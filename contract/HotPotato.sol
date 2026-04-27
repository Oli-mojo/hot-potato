// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  HOT POTATO — v4
//  Single ERC-721 NFT always for sale. Price only goes up.
//  Souvenir NFTs are minted by a separate HotPotatoSouvenir
//  contract, keeping the two collections cleanly separated on
//  OpenSea and marketplaces.
//
//  What changed from v3:
//  - Souvenir minting delegated to ISouvenirContract
//  - Souvenir storage removed from this contract entirely
//  - Constructor takes souvenir contract address
//
//  Game rules (unchanged):
//  - Token 0 = The Hot Potato, always for sale
//  - Price only goes up (tiered minimum increase)
//  - 5% of every sale → creator wallet
//  - Overpaying above the minimum banks a rarity boost
//  - Hold longer for rarer souvenir odds
//  - Starting price: 0.001 ETH
// ============================================================

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ─── Souvenir contract interface ──────────────────────────────
interface ISouvenirContract {
    function mint(
        address to,
        uint256 transferNumber,
        uint256 pricePaid,
        uint256 holdDuration,
        uint8   rarityTierUint
    ) external returns (uint256 tokenId);

    function souvenirCount() external view returns (uint256);
}

contract HotPotato is ERC721, ERC2981, Ownable, ReentrancyGuard {

    // ─── Token ID ─────────────────────────────────────────────
    // Token 0 = The Hot Potato. Only token this contract ever holds.
    uint256 public constant POTATO_TOKEN_ID = 0;

    // ─── Game constants ───────────────────────────────────────
    uint256 public constant STARTING_PRICE  = 0.001 ether;
    uint256 public constant CREATOR_FEE_BPS = 500;   // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ─── Tiered minimum price increase ────────────────────────
    // Scales down as price rises so the game stays accessible at
    // high valuations.
    //
    //   Price paid      Min increase   Multiplier (BPS)
    //   ──────────────  ────────────   ────────────────
    //   < 0.1 ETH       +25%           12500
    //   0.1 – 1 ETH     +15%           11500
    //   1 – 10 ETH      +10%           11000
    //   10 – 100 ETH    + 7%           10700
    //   100+ ETH        + 5%           10500
    function _minIncreaseBps(uint256 price) internal pure returns (uint256) {
        if (price <    0.1 ether)  return 12500;
        if (price <    1   ether)  return 11500;
        if (price <   10   ether)  return 11000;
        if (price <  100   ether)  return 10700;
        return                            10500;
    }

    // ─── Creator wallet ───────────────────────────────────────
    address public constant CREATOR_WALLET =
        0x995a13322683cf42463Cd1bDE6412020Ce685008;

    // ─── Rarity ───────────────────────────────────────────────
    // 0=Common  1=Rare  2=Epic  3=Legendary
    enum RarityTier { Common, Rare, Epic, Legendary }

    // ─── Holder info — stored at purchase time ────────────────
    struct HolderInfo {
        uint256 purchaseTimestamp;
        uint8   premiumBoostLevel; // 0–4, based on how much they overpaid
    }

    // ─── State ────────────────────────────────────────────────
    uint256 public currentPrice;
    uint256 public totalTransfers;

    HolderInfo public holderInfo;

    ISouvenirContract public souvenirContract;

    // Hot Potato's own metadata URI (set by owner/backend)
    string private _potatoURI;

    // ─── Events ───────────────────────────────────────────────
    event PotatoPassed(
        address indexed from,
        address indexed to,
        uint256 price,
        uint256 holdDuration,
        uint256 souvenirTokenId,
        uint8   rarityTier,
        uint8   buyerBoostLevel
    );

    // ─── Constructor ──────────────────────────────────────────
    constructor(address _souvenirContract)
        ERC721("Hot Potato", "HOTP")
        Ownable(msg.sender)
    {
        require(_souvenirContract != address(0), "Zero souvenir address");
        souvenirContract = ISouvenirContract(_souvenirContract);

        currentPrice = STARTING_PRICE;

        // Mint The Hot Potato to deployer
        _mint(msg.sender, POTATO_TOKEN_ID);

        // Record deployer as first holder
        holderInfo = HolderInfo({
            purchaseTimestamp: block.timestamp,
            premiumBoostLevel: 0
        });

        // ERC-2981: 5% royalty for marketplace secondary sales
        _setDefaultRoyalty(CREATOR_WALLET, uint96(CREATOR_FEE_BPS));
    }

    // ─── Buy The Potato ───────────────────────────────────────
    /**
     * @param newAskingPrice  Your new asking price for the next buyer.
     *                        Must be >= msg.value × (1 + minIncrease%).
     *
     * Overpay above the minimum to bank a rarity boost on your souvenir:
     *   Boost   Overpayment above asking   Effect
     *   ─────   ────────────────────────   ──────────────────────────
     *   0       < 10%                      Pure hold-duration odds
     *   1       10–24%                     +1 rarity tier
     *   2       25–49%                     +2 rarity tiers
     *   3       50–99%                     +3 rarity tiers
     *   4       100%+                      Max (Legendary odds)
     */
    function buyPotato(uint256 newAskingPrice) external payable nonReentrant {
        address seller = ownerOf(POTATO_TOKEN_ID);
        require(msg.sender != seller, "You already hold the potato");

        // ── Validate payment ────────────────────────────────
        require(msg.value >= currentPrice, "Payment too low");

        // ── Validate new asking price ────────────────────────
        uint256 bps        = _minIncreaseBps(msg.value);
        uint256 minNextAsk = (msg.value * bps) / BPS_DENOMINATOR;
        require(newAskingPrice >= minNextAsk, "New asking price below tiered minimum");

        // ── Capture pre-sale state ───────────────────────────
        uint256 holdDuration     = block.timestamp - holderInfo.purchaseTimestamp;
        uint8   sellerBoost      = holderInfo.premiumBoostLevel;
        uint8   rarityTierUint   = uint8(_rollRarity(holdDuration, sellerBoost));
        uint8   buyerBoost       = _premiumBoostLevel(msg.value, currentPrice);
        uint256 handNumber       = totalTransfers + 1;

        // ── Update state BEFORE external calls (CEI pattern) ─
        totalTransfers++;
        currentPrice = newAskingPrice;
        holderInfo   = HolderInfo({
            purchaseTimestamp: block.timestamp,
            premiumBoostLevel: buyerBoost
        });

        // ── Mint souvenir to seller via souvenir contract ────
        uint256 souvenirId = souvenirContract.mint(
            seller, handNumber, msg.value, holdDuration, rarityTierUint
        );

        // ── Transfer The Hot Potato to buyer ─────────────────
        _transfer(seller, msg.sender, POTATO_TOKEN_ID);

        // ── Pay creator (5%) then seller (95%) ───────────────
        uint256 creatorFee     = (msg.value * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerProceeds = msg.value - creatorFee;

        (bool creatorOk,) = CREATOR_WALLET.call{value: creatorFee}("");
        require(creatorOk, "Creator fee transfer failed");

        (bool sellerOk,) = seller.call{value: sellerProceeds}("");
        require(sellerOk, "Seller payment failed");

        emit PotatoPassed(
            seller, msg.sender, msg.value,
            holdDuration, souvenirId, rarityTierUint, buyerBoost
        );
    }

    // ─── Premium Boost Logic ──────────────────────────────────
    function _premiumBoostLevel(uint256 paid, uint256 minimum)
        internal pure returns (uint8)
    {
        if (paid <= minimum) return 0;
        uint256 overpaymentBps = ((paid - minimum) * BPS_DENOMINATOR) / minimum;
        if (overpaymentBps >= 10000) return 4; // 100%+
        if (overpaymentBps >= 5000)  return 3; // 50–99%
        if (overpaymentBps >= 2500)  return 2; // 25–49%
        if (overpaymentBps >= 1000)  return 1; // 10–24%
        return 0;
    }

    // ─── Rarity Roll ──────────────────────────────────────────
    function _rollRarity(uint256 holdDuration, uint8 premiumBoost)
        internal view returns (RarityTier)
    {
        uint8 holdTier      = _holdTier(holdDuration);
        uint8 effectiveTier = holdTier + premiumBoost > 4 ? 4 : holdTier + premiumBoost;
        uint256[4] memory w = _tierWeights(effectiveTier);

        uint256 rand = uint256(keccak256(abi.encodePacked(
            block.prevrandao,
            block.timestamp,
            msg.sender,
            totalTransfers
        ))) % 100;

        uint256 cumulative = 0;
        for (uint8 i = 0; i < 4; i++) {
            cumulative += w[i];
            if (rand < cumulative) return RarityTier(i);
        }
        return RarityTier.Common;
    }

    // ─── Hold Duration → Base Tier ────────────────────────────
    function _holdTier(uint256 holdDuration) internal pure returns (uint8) {
        if (holdDuration <   6 hours) return 0; // < 6h      — Common
        if (holdDuration <  48 hours) return 1; // 6h–2 days — Rare
        if (holdDuration <   7 days)  return 2; // 2–7 days  — Epic
        if (holdDuration <  30 days)  return 3; // 7–30 days — Legendary
        return 4;                               // 30+ days  — Max odds
    }

    // ─── Tier → Rarity Weights ────────────────────────────────
    // [Common, Rare, Epic, Legendary] — must sum to 100
    function _tierWeights(uint8 tier)
        internal pure returns (uint256[4] memory)
    {
        if (tier == 0) return [uint256(85), 12,  2,  1];
        if (tier == 1) return [uint256(60), 28,  9,  3];
        if (tier == 2) return [uint256(20), 40, 25, 15];
        if (tier == 3) return [uint256( 5), 20, 45, 30];
                       return [uint256( 1),  9, 40, 50];
    }

    // ─── Read Functions ───────────────────────────────────────

    /// Core game state — same signature as v3 for backend compatibility.
    function getGameState() external view returns (
        address currentOwner,
        uint256 price,
        uint256 timeHeld,
        uint256 totalTransfers_
    ) {
        return (
            ownerOf(POTATO_TOKEN_ID),
            currentPrice,
            block.timestamp - holderInfo.purchaseTimestamp,
            totalTransfers
        );
    }

    /// Extended state including souvenir count and boost info.
    function getExtendedState() external view returns (
        address currentOwner,
        uint256 price,
        uint256 timeHeld,
        uint256 totalTransfers_,
        uint256 totalSouvenirs_,
        uint8   currentBoostLevel,
        uint256 minNextPayment
    ) {
        uint256 minNext = (currentPrice * _minIncreaseBps(currentPrice)) / BPS_DENOMINATOR;
        return (
            ownerOf(POTATO_TOKEN_ID),
            currentPrice,
            block.timestamp - holderInfo.purchaseTimestamp,
            totalTransfers,
            souvenirContract.souvenirCount() - 1, // -1 because souvenirCount starts at 1
            holderInfo.premiumBoostLevel,
            minNext
        );
    }

    /// Preview rarity odds for the current holder right now.
    function previewRarityOdds() external view returns (
        uint8 holdTier,
        uint8 premiumBoost,
        uint8 effectiveTier,
        uint256 chanceCommon,
        uint256 chanceRare,
        uint256 chanceEpic,
        uint256 chanceLegendary
    ) {
        uint256 holdDuration = block.timestamp - holderInfo.purchaseTimestamp;
        holdTier      = _holdTier(holdDuration);
        premiumBoost  = holderInfo.premiumBoostLevel;
        effectiveTier = holdTier + premiumBoost > 4 ? 4 : holdTier + premiumBoost;
        uint256[4] memory w = _tierWeights(effectiveTier);
        return (holdTier, premiumBoost, effectiveTier, w[0], w[1], w[2], w[3]);
    }

    // ─── Token URI ────────────────────────────────────────────
    function tokenURI(uint256 tokenId)
        public view override returns (string memory)
    {
        require(tokenId == POTATO_TOKEN_ID, "Only token 0 exists in this contract");
        return _potatoURI;
    }

    /// Set The Hot Potato's own metadata URI (called by owner/backend)
    function setPotatoURI(string calldata uri) external onlyOwner {
        _potatoURI = uri;
    }

    // ─── Admin ────────────────────────────────────────────────

    /// Update the souvenir contract address (owner only, for emergency use)
    function setSouvenirContract(address _souvenirContract) external onlyOwner {
        require(_souvenirContract != address(0), "Zero address");
        souvenirContract = ISouvenirContract(_souvenirContract);
    }

    // ─── ERC-165 ──────────────────────────────────────────────
    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ─── Safety withdraw ──────────────────────────────────────
    /// Rescue any accidentally stuck ETH
    function withdraw() external onlyOwner {
        (bool ok,) = owner().call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }
}

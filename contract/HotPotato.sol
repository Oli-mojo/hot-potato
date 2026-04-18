// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  HOT POTATO — v2
//  Single ERC-721 NFT always for sale. Price only goes up.
//  Outgoing holder earns a souvenir NFT on every sale.
//
//  New in v2:
//  - 5% of every sale → Original Potato Wallet (creator)
//  - Premium boost: overpaying above minimum earns better
//    rarity odds on your future souvenir
//  - Starting price: 0.001 ETH (10× lower than v1)
//  - ERC-2981 royalty standard for marketplace compatibility
// ============================================================

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract HotPotato is ERC721, ERC2981, Ownable, ReentrancyGuard {

    // ─── Token IDs ────────────────────────────────────────────
    // Token 0 = The Hot Potato (special, always exists, just transferred)
    // Tokens 1+ = Souvenir NFTs (minted fresh on each sale)
    uint256 public constant POTATO_TOKEN_ID = 0;

    // ─── Game constants ───────────────────────────────────────
    uint256 public constant STARTING_PRICE    = 0.001 ether;
    uint256 public constant MIN_INCREASE_BPS  = 11500;  // 115% = minimum 15% increase
    uint256 public constant CREATOR_FEE_BPS   = 500;    // 5%
    uint256 public constant BPS_DENOMINATOR   = 10000;

    // ─── Original Potato Wallet ───────────────────────────────
    address public constant CREATOR_WALLET =
        0x995a13322683cf42463Cd1bDE6412020Ce685008;

    // ─── Rarity ───────────────────────────────────────────────
    // 0=Common  1=Rare  2=Epic  3=Legendary
    enum RarityTier { Common, Rare, Epic, Legendary }

    // ─── Souvenir on-chain data ───────────────────────────────
    struct SouvenirData {
        uint256 transferNumber;   // which hand this was
        uint256 pricePaid;        // what the buyer paid (wei)
        uint256 holdDuration;     // how long the seller held (seconds)
        RarityTier rarityTier;    // rolled at time of sale
        address originalOwner;    // who earned this souvenir
    }

    // ─── Holder info stored at purchase time ──────────────────
    // Used to calculate rarity when they eventually sell
    struct HolderInfo {
        uint256 purchaseTimestamp;
        uint8   premiumBoostLevel; // 0–4, based on how much they overpaid
    }

    // ─── State ────────────────────────────────────────────────
    uint256 public currentPrice;
    uint256 public totalTransfers;
    uint256 public souvenirCount;  // next souvenir token ID (starts at 1)

    HolderInfo public holderInfo;

    mapping(uint256 => SouvenirData) public souvenirs;
    mapping(uint256 => string)       private _tokenURIs;

    // ─── Events ───────────────────────────────────────────────
    event PotatoPassed(
        address indexed from,
        address indexed to,
        uint256 price,
        uint256 holdDuration,
        uint256 souvenirTokenId,
        uint8   rarityTier,
        uint8   buyerBoostLevel   // stored boost for the new holder
    );

    // ─── Constructor ──────────────────────────────────────────
    constructor() ERC721("Hot Potato", "HOTP") Ownable(msg.sender) {
        currentPrice  = STARTING_PRICE;
        souvenirCount = 1; // first souvenir will be token 1

        // Mint The Hot Potato to deployer
        _mint(msg.sender, POTATO_TOKEN_ID);

        // Record deployer as first holder
        holderInfo = HolderInfo({
            purchaseTimestamp: block.timestamp,
            premiumBoostLevel: 0
        });

        // ERC-2981: register 5% royalty for marketplace secondary sales
        _setDefaultRoyalty(CREATOR_WALLET, uint96(CREATOR_FEE_BPS));
    }

    // ─── Buy The Potato ───────────────────────────────────────
    /**
     * @param newAskingPrice  The price you want to sell at (must be >= msg.value * 1.15)
     *
     * Strategy tip: pay more than minimum to bank a premium boost on your
     * future souvenir. The bigger the overpayment, the rarer the odds.
     *
     *   Boost level   Overpayment above min   Rarity effect
     *   ──────────    ─────────────────────   ─────────────
     *   0             < 10%                   Pure hold-duration odds
     *   1             10–24%                  +1 rarity tier
     *   2             25–49%                  +2 rarity tiers
     *   3             50–99%                  +3 rarity tiers
     *   4             100%+                   Max tier (legendary odds)
     */
    function buyPotato(uint256 newAskingPrice) external payable nonReentrant {
        address seller = ownerOf(POTATO_TOKEN_ID);
        require(msg.sender != seller, "You already hold the potato");

        // ── Validate payment ────────────────────────────────
        uint256 minPayment = (currentPrice * MIN_INCREASE_BPS) / BPS_DENOMINATOR;
        require(msg.value >= minPayment, "Payment too low: need >= 15% above current price");

        // ── Validate new asking price ───────────────────────
        uint256 minNextAsk = (msg.value * MIN_INCREASE_BPS) / BPS_DENOMINATOR;
        require(newAskingPrice >= minNextAsk, "New asking price too low: must be >= 15% above what you paid");

        // ── Calculate buyer's stored boost ──────────────────
        uint8 buyerBoost = _premiumBoostLevel(msg.value, minPayment);

        // ── Roll seller's souvenir rarity ───────────────────
        uint256 holdDuration = block.timestamp - holderInfo.purchaseTimestamp;
        uint8 rarityTierUint = uint8(_rollRarity(holdDuration, holderInfo.premiumBoostLevel));

        // ── Mint souvenir to seller ──────────────────────────
        uint256 souvenirId = souvenirCount++;
        _mint(seller, souvenirId);
        souvenirs[souvenirId] = SouvenirData({
            transferNumber: totalTransfers + 1,
            pricePaid:      msg.value,
            holdDuration:   holdDuration,
            rarityTier:     RarityTier(rarityTierUint),
            originalOwner:  seller
        });

        // ── Transfer The Hot Potato ──────────────────────────
        _transfer(seller, msg.sender, POTATO_TOKEN_ID);
        totalTransfers++;

        // ── Update state (before external calls) ────────────
        currentPrice = newAskingPrice;
        holderInfo   = HolderInfo({
            purchaseTimestamp: block.timestamp,
            premiumBoostLevel: buyerBoost
        });

        // ── Pay creator (5%) then seller (95%) ──────────────
        uint256 creatorFee      = (msg.value * CREATOR_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerProceeds  = msg.value - creatorFee;

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
    /**
     * Returns boost level 0–4 based on how much above minimum was paid.
     * Stored at purchase time; applied when the holder eventually sells.
     */
    function _premiumBoostLevel(uint256 paid, uint256 minimum)
        internal pure returns (uint8)
    {
        if (paid <= minimum) return 0;
        // overpaymentBps = how many BPS above minimum
        // e.g., paid = 1.5× minimum → overpaymentBps = 5000 (50%)
        uint256 overpaymentBps = ((paid - minimum) * BPS_DENOMINATOR) / minimum;

        if (overpaymentBps >= 10000) return 4; // 100%+ above minimum → max boost
        if (overpaymentBps >= 5000)  return 3; // 50–99%
        if (overpaymentBps >= 2500)  return 2; // 25–49%
        if (overpaymentBps >= 1000)  return 1; // 10–24%
        return 0;                               // < 10% — no boost
    }

    // ─── Rarity Roll ──────────────────────────────────────────
    /**
     * Premium boost advances your effective hold tier upward.
     * e.g., held < 24h (tier 0) + boost 2 = tier 2 (1–4 week odds).
     * Capped at tier 4 (3+ month / legendary odds).
     */
    function _rollRarity(uint256 holdDuration, uint8 premiumBoost)
        internal view returns (RarityTier)
    {
        uint8 holdTier      = _holdTier(holdDuration);
        uint8 effectiveTier = holdTier + premiumBoost > 4
                                ? 4
                                : holdTier + premiumBoost;

        uint256[4] memory w = _tierWeights(effectiveTier);

        // Pseudo-random roll using block data + context
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

    // ─── Hold Duration → Tier ─────────────────────────────────
    function _holdTier(uint256 holdDuration) internal pure returns (uint8) {
        if (holdDuration <  1 days)  return 0; // < 24h
        if (holdDuration <  7 days)  return 1; // 1–7 days
        if (holdDuration < 28 days)  return 2; // 1–4 weeks
        if (holdDuration < 90 days)  return 3; // 1–3 months
        return 4;                               // 3+ months
    }

    // ─── Tier → Rarity Weights ────────────────────────────────
    // [Common, Rare, Epic, Legendary] must sum to 100
    function _tierWeights(uint8 tier)
        internal pure returns (uint256[4] memory)
    {
        if (tier == 0) return [uint256(85), 12,  2,  1]; // < 24h
        if (tier == 1) return [uint256(60), 28,  9,  3]; // 1–7 days
        if (tier == 2) return [uint256(20), 40, 25, 15]; // 1–4 weeks
        if (tier == 3) return [uint256( 5), 20, 45, 30]; // 1–3 months
                       return [uint256( 1),  9, 40, 50]; // 3+ months
    }

    // ─── Read Functions ───────────────────────────────────────

    /**
     * Same signature as v1 — backend requires no changes.
     */
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

    /**
     * Extended state — new fields for the frontend boost display.
     */
    function getExtendedState() external view returns (
        address currentOwner,
        uint256 price,
        uint256 timeHeld,
        uint256 totalTransfers_,
        uint256 totalSouvenirs_,
        uint8   currentBoostLevel,
        uint256 minNextPayment
    ) {
        return (
            ownerOf(POTATO_TOKEN_ID),
            currentPrice,
            block.timestamp - holderInfo.purchaseTimestamp,
            totalTransfers,
            souvenirCount - 1,
            holderInfo.premiumBoostLevel,
            (currentPrice * MIN_INCREASE_BPS) / BPS_DENOMINATOR
        );
    }

    /**
     * Preview rarity odds for the current holder at this moment.
     * Useful for the frontend to show "your current souvenir odds".
     */
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
        holdTier     = _holdTier(holdDuration);
        premiumBoost = holderInfo.premiumBoostLevel;
        effectiveTier = holdTier + premiumBoost > 4 ? 4 : holdTier + premiumBoost;
        uint256[4] memory w = _tierWeights(effectiveTier);
        return (holdTier, premiumBoost, effectiveTier, w[0], w[1], w[2], w[3]);
    }

    // ─── Token URI ────────────────────────────────────────────
    function tokenURI(uint256 tokenId)
        public view override returns (string memory)
    {
        return _tokenURIs[tokenId];
    }

    /// Set souvenir metadata URI (called by backend after IPFS upload)
    function setSouvenirURI(uint256 tokenId, string calldata uri)
        external onlyOwner
    {
        _tokenURIs[tokenId] = uri;
    }

    /// Set the Hot Potato's own metadata URI
    function setPotatoURI(string calldata uri) external onlyOwner {
        _tokenURIs[POTATO_TOKEN_ID] = uri;
    }

    // ─── ERC-165 supportsInterface ────────────────────────────
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

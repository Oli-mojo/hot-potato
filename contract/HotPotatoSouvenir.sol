// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  HOT POTATO SOUVENIR — v1
//  Separate ERC-721 collection for souvenir NFTs.
//  Minted by the HotPotato game contract on every sale.
//  Each souvenir permanently records the holder's stats.
//
//  Deployment order:
//    1. Deploy HotPotatoSouvenir → get SOUVENIR_ADDRESS
//    2. Deploy HotPotato(SOUVENIR_ADDRESS) → get GAME_ADDRESS
//    3. Call souvenir.setGameContract(GAME_ADDRESS)
//    4. Call souvenir.transferOwnership(BACKEND_WALLET)
//    5. Call game.transferOwnership(BACKEND_WALLET)
// ============================================================

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract HotPotatoSouvenir is ERC721, ERC2981, Ownable {

    // ─── Rarity ───────────────────────────────────────────────
    // 0=Common  1=Rare  2=Epic  3=Legendary
    enum RarityTier { Common, Rare, Epic, Legendary }

    // ─── Souvenir on-chain data ───────────────────────────────
    struct SouvenirData {
        uint256 transferNumber;  // which hand this was (1-indexed)
        uint256 pricePaid;       // what the buyer paid (wei)
        uint256 holdDuration;    // how long the seller held (seconds)
        RarityTier rarityTier;   // rolled by game contract at time of sale
        address originalOwner;   // who earned this souvenir
    }

    // ─── Creator wallet ───────────────────────────────────────
    address public constant CREATOR_WALLET =
        0x995a13322683cf42463Cd1bDE6412020Ce685008;
    uint256 public constant CREATOR_FEE_BPS = 500;   // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ─── State ────────────────────────────────────────────────
    uint256 public totalMinted;       // total souvenirs minted (also = next token ID)
    address public gameContract;      // the HotPotato game — only authorised minter

    mapping(uint256 => SouvenirData) public souvenirs;
    mapping(uint256 => string)       private _tokenURIs;

    // ─── Events ───────────────────────────────────────────────
    event SouvenirMinted(
        uint256 indexed tokenId,
        address indexed originalOwner,
        uint256 transferNumber,
        uint256 pricePaid,
        uint256 holdDuration,
        uint8   rarityTier
    );

    // ─── Constructor ──────────────────────────────────────────
    constructor() ERC721("Hot Potato Souvenir", "HOTPS") Ownable(msg.sender) {
        // 5% royalty on secondary marketplace sales → creator wallet
        _setDefaultRoyalty(CREATOR_WALLET, uint96(CREATOR_FEE_BPS));
    }

    // ─── Access control ───────────────────────────────────────
    modifier onlyGame() {
        require(msg.sender == gameContract, "Caller is not the game contract");
        _;
    }

    /// Authorise the HotPotato game contract to mint souvenirs.
    /// Call once after deploying the game contract.
    function setGameContract(address _gameContract) external onlyOwner {
        require(_gameContract != address(0), "Zero address");
        gameContract = _gameContract;
    }

    // ─── Mint — called by HotPotato game on every sale ────────
    /**
     * @param to             Seller — who receives the souvenir
     * @param transferNumber Which hand this was (totalTransfers + 1)
     * @param pricePaid      What the buyer paid in wei
     * @param holdDuration   How long the seller held in seconds
     * @param rarityTierUint Rarity rolled by game contract (0–3)
     * @return tokenId       The minted souvenir token ID
     */
    function mint(
        address to,
        uint256 transferNumber,
        uint256 pricePaid,
        uint256 holdDuration,
        uint8   rarityTierUint
    ) external onlyGame returns (uint256) {
        uint256 tokenId = totalMinted++;
        _mint(to, tokenId);
        souvenirs[tokenId] = SouvenirData({
            transferNumber: transferNumber,
            pricePaid:      pricePaid,
            holdDuration:   holdDuration,
            rarityTier:     RarityTier(rarityTierUint),
            originalOwner:  to
        });
        emit SouvenirMinted(tokenId, to, transferNumber, pricePaid, holdDuration, rarityTierUint);
        return tokenId;
    }

    // ─── Token URI ────────────────────────────────────────────
    function tokenURI(uint256 tokenId)
        public view override returns (string memory)
    {
        return _tokenURIs[tokenId];
    }

    /// Set souvenir metadata URI — called by backend after IPFS upload
    function setSouvenirURI(uint256 tokenId, string calldata uri)
        external onlyOwner
    {
        _tokenURIs[tokenId] = uri;
    }

    // ─── ERC-165 ──────────────────────────────────────────────
    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

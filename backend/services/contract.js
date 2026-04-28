// Hot Potato — Contract Service (v4)
// Two contracts:
//   HotPotato (game)         — token 0, manages the potato + rarity rolls
//   HotPotatoSouvenir (NFTs) — separate ERC-721 collection, minted by game
//
// Required env vars:
//   CONTRACT_ADDRESS    — HotPotato game contract
//   SOUVENIR_ADDRESS    — HotPotatoSouvenir contract
//   RPC_URL             — Base mainnet or Sepolia RPC endpoint
//   WALLET_PRIVATE_KEY  — backend operator wallet (set URIs, not game funds)

const { ethers } = require('ethers');

// ── Addresses ──────────────────────────────────────────────────────────────────
const GAME_ADDRESS     = process.env.CONTRACT_ADDRESS;
const SOUVENIR_ADDRESS = process.env.SOUVENIR_ADDRESS;
const RPC_URL          = process.env.RPC_URL;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

// ── ABIs ───────────────────────────────────────────────────────────────────────

// HotPotato.sol — game contract (token 0 only)
const GAME_ABI = [
  // Core buy function
  'function buyPotato(uint256 newAskingPrice) external payable',
  // Read
  'function getGameState() external view returns (address currentOwner, uint256 price, uint256 timeHeld, uint256 totalTransfers)',
  'function getExtendedState() external view returns (address currentOwner, uint256 price, uint256 timeHeld, uint256 totalTransfers, uint256 totalSouvenirs, uint8 currentBoostLevel, uint256 minNextPayment)',
  'function previewRarityOdds() external view returns (uint8 holdTier, uint8 premiumBoost, uint8 effectiveTier, uint256 chanceCommon, uint256 chanceRare, uint256 chanceEpic, uint256 chanceLegendary)',
  'function currentPrice() view returns (uint256)',
  'function totalTransfers() view returns (uint256)',
  'function souvenirContract() view returns (address)',
  // Admin
  'function setPotatoURI(string calldata uri) external',
  'function withdraw() external',
  // Event
  'event PotatoPassed(address indexed from, address indexed to, uint256 price, uint256 holdDuration, uint256 souvenirTokenId, uint8 rarityTier, uint8 buyerBoostLevel)',
];

// HotPotatoSouvenir.sol — souvenir NFT collection
const SOUVENIR_ABI = [
  // Read
  'function souvenirCount() external view returns (uint256)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function gameContract() view returns (address)',
  // Write — backend wallet only (owner)
  'function setSouvenirURI(uint256 tokenId, string calldata uri) external',
  'function batchSetSouvenirURI(uint256[] calldata tokenIds, string[] calldata uris) external',
  // Event
  'event SouvenirMinted(uint256 indexed tokenId, address indexed originalOwner, uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier)',
];

// ── Provider / signer helpers ──────────────────────────────────────────────────

function getProvider() {
  if (!RPC_URL) throw new Error('RPC_URL env var not set');
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getSigner() {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY env var not set');
  return new ethers.Wallet(WALLET_PRIVATE_KEY, getProvider());
}

function getGameContract(signerOrProvider) {
  if (!GAME_ADDRESS) throw new Error('CONTRACT_ADDRESS env var not set');
  return new ethers.Contract(GAME_ADDRESS, GAME_ABI, signerOrProvider || getProvider());
}

function getSouvenirContract(signerOrProvider) {
  if (!SOUVENIR_ADDRESS) throw new Error('SOUVENIR_ADDRESS env var not set');
  return new ethers.Contract(SOUVENIR_ADDRESS, SOUVENIR_ABI, signerOrProvider || getProvider());
}

// ── Game state ─────────────────────────────────────────────────────────────────

async function getPotatoState() {
  const provider = getProvider();
  const game     = getGameContract(provider);

  const [owner, price, timeHeld, transfers, souvenirs, boostLevel, minNext] =
    await game.getExtendedState();

  const holdDurationHours = Number(timeHeld) / 3600;

  return {
    currentOwner:       owner,
    currentPrice:       ethers.formatEther(price),
    currentPriceWei:    price.toString(),
    holdDurationHours,
    holdDurationSeconds: Number(timeHeld),
    totalTransfers:     Number(transfers),
    totalSouvenirs:     Number(souvenirs),
    currentBoostLevel:  Number(boostLevel),
    minNextPayment:     ethers.formatEther(minNext),
    minNextPaymentWei:  minNext.toString(),
  };
}

// ── Rarity tier helpers ────────────────────────────────────────────────────────

// Mirror of HotPotato._holdTier() — keeps frontend/backend in sync with contract
function getRarityTier(holdDurationHours) {
  const TIERS = [
    { maxHours:   6, tier: 'common',    label: 'Common',    weights: { common: 85, rare: 12, epic:  2, legendary:  1 } },
    { maxHours:  48, tier: 'rare',      label: 'Rare',      weights: { common: 60, rare: 28, epic:  9, legendary:  3 } },
    { maxHours: 168, tier: 'epic',      label: 'Epic',      weights: { common: 20, rare: 40, epic: 25, legendary: 15 } },
    { maxHours: 720, tier: 'legendary', label: 'Legendary', weights: { common:  5, rare: 20, epic: 45, legendary: 30 } },
    { maxHours: Infinity, tier: 'legendary', label: 'Legendary', weights: { common: 1, rare: 9, epic: 40, legendary: 50 } },
  ];
  return TIERS.find(t => holdDurationHours < t.maxHours) || TIERS[TIERS.length - 1];
}

// Convert a numeric rarity tier (0–3 from contract enum) to a label
function rarityLabel(rarityTierUint) {
  return ['common', 'rare', 'epic', 'legendary'][rarityTierUint] || 'common';
}

// ── Token URI setter ───────────────────────────────────────────────────────────

/**
 * Read a souvenir's current token URI from the contract.
 * Returns an empty string if not yet set or if the call reverts.
 * Used by the generate route as an idempotency check (H-7).
 */
async function getTokenURI(tokenId) {
  try {
    const souvenir = getSouvenirContract(getProvider());
    return await souvenir.tokenURI(tokenId);
  } catch {
    return '';
  }
}

/**
 * Set a souvenir's IPFS metadata URI on-chain.
 * Called by the backend after image generation + Pinata upload.
 * Backend wallet must be the owner of the souvenir contract.
 */
async function setTokenURI(tokenId, uri) {
  const signer    = getSigner();
  const souvenir  = getSouvenirContract(signer);
  const tx        = await souvenir.setSouvenirURI(tokenId, uri);
  await tx.wait();
  console.log(`✅ Souvenir URI set: #${tokenId} → ${uri}`);
  return tx.hash;
}

/**
 * Set multiple souvenir URIs in one transaction (gas-efficient for backfills).
 */
async function batchSetTokenURIs(tokenIds, uris) {
  const signer   = getSigner();
  const souvenir = getSouvenirContract(signer);
  const tx       = await souvenir.batchSetSouvenirURI(tokenIds, uris);
  await tx.wait();
  console.log(`✅ Batch URI set: ${tokenIds.length} souvenirs`);
  return tx.hash;
}

// ── Stub compatibility shims ───────────────────────────────────────────────────
// These keep souvenir.js working without a full rewrite.
// In v4, rarity is rolled on-chain at mint time — no score system needed.
// Backend boosts affect the image generation prompt only.

function getSouvenirScore(tokenId) {
  // No-op in v4. Rarity is already in the on-chain SouvenirData.rarityTier.
  // Returns 0 so existing boost logic is a no-op (0 base + N boost = N → image only).
  return Promise.resolve(0);
}

function scoreToRarity(score) {
  // Not used in v4, kept for compatibility.
  return 'common';
}

function applyScoreBoost(baseScore, boost) {
  // In v4, boost is passed directly to image generation.
  // Return boost value so souvenir.js can use it for prompt selection.
  return boost;
}

async function setRarityScore(tokenId, newScore) {
  // No-op in v4. On-chain rarity is immutable after mint.
  // Image quality is controlled via the image generation prompt.
  console.log(`ℹ️  setRarityScore skipped in v4 (tokenId ${tokenId}) — rarity is on-chain`);
  return null;
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  // Contract instances (for routes that build their own queries)
  getProvider,
  getSigner,
  getGameContract,
  getSouvenirContract,
  // State
  getPotatoState,
  getRarityTier,
  rarityLabel,
  // URI management
  getTokenURI,
  setTokenURI,
  batchSetTokenURIs,
  // Compatibility shims (souvenir.js imports these)
  getSouvenirScore,
  scoreToRarity,
  applyScoreBoost,
  setRarityScore,
};

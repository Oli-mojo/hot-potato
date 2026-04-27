// Hot Potato — Smart Contract Service (V4)
// Two contracts: JackpotatoV4 (game) + SouvenirNFT (souvenirs)
const { ethers } = require('ethers');

// ── Addresses ───────────────────────────────────────────────────────────────
// Set both in Railway environment variables when V4 is deployed.
// GAME_ADDRESS    = JackpotatoV4 contract
// SOUVENIR_ADDRESS = SouvenirNFT contract
const GAME_ADDRESS     = process.env.GAME_ADDRESS     || process.env.CONTRACT_ADDRESS || '0x90Bfcf98282445B35e3ce48b9Eb21E532E603473'; // fallback to v3 during transition
const SOUVENIR_ADDRESS = process.env.SOUVENIR_ADDRESS || GAME_ADDRESS; // v3 was a single contract
const RPC_URL          = process.env.RPC_URL;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

// ── ABIs ─────────────────────────────────────────────────────────────────────

const GAME_ABI = [
  // State reads
  'function holder() view returns (address)',
  'function lastJackPrice() view returns (uint256)',
  'function jackCount() view returns (uint256)',
  'function pot() view returns (uint256)',
  'function seasonNumber() view returns (uint256)',
  'function gameState() view returns (uint8)',
  'function lastTransferAt() view returns (uint256)',
  // Computed views
  'function currentStage() view returns (uint8)',
  'function currentTier() view returns (uint8)',
  'function minNextAsk() view returns (uint256)',
  'function timeUntilBoil() view returns (uint256)',
  'function holderMinPayout() view returns (uint256)',
];

const SOUVENIR_ABI = [
  // State reads
  'function totalMinted() view returns (uint256)',
  'function souvenirData(uint256 tokenId) view returns (address holder, uint256 holdDuration, uint8 tier, uint8 stage, uint256 jackPrice, uint256 prevPrice, uint256 mintedAt, uint256 season, uint256 rarityScore)',
  'function rarityFromScore(uint256 score) view returns (uint8)',
  'function rarityOf(uint256 tokenId) view returns (uint8)',
  // Write — URI setter wallet only
  'function setTokenURI(uint256 tokenId, string memory uri) external',
  'function batchSetTokenURI(uint256[] calldata tokenIds, string[] calldata uris) external',
  'function setRarityScore(uint256 tokenId, uint256 newScore) external',
  // Events (for off-chain listeners)
  'event SouvenirMinted(uint256 indexed tokenId, address indexed holder, uint256 holdDuration, uint8 tier, uint8 stage, uint256 rarityScore, uint8 rarity, uint256 season)',
  'event RarityScoreUpdated(uint256 indexed tokenId, uint256 oldScore, uint256 newScore)',
  'event URISet(uint256 indexed tokenId, string uri)',
];

// ── Provider / signer helpers ─────────────────────────────────────────────────

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getSigner() {
  return new ethers.Wallet(WALLET_PRIVATE_KEY, getProvider());
}

function getGameContract(signerOrProvider) {
  return new ethers.Contract(GAME_ADDRESS, GAME_ABI, signerOrProvider || getProvider());
}

function getSouvenirContract(signerOrProvider) {
  return new ethers.Contract(SOUVENIR_ADDRESS, SOUVENIR_ABI, signerOrProvider || getProvider());
}

// ── Game state ────────────────────────────────────────────────────────────────

async function getPotatoState() {
  const provider  = getProvider();
  const game      = getGameContract(provider);
  const souvenirs = getSouvenirContract(provider);

  const [holder, price, jackCount, pot, stageNum, totalMinted, boilSeconds] = await Promise.all([
    game.holder(),
    game.lastJackPrice(),
    game.jackCount(),
    game.pot(),
    game.currentStage(),
    souvenirs.totalMinted(),
    game.timeUntilBoil(),
  ]);

  const STAGE_NAMES = ['Dormant', 'Sprouting', 'Harvest'];

  return {
    currentHolder:      holder,
    lastJackPrice:      ethers.formatEther(price),
    lastJackPriceWei:   price.toString(),
    jackCount:          Number(jackCount),
    reserveEth:         ethers.formatEther(pot),
    totalSouvenirs:     Number(totalMinted),
    currentStage:       STAGE_NAMES[Number(stageNum)] || 'Dormant',
    currentStageIndex:  Number(stageNum),
    secondsUntilBoil:   Number(boilSeconds),
  };
}

// ── Souvenir rarity (single source of truth) ──────────────────────────────────

/**
 * Read the on-chain rarityScore for a minted souvenir.
 * This is the authoritative base score set by the contract at mint time,
 * computed from hold duration + stage + overpay.
 */
async function getSouvenirScore(tokenId) {
  const provider  = getProvider();
  const souvenirs = getSouvenirContract(provider);
  const data      = await souvenirs.souvenirData(tokenId);
  return Number(data.rarityScore);
}

/**
 * Convert a 0–99 on-chain score to a rarity label.
 * Mirrors SouvenirNFT.rarityFromScore().
 */
function scoreToRarity(score) {
  if (score < 20) return 'common';
  if (score < 40) return 'uncommon';
  if (score < 60) return 'rare';
  if (score < 80) return 'epic';
  return 'legendary';
}

/**
 * Apply a boost to a base score.
 * Each +1 boost = +20 points (one full rarity tier), capped at 99.
 * Returns the new score; caller is responsible for deciding whether to write it back.
 */
function applyScoreBoost(baseScore, boost) {
  if (boost <= 0) return baseScore;
  return Math.min(99, baseScore + boost * 20);
}

/**
 * Push a boosted rarity score back on-chain.
 * Only call this when boostedScore > baseScore (i.e. a boost was actually applied).
 * Must be called BEFORE setTokenURI so both values are in sync.
 */
async function setRarityScore(tokenId, newScore) {
  const signer    = getSigner();
  const souvenirs = getSouvenirContract(signer);
  const tx        = await souvenirs.setRarityScore(tokenId, newScore);
  await tx.wait();
  console.log(`⚡ On-chain rarity score updated: souvenir #${tokenId} → ${newScore} (${scoreToRarity(newScore)})`);
  return tx.hash;
}

// ── URI setter ────────────────────────────────────────────────────────────────

async function setTokenURI(tokenId, uri) {
  const signer    = getSigner();
  const souvenirs = getSouvenirContract(signer);
  const tx        = await souvenirs.setTokenURI(tokenId, uri);
  await tx.wait();
  console.log(`✅ Token URI set: souvenir #${tokenId} → ${uri}`);
  return tx.hash;
}

module.exports = {
  getPotatoState,
  getSouvenirScore,
  scoreToRarity,
  applyScoreBoost,
  setRarityScore,
  setTokenURI,
};

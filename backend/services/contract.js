// Hot Potato — Smart Contract Service
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xDe1b1e37B13ad10707DCbA1f5A3a88d470EA94c7';
const RPC_URL = process.env.RPC_URL;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

// ABI matching the actual deployed HotPotato contract
const ABI = [
  // View functions
  'function getGameState() external view returns (address currentOwner, uint256 price, uint256 timeHeld, uint256 totalTransfers)',
  'function souvenirCount() view returns (uint256)',
  'function currentPrice() view returns (uint256)',
  'function holdStartTime() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
  // Write functions
  'function buyPotato(uint256 newAskingPrice) external payable',
  'function setSouvenirURI(uint256 tokenId, string memory uri) external',
  // Events
  'event PotatoPassed(address indexed from, address indexed to, uint256 price, uint256 holdDuration, uint256 souvenirTokenId, uint8 rarityTier)',
];

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getContract(signerOrProvider) {
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

function getSigner() {
  const provider = getProvider();
  return new ethers.Wallet(WALLET_PRIVATE_KEY, provider);
}

async function getPotatoState() {
  const provider = getProvider();
  const contract = getContract(provider);

  const [gameState, souvenirCount] = await Promise.all([
    contract.getGameState(),
    contract.souvenirCount(),
  ]);

  const holdDurationSeconds = Number(gameState.timeHeld);
  const holdDurationHours = holdDurationSeconds / 3600;

  return {
    currentPrice: ethers.formatEther(gameState.price),
    currentPriceWei: gameState.price.toString(),
    currentHolder: gameState.currentOwner,
    totalTransfers: Number(gameState.totalTransfers),
    holdDurationSeconds,
    holdDurationHours: Math.round(holdDurationHours * 10) / 10,
    totalSouvenirs: Number(souvenirCount) - 1, // souvenirCount starts at 1
  };
}

async function setSouvenirURI(tokenId, uri) {
  const signer = getSigner();
  const contract = getContract(signer);
  const tx = await contract.setSouvenirURI(tokenId, uri);
  await tx.wait();
  console.log(`✅ Souvenir URI set for token ${tokenId}`);
  return tx.hash;
}

function getRarityTier(holdDurationHours) {
  if (holdDurationHours < 24) {
    return { tier: 'common', label: 'Under 24h', weights: { common: 85, rare: 12, epic: 2, legendary: 1 } };
  } else if (holdDurationHours < 168) {
    return { tier: 'rare', label: '1–7 days', weights: { common: 60, rare: 28, epic: 9, legendary: 3 } };
  } else if (holdDurationHours < 672) {
    return { tier: 'epic', label: '1–4 weeks', weights: { common: 20, rare: 40, epic: 25, legendary: 15 } };
  } else if (holdDurationHours < 2160) {
    return { tier: 'legendary', label: '1–3 months', weights: { common: 5, rare: 20, epic: 45, legendary: 30 } };
  } else {
    return { tier: 'legendary', label: '3+ months', weights: { common: 1, rare: 9, epic: 40, legendary: 50 } };
  }
}

function rollRarity(weights) {
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll < cumulative) return rarity;
  }
  return 'common';
}

module.exports = { getPotatoState, getRarityTier, rollRarity, setSouvenirURI };

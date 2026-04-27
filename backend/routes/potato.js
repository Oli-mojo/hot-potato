// Hot Potato — Potato State Routes
const express = require('express');
const router  = express.Router();
const { ethers } = require('ethers');
const { getPotatoState, getRarityTier } = require('../services/contract');
const axios = require('axios');

const CONTRACT_ADDRESS  = process.env.CONTRACT_ADDRESS;
const SOUVENIR_ADDRESS  = process.env.SOUVENIR_ADDRESS || process.env.CONTRACT_ADDRESS;
const RPC_URL  = process.env.RPC_URL;
const IPFS_GW  = 'https://gateway.pinata.cloud/ipfs/';
const RARITY_MAP = ['common', 'rare', 'epic', 'legendary'];

const SOUVENIR_READ_ABI = [
  'function souvenirCount() view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];

// ─── Souvenir cache ────────────────────────────────────────
// Souvenir on-chain data + IPFS image never change after minting.
// Cache them forever — only fetch tokens we haven't seen before.
const souvenirCache = new Map(); // tokenId → { hand, from, price, holdDurationSeconds, rarityTier, souvenirImage }

async function fetchSouvenirRange(contract, from, to) {
  // Fetch all tokens in range in parallel
  const ids = [];
  for (let i = from; i < to; i++) ids.push(i);

  await Promise.all(ids.map(async (i) => {
    if (souvenirCache.has(i)) return; // already cached
    try {
      const [data, uri] = await Promise.all([
        contract.souvenirs(i),
        contract.tokenURI(i).catch(() => null),
      ]);

      // Fetch IPFS image in parallel with contract calls
      let souvenirImage = null;
      if (uri) {
        try {
          const metaUrl = uri.startsWith('ipfs://') ? IPFS_GW + uri.slice(7) : uri;
          const meta = await axios.get(metaUrl, { timeout: 5000 });
          const img = meta.data?.image;
          if (img) souvenirImage = img.startsWith('ipfs://') ? IPFS_GW + img.slice(7) : img;
        } catch {}
      }

      souvenirCache.set(i, {
        hand:               Number(data.transferNumber),
        from:               data.originalOwner,
        price:              ethers.formatEther(data.pricePaid),
        holdDurationSeconds: Number(data.holdDuration),
        souvenirTokenId:    i,
        rarityTier:         RARITY_MAP[Number(data.rarityTier)] || 'common',
        souvenirImage,
      });
    } catch {}
  }));
}

// ─── GET /api/potato ───────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const state      = await getPotatoState();
    const rarityInfo = getRarityTier(state.holdDurationHours);
    res.json({ ...state, rarity: rarityInfo });
  } catch (err) {
    console.error('Error fetching potato state:', err.message);
    console.error('CONTRACT_ADDRESS:', process.env.CONTRACT_ADDRESS);
    console.error('RPC_URL:', process.env.RPC_URL ? 'set' : 'MISSING');
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/potato/history ───────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(SOUVENIR_ADDRESS, SOUVENIR_READ_ABI, provider);
    const count    = Number(await contract.souvenirCount());

    // Fetch only uncached tokens — all in parallel
    await fetchSouvenirRange(contract, 1, count);

    const history = [];
    for (let i = 1; i < count; i++) {
      if (souvenirCache.has(i)) history.push(souvenirCache.get(i));
    }

    history.sort((a, b) => b.hand - a.hand);
    res.json({ total: history.length, history });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/potato/leaderboard ──────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(SOUVENIR_ADDRESS, SOUVENIR_READ_ABI, provider);
    const count    = Number(await contract.souvenirCount());

    // Reuse the same cache — leaderboard is free if history was loaded first
    await fetchSouvenirRange(contract, 1, count);

    const entries   = [];
    const holdCount = {};

    for (let i = 1; i < count; i++) {
      const s = souvenirCache.get(i);
      if (!s) continue;
      const holdHours = Math.round(s.holdDurationSeconds / 360) / 10;
      entries.push({ address: s.from, holdDurationHours: holdHours, rarity: s.rarityTier, hand: s.hand });
      holdCount[s.from] = (holdCount[s.from] || 0) + 1;
    }

    const longestHolds = [...entries].sort((a, b) => b.holdDurationHours - a.holdDurationHours).slice(0, 5);
    const loyaltyBoard = Object.entries(holdCount)
      .map(([address, timesHeld]) => ({ address, timesHeld }))
      .sort((a, b) => b.timesHeld - a.timesHeld).slice(0, 5);
    const hallOfFame   = entries
      .filter(e => e.rarity === 'legendary')
      .sort((a, b) => b.holdDurationHours - a.holdDurationHours);

    res.json({ longestHolds, loyaltyBoard, hallOfFame });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

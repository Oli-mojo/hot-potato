// Hot Potato — Potato State Routes
const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { getPotatoState, getRarityTier } = require('../services/contract');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xd04A4fA2B05874d268Ce8bB8E8EaEc252ef2AB22';
const RPC_URL = process.env.RPC_URL;
const HISTORY_ABI = [
  'event PotatoPassed(address indexed from, address indexed to, uint256 price, uint256 holdDuration, uint256 souvenirTokenId, uint8 rarityTier)',
  'function tokenURI(uint256 tokenId) view returns (string)',
];
const RARITY_MAP = ['common', 'rare', 'epic', 'legendary'];

// GET /api/potato — current game state
router.get('/', async (req, res) => {
  try {
    const state = await getPotatoState();
    const rarityInfo = getRarityTier(state.holdDurationHours);

    res.json({
      ...state,
      rarity: rarityInfo,
    });
  } catch (err) {
    console.error('Error fetching potato state:', err.message);
    console.error('CONTRACT_ADDRESS:', process.env.CONTRACT_ADDRESS);
    console.error('RPC_URL:', process.env.RPC_URL ? 'set' : 'MISSING');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/potato/history — rebuild from souvenir contract data (avoids eth_getLogs limits)
const SOUVENIR_READ_ABI = [
  'function souvenirCount() view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];
const IPFS_GW = 'https://gateway.pinata.cloud/ipfs/';
const axios = require('axios');

router.get('/history', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SOUVENIR_READ_ABI, provider);
    const count = Number(await contract.souvenirCount());

    const history = [];
    for (let i = 1; i < count; i++) {
      try {
        const [data, uri] = await Promise.all([
          contract.souvenirs(i),
          contract.tokenURI(i).catch(() => null),
        ]);

        // Fetch image from metadata
        let souvenirImage = null;
        if (uri) {
          try {
            const metaUrl = uri.startsWith('ipfs://') ? IPFS_GW + uri.slice(7) : uri;
            const meta = await axios.get(metaUrl, { timeout: 5000 });
            const img = meta.data?.image;
            if (img) souvenirImage = img.startsWith('ipfs://') ? IPFS_GW + img.slice(7) : img;
          } catch {}
        }

        history.push({
          hand: Number(data.transferNumber),
          from: data.originalOwner,
          price: ethers.formatEther(data.pricePaid),
          holdDurationSeconds: Number(data.holdDuration),
          souvenirTokenId: i,
          rarityTier: RARITY_MAP[Number(data.rarityTier)] || 'common',
          souvenirImage,
        });
      } catch {}
    }

    history.sort((a, b) => b.hand - a.hand);
    res.json({ total: history.length, history });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/potato/leaderboard — top holders, loyalty leaders, hall of fame
router.get('/leaderboard', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SOUVENIR_READ_ABI, provider);
    const count    = Number(await contract.souvenirCount());

    const entries  = [];
    const holdCount = {};

    for (let i = 1; i < count; i++) {
      try {
        const data = await contract.souvenirs(i);
        const addr = data.originalOwner;
        const holdHours = Math.round(Number(data.holdDuration) / 360) / 10;
        const rarity    = RARITY_MAP[Number(data.rarityTier)] || 'common';
        entries.push({ address: addr, holdDurationHours: holdHours, rarity, hand: Number(data.transferNumber) });
        holdCount[addr] = (holdCount[addr] || 0) + 1;
      } catch {}
    }

    const longestHolds = [...entries].sort((a, b) => b.holdDurationHours - a.holdDurationHours).slice(0, 5);
    const loyaltyBoard = Object.entries(holdCount)
      .map(([address, timesHeld]) => ({ address, timesHeld }))
      .sort((a, b) => b.timesHeld - a.timesHeld).slice(0, 5);
    const hallOfFame   = entries.filter(e => e.rarity === 'legendary')
      .sort((a, b) => b.holdDurationHours - a.holdDurationHours);

    res.json({ longestHolds, loyaltyBoard, hallOfFame });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// Hot Potato — Potato State Routes
const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { getPotatoState, getRarityTier } = require('../services/contract');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x2E8eA15a54Db53375807A8F74ad6ff6eC4a4065e';
const RPC_URL = process.env.RPC_URL || 'https://base-sepolia.g.alchemy.com/v2/CCsT7yY4zuEqcoCPeivbS';
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

// GET /api/potato/history — all PotatoPassed events
router.get('/history', async (req, res) => {
  try {
    // Use PublicNode for event queries — Alchemy free tier blocks broad getLogs
    const PUBLIC_RPC = 'https://base-sepolia-rpc.publicnode.com';
    const provider = new ethers.JsonRpcProvider(PUBLIC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, HISTORY_ABI, provider);
    const filter = contract.filters.PotatoPassed();
    const events = await contract.queryFilter(filter, 0, 'latest');

    const history = await Promise.all(events.map(async (e, idx) => {
      const rarityTier = RARITY_MAP[Number(e.args.rarityTier)] || 'common';
      let souvenirImage = null;
      try {
        const uri = await contract.tokenURI(e.args.souvenirTokenId);
        if (uri && uri.startsWith('ipfs://')) {
          souvenirImage = 'https://gateway.pinata.cloud/ipfs/' + uri.slice(7);
        } else if (uri && uri.startsWith('http')) {
          souvenirImage = uri;
        }
      } catch {}
      return {
        hand: idx + 1,
        from: e.args.from,
        to: e.args.to,
        price: ethers.formatEther(e.args.price),
        holdDurationSeconds: Number(e.args.holdDuration),
        holdDurationHours: Math.round(Number(e.args.holdDuration) / 360) / 10,
        souvenirTokenId: Number(e.args.souvenirTokenId),
        rarityTier,
        souvenirImage,
        txHash: e.transactionHash,
      };
    }));

    res.json({ total: history.length, history: history.reverse() });
  } catch (err) {
    console.error('History error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

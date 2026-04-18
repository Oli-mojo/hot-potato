// Hot Potato — Potato State Routes
const express = require('express');
const router = express.Router();
const { getPotatoState, getRarityTier } = require('../services/contract');

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

module.exports = router;

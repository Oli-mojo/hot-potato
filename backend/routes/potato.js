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
    console.error('Error fetching potato state:', err);
    res.status(500).json({ error: 'Failed to fetch potato state' });
  }
});

module.exports = router;

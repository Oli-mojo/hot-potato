// Hot Potato — Souvenir Generation Routes
const express = require('express');
const router = express.Router();

const { getPotatoState, getRarityTier, rollRarity } = require('../services/contract');
const { generateSouvenirImage } = require('../services/imageGen');
const { uploadImageToIPFS, uploadMetadataToIPFS, buildMetadata } = require('../services/ipfs');

// POST /api/souvenir/generate
// Body: { holderAddress: "0x..." }
// Generates image + metadata and returns tokenURI ready for minting
router.post('/generate', async (req, res) => {
  try {
    const { holderAddress } = req.body;
    if (!holderAddress) {
      return res.status(400).json({ error: 'holderAddress is required' });
    }

    // 1. Get current potato state
    const state = await getPotatoState();
    const rarityInfo = getRarityTier(state.holdDurationHours);
    const rarity = rollRarity(rarityInfo.weights);
    const edition = state.totalSouvenirs + 1;

    console.log(`\n🥔 Generating souvenir for ${holderAddress}`);
    console.log(`   Hold time: ${state.holdDurationHours}h → Rarity roll: ${rarity}`);

    // 2. Generate image
    const imageUrl = await generateSouvenirImage(rarity, state.holdDurationHours, holderAddress);

    // 3. Upload image to IPFS
    const { cid: imageCid } = await uploadImageToIPFS(
      imageUrl,
      `hot-potato-souvenir-${edition}.png`
    );

    // 4. Build and upload metadata
    const metadata = buildMetadata({
      rarity,
      holdDurationHours: state.holdDurationHours,
      holderAddress,
      imageCid,
      edition,
    });
    const { url: tokenURI } = await uploadMetadataToIPFS(metadata);

    res.json({
      success: true,
      rarity,
      holdDurationHours: state.holdDurationHours,
      edition,
      imageUrl,
      imageCid,
      tokenURI,
      metadata,
    });
  } catch (err) {
    console.error('Error generating souvenir:', err);
    res.status(500).json({ error: err.message || 'Failed to generate souvenir' });
  }
});

// POST /api/souvenir/demo — force a specific rarity for testing
// Body: { rarity: "common" | "rare" | "epic" | "legendary" }
router.post('/demo', async (req, res) => {
  try {
    const { rarity } = req.body;
    const validRarities = ['common', 'rare', 'epic', 'legendary'];
    if (!validRarities.includes(rarity)) {
      return res.status(400).json({ error: 'rarity must be common, rare, epic, or legendary' });
    }

    const holdHours = { common: 12, rare: 72, epic: 336, legendary: 2200 };
    const imageUrl = await generateSouvenirImage(rarity, holdHours[rarity], '0xDEMO');

    res.json({ success: true, rarity, imageUrl });
  } catch (err) {
    console.error('Demo error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/souvenir/preview/:address — preview rarity odds without minting
router.get('/preview/:address', async (req, res) => {
  try {
    const state = await getPotatoState();
    const rarityInfo = getRarityTier(state.holdDurationHours);

    res.json({
      holdDurationHours: state.holdDurationHours,
      currentHolder: state.currentHolder,
      rarityTier: rarityInfo.label,
      odds: rarityInfo.weights,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch preview' });
  }
});

module.exports = router;

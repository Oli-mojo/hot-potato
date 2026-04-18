// Hot Potato — Souvenir Generation Routes
const express = require('express');
const router = express.Router();

const { getPotatoState, getRarityTier, rollRarity, setSouvenirURI } = require('../services/contract');
const { generateSouvenirImage } = require('../services/imageGen');
const { uploadImageToIPFS, uploadMetadataToIPFS, buildMetadata } = require('../services/ipfs');

const RARITY_MAP = ['common', 'rare', 'epic', 'legendary'];

// POST /api/souvenir/generate
// Body: { fromAddress, holdDurationSeconds, souvenirTokenId, rarityTier }
// Called by the frontend immediately after a PotatoPassed event
router.post('/generate', async (req, res) => {
  const { fromAddress, holdDurationSeconds, souvenirTokenId, rarityTier } = req.body;
  if (!fromAddress || souvenirTokenId === undefined) {
    return res.status(400).json({ error: 'fromAddress and souvenirTokenId are required' });
  }

  // Respond immediately so the buyer's UI isn't blocked
  res.json({ success: true, message: 'Souvenir generation started', souvenirTokenId });

  // Generate in the background
  (async () => {
    try {
      const holdDurationHours = (Number(holdDurationSeconds) || 0) / 3600;
      const rarity = RARITY_MAP[Number(rarityTier)] || rollRarity(getRarityTier(holdDurationHours).weights);
      const state = await getPotatoState();
      const edition = state.totalSouvenirs;

      console.log(`\n🥔 Generating souvenir #${souvenirTokenId} for ${fromAddress}`);
      console.log(`   Hold time: ${holdDurationHours.toFixed(1)}h → Rarity: ${rarity}`);

      const imageUrl = await generateSouvenirImage(rarity, holdDurationHours, fromAddress);
      const { cid: imageCid } = await uploadImageToIPFS(imageUrl, `hot-potato-souvenir-${edition}.png`);
      const metadata = buildMetadata({ rarity, holdDurationHours, holderAddress: fromAddress, imageCid, edition });
      const { url: tokenURI } = await uploadMetadataToIPFS(metadata);

      await setSouvenirURI(Number(souvenirTokenId), tokenURI);
      console.log(`✅ Souvenir #${souvenirTokenId} complete — ${rarity} — ${tokenURI}`);
    } catch (err) {
      console.error('Background souvenir generation failed:', err.message);
    }
  })();
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

// GET /api/souvenir/gallery — all minted souvenirs with metadata
const { ethers } = require('ethers');
const SOUVENIR_ABI = [
  'function souvenirCount() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x2E8eA15a54Db53375807A8F74ad6ff6eC4a4065e';
const RPC_URL = process.env.RPC_URL || 'https://base-sepolia.g.alchemy.com/v2/CCsT7yY4zuEqcoCPeivbS';

router.get('/gallery', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SOUVENIR_ABI, provider);
    const count = Number(await contract.souvenirCount());
    const souvenirs = [];
    for (let i = 1; i < count; i++) {
      try {
        const [data, uri] = await Promise.all([
          contract.souvenirs(i),
          contract.tokenURI(i).catch(() => null),
        ]);
        souvenirs.push({
          tokenId: i,
          transferNumber: Number(data.transferNumber),
          pricePaid: ethers.formatEther(data.pricePaid),
          holdDurationHours: Math.round(Number(data.holdDuration) / 360) / 10,
          rarityTier: RARITY_MAP[Number(data.rarityTier)] || 'common',
          originalOwner: data.originalOwner,
          tokenURI: uri,
        });
      } catch (e) { /* skip broken tokens */ }
    }
    res.json({ total: souvenirs.length, souvenirs: souvenirs.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

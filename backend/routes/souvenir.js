// Hot Potato — Souvenir Generation Routes
const express = require('express');
const router = express.Router();
const axios = require('axios');

const { getPotatoState, getRarityTier, rollRarity, setSouvenirURI } = require('../services/contract');
const { generateSouvenirImage } = require('../services/imageGen');
const { uploadImageToIPFS, uploadMetadataToIPFS, buildMetadata } = require('../services/ipfs');
const { announcePotatoPassed } = require('../services/social');
const { createTradeInCode, validateCode, storePendingBoost, consumePendingBoost, applyBoost } = require('../services/promoCode');

const { ethers } = require('ethers');
const SOUVENIR_ABI = [
  'function souvenirCount() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xd04A4fA2B05874d268Ce8bB8E8EaEc252ef2AB22';
const RPC_URL = process.env.RPC_URL;
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
const RARITY_MAP = ['common', 'rare', 'epic', 'legendary'];

// POST /api/souvenir/generate
// Body: { fromAddress, holdDurationSeconds, souvenirTokenId, rarityTier, promoCode? }
router.post('/generate', async (req, res) => {
  const { fromAddress, holdDurationSeconds, souvenirTokenId, rarityTier } = req.body;
  if (!fromAddress || souvenirTokenId === undefined) {
    return res.status(400).json({ error: 'fromAddress and souvenirTokenId are required' });
  }

  res.json({ success: true, message: 'Souvenir generation started', souvenirTokenId });

  (async () => {
    try {
      const holdDurationHours = (Number(holdDurationSeconds) || 0) / 3600;
      const baseRarity = RARITY_MAP[Number(rarityTier)] || rollRarity(getRarityTier(holdDurationHours).weights);
      const state = await getPotatoState();
      const edition = state.totalSouvenirs;

      // Apply any pending boost stored for this holder
      const pendingBoost = consumePendingBoost(fromAddress);
      const finalRarity = applyBoost(baseRarity, pendingBoost);

      console.log(`\n🥔 Generating souvenir #${souvenirTokenId} for ${fromAddress}`);
      console.log(`   Hold time: ${holdDurationHours.toFixed(1)}h → Base: ${baseRarity}${pendingBoost ? ` → Boosted: ${finalRarity} (+${pendingBoost})` : ''}`);

      const imageUrl = await generateSouvenirImage(finalRarity, holdDurationHours, fromAddress);
      const { cid: imageCid } = await uploadImageToIPFS(imageUrl, `hot-potato-souvenir-${edition}.png`);
      const metadata = buildMetadata({ rarity: finalRarity, holdDurationHours, holderAddress: fromAddress, imageCid, edition });
      const { url: tokenURI } = await uploadMetadataToIPFS(metadata);

      await setSouvenirURI(Number(souvenirTokenId), tokenURI);
      console.log(`✅ Souvenir #${souvenirTokenId} complete — ${finalRarity} — ${tokenURI}`);

      const ipfsImageUrl = `https://gateway.pinata.cloud/ipfs/${imageCid}`;
      await announcePotatoPassed({
        hand: edition,
        fromAddress,
        holdDurationHours,
        pricePaid: req.body.pricePaid || '?',
        rarity: finalRarity,
        newAskingPrice: req.body.newAskingPrice || '?',
        imageUrl: ipfsImageUrl,
      });
    } catch (err) {
      console.error('Background souvenir generation failed:', err.message);
    }
  })();
});

// POST /api/souvenir/apply-promo
// Body: { walletAddress, promoCode }
// Stores a pending boost for this buyer — applied when they eventually get bought out
router.post('/apply-promo', (req, res) => {
  const { walletAddress, promoCode } = req.body;
  if (!walletAddress || !promoCode) {
    return res.status(400).json({ error: 'walletAddress and promoCode required' });
  }
  const result = validateCode(promoCode);
  if (!result.valid) {
    return res.status(400).json({ error: result.reason });
  }
  storePendingBoost(walletAddress, result.boost, result.code);
  res.json({ success: true, boost: result.boost, type: result.type, code: result.code });
});

// GET /api/souvenir/validate-promo/:code
router.get('/validate-promo/:code', (req, res) => {
  const result = validateCode(req.params.code);
  res.json(result);
});

// POST /api/souvenir/trade-in
// Body: { walletAddress, tokenId, txHash }
// Verifies souvenir was burned, generates a trade-in promo code
router.post('/trade-in', async (req, res) => {
  const { walletAddress, tokenId, txHash } = req.body;
  if (!walletAddress || tokenId === undefined || !txHash) {
    return res.status(400).json({ error: 'walletAddress, tokenId, and txHash required' });
  }
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    // Verify transaction exists and succeeded
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction not confirmed yet — try again in a moment' });
    }

    // Verify the token now lives at the burn address
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SOUVENIR_ABI, provider);
    const currentOwner = await contract.ownerOf(tokenId).catch(() => null);
    if (!currentOwner || currentOwner.toLowerCase() !== BURN_ADDRESS.toLowerCase()) {
      return res.status(400).json({ error: 'Token not yet at burn address — transaction may still be processing' });
    }

    // Get souvenir rarity from on-chain data
    const data = await contract.souvenirs(tokenId);
    const rarity = RARITY_MAP[Number(data.rarityTier)] || 'common';

    const { code, boost } = createTradeInCode(Number(tokenId), rarity);
    console.log(`🔥 Trade-in complete: token #${tokenId} [${rarity}] → code ${code}`);

    res.json({ success: true, code, boost, rarity, tokenId });
  } catch (err) {
    console.error('Trade-in error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GALLERY + UTILITY ROUTES ──────────────────────────────────────────────

async function fetchImageFromMetadata(tokenURI) {
  if (!tokenURI) return null;
  try {
    const url = tokenURI.startsWith('ipfs://') ? IPFS_GATEWAY + tokenURI.slice(7) : tokenURI;
    const res = await axios.get(url, { timeout: 8000 });
    const image = res.data?.image;
    if (!image) return null;
    return image.startsWith('ipfs://') ? IPFS_GATEWAY + image.slice(7) : image;
  } catch { return null; }
}

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
        const imageUrl = await fetchImageFromMetadata(uri);
        souvenirs.push({
          tokenId: i,
          transferNumber: Number(data.transferNumber),
          pricePaid: ethers.formatEther(data.pricePaid),
          holdDurationHours: Math.round(Number(data.holdDuration) / 360) / 10,
          rarityTier: RARITY_MAP[Number(data.rarityTier)] || 'common',
          originalOwner: data.originalOwner,
          tokenURI: uri,
          imageUrl,
        });
      } catch (e) {}
    }
    res.json({ total: souvenirs.length, souvenirs: souvenirs.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/owned/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SOUVENIR_ABI, provider);
    const count = Number(await contract.souvenirCount());
    const owned = [];
    for (let i = 1; i < count; i++) {
      try {
        const [owner, data] = await Promise.all([
          contract.ownerOf(i),
          contract.souvenirs(i),
        ]);
        if (owner.toLowerCase() === address.toLowerCase()) {
          owned.push({ tokenId: i, rarityTier: RARITY_MAP[Number(data.rarityTier)] || 'common' });
        }
      } catch (e) {}
    }
    res.json({ owned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/demo', async (req, res) => {
  try {
    const { rarity } = req.query;
    const validRarities = ['common', 'rare', 'epic', 'legendary'];
    if (!validRarities.includes(rarity)) {
      return res.status(400).json({ error: 'rarity must be common, rare, epic, or legendary' });
    }
    const holdHours = { common: 12, rare: 72, epic: 336, legendary: 2200 };
    const imageUrl = await generateSouvenirImage(rarity, holdHours[rarity], '0xDEMO');
    res.json({ success: true, rarity, imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/debug-env', (req, res) => {
  res.json({
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL ? `set (${process.env.DISCORD_WEBHOOK_URL.slice(0, 40)}...)` : 'NOT SET',
    RPC_URL: process.env.RPC_URL ? 'set' : 'NOT SET',
    PINATA_JWT: process.env.PINATA_JWT ? 'set' : 'NOT SET',
    PROMO_CODES: process.env.PROMO_CODES ? `set (${process.env.PROMO_CODES})` : 'NOT SET',
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || 'using default',
  });
});

router.post('/test-discord', async (req, res) => {
  try {
    await announcePotatoPassed({
      hand: 99,
      fromAddress: '0xTEST000000000000000000000000000000000000',
      holdDurationHours: 72,
      pricePaid: '0.042',
      rarity: 'rare',
      newAskingPrice: '0.050',
      imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Sweet_potato_Ipomoea_batatas.jpg/320px-Sweet_potato_Ipomoea_batatas.jpg',
    });
    res.json({ success: true, message: 'Discord test fired — check #announcements' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

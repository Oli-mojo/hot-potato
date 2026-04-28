// Hot Potato — Souvenir Generation Routes
const express = require('express');
const router = express.Router();
const axios = require('axios');

const {
  getPotatoState,
  getSouvenirScore,
  scoreToRarity,
  applyScoreBoost,
  setRarityScore,
  setTokenURI,
} = require('../services/contract');
const { generateSouvenirImage } = require('../services/imageGen');
const { uploadImageToIPFS, uploadMetadataToIPFS, buildMetadata } = require('../services/ipfs');
const { announcePotatoPassed } = require('../services/social');
const {
  createTradeInCode, getTradeInCodeForWallet, validateCode,
  storePendingBoost, consumePendingBoost,
  getLoyaltyStatus, claimLoyaltyBoost,
  registerReferral, applyReferral,
} = require('../services/promoCode');

const { ethers } = require('ethers');
const requireSignature   = require('../middleware/requireSignature');
const requireInternalKey = require('../middleware/requireInternalKey');

const BURN_ADDRESS  = '0x000000000000000000000000000000000000dEaD';
const IPFS_GATEWAY  = 'https://gateway.pinata.cloud/ipfs/';

// ── V3 legacy helpers — used by gallery/owned/trade-in until V4 is deployed ──
// TODO: after V4 deploy, replace these routes with SouvenirNFT V4 ABI calls.
//
// H-8/M-2 fix: fail fast if SOUVENIR_ADDRESS is missing rather than silently
// falling back to a hardcoded testnet address or the game contract address.
if (!process.env.SOUVENIR_ADDRESS) {
  throw new Error(
    'SOUVENIR_ADDRESS env var is required — set it to the HotPotatoSouvenir contract address.'
  );
}
const CONTRACT_ADDRESS = process.env.SOUVENIR_ADDRESS;
const RPC_URL          = process.env.RPC_URL;
const RARITY_MAP       = ['common', 'uncommon', 'rare', 'epic', 'legendary']; // 5-tier V4 mapping
const SOUVENIR_ABI     = [
  // V3 legacy ABI — kept for gallery/owned routes until V4 migration
  'function souvenirCount() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];

// POST /api/souvenir/generate
// Body: { fromAddress, souvenirTokenId, holdDurationSeconds?, pricePaid?, newAskingPrice? }
// Authorization: Bearer <GENERATE_SECRET>
//
// H-1 fix: protected by requireInternalKey — only callable by the on-chain
// event listener service (or manually by an operator for recovery).
// The frontend no longer calls this endpoint directly.
//
// Rarity flow (single source of truth):
//   1. Read rarityScore from the on-chain SouvenirNFT — the contract computed this
//      deterministically from hold duration + stage + overpay at mint time.
//   2. If this holder has a pending boost (promo / loyalty / referral / trade-in),
//      add 20 points per boost level (one rarity tier per +1), capped at 99.
//   3. If the score increased, write it back on-chain via setRarityScore() BEFORE
//      setting the URI — so on-chain rarityScore and metadata rarity are always identical.
//   4. Generate art, upload to IPFS, set the token URI.
router.post('/generate', requireInternalKey, async (req, res) => {
  const { fromAddress, souvenirTokenId } = req.body;
  if (!fromAddress || souvenirTokenId === undefined) {
    return res.status(400).json({ error: 'fromAddress and souvenirTokenId are required' });
  }

  res.json({ success: true, message: 'Souvenir generation started', souvenirTokenId });

  (async () => {
    try {
      const tokenId = Number(souvenirTokenId);
      const holdDurationHours = (Number(req.body.holdDurationSeconds) || 0) / 3600;
      const state   = await getPotatoState();
      const edition = state.totalSouvenirs;

      // ── Step 1: read on-chain base score ────────────────────────────────
      const baseScore  = await getSouvenirScore(tokenId);
      const baseRarity = scoreToRarity(baseScore);

      // ── Step 2: apply any pending boost ─────────────────────────────────
      const pendingBoost   = consumePendingBoost(fromAddress);
      const clampedBoost   = Math.min(pendingBoost, 4); // max +4 tiers
      const boostedScore   = applyScoreBoost(baseScore, clampedBoost);
      const finalRarity    = scoreToRarity(boostedScore);

      console.log(`\n🥔 Generating souvenir #${tokenId} for ${fromAddress}`);
      console.log(`   On-chain score: ${baseScore} (${baseRarity}) | Boost: +${clampedBoost} → ${boostedScore} (${finalRarity})`);

      // ── Step 3: write boosted score back on-chain if it changed ─────────
      if (boostedScore > baseScore) {
        await setRarityScore(tokenId, boostedScore);
      }

      // ── Step 4: generate art + upload metadata ───────────────────────────
      const imageUrl          = await generateSouvenirImage(finalRarity, holdDurationHours, fromAddress);
      const { cid: imageCid } = await uploadImageToIPFS(imageUrl, `hotpotato-souvenir-${edition}.png`);
      const metadata          = buildMetadata({ rarity: finalRarity, holdDurationHours, holderAddress: fromAddress, imageCid, edition });
      const { url: tokenUri } = await uploadMetadataToIPFS(metadata);

      await setTokenURI(tokenId, tokenUri);
      console.log(`✅ Souvenir #${tokenId} complete — ${finalRarity} — ${tokenUri}`);

      const ipfsImageUrl = `${IPFS_GATEWAY}${imageCid}`;
      await announcePotatoPassed({
        hand: edition,
        fromAddress,
        holdDurationHours,
        pricePaid:      req.body.pricePaid      || '?',
        rarity:         finalRarity,
        newAskingPrice: req.body.newAskingPrice || '?',
        imageUrl:       ipfsImageUrl,
      });
    } catch (err) {
      console.error('Background souvenir generation failed:', err.message);
    }
  })();
});

// POST /api/souvenir/apply-promo
// Body: { walletAddress, promoCode, signature, message }
// Stores a pending boost for this buyer — applied when they eventually get bought out
router.post('/apply-promo', requireSignature, (req, res) => {
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

// GET /api/souvenir/validate-promo/:code?wallet=0x...
router.get('/validate-promo/:code', (req, res) => {
  const result = validateCode(req.params.code);
  // Block self-referral — check if this REF- code belongs to the requester
  if (result.valid && result.type === 'referral' && req.query.wallet) {
    if (result.referrer === req.query.wallet.toLowerCase()) {
      return res.json({ valid: false, reason: "That's your own referral code — share it with someone else!" });
    }
  }
  res.json(result);
});

// GET /api/souvenir/loyalty/:address — loyalty status (unclaimed holds + available boost)
router.get('/loyalty/:address', async (req, res) => {
  try {
    const status = await getLoyaltyStatus(req.params.address);
    const { boost, totalHolds, unclaimedHolds } = status;
    const holdsNeededForNext = boost >= 3 ? null : boost >= 2 ? 1 : boost >= 1 ? 2 : 1;
    res.json({
      totalHolds,
      unclaimedHolds,
      boost,
      maxed: boost >= 3,
      holdsNeededForNext,
      claimable: boost > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/souvenir/claim-loyalty — player claims their loyalty boost before buying
// Body: { walletAddress, signature, message }
router.post('/claim-loyalty', requireSignature, async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });
  try {
    const result = await claimLoyaltyBoost(walletAddress);
    if (!result.success) return res.status(400).json({ error: result.reason });
    res.json({ success: true, boost: result.boost, unclaimedHolds: result.unclaimedHolds, message: `Loyalty boost +${result.boost} locked in! It'll apply to your next souvenir.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/souvenir/recover-trade-in/:address — retrieve unused trade-in code for this wallet
router.get('/recover-trade-in/:address', (req, res) => {
  const entry = getTradeInCodeForWallet(req.params.address);
  if (!entry) {
    return res.status(404).json({ error: 'No unused trade-in code found for this wallet' });
  }
  res.json({ found: true, ...entry });
});

// GET /api/souvenir/referral/:address — register + return referral code for this wallet
router.get('/referral/:address', (req, res) => {
  try {
    const { address } = req.params;
    if (!address || !address.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const { code, boost } = registerReferral(address);
    res.json({ code, boost, message: 'Share this code — both you and the buyer get a +1 rarity boost' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/souvenir/apply-referral
// Body: { referralCode, walletAddress, signature, message }
// Applies mutual +1 boost to referee and referrer
router.post('/apply-referral', requireSignature, (req, res) => {
  const { referralCode, walletAddress } = req.body;
  if (!referralCode || !walletAddress) {
    return res.status(400).json({ error: 'referralCode and walletAddress required' });
  }
  const result = applyReferral(referralCode, walletAddress);
  if (!result.success) {
    return res.status(400).json({ error: result.reason });
  }
  res.json({ success: true, boost: 1, type: 'referral', referrer: result.referrer });
});

// POST /api/souvenir/trade-in
// Body: { walletAddress, tokenId, txHash, signature, message }
// Verifies souvenir was burned, generates a trade-in promo code
router.post('/trade-in', requireSignature, async (req, res) => {
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

    // H-3 fix: decode the ERC-721 Transfer event directly from the receipt logs
    // rather than trusting ownerOf() alone. ownerOf() can be gamed by a race
    // condition where someone burns then immediately re-mints into the same slot.
    // Decoding the log proves the burn happened in THIS specific transaction.
    const transferIface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    ]);
    const burnConfirmed = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) return false;
      try {
        const parsed = transferIface.parseLog({ topics: log.topics, data: log.data });
        return (
          parsed.name === 'Transfer' &&
          parsed.args.to.toLowerCase()       === BURN_ADDRESS.toLowerCase() &&
          parsed.args.tokenId.toString()     === tokenId.toString()
        );
      } catch { return false; }
    });
    if (!burnConfirmed) {
      return res.status(400).json({
        error: 'No burn Transfer event found for this tokenId in the provided transaction',
      });
    }

    // Get souvenir rarity from on-chain data
    const data = await contract.souvenirs(tokenId);
    const rarity = RARITY_MAP[Number(data.rarityTier)] || 'common';

    const { code, boost } = createTradeInCode(Number(tokenId), rarity, walletAddress);
    console.log(`🔥 Trade-in complete: token #${tokenId} [${rarity}] → code ${code}`);

    res.json({ success: true, code, boost, rarity, tokenId });
  } catch (err) {
    console.error('Trade-in error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GALLERY + UTILITY ROUTES ──────────────────────────────────────────────

// Fetches full metadata from IPFS — returns { imageUrl, metadataRarity }
async function fetchMetadata(tokenURI) {
  if (!tokenURI) return { imageUrl: null, metadataRarity: null };
  try {
    const url = tokenURI.startsWith('ipfs://') ? IPFS_GATEWAY + tokenURI.slice(7) : tokenURI;
    const res = await axios.get(url, { timeout: 8000 });
    const meta = res.data;
    const image = meta?.image;
    const imageUrl = image
      ? (image.startsWith('ipfs://') ? IPFS_GATEWAY + image.slice(7) : image)
      : null;
    // Rarity is stored as attributes[0].value e.g. "Legendary"
    const rarityRaw = meta?.attributes?.find(a => a.trait_type === 'Rarity')?.value;
    const metadataRarity = rarityRaw ? rarityRaw.toLowerCase() : null;
    return { imageUrl, metadataRarity };
  } catch { return { imageUrl: null, metadataRarity: null }; }
}

router.get('/gallery', async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SOUVENIR_ABI, provider);
    const count = Number(await contract.souvenirCount());
    const souvenirs = [];
    for (let i = 1; i < count; i++) {
      try {
        const [data, uri, owner] = await Promise.all([
          contract.souvenirs(i),
          contract.tokenURI(i).catch(() => null),
          contract.ownerOf(i).catch(() => null),
        ]);
        const { imageUrl, metadataRarity } = await fetchMetadata(uri);
        const burned = owner ? owner.toLowerCase() === BURN_ADDRESS.toLowerCase() : false;
        const onChainRarity = RARITY_MAP[Number(data.rarityTier)] || 'common';
        souvenirs.push({
          tokenId: i,
          transferNumber: Number(data.transferNumber),
          pricePaid: ethers.formatEther(data.pricePaid),
          holdDurationHours: Math.round(Number(data.holdDuration) / 360) / 10,
          rarityTier: metadataRarity || onChainRarity, // prefer metadata (includes boosts)
          originalOwner: data.originalOwner,
          tokenURI: uri,
          imageUrl,
          burned,
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

// H-5 fix: /debug-env removed — it leaked DISCORD_WEBHOOK_URL and PROMO_CODES
// in plaintext. Use server logs or a health-check endpoint that returns only
// boolean "set / not set" values without exposing actual content.

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

// Hot Potato — Promo Code Service
//
// Code types:
// 1. Social codes — set in Railway env var PROMO_CODES as JSON: {"DISCORD":1,"XFOLLOW":1}
//    Reusable (everyone can use them), give a small +1 boost
// 2. Trade-in codes — generated when a souvenir is burned, single-use, boost scales with rarity
// 3. Referral codes — deterministic from wallet address (REF-XXXXXXXX), give mutual +1 boost
//
// Boost is applied to image generation + metadata rarity (on top of hold-duration tier)

const crypto = require('crypto');

// In-memory store for trade-in codes — persists until server restart
// { code => { boost, usedBy, createdAt, fromTokenId, fromRarity, walletAddress } }
const tradeInCodes = new Map();

// Index from wallet address to trade-in code — for recovery lookups
// { walletAddress.toLowerCase() => code }
const tradeInByWallet = new Map();

// Pending boosts for buyers — applied when they eventually get bought out
// { walletAddress.toLowerCase() => { boost, fromCode, appliedAt } }
const pendingBoosts = new Map();

// Referral codes — deterministic from wallet address, registered on first display
// { code => walletAddress.toLowerCase() }
const referralCodes = new Map();

// M-4 fix: track which wallets have already redeemed a referral code so one
// wallet can't apply multiple different referral codes to stack boosts.
// { walletAddress.toLowerCase() => true }
const referralRedeemed = new Set();

const RARITY_BOOST   = { common: 1, rare: 2, epic: 3, legendary: 4 };
const RARITY_ORDER   = ['common', 'rare', 'epic', 'legendary'];

function generateCode(rarity) {
  const prefix = { common: 'C', rare: 'R', epic: 'E', legendary: 'L' }[rarity] || 'C';
  const random  = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `HP-${prefix}${random}`;
}

// Called when a souvenir is transferred to the burn address
function createTradeInCode(tokenId, rarity, walletAddress) {
  const code  = generateCode(rarity);
  const boost = RARITY_BOOST[rarity] || 1;
  const addr  = walletAddress ? walletAddress.toLowerCase() : null;
  tradeInCodes.set(code, {
    boost,
    usedBy:      null,
    createdAt:   Date.now(),
    fromTokenId: tokenId,
    fromRarity:  rarity,
    walletAddress: addr,
  });
  if (addr) tradeInByWallet.set(addr, code);
  console.log(`🎟️  Trade-in code ${code} created (boost +${boost}) for token #${tokenId} [${rarity}]`);
  return { code, boost };
}

// Look up an unused trade-in code by the wallet that burned a souvenir
function getTradeInCodeForWallet(walletAddress) {
  const addr = walletAddress.toLowerCase();
  const code = tradeInByWallet.get(addr);
  if (!code) return null;
  const entry = tradeInCodes.get(code);
  if (!entry || entry.usedBy) return null; // already used
  return { code, boost: entry.boost, fromRarity: entry.fromRarity, fromTokenId: entry.fromTokenId };
}

// ─── REFERRAL CODES ───────────────────────────────────────
// Deterministic code from wallet — always the same for a given address
function getReferralCode(walletAddress) {
  const hash = crypto.createHash('sha256')
    .update(walletAddress.toLowerCase() + 'HOTPOTATO2025')
    .digest('hex');
  return `REF-${hash.slice(0, 8).toUpperCase()}`;
}

// Register a wallet's referral code so it can be redeemed by others
function registerReferral(walletAddress) {
  const code = getReferralCode(walletAddress);
  referralCodes.set(code, walletAddress.toLowerCase());
  return { code, boost: 1 };
}

// Apply referral: referee gets +1 pending boost, referrer also gets +1 pending boost
//
// M-4 fix: each wallet may only redeem ONE referral code. Without this a player
// could apply multiple different referral codes to accumulate boosts.
function applyReferral(referralCode, refereeAddress) {
  const upper = referralCode.toUpperCase().trim();
  const referrerAddress = referralCodes.get(upper);
  if (!referrerAddress) return { success: false, reason: 'Referral code not registered' };

  const refeeAddr = refereeAddress.toLowerCase();
  if (referrerAddress === refeeAddr) {
    return { success: false, reason: 'Cannot use your own referral code' };
  }

  // M-4: one referral redemption per wallet
  if (referralRedeemed.has(refeeAddr)) {
    return { success: false, reason: 'You have already used a referral code' };
  }

  // Store +1 boost for referee
  const existingReferee = pendingBoosts.get(refeeAddr);
  if (!existingReferee || 1 > existingReferee.boost) {
    pendingBoosts.set(refeeAddr, { boost: 1, fromCode: upper, appliedAt: Date.now() });
    console.log(`🤝 Referral: referee boost +1 stored for ${refeeAddr}`);
  }
  referralRedeemed.add(refeeAddr); // mark this wallet as having redeemed a referral

  // Store +1 boost for referrer too (mutual)
  const existingReferrer = pendingBoosts.get(referrerAddress);
  if (!existingReferrer || 1 > existingReferrer.boost) {
    pendingBoosts.set(referrerAddress, { boost: 1, fromCode: `referral-by-${refeeAddr}`, appliedAt: Date.now() });
    console.log(`🤝 Referral: referrer boost +1 stored for ${referrerAddress}`);
  }

  return { success: true, referrer: referrerAddress };
}

// Validate any code — returns { valid, boost, type } or { valid: false, reason }
//
// M-4 fix:
//   - Max code length (50 chars) prevents CPU waste on giant inputs.
//   - Social boost values are clamped to 1–4 so a misconfigured PROMO_CODES
//     env var can't grant an out-of-range boost.
function validateCode(code) {
  if (!code) return { valid: false, reason: 'No code provided' };
  if (typeof code !== 'string' || code.length > 50) {
    return { valid: false, reason: 'Invalid code' };
  }
  const upper = code.toUpperCase().trim();

  // Social codes from env var
  try {
    const social = JSON.parse(process.env.PROMO_CODES || '{}');
    if (social[upper] !== undefined) {
      // Clamp boost to 1–4 regardless of what's in the env var
      const boost = Math.min(4, Math.max(1, Math.floor(Number(social[upper]))));
      return { valid: true, boost, type: 'social', code: upper };
    }
  } catch (e) {}

  // Trade-in codes
  const tradeIn = tradeInCodes.get(upper);
  if (tradeIn) {
    if (tradeIn.usedBy) return { valid: false, reason: 'Code already used' };
    return { valid: true, boost: tradeIn.boost, type: 'trade-in', code: upper };
  }

  // Referral codes
  if (upper.startsWith('REF-')) {
    const referrer = referralCodes.get(upper);
    if (referrer) return { valid: true, boost: 1, type: 'referral', code: upper, referrer };
    return { valid: false, reason: 'Referral code not registered — the referrer must visit the site first' };
  }

  return { valid: false, reason: 'Invalid code' };
}

// Store a pending boost for a buyer's wallet (applied when they get bought out)
function storePendingBoost(walletAddress, boost, code) {
  const addr = walletAddress.toLowerCase();
  const existing = pendingBoosts.get(addr);
  // Keep the higher boost if they have multiple codes
  if (!existing || boost > existing.boost) {
    pendingBoosts.set(addr, { boost, fromCode: code, appliedAt: Date.now() });
    console.log(`⚡ Pending boost +${boost} stored for ${addr}`);
  }
  // Mark trade-in code as used
  const tradeIn = tradeInCodes.get(code.toUpperCase());
  if (tradeIn) {
    tradeIn.usedBy  = walletAddress;
    tradeIn.usedAt  = Date.now();
  }
  // Social + referral codes are reusable — not marked used
}

// Consume pending boost for a wallet (called during souvenir generation)
function consumePendingBoost(walletAddress) {
  const addr  = walletAddress.toLowerCase();
  const entry = pendingBoosts.get(addr);
  if (!entry) return 0;
  pendingBoosts.delete(addr);
  console.log(`✨ Applied pending boost +${entry.boost} for ${addr}`);
  return entry.boost;
}

// Apply boost to a rarity string, capped at legendary
function applyBoost(rarity, boost) {
  if (!boost || boost <= 0) return rarity;
  const idx    = RARITY_ORDER.indexOf(rarity);
  const newIdx = Math.min(idx + boost, RARITY_ORDER.length - 1);
  return RARITY_ORDER[newIdx];
}

// ─── LOYALTY BOOST (CLAIM-BASED) ──────────────────────────
// Loyalty is earned by holding the potato multiple times, but must be actively claimed.
// After claiming, the counter resets — you need to hold again to rebuild it.
//
// Boost table (unclaimed holds since last reset):
//   1 hold  → +1
//   2 holds → +2
//   3+      → +3 (max)
//
// { walletAddress.toLowerCase() => { claimedHoldCount: N } }
const loyaltyResets = new Map();

const { ethers } = require('ethers');

const LOYALTY_ABI = [
  'function souvenirCount() view returns (uint256)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];

// Count how many times this wallet has previously held on-chain
async function countOnChainHolds(walletAddress) {
  const rpcUrl = process.env.RPC_URL;
  const contractAddress = process.env.SOUVENIR_ADDRESS || process.env.CONTRACT_ADDRESS;
  if (!rpcUrl) return 0;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, LOYALTY_ABI, provider);
  const count = Number(await contract.souvenirCount());
  let timesHeld = 0;
  for (let i = 1; i < count; i++) {
    try {
      const data = await contract.souvenirs(i);
      if (data.originalOwner.toLowerCase() === walletAddress.toLowerCase()) timesHeld++;
    } catch (e) {}
  }
  return timesHeld;
}

// Check available (unclaimed) loyalty boost — shown in UI before claiming
async function getLoyaltyStatus(walletAddress) {
  try {
    const addr = walletAddress.toLowerCase();
    const totalHolds = await countOnChainHolds(addr);
    const claimedAt = loyaltyResets.get(addr) || 0;
    const unclaimedHolds = Math.max(0, totalHolds - claimedAt);
    let boost = 0;
    if (unclaimedHolds >= 3) boost = 3;
    else if (unclaimedHolds >= 2) boost = 2;
    else if (unclaimedHolds >= 1) boost = 1;
    return { boost, totalHolds, unclaimedHolds, claimedAt };
  } catch (e) {
    console.error('Loyalty status lookup failed:', e.message);
    return { boost: 0, totalHolds: 0, unclaimedHolds: 0, claimedAt: 0 };
  }
}

// Claim loyalty boost — stores pending boost and resets the counter
async function claimLoyaltyBoost(walletAddress) {
  const addr = walletAddress.toLowerCase();
  const { boost, totalHolds, unclaimedHolds } = await getLoyaltyStatus(addr);
  if (boost <= 0) return { success: false, reason: 'No loyalty boost available — hold the potato first!', boost: 0 };

  // Store pending boost (stacks with promo codes, capped at legendary in generate route)
  const existing = pendingBoosts.get(addr);
  if (!existing || boost > existing.boost) {
    pendingBoosts.set(addr, { boost, fromCode: 'loyalty', appliedAt: Date.now() });
  }

  // Reset counter to current hold count — new holds start accumulating from here
  loyaltyResets.set(addr, totalHolds);
  console.log(`🏆 Loyalty claimed: +${boost} for ${addr} (${unclaimedHolds} unclaimed holds → reset to ${totalHolds})`);
  return { success: true, boost, unclaimedHolds, newBaseline: totalHolds };
}

// Legacy: used internally during generate — kept for backwards compat but returns 0
// Loyalty must now be claimed explicitly via claimLoyaltyBoost()
async function getLoyaltyBoost(walletAddress) {
  return { boost: 0, timesHeld: 0 };
}

module.exports = {
  createTradeInCode, getTradeInCodeForWallet, validateCode,
  storePendingBoost, consumePendingBoost,
  applyBoost, RARITY_BOOST,
  getLoyaltyBoost, getLoyaltyStatus, claimLoyaltyBoost,
  getReferralCode, registerReferral, applyReferral,
};

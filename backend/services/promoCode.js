// Hot Potato — Promo Code Service
//
// Two types of codes:
// 1. Social codes — set in Railway env var PROMO_CODES as JSON: {"DISCORD":1,"XFOLLOW":1}
//    These are reusable (everyone can use them), give a small +1 boost
// 2. Trade-in codes — generated when a souvenir is burned, single-use, boost scales with rarity
//
// Boost is applied to image generation + metadata rarity (on top of hold-duration tier)

const crypto = require('crypto');

// In-memory store for trade-in codes — persists until server restart
// { code => { boost, usedBy, createdAt, fromTokenId, fromRarity } }
const tradeInCodes = new Map();

// Pending boosts for buyers — applied when they eventually get bought out
// { walletAddress.toLowerCase() => { boost, fromCode, appliedAt } }
const pendingBoosts = new Map();

const RARITY_BOOST   = { common: 1, rare: 2, epic: 3, legendary: 4 };
const RARITY_ORDER   = ['common', 'rare', 'epic', 'legendary'];

function generateCode(rarity) {
  const prefix = { common: 'C', rare: 'R', epic: 'E', legendary: 'L' }[rarity] || 'C';
  const random  = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `HP-${prefix}${random}`;
}

// Called when a souvenir is transferred to the burn address
function createTradeInCode(tokenId, rarity) {
  const code  = generateCode(rarity);
  const boost = RARITY_BOOST[rarity] || 1;
  tradeInCodes.set(code, {
    boost,
    usedBy:     null,
    createdAt:  Date.now(),
    fromTokenId: tokenId,
    fromRarity:  rarity,
  });
  console.log(`🎟️  Trade-in code ${code} created (boost +${boost}) for token #${tokenId} [${rarity}]`);
  return { code, boost };
}

// Validate any code — returns { valid, boost, type } or { valid: false, reason }
function validateCode(code) {
  if (!code) return { valid: false, reason: 'No code provided' };
  const upper = code.toUpperCase().trim();

  // Social codes from env var
  try {
    const social = JSON.parse(process.env.PROMO_CODES || '{}');
    if (social[upper] !== undefined) {
      return { valid: true, boost: Number(social[upper]), type: 'social', code: upper };
    }
  } catch (e) {}

  // Trade-in codes
  const tradeIn = tradeInCodes.get(upper);
  if (tradeIn) {
    if (tradeIn.usedBy) return { valid: false, reason: 'Code already used' };
    return { valid: true, boost: tradeIn.boost, type: 'trade-in', code: upper };
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
  // Social codes are reusable — not marked used
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

module.exports = { createTradeInCode, validateCode, storePendingBoost, consumePendingBoost, applyBoost, RARITY_BOOST };

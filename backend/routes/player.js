// Hot Potato — Player Profile Routes
// Stores name + taunt per wallet address in memory.
// Used by the leaderboard to show real names instead of 0x addresses.

const express = require('express');
const router  = express.Router();
const { ethers } = require('ethers');

// Map: lowercaseAddress → { name, taunt, updatedAt }
const profiles = new Map();

// POST /api/player/profile
// Body: { walletAddress, name, taunt, signature, message }
//
// C-3 fix: requires a wallet signature so only the key-holder can set their
// own profile. Without this anyone could set a name/taunt for any address,
// enabling stored XSS via the leaderboard/gallery/HoF innerHTML render paths.
//
// Client-side: const sig = await signer.signMessage(message);
// where message = `Hot Potato profile update\nAddress: ${walletAddress}\nTimestamp: ${timestamp}`
router.post('/profile', (req, res) => {
  const { walletAddress, name, taunt, signature, message } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });

  // ── Signature verification ─────────────────────────────────
  if (!signature || !message) {
    return res.status(401).json({ error: 'signature and message are required' });
  }
  // Guard against absurdly long messages (no need to verify a 1MB string)
  if (typeof message !== 'string' || message.length > 500) {
    return res.status(400).json({ error: 'message too long' });
  }
  let signer;
  try {
    signer = ethers.verifyMessage(message, signature);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  if (signer.toLowerCase() !== walletAddress.toLowerCase()) {
    return res.status(401).json({ error: 'Signature does not match walletAddress' });
  }

  const addr = walletAddress.toLowerCase();
  const existing = profiles.get(addr) || {};

  const updated = {
    name:      (name  || '').trim().slice(0, 20)  || existing.name  || null,
    taunt:     (taunt || '').trim().slice(0, 80)  || existing.taunt || null,
    updatedAt: Date.now(),
  };

  profiles.set(addr, updated);
  console.log(`👤 Profile saved: ${addr} → "${updated.name}" / "${updated.taunt}"`);
  res.json({ ok: true, profile: updated });
});

// GET /api/player/profile/:address
router.get('/profile/:address', (req, res) => {
  const addr = req.params.address.toLowerCase();
  const profile = profiles.get(addr) || { name: null, taunt: null };
  res.json({ address: addr, ...profile });
});

// GET /api/player/profiles?addresses=0x...,0x...
// Batch lookup — returns object keyed by lowercase address
router.get('/profiles', (req, res) => {
  const raw = req.query.addresses || '';
  if (!raw) return res.json({});

  const result = {};
  raw.split(',').forEach(a => {
    const addr = a.trim().toLowerCase();
    if (addr) result[addr] = profiles.get(addr) || { name: null, taunt: null };
  });
  res.json(result);
});

module.exports = router;

// Hot Potato — Player Profile Routes
// Stores name + taunt per wallet address in memory.
// Used by the leaderboard to show real names instead of 0x addresses.

const express = require('express');
const router  = express.Router();
const { mutationLimiter } = require('../middleware/rateLimiter');
const requireSignature    = require('../middleware/requireSignature');
const { buildExpectedMessage } = require('../middleware/signedMessage');

// Map: lowercaseAddress → { name, taunt, updatedAt }
const profiles = new Map();

// POST /api/player/profile
// Body: { walletAddress, name, taunt, signature, message }
//
// C-3 / N-2 fix: requires a wallet signature where the signed message commits
// to the exact name and taunt being submitted. A captured signature cannot be
// replayed with different name/taunt values.
//
// Message format:
//   Hot Potato profile-update
//   Address: <walletAddress lowercase>
//   Name: <name trimmed to 20 chars>
//   Taunt: <taunt trimmed to 80 chars>
//   Timestamp: <unix ms>
router.post('/profile', mutationLimiter, requireSignature, (req, res) => {
  const { walletAddress, name, taunt, message } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });

  // N-2 fix: rebuild the canonical message from the submitted body and
  // require a byte-exact match with what the user signed. Without this,
  // a captured signature could be replayed with different name/taunt.
  const expected = buildExpectedMessage({
    action: 'profile-update',
    walletAddress,
    fields: {
      Name:  (name  || '').trim().slice(0, 20),
      Taunt: (taunt || '').trim().slice(0, 80),
    },
    timestamp: req.signedTimestamp,
  });
  if (message !== expected) {
    return res.status(401).json({ error: 'Signed message does not match submitted name/taunt' });
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

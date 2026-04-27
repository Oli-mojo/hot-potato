// Hot Potato — Player Profile Routes
// Stores name + taunt per wallet address in memory.
// Used by the leaderboard to show real names instead of 0x addresses.

const express = require('express');
const router  = express.Router();

// Map: lowercaseAddress → { name, taunt, updatedAt }
const profiles = new Map();

// POST /api/player/profile
// Body: { walletAddress, name, taunt }
router.post('/profile', (req, res) => {
  const { walletAddress, name, taunt } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });

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

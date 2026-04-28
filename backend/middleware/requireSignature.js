// Hot Potato — Wallet Signature Middleware
//
// N-2 fix: this middleware verifies signature ownership and timestamp freshness
// only. Each route is responsible for verifying that the signed message
// commits to the action data being submitted (using buildExpectedMessage from
// ./signedMessage.js). Without per-route message binding, a captured signature
// is replayable with attacker-chosen body data.
//
// Required request body fields:
//   walletAddress  — the Ethereum address performing the action
//   signature      — output of ethers signer.signMessage(message)
//   message        — the exact string that was signed (must contain Timestamp:)
//
// On success: req.signedTimestamp is set to the parsed timestamp (ms) so the
// route handler can rebuild the expected message with the same timestamp.

const { ethers } = require('ethers');
const { extractTimestamp, SIGNATURE_MAX_AGE_MS } = require('./signedMessage');

const FUTURE_SKEW_MS = 60 * 1000; // accept up to 1 minute of clock skew

module.exports = function requireSignature(req, res, next) {
  const { walletAddress, signature, message } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress required' });
  }
  if (!signature || !message) {
    return res.status(401).json({ error: 'signature and message required' });
  }
  if (typeof message !== 'string' || message.length > 500) {
    return res.status(400).json({ error: 'message must be a string under 500 characters' });
  }

  // ── Verify signer ────────────────────────────────────────
  let signer;
  try {
    signer = ethers.verifyMessage(message, signature);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  if (signer.toLowerCase() !== String(walletAddress).toLowerCase()) {
    return res.status(401).json({ error: 'Signature does not match walletAddress' });
  }

  // ── Verify timestamp (REQUIRED, not optional) ────────────
  const msgTime = extractTimestamp(message);
  if (msgTime === null) {
    return res.status(401).json({ error: 'Signed message must include a Timestamp line' });
  }
  const now = Date.now();
  if (msgTime > now + FUTURE_SKEW_MS) {
    return res.status(401).json({ error: 'Timestamp is in the future — clock skew?' });
  }
  if (now - msgTime > SIGNATURE_MAX_AGE_MS) {
    return res.status(401).json({ error: 'Signature expired — please re-sign and try again' });
  }

  // Pass the timestamp through so the route can rebuild the expected message
  // with the same value rather than parsing it twice.
  req.signedTimestamp = msgTime;

  next();
};

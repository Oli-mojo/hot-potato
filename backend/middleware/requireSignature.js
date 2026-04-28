// Hot Potato — Wallet Signature Middleware
//
// H-2 fix: verifies that the caller controls the walletAddress they claim.
// Any POST route that mutates per-wallet state (boosts, loyalty, referrals)
// must use this middleware to prevent one user from modifying another's state.
//
// Expected request body fields:
//   walletAddress  — the Ethereum address performing the action
//   signature      — ethers.js signer.signMessage(message) output
//   message        — the exact string that was signed
//
// The message must contain the walletAddress so the signed payload is
// wallet-specific (prevents signature replay across wallets).
// A timestamp in the message (recommended) limits the replay window to
// SIGNATURE_MAX_AGE_MS (default: 5 minutes).
//
// Client-side example:
//   const timestamp = Date.now();
//   const message = `Hot Potato: ${action}\nAddress: ${walletAddress}\nTimestamp: ${timestamp}`;
//   const signature = await signer.signMessage(message);
//   fetch('/api/...', { body: JSON.stringify({ walletAddress, signature, message, ...rest }) });

const { ethers } = require('ethers');

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

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

  // Verify the signer
  let signer;
  try {
    signer = ethers.verifyMessage(message, signature);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  if (signer.toLowerCase() !== walletAddress.toLowerCase()) {
    return res.status(401).json({ error: 'Signature does not match walletAddress' });
  }

  // Optional: check timestamp freshness to limit replay window.
  // The message format is expected to contain "Timestamp: <unix_ms>".
  const tsMatch = message.match(/Timestamp:\s*(\d+)/);
  if (tsMatch) {
    const msgTime = parseInt(tsMatch[1], 10);
    if (Date.now() - msgTime > SIGNATURE_MAX_AGE_MS) {
      return res.status(401).json({ error: 'Signature expired — please re-sign and try again' });
    }
  }

  next();
};

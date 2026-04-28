// Hot Potato — Signed Message Helpers
//
// Single source of truth for the message format that wallets sign.
// The frontend (index.html → signRequest helper) and the backend (each route
// that uses requireSignature) both construct the same canonical string, so
// a captured signature cannot be replayed against a different action or with
// different parameter values.
//
// Format:
//   Hot Potato <action>
//   Address: <walletAddress lowercase>
//   <Field1>: <value1>
//   <Field2>: <value2>
//   ...
//   Timestamp: <unix ms>

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build the canonical signed-message string for an action.
 * Field order matters: the client and server must produce the byte-identical
 * string. JS objects preserve insertion order for string keys, which we rely on.
 */
function buildExpectedMessage({ action, walletAddress, fields = {}, timestamp }) {
  const lines = [
    `Hot Potato ${action}`,
    `Address: ${String(walletAddress).toLowerCase()}`,
  ];
  for (const [k, v] of Object.entries(fields)) {
    // Coerce to string. Don't allow nested newlines — they would break parsing.
    const safe = String(v ?? '').replace(/\r?\n/g, ' ');
    lines.push(`${k}: ${safe}`);
  }
  lines.push(`Timestamp: ${timestamp}`);
  return lines.join('\n');
}

/**
 * Extract the timestamp from a signed message. Returns null if missing/malformed.
 */
function extractTimestamp(message) {
  const m = String(message || '').match(/^Timestamp:\s*(\d+)\s*$/m);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = { buildExpectedMessage, extractTimestamp, SIGNATURE_MAX_AGE_MS };

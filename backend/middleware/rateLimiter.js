// Hot Potato — Lightweight In-Memory Rate Limiter
//
// H-4 fix: protects the API from hammering and code-enumeration attacks.
// Uses a sliding-window counter keyed by IP address.
//
// No external package required — works for a single Railway replica.
// If you ever scale to multiple replicas, swap `store` for a Redis-backed
// store (e.g. rate-limit-redis) so counters are shared across instances.
//
// Usage:
//   const { globalLimiter, mutationLimiter, validateLimiter, galleryLimiter } = require('./rateLimiter');
//   app.use(globalLimiter);                          // server.js — blanket limit
//   router.get('/validate-promo/:code', validateLimiter, handler);
//   router.post('/apply-promo', mutationLimiter, requireSignature, handler);
//   router.get('/gallery', galleryLimiter, handler);

/**
 * createLimiter({ windowMs, max, message })
 *
 * Returns an Express middleware that allows at most `max` requests
 * per `windowMs` milliseconds per IP.  Responds with 429 when exceeded.
 */
function createLimiter({ windowMs, max, message }) {
  // ip → array of request timestamps within the current window
  const store = new Map();

  // Purge expired entries periodically so the Map doesn't grow forever.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of store.entries()) {
      const fresh = timestamps.filter(t => t > cutoff);
      if (fresh.length === 0) store.delete(ip);
      else store.set(ip, fresh);
    }
  }, windowMs).unref(); // .unref() so this timer never prevents the process from exiting

  return function rateLimiter(req, res, next) {
    // N-8 fix: use req.ip which Express computes from X-Forwarded-For correctly
    // once app.set('trust proxy', 1) is set in server.js. The old hand-parsed
    // approach trusted the client-supplied X-Forwarded-For header directly,
    // allowing an attacker to rotate it and bypass rate limiting entirely.
    const ip = req.ip || 'unknown';

    const now    = Date.now();
    const cutoff = now - windowMs;

    // Slide the window: drop timestamps older than `windowMs`
    const timestamps = (store.get(ip) || []).filter(t => t > cutoff);

    const remaining = Math.max(0, max - timestamps.length);

    res.set('X-RateLimit-Limit',     String(max));
    res.set('X-RateLimit-Remaining', String(remaining));

    if (timestamps.length >= max) {
      // Tell the client how many seconds until their oldest request ages out
      const retryAfter = timestamps.length > 0
        ? Math.ceil((timestamps[0] - cutoff) / 1000)
        : Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json(message);
    }

    timestamps.push(now);
    store.set(ip, timestamps);
    next();
  };
}

// ── Limiter tiers ──────────────────────────────────────────────────────────────

// Blanket limit on all API traffic — catches scrapers / bots.
const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests — please slow down and try again shortly' },
});

// POST endpoints that mutate per-wallet state (promos, loyalty, referrals, trade-ins,
// profile updates). Tight window to limit brute-force and promo farming.
const mutationLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests — please slow down and try again shortly' },
});

// Promo-code validation — low limit to prevent enumeration attacks.
const validateLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: 'Too many validation attempts — please slow down and try again shortly' },
});

// Gallery and /owned/:address — each loops over every token on-chain, so they
// are expensive. Limit to prevent accidental or deliberate RPC exhaustion.
const galleryLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: { error: 'Too many requests — please slow down and try again shortly' },
});

module.exports = { globalLimiter, mutationLimiter, validateLimiter, galleryLimiter };

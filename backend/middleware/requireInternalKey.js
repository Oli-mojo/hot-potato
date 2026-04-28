// Hot Potato — Internal API Key Middleware
//
// H-1 fix: protects endpoints that should only be called by the backend
// itself (or an authorised off-chain service), not by the public.
//
// The generate endpoint is the primary target — souvenir generation must
// be triggered by the on-chain PotatoPassed event, not by arbitrary HTTP
// requests from anyone who can discover the URL.
//
// Usage: router.post('/generate', requireInternalKey, handler)
//
// Set GENERATE_SECRET to a long random string in your Railway env vars.
// The event listener passes it in the Authorization header automatically.
// You can also use it manually for recovery: curl with -H "Authorization: Bearer <secret>"

module.exports = function requireInternalKey(req, res, next) {
  const secret = process.env.GENERATE_SECRET;
  if (!secret) {
    // Fail closed: if the secret isn't configured the route is unreachable.
    return res.status(503).json({
      error: 'GENERATE_SECRET not configured — set it in Railway env vars',
    });
  }
  const auth = (req.headers['authorization'] || '').trim();
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

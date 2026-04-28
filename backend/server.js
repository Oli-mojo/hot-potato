// Hot Potato — Backend API Server
require('dotenv').config({ path: '../.env' }); // local dev
require('dotenv').config(); // Railway (reads from environment)

const express = require('express');
const cors = require('cors');

const potatoRoutes   = require('./routes/potato');
const souvenirRoutes = require('./routes/souvenir');
const playerRoutes   = require('./routes/player');
const { startEventListener } = require('./services/eventListener');
// H-4 fix: blanket rate limit on all API traffic
const { globalLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3001;

// H-6 fix: lock CORS to the deployed frontend origin.
// Set ALLOWED_ORIGIN in your Railway env vars to e.g. https://hotpotato.xyz
// For local dev, set ALLOWED_ORIGIN=http://localhost:3000 in .env
if (!process.env.ALLOWED_ORIGIN) {
  console.warn('⚠️  ALLOWED_ORIGIN not set — CORS will block all browser requests. Set it in .env or Railway.');
}
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || false,
  credentials: false, // no cookies/sessions — wallet auth uses signed messages
}));
app.use(express.json());
// H-4 fix: apply global rate limit to all routes (300 req / 15 min per IP).
// Tighter per-route limits are applied in the individual route files.
app.use(globalLimiter);

// Routes
app.use('/api/potato',   potatoRoutes);
app.use('/api/souvenir', souvenirRoutes);
app.use('/api/player',   playerRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: 'Hot Potato 🥔' });
});

app.listen(PORT, () => {
  console.log(`🥔 Hot Potato backend running on http://localhost:${PORT}`);
  // H-1 fix: start the on-chain event listener after the HTTP server is ready.
  // The listener calls /api/souvenir/generate internally — the server must be
  // listening before that call is made.
  startEventListener().catch(err =>
    console.error('EventListener startup error:', err.message)
  );
});

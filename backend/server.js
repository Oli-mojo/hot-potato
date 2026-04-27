// Hot Potato — Backend API Server
require('dotenv').config({ path: '../.env' }); // local dev
require('dotenv').config(); // Railway (reads from environment)

const express = require('express');
const cors = require('cors');

const potatoRoutes   = require('./routes/potato');
const souvenirRoutes = require('./routes/souvenir');
const playerRoutes   = require('./routes/player');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: true, // reflect the request origin — allows all
  credentials: true,
}));
app.use(express.json());

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
});

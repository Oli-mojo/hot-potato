// Hot Potato — On-Chain Event Listener
//
// H-1 fix: listens for PotatoPassed events on the game contract and triggers
// souvenir generation automatically. This replaces the pattern where the
// frontend called POST /api/souvenir/generate directly after a transaction —
// which was unauthenticated and open to abuse.
//
// Architecture:
//   1. On startup, scan for missed PotatoPassed events since the last known block
//      (persisted to disk — H-7 fix — to survive process restarts).
//   2. Subscribe to new PotatoPassed events in real time.
//   3. For each event, POST to /api/souvenir/generate with the internal key.
//
// The HTTP call to /generate is intentional — it keeps generation logic in
// one place and makes manual recovery easy (just hit the endpoint with curl).
//
// H-7 note: Railway redeploys reset the container filesystem, so the persisted
// block file is lost on each deploy. The catch-up scan will replay recent events,
// but the /generate endpoint is idempotent — it skips souvenirs that already
// have a URI set on-chain — so replays are harmless.

const { ethers } = require('ethers');
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const GAME_CONTRACT_ABI = [
  'event PotatoPassed(address indexed from, address indexed to, uint256 price, uint256 holdDuration, uint256 souvenirTokenId, uint8 rarityTier, uint8 buyerBoostLevel)',
];

// ── Block persistence (H-7) ────────────────────────────────────────────────────
// Survives process crashes/restarts (but not Railway redeploys, which reset the
// container). Combined with the idempotency guard in /generate, replays are safe.

// Allow Railway Volume path via env var so the file survives redeploys
const BLOCK_FILE = process.env.BLOCK_FILE
  || path.join(__dirname, '../data/lastProcessedBlock.json');

function loadLastProcessedBlock() {
  try {
    const raw = fs.readFileSync(BLOCK_FILE, 'utf8');
    const { block } = JSON.parse(raw);
    if (typeof block === 'number') {
      console.log(`EventListener: Loaded last processed block ${block} from disk`);
      return block;
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }
  return null;
}

function saveLastProcessedBlock(block) {
  try {
    fs.mkdirSync(path.dirname(BLOCK_FILE), { recursive: true });
    fs.writeFileSync(BLOCK_FILE, JSON.stringify({ block, savedAt: new Date().toISOString() }));
  } catch (err) {
    // Non-fatal — log and continue. The idempotency guard in /generate protects us.
    console.warn('EventListener: Could not save block number to disk:', err.message);
  }
}

// Track the last processed block. Loaded from disk on startup; saved after each event.
let lastProcessedBlock = loadLastProcessedBlock();

async function triggerGeneration(event) {
  const secret = process.env.GENERATE_SECRET;
  const port   = process.env.PORT || 3001;
  if (!secret) {
    console.error('EventListener: GENERATE_SECRET not set — skipping generation for', event.transactionHash);
    return;
  }

  const { from, souvenirTokenId, holdDuration, price } = event.args;
  const holdDurationSeconds = Number(holdDuration);
  const pricePaid           = ethers.formatEther(price);

  console.log(`\n🎯 PotatoPassed detected — hand #${souvenirTokenId}, triggering generation for ${from}`);

  try {
    await axios.post(
      `http://localhost:${port}/api/souvenir/generate`,
      {
        fromAddress:          from,
        souvenirTokenId:      Number(souvenirTokenId),
        holdDurationSeconds,
        pricePaid,
      },
      {
        headers: { Authorization: `Bearer ${secret}` },
        timeout: 10000,
      }
    );
    console.log(`✅ Generation triggered for souvenir #${souvenirTokenId}`);
  } catch (err) {
    console.error(`❌ Generation trigger failed for souvenir #${souvenirTokenId}:`, err.message);
  }
}

async function startEventListener() {
  const rpcUrl          = process.env.RPC_URL;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl || !contractAddress) {
    console.warn('⚠️  EventListener: RPC_URL or CONTRACT_ADDRESS not set — event listener not started.');
    return;
  }

  console.log('👂 Starting PotatoPassed event listener...');

  // Use a WebSocket provider if available (wss://), otherwise fall back to polling.
  let provider;
  try {
    provider = rpcUrl.startsWith('wss://') || rpcUrl.startsWith('ws://')
      ? new ethers.WebSocketProvider(rpcUrl)
      : new ethers.JsonRpcProvider(rpcUrl);
  } catch (err) {
    console.error('EventListener: Failed to create provider:', err.message);
    return;
  }

  const contract = new ethers.Contract(contractAddress, GAME_CONTRACT_ABI, provider);

  // ── Catch-up: process any events since last restart ────────────────────
  // Scans in 10-block chunks to stay within Alchemy free-tier getLogs limits.
  try {
    const currentBlock = await provider.getBlockNumber();
    const CHUNK        = 10;  // Alchemy free tier: max 10 blocks per eth_getLogs
    const LOOKBACK     = 3000; // ~100 min on Base (2s blocks) — covers long redeploy gaps
    const fromBlock    = lastProcessedBlock
      ? lastProcessedBlock + 1
      : Math.max(0, currentBlock - LOOKBACK);
    console.log(`EventListener: Scanning for missed events from block ${fromBlock} to ${currentBlock}...`);

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let totalMissed = 0;
    for (let from = fromBlock; from <= currentBlock; from += CHUNK) {
      const to      = Math.min(from + CHUNK - 1, currentBlock);
      const missed  = await contract.queryFilter('PotatoPassed', from, to);
      totalMissed  += missed.length;
      for (const event of missed) {
        await triggerGeneration(event);
      }
      await sleep(150); // throttle: ~6 req/sec to stay within Alchemy free tier
    }
    if (totalMissed > 0) {
      console.log(`EventListener: Found and processed ${totalMissed} missed event(s)`);
    }
    lastProcessedBlock = currentBlock;
    saveLastProcessedBlock(currentBlock); // H-7: persist after catch-up
  } catch (err) {
    console.error('EventListener: Catch-up scan failed:', err.message);
  }

  // ── Live subscription ──────────────────────────────────────────────────
  contract.on('PotatoPassed', async (...args) => {
    const event = args[args.length - 1]; // ethers v6: last arg is the event object
    lastProcessedBlock = event.blockNumber;
    saveLastProcessedBlock(event.blockNumber); // H-7: persist after each live event
    await triggerGeneration(event);
  });

  // ── Reconnect on WebSocket disconnect ─────────────────────────────────
  if (provider.websocket) {
    provider.websocket.on('close', () => {
      console.warn('EventListener: WebSocket disconnected — reconnecting in 5s...');
      setTimeout(startEventListener, 5000);
    });
  }

  console.log('✅ PotatoPassed event listener active');
}

module.exports = { startEventListener };

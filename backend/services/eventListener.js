// Hot Potato — On-Chain Event Listener
//
// H-1 fix: listens for PotatoPassed events on the game contract and triggers
// souvenir generation automatically. This replaces the pattern where the
// frontend called POST /api/souvenir/generate directly after a transaction —
// which was unauthenticated and open to abuse.
//
// Architecture:
//   1. On startup, scan for missed PotatoPassed events since the last known block
//      (stored in-memory; production should persist this to avoid re-generation).
//   2. Subscribe to new PotatoPassed events in real time.
//   3. For each event, POST to /api/souvenir/generate with the internal key.
//
// The HTTP call to /generate is intentional — it keeps generation logic in
// one place and makes manual recovery easy (just hit the endpoint with curl).

const { ethers } = require('ethers');
const axios = require('axios');

const GAME_CONTRACT_ABI = [
  'event PotatoPassed(address indexed from, address indexed to, uint256 price, uint256 holdDuration, uint256 souvenirTokenId, uint8 rarityTier, uint8 buyerBoostLevel)',
];

// Track the last processed block to avoid double-processing on restart.
// In production, persist this to a file or database.
let lastProcessedBlock = null;

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
  try {
    const currentBlock   = await provider.getBlockNumber();
    const fromBlock      = lastProcessedBlock ? lastProcessedBlock + 1 : Math.max(0, currentBlock - 1000);
    console.log(`EventListener: Scanning for missed events from block ${fromBlock} to ${currentBlock}...`);

    const missedEvents = await contract.queryFilter('PotatoPassed', fromBlock, currentBlock);
    if (missedEvents.length > 0) {
      console.log(`EventListener: Found ${missedEvents.length} missed event(s) — processing...`);
      for (const event of missedEvents) {
        await triggerGeneration(event);
      }
    }
    lastProcessedBlock = currentBlock;
  } catch (err) {
    console.error('EventListener: Catch-up scan failed:', err.message);
  }

  // ── Live subscription ──────────────────────────────────────────────────
  contract.on('PotatoPassed', async (...args) => {
    const event = args[args.length - 1]; // ethers v6: last arg is the event object
    lastProcessedBlock = event.blockNumber;
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

// Hot Potato — Social Scheduler
// ─────────────────────────────────────────────────────────────────────────────
// Runs every 30 minutes. Checks what's happening in the game and posts to X
// when milestone thresholds are hit — at random times within each window so
// posts feel reactive rather than clockwork.
//
// State is persisted to the Railway Volume (SCHEDULER_FILE env var) so it
// survives process restarts. On redeploy the file is lost, but the catch-up
// logic re-evaluates the current hold duration and sets appropriate targets.
//
// Edit backend/config/socialCopy.js to change post copy and tags.
//   — Add/remove milestones there
//   — Toggle account tags on/off there
//   — Change copy there — no code changes needed
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const { getPotatoState }              = require('./contract');
const { postRawTweet, postRawDiscord } = require('./social');
const copy                             = require('../config/socialCopy');

// ── State file ─────────────────────────────────────────────────────────────
const SCHEDULER_FILE = process.env.SCHEDULER_FILE
  || path.join(__dirname, '../data/schedulerState.json');

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ── Persistence ────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = fs.readFileSync(SCHEDULER_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(SCHEDULER_FILE), { recursive: true });
    fs.writeFileSync(SCHEDULER_FILE, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.warn('SocialScheduler: Could not save state:', err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function fmtHours(hours) {
  if (hours < 1)   return `${Math.round(hours * 60)}m`;
  if (hours < 24)  return `${Math.round(hours)}h`;
  if (hours < 168) return `${(hours / 24).toFixed(1)} days`;
  return `${(hours / 168).toFixed(1)} weeks`;
}

function scoreToRarity(score) {
  if (score >= 75) return 'legendary';
  if (score >= 50) return 'epic';
  if (score >= 25) return 'rare';
  return 'common';
}

// Pick a random float between min and max
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Build tweet text from a template + optional tags
function buildTweetText(templateFn, ctx, tags = []) {
  let text = templateFn(ctx).trim();
  if (tags.length > 0) {
    text += '\n\n' + tags.join(' ');
  }
  // Twitter hard limit: 280 chars. Truncate gracefully if over.
  if (text.length > 280) {
    text = text.slice(0, 277) + '…';
  }
  return text;
}

// ── Core check ─────────────────────────────────────────────────────────────

async function runCheck() {
  let state;
  let potatoState;

  try {
    potatoState = await getPotatoState();
  } catch (err) {
    console.warn('SocialScheduler: Could not fetch potato state:', err.message);
    return;
  }

  const siteUrl   = process.env.SITE_URL || 'https://hotpotato.tulipfactory.io';
  const holder    = potatoState.currentOwner;
  const price     = potatoState.currentPrice;
  const holdHours = potatoState.holdDurationHours; // direct from contract
  const now       = Date.now();

  if (!holder || holder === '0x0000000000000000000000000000000000000000') {
    console.log('SocialScheduler: No active holder — skipping');
    return;
  }

  // Derive holderSince from the contract's live hold duration
  const holderSinceMs = now - holdHours * 60 * 60 * 1000;
  const holdDays      = Math.round(holdHours / 24) || 1;
  const addr          = shortAddr(holder);

  // Approximate rarity from hold duration (mirrors contract logic for display)
  // Real score is on-chain; this is just for copy context
  const approxScore = Math.min(99, Math.floor(holdHours / 2));
  const rarity      = scoreToRarity(approxScore);

  const ctx = { addr, price, hours: holdHours, days: holdDays, rarity, siteUrl };

  // ── Load or initialise state ─────────────────────────────────────────────

  state = loadState();

  const holderChanged = !state || state.holder?.toLowerCase() !== holder.toLowerCase();

  if (holderChanged) {
    // New holder — reset everything and assign random fire times for each milestone
    console.log(`SocialScheduler: New holder detected (${addr}) — resetting milestone targets`);

    const milestoneTargets = {};
    for (const m of copy.milestones) {
      // Pick a random offset within [minHours, maxHours] from holderSince
      const fireOffsetHours = randomBetween(m.minHours, m.maxHours);
      milestoneTargets[m.id] = holderSinceMs + fireOffsetHours * 60 * 60 * 1000;
    }

    state = {
      holder,
      holderSince:      holderSinceMs,
      milestoneTargets,               // { id: fireAtTimestamp }
      milestonesFired:  [],           // ids already posted
      lastNudgeAt:      null,
    };
    saveState(state);
  }

  // ── Check milestones ─────────────────────────────────────────────────────

  for (const milestone of copy.milestones) {
    if (state.milestonesFired.includes(milestone.id)) continue; // already posted
    const fireAt = state.milestoneTargets[milestone.id];
    if (!fireAt || now < fireAt) continue; // not yet time

    console.log(`\n📣 SocialScheduler: Firing milestone "${milestone.id}" for ${addr}`);

    // Post to Twitter
    const tweetText = buildTweetText(milestone.template, ctx, milestone.tags);
    await postRawTweet(tweetText);

    // Post to Discord (find matching discord milestone by id)
    const discordMilestone = (copy.discordMilestones || []).find(m => m.id === milestone.id);
    if (discordMilestone) {
      const embed = discordMilestone.embed(ctx);
      await postRawDiscord(embed);
    }

    state.milestonesFired.push(milestone.id);
    state.lastNudgeAt = now; // counts as activity — suppress nudge today
    saveState(state);

    // Only fire one milestone per check to avoid bursting
    return;
  }

  // ── Daily nudge ──────────────────────────────────────────────────────────
  // Fires if no milestone posted in the last 23 hours

  const nudgeIntervalMs = 23 * 60 * 60 * 1000;
  const lastActivity    = state.lastNudgeAt || holderSinceMs;

  if (now - lastActivity >= nudgeIntervalMs) {
    // Pick a random template — avoid repeating the last one if possible
    const lastIdx = state.lastNudgeTemplateIdx ?? -1;
    let idx;
    do { idx = Math.floor(Math.random() * copy.dailyNudge.templates.length); }
    while (copy.dailyNudge.templates.length > 1 && idx === lastIdx);

    console.log(`\n📣 SocialScheduler: Firing daily nudge (template ${idx}) for ${addr}`);

    // Twitter nudge
    const tweetText = buildTweetText(copy.dailyNudge.templates[idx], ctx, copy.dailyNudge.tags);
    await postRawTweet(tweetText);

    // Discord nudge — pick same index (mod length in case arrays differ)
    const discordNudge = copy.discordDailyNudge;
    if (discordNudge) {
      const discordIdx  = idx % discordNudge.embeds.length;
      const embed       = discordNudge.embeds[discordIdx](ctx);
      await postRawDiscord({ ...embed, mention: discordNudge.mention });
    }

    state.lastNudgeAt          = now;
    state.lastNudgeTemplateIdx = idx;
    saveState(state);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

async function startSocialScheduler() {
  const apiKey = process.env.TWITTER_API_KEY;
  if (!apiKey) {
    console.log('ℹ️  SocialScheduler: TWITTER_API_KEY not set — social scheduler not started');
    return;
  }

  console.log('🗓️  Social scheduler started (checks every 30 min)');

  // First check after a short delay so the server is fully up
  setTimeout(async () => {
    await runCheck().catch(err => console.error('SocialScheduler error:', err.message));
    setInterval(
      () => runCheck().catch(err => console.error('SocialScheduler error:', err.message)),
      CHECK_INTERVAL_MS
    );
  }, 60 * 1000); // 1 min delay on startup
}

module.exports = { startSocialScheduler };

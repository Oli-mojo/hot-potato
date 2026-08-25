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

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { getPotatoState }              = require('./contract');
const { postRawTweet, postRawDiscord, tweetLength, fitTweet, TWEET_LIMIT } = require('./social');
const copy                             = require('../config/socialCopy');

// ── State file ─────────────────────────────────────────────────────────────
const SCHEDULER_FILE = process.env.SCHEDULER_FILE
  || path.join(__dirname, '../data/schedulerState.json');

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Never let two scheduler posts land closer together than this, whatever the
// individual timers say — milestones, nudges and taunts all share the account.
const MIN_POST_GAP_MS = 90 * 60 * 1000; // 90 minutes

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

// Short fingerprint of a rendered tweet, for the duplicate guard
function textHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
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

// Build tweet text from a template + optional tags.
// Over-length posts are trimmed above the link, never through it — slicing at a
// fixed offset used to leave "https://hotpotato…" and drop the hashtags.
function buildTweetText(templateFn, ctx, tags = []) {
  let text = templateFn(ctx).trim();
  if (tags.length > 0) {
    text += '\n\n' + tags.join(' ');
  }
  if (tweetLength(text) <= TWEET_LIMIT) return text;

  // Split at the site URL so the link and everything after it survives intact.
  const idx = text.lastIndexOf(ctx.siteUrl);
  if (idx === -1) return fitTweet(text);
  return fitTweet(text.slice(0, idx).trimEnd(), text.slice(idx).trim());
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
    const alreadyMissed    = [];
    for (const m of copy.milestones) {
      // Pick a random offset within [minHours, maxHours] from holderSince
      const fireOffsetHours = randomBetween(m.minHours, m.maxHours);
      milestoneTargets[m.id] = holderSinceMs + fireOffsetHours * 60 * 60 * 1000;

      // If this holder is already past the milestone's whole window, the post is
      // genuinely missed — mark it fired. Without this a lost state file (every
      // Railway redeploy loses it) replays "the potato has a new holder" and
      // "24 hours" days into someone's hold, one stale post per 30-min check.
      if (holdHours >= m.maxHours) alreadyMissed.push(m.id);
    }
    if (alreadyMissed.length > 0) {
      console.log(`SocialScheduler: suppressing ${alreadyMissed.length} already-passed milestone(s): ${alreadyMissed.join(', ')}`);
    }

    state = {
      holder,
      holderSince:       holderSinceMs,
      milestoneTargets,                        // { id: fireAtTimestamp }
      milestonesFired:   [...alreadyMissed],   // ids already posted to X
      discordFired:      [...alreadyMissed],   // ids already posted to Discord
      milestoneAttempts: {},                   // { id: failedAttemptCount }
      lastNudgeAt:       null,
      lastPostAt:        null,                 // any scheduler post, any type
      nextTauntAt:       now + randomBetween(copy.taunts?.minGapHours ?? 5, copy.taunts?.maxGapHours ?? 7) * 60 * 60 * 1000,
      recentTaunts:      [],                   // recently used template indexes
    };
    saveState(state);
  }

  // ── Check milestones ─────────────────────────────────────────────────────

  // Tolerate state files written by an older schema
  state.milestonesFired   = state.milestonesFired   || [];
  state.discordFired      = state.discordFired      || [];
  state.milestoneAttempts = state.milestoneAttempts || {};

  const MAX_ATTEMPTS = 3;

  for (const milestone of copy.milestones) {
    const xDone       = state.milestonesFired.includes(milestone.id);
    const discordDone = state.discordFired.includes(milestone.id);
    if (xDone && discordDone) continue; // fully posted

    const fireAt = state.milestoneTargets[milestone.id];
    if (!fireAt || now < fireAt) continue; // not yet time

    console.log(`\n📣 SocialScheduler: Firing milestone "${milestone.id}" for ${addr}`);

    // Post to X — track success per channel so a retry can't double-post
    // the channel that already went out.
    if (!xDone) {
      const tweetText = buildTweetText(milestone.template, ctx, milestone.tags);
      if (await postRawTweet(tweetText)) {
        state.milestonesFired.push(milestone.id);
      } else {
        const attempts = (state.milestoneAttempts[milestone.id] || 0) + 1;
        state.milestoneAttempts[milestone.id] = attempts;
        if (attempts >= MAX_ATTEMPTS) {
          console.warn(`SocialScheduler: milestone "${milestone.id}" failed ${attempts}× — giving up`);
          state.milestonesFired.push(milestone.id);
        } else {
          console.warn(`SocialScheduler: milestone "${milestone.id}" tweet failed (attempt ${attempts}/${MAX_ATTEMPTS}) — retrying next check`);
        }
      }
    }

    // Post to Discord (find matching discord milestone by id)
    if (!discordDone) {
      const discordMilestone = (copy.discordMilestones || []).find(m => m.id === milestone.id);
      if (!discordMilestone || await postRawDiscord(discordMilestone.embed(ctx))) {
        state.discordFired.push(milestone.id);
      }
    }

    state.lastNudgeAt = now; // counts as activity — suppress nudge today
    state.lastPostAt  = now;
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
    const posted    = await postRawTweet(tweetText);

    // Discord nudge — pick same index (mod length in case arrays differ)
    const discordNudge = copy.discordDailyNudge;
    if (discordNudge) {
      const discordIdx  = idx % discordNudge.embeds.length;
      const embed       = discordNudge.embeds[discordIdx](ctx);
      await postRawDiscord({ ...embed, mention: discordNudge.mention });
    }

    if (posted) {
      state.lastNudgeAt          = now;
      state.lastPostAt           = now;
      state.lastNudgeTemplateIdx = idx;
      saveState(state);
      return; // one post per check
    } else {
      // Leave lastNudgeAt alone so the next check retries with a fresh template
      // (a different template also clears X's duplicate-content rejection).
      console.warn('SocialScheduler: daily nudge tweet failed — retrying next check');
    }
    return;
  }

  // ── Taunts ───────────────────────────────────────────────────────────────
  // Steady reach play — X only. Fires on its own randomised timer, but never
  // within MIN_POST_GAP_MS of any other scheduler post.

  const taunts = copy.taunts;
  if (!taunts || !taunts.templates?.length) return;

  state.recentTaunts = state.recentTaunts || [];
  if (!state.nextTauntAt) {
    state.nextTauntAt = now + randomBetween(taunts.minGapHours, taunts.maxGapHours) * 60 * 60 * 1000;
    saveState(state);
    return;
  }

  if (now < state.nextTauntAt) return;
  if (state.lastPostAt && now - state.lastPostAt < MIN_POST_GAP_MS) {
    console.log('SocialScheduler: taunt due but another post went out recently — holding');
    return;
  }

  // Eligible = passes its `when` gate (if any) and isn't a recent repeat
  const eligible = taunts.templates
    .map((t, i) => ({ i, fn: typeof t === 'function' ? t : t.template, when: t.when }))
    .filter(t => (!t.when || t.when(ctx)));
  const fresh = eligible.filter(t => !state.recentTaunts.includes(t.i));
  const pool  = fresh.length > 0 ? fresh : eligible; // all used recently — allow reuse
  if (pool.length === 0) return;

  // Hard duplicate guard: X rejects byte-identical tweets with a 403, and a
  // stale potato means addr and price don't change for days. Render each
  // candidate and skip any whose exact text we've already posted.
  state.recentTauntHashes = state.recentTauntHashes || [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  let pick, text;
  for (const candidate of shuffled) {
    const rendered = buildTweetText(candidate.fn, ctx, taunts.tags);
    if (!state.recentTauntHashes.includes(textHash(rendered))) {
      pick = candidate;
      text = rendered;
      break;
    }
  }
  if (!pick) {
    // Everything eligible would be a repeat — stay quiet rather than get 403'd.
    console.log('SocialScheduler: every taunt would duplicate a recent post — skipping this window');
    state.nextTauntAt = now + randomBetween(taunts.minGapHours, taunts.maxGapHours) * 60 * 60 * 1000;
    saveState(state);
    return;
  }

  console.log(`\n📣 SocialScheduler: Firing taunt (template ${pick.i}) for ${addr}`);

  if (await postRawTweet(text)) {
    state.recentTaunts       = [pick.i, ...state.recentTaunts].slice(0, taunts.avoidRepeats ?? 8);
    state.recentTauntHashes  = [textHash(text), ...state.recentTauntHashes].slice(0, 60);
    state.lastPostAt   = now;
    state.nextTauntAt  = now + randomBetween(taunts.minGapHours, taunts.maxGapHours) * 60 * 60 * 1000;
    saveState(state);
  } else {
    // Push the next attempt out a little so a hard failure doesn't retry every
    // 30 minutes forever.
    state.nextTauntAt = now + 60 * 60 * 1000;
    saveState(state);
    console.warn('SocialScheduler: taunt tweet failed — retrying in ~1h');
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

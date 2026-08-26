// Hot Potato — Organic Engagement Service
// ─────────────────────────────────────────────────────────────────────────────
// Follows and likes at a deliberately human pace: 3–7 actions on an active day,
// nothing at all on roughly one day in four, spread across waking hours with
// randomised gaps. It never bulk-follows, never chases keywords, and never
// touches an account that isn't either on the allowlist or already talking to
// you. Targets live in config/engagementTargets.js.
//
// Required env:
//   TWITTER_API_KEY / _SECRET / _ACCESS_TOKEN / _ACCESS_SECRET
//   ENGAGEMENT_ENABLED=true   — off by default; nothing runs without it
//
// Optional env:
//   SOCIAL_DRY_RUN=true       — log every action, call no write API
//   ENGAGEMENT_FILE           — state path (point at the Railway Volume)
//   ENGAGEMENT_TZ_OFFSET      — hours from UTC for the active-hours window
//
// Note on API access: follows, likes and mention lookups are not part of X's
// free tier. On a free key every call here returns 403 and the service backs
// off for the day and says so in the logs — it degrades, it doesn't crash.
// ─────────────────────────────────────────────────────────────────────────────

const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const { oauthSign } = require('./social');
const targets = require('../config/engagementTargets');

const API = 'https://api.twitter.com/2';

const ENGAGEMENT_FILE = process.env.ENGAGEMENT_FILE
  || path.join(__dirname, '../data/engagementState.json');

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ── Persistence ────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf8')); }
  catch { return null; }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(ENGAGEMENT_FILE), { recursive: true });
    fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    console.warn('Engagement: could not save state:', err.message);
  }
}

function freshState() {
  return {
    day:            null,   // YYYY-MM-DD the budget was drawn for
    budget:         0,      // actions allowed today (0 on a silent day)
    used:           0,      // actions taken today
    lastActionAt:   null,
    nextActionAt:   null,
    followed:       [],     // user ids we've followed — never re-follow
    likedTweets:    [],     // tweet ids we've liked
    likedAuthorsAt: {},     // authorId -> timestamp, for the per-author cooldown
    backoffUntil:   null,   // set when the API pushes back
    ownUserId:      null,
    searchesToday:  0,      // discovery searches run today
    followsToday:   0,      // strangers followed today
    seenAuthors:    [],     // discovered authors already engaged with
    queryCursor:    0,      // rotate through the query list
    candidateQueue: [],     // eligible targets found by the last search
    estimatedSpend: 0,      // running $ estimate, reset daily
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const creds = () => ({
  apiKey:       process.env.TWITTER_API_KEY,
  apiSecret:    process.env.TWITTER_API_SECRET,
  accessToken:  process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const dryRun    = () => process.env.SOCIAL_DRY_RUN === 'true';
const randInt   = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randFloat = (min, max) => min + Math.random() * (max - min);

function localHour(now) {
  const offset = Number(process.env.ENGAGEMENT_TZ_OFFSET || 0);
  return new Date(now + offset * 3600000).getUTCHours();
}

// Space the remaining actions across the rest of the active window instead of
// using a flat random gap. A flat 45–180min gap averages ~112min, which can't
// fit a 7-action day into a 15-hour window — high-budget days used to run out
// of daylight and silently under-deliver.
function nextGapMs(state, now) {
  const p = targets.pace;
  const minGap = (p.minGapMinutes ?? 45) * 60000;
  const maxGap = (p.maxGapMinutes ?? 180) * 60000;

  const remaining = Math.max(1, state.budget - state.used);
  const endHour   = (p.activeHours || {}).end ?? 23;
  const offset    = Number(process.env.ENGAGEMENT_TZ_OFFSET || 0);
  const local     = new Date(now + offset * 3600000);
  const windowEnd = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), endHour)
                    - offset * 3600000;

  const left   = Math.max(0, windowEnd - now);
  const target = left / remaining;
  // Jitter hard so the rhythm never looks metronomic.
  return Math.min(maxGap, Math.max(minGap, target * randFloat(0.55, 1.35)));
}

function dayKey(now) {
  const offset = Number(process.env.ENGAGEMENT_TZ_OFFSET || 0);
  return new Date(now + offset * 3600000).toISOString().slice(0, 10);
}

// ── X API ──────────────────────────────────────────────────────────────────

// Rough running cost estimate so the logs show what this is spending.
// Rates are X's pay-per-use list prices as of Aug 2026 — update if they move.
const COST = { read: 0.005, action: 0.015, lookup: 0.01 };
function bill(state, kind, units = 1) {
  state.estimatedSpend = Number(((state.estimatedSpend || 0) + COST[kind] * units).toFixed(4));
}

async function xGet(url, params = {}) {
  const auth  = oauthSign({ method: 'GET', url, params, ...creds() });
  const res   = await axios.get(url, {
    params,
    headers: { Authorization: auth },
    timeout: 10000,
  });
  return res.data;
}

async function xPost(url, body) {
  // Body params are not part of the OAuth signature for JSON requests.
  const auth = oauthSign({ method: 'POST', url, params: {}, ...creds() });
  const res  = await axios.post(url, body, {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  return res.data;
}

async function getOwnUserId(state) {
  if (state.ownUserId) return state.ownUserId;
  const data = await xGet(`${API}/users/me`);
  state.ownUserId = data?.data?.id || null;
  return state.ownUserId;
}

// ── Action: like a mention ─────────────────────────────────────────────────
// Only ever likes posts that mention us. Community management, not reach farming.

async function tryLike(state, now) {
  const ownId = await getOwnUserId(state);
  if (!ownId) return false;

  const data = await xGet(`${API}/users/${ownId}/mentions`, {
    max_results:   String(targets.likes.mentionsPerCheck ?? 5),
    'tweet.fields': 'created_at,author_id',
  });

  const mentions  = data?.data || [];
  bill(state, 'read', mentions.length);
  const cooldown  = (targets.likes.perAuthorCooldownHours ?? 24) * 3600000;
  const maxAge    = (targets.likes.maxAgeHours ?? 48) * 3600000;
  const ignore    = new Set((targets.likes.ignore || []).map(h => h.toLowerCase()));

  const candidate = mentions.find((t) => {
    if (state.likedTweets.includes(t.id)) return false;
    if (t.author_id === ownId) return false;
    if (ignore.has(String(t.author_id).toLowerCase())) return false;
    if (t.created_at && now - Date.parse(t.created_at) > maxAge) return false;
    const lastForAuthor = state.likedAuthorsAt[t.author_id];
    if (lastForAuthor && now - lastForAuthor < cooldown) return false;
    return true;
  });

  if (!candidate) return false;

  if (dryRun()) {
    console.log(`🌵 [DRY RUN] would like tweet ${candidate.id} from author ${candidate.author_id}`);
  } else {
    await xPost(`${API}/users/${ownId}/likes`, { tweet_id: candidate.id });
    bill(state, 'action');
    console.log(`❤️  Liked mention ${candidate.id} (author ${candidate.author_id})`);
  }

  state.likedTweets = [candidate.id, ...state.likedTweets].slice(0, 500);
  state.likedAuthorsAt[candidate.author_id] = now;
  return true;
}

// ── Action: discover someone relevant and engage ───────────────────────────
// Searches for people talking about our topics, narrows to a follower band,
// likes one post and optionally follows the author. Relevance first, follower
// count second — see the note in config/engagementTargets.js.

async function tryDiscover(state, now) {
  const d = targets.discover;
  if (!d?.enabled || !d.queries?.length) return false;
  if (state.searchesToday >= (d.maxSearchesPerDay ?? 3)) return false;

  const ownId = await getOwnUserId(state);
  if (!ownId) return false;

  // Rotate queries so one topic doesn't dominate
  // Work through candidates already found before paying for another search.
  // One search costs ~10 reads; harvesting every eligible author from it means
  // a day's actions cost one or two searches, not one search each.
  state.candidateQueue = state.candidateQueue || [];
  if (state.candidateQueue.length === 0) {
    if (state.searchesToday >= (d.maxSearchesPerDay ?? 3)) return false;
    await refillCandidates(state, now, d, ownId);
  }
  if (state.candidateQueue.length === 0) return false;

  return engageCandidate(state, d, ownId);
}

async function refillCandidates(state, now, d, ownId) {
  const query = d.queries[state.queryCursor % d.queries.length];
  state.queryCursor = (state.queryCursor + 1) % d.queries.length;
  state.searchesToday += 1;

  const data = await xGet(`${API}/tweets/search/recent`, {
    query,
    max_results:    String(Math.max(10, d.maxResultsPerSearch ?? 10)),
    'tweet.fields': 'created_at,author_id,public_metrics',
    expansions:     'author_id',
    // Follower counts arrive with the same response — no separate lookups.
    'user.fields':  'public_metrics,description',
  });

  const posts = data?.data || [];
  const users = new Map((data?.includes?.users || []).map(u => [u.id, u]));
  bill(state, 'read', posts.length);

  const { min = 100, max = 5000 } = d.followerRange || {};
  const maxAge = (d.maxAgeHours ?? 24) * 3600000;

  const eligible = posts.filter((t) => {
    if (t.author_id === ownId) return false;
    if (state.seenAuthors.includes(t.author_id)) return false;
    if (state.likedTweets.includes(t.id)) return false;
    if (t.created_at && now - Date.parse(t.created_at) > maxAge) return false;
    const author = users.get(t.author_id);
    if (!author) return false;
    const followers = author.public_metrics?.followers_count ?? 0;
    return followers >= min && followers <= max;
  });

  // Keep one post per author — engaging twice with the same person in a day
  // is the opposite of subtle.
  const byAuthor = new Map();
  for (const t of eligible) {
    if (!byAuthor.has(t.author_id)) {
      const author = users.get(t.author_id);
      byAuthor.set(t.author_id, {
        tweetId:   t.id,
        authorId:  t.author_id,
        username:  author.username || t.author_id,
        followers: author.public_metrics?.followers_count ?? 0,
        query,
      });
    }
  }

  state.candidateQueue = [...state.candidateQueue, ...byAuthor.values()];
  console.log(`Engagement: "${query}" — ${posts.length} read, ${byAuthor.size} eligible (band ${min}-${max})`);
}

async function engageCandidate(state, d, ownId) {
  const candidate = state.candidateQueue.shift();
  const { tweetId, authorId, username, followers, query } = candidate;

  if (dryRun()) {
    console.log(`🌵 [DRY RUN] would like ${tweetId} by @${username} (${followers} followers)`);
  } else {
    await xPost(`${API}/users/${ownId}/likes`, { tweet_id: tweetId });
    bill(state, 'action');
    console.log(`❤️  Liked @${username} (${followers} followers) — via "${query}"`);
  }
  state.likedTweets = [tweetId, ...state.likedTweets].slice(0, 500);
  state.seenAuthors = [authorId, ...state.seenAuthors].slice(0, 1000);

  // Optionally follow the author too — capped hard, and never more than once.
  const followCap = d.followDiscoveredPerDay ?? 0;
  if (followCap > 0 && state.followsToday < followCap && !state.followed.includes(authorId)) {
    if (dryRun()) {
      console.log(`🌵 [DRY RUN] would follow @${username}`);
    } else {
      await xPost(`${API}/users/${ownId}/following`, { target_user_id: authorId });
      bill(state, 'action');
      console.log(`👤 Followed @${username} (${followers} followers)`);
    }
    state.followed     = [...state.followed, authorId];
    state.followsToday += 1;
  }

  return true;
}

// ── Action: follow one allowlisted account ─────────────────────────────────

async function tryFollow(state) {
  const list = targets.follow || [];
  if (list.length === 0) return false;

  const ownId = await getOwnUserId(state);
  if (!ownId) return false;

  for (const username of list) {
    const lookup = await xGet(`${API}/users/by/username/${username}`);
    bill(state, 'lookup');
    const id     = lookup?.data?.id;
    if (!id || state.followed.includes(id)) continue;

    if (dryRun()) {
      console.log(`🌵 [DRY RUN] would follow @${username} (${id})`);
    } else {
      await xPost(`${API}/users/${ownId}/following`, { target_user_id: id });
      bill(state, 'action');
      console.log(`👤 Followed @${username}`);
    }
    state.followed = [...state.followed, id];
    return true;
  }
  return false; // whole allowlist already followed
}

// ── Tick ───────────────────────────────────────────────────────────────────

async function runTick() {
  let state = loadState() || freshState();
  const now = Date.now();

  if (state.backoffUntil && now < state.backoffUntil) return;

  // New day — draw a fresh budget. Some days are deliberately silent.
  const today = dayKey(now);
  if (state.day !== today) {
    const p = targets.pace;
    const silent = Math.random() < (p.zeroDayChance ?? 0.25);
    const spentYesterday = state.estimatedSpend || 0;
    state.day    = today;
    state.used   = 0;
    state.budget = silent ? 0 : randInt(p.minPerActiveDay ?? 3, p.maxPerActiveDay ?? 7);
    state.nextActionAt   = null;
    state.searchesToday  = 0;
    state.followsToday   = 0;
    state.candidateQueue = [];
    state.estimatedSpend = 0;
    console.log(`Engagement: ${today} budget = ${state.budget}${silent ? ' (quiet day)' : ''}` +
                (spentYesterday ? ` | yesterday cost ~$${spentYesterday.toFixed(2)}` : ''));
    saveState(state);
  }

  if (state.used >= state.budget) return;

  // Only during waking hours — 3am activity is the tell of a script.
  const hour = localHour(now);
  const { start = 8, end = 23 } = targets.pace.activeHours || {};
  if (hour < start || hour >= end) return;

  // Randomised spacing, re-rolled after every action. The first action of the
  // day lands soon after the window opens rather than a full gap in, so the
  // whole budget has room to fit.
  if (!state.nextActionAt) {
    state.nextActionAt = now + randFloat(0, 60) * 60000;
    saveState(state);
    return;
  }
  if (now < state.nextActionAt) return;

  try {
    // Mentions first — responding to someone who talked to you is the most
    // natural thing to do and the cheapest (5 reads). Then the curated
    // allowlist. Discovery last, because it's the expensive one.
    const acted = (await tryLike(state, now))
               || (await tryFollow(state))
               || (await tryDiscover(state, now));

    if (acted) {
      state.used        += 1;
      state.lastActionAt = now;
      state.nextActionAt = now + nextGapMs(state, now);
      console.log(`Engagement: ${state.used}/${state.budget} actions today | ~$${(state.estimatedSpend || 0).toFixed(2)} spent`);
    } else {
      // Nothing worth doing — check again later rather than burning budget.
      state.nextActionAt = now + 60 * 60000;
    }
    saveState(state);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data;
    if (status === 403) {
      console.warn('Engagement: 403 from X — likely an API tier that excludes follows/likes/mentions. Pausing 24h.');
      console.warn('  detail:', JSON.stringify(detail));
      state.backoffUntil = now + 24 * 3600000;
    } else if (status === 429) {
      console.warn('Engagement: rate limited — pausing 3h.');
      state.backoffUntil = now + 3 * 3600000;
    } else {
      console.error('Engagement error:', JSON.stringify(detail) || err.message);
      state.backoffUntil = now + 60 * 60000;
    }
    saveState(state);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

async function startEngagement() {
  if (process.env.ENGAGEMENT_ENABLED !== 'true') {
    console.log('ℹ️  Engagement: ENGAGEMENT_ENABLED not set — organic engagement not started');
    return;
  }
  if (!process.env.TWITTER_API_KEY) {
    console.log('ℹ️  Engagement: Twitter credentials not set — organic engagement not started');
    return;
  }

  console.log(`🤝 Organic engagement started (${targets.pace.minPerActiveDay}–${targets.pace.maxPerActiveDay} actions on an active day, ~${Math.round((targets.pace.zeroDayChance ?? 0.25) * 100)}% of days quiet)`);

  // Offset from the social scheduler so the two don't tick in lockstep.
  setTimeout(() => {
    runTick().catch(err => console.error('Engagement tick error:', err.message));
    setInterval(() => runTick().catch(err => console.error('Engagement tick error:', err.message)),
      CHECK_INTERVAL_MS);
  }, 7 * 60 * 1000);
}

module.exports = { startEngagement, runTick };

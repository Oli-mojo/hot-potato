// Hot Potato — Engagement Targets
// ─────────────────────────────────────────────────────────────────────────────
// Who the engagement service is allowed to interact with. This is an ALLOWLIST
// by design: the service never goes hunting for accounts by keyword, because
// keyword-driven following is the pattern X's platform-manipulation rules exist
// to catch. If an account isn't listed here (or hasn't talked to you first),
// it will never be followed.
//
// Edit this file to steer who you engage with. No code changes needed.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {

  // ── Accounts worth following ───────────────────────────────────────────────
  // Handles without the @. The service follows at most one per active day,
  // picks in listed order, and never re-follows someone you've unfollowed.
  // Keep this list curated and genuinely relevant — it's the whole safety model.
  follow: [
    // 'base',
    // 'buildoncbase',
    // 'jessepollak',
    // 'zora',
    // 'opensea',
  ],

  // ── Likes ──────────────────────────────────────────────────────────────────
  // The service only ever likes posts that mention your own account — replies,
  // quotes, people talking about the potato. That's community management, not
  // reach farming, and it's the lowest-risk automation on the platform.
  likes: {
    // How many mentions to pull per check. Under X's pay-per-use pricing every
    // post returned is a billable read ($0.005), so this number is a direct
    // monthly cost: 25 was ~$15/mo, 5 is ~$3/mo. Raise it only if the service
    // is regularly finding nothing to like.
    mentionsPerCheck: 5,
    // Skip anything older than this — liking a three-week-old reply reads as a bot.
    maxAgeHours: 48,
    // Never like the same author twice within this window, so one chatty
    // account can't soak up a whole day's budget.
    perAuthorCooldownHours: 24,
    // Don't like posts from these accounts (your own alts, bots, etc).
    ignore: [
      // 'somebot',
    ],
  },

  // ── Discovery ──────────────────────────────────────────────────────────────
  // Finds people talking about your corner of the world and engages with them.
  //
  // Relevance is the primary filter and the follower band is secondary, on
  // purpose. A 300-follower account with no interest in onchain games is worth
  // nothing to you; a 300-follower account deep in Base culture is exactly who
  // you want, and engaging with them is genuine participation rather than
  // follow-farming — which is both the honest framing and the defensible one.
  //
  // COST: this is the expensive part of the whole system. Every post returned
  // by a search is a billable read ($0.005), so maxResultsPerSearch and
  // maxSearchesPerDay are your spend dial. Defaults below work out at roughly
  // $0.05/day in reads. Author follower counts come back in the same response
  // via expansions, so there are no extra $0.01 profile lookups.

  discover: {
    enabled: true,

    // X recent-search queries (7-day window on pay-per-use). Tune these — they
    // decide who you end up in front of. Keep them narrow; broad queries burn
    // reads on noise.
    queries: [
      '"onchain game" -is:retweet -is:reply lang:en',
      '(nft OR nfts) base -is:retweet -is:reply lang:en',
      '(harberger OR "always for sale") -is:retweet lang:en',
    ],

    // Who's worth engaging. Below the floor is usually a bot or a dead account;
    // above the ceiling they'll never notice you.
    followerRange: { min: 100, max: 5000 },

    // Don't engage with posts older than this — it reads as a bot trawling.
    maxAgeHours: 24,

    // Spend dial. 10 results x 3 searches = at most 30 reads/day = $0.15/day.
    maxResultsPerSearch: 10,
    maxSearchesPerDay:   3,

    // Follow the authors we like, at most this many per day. Set to 0 to like
    // only and never follow strangers.
    followDiscoveredPerDay: 1,
  },

  // ── Pace ───────────────────────────────────────────────────────────────────
  // Quality over quantity. Some days nothing happens at all — that's the point.
  pace: {
    zeroDayChance:   0.25,  // ~1 day in 4 is silent
    minPerActiveDay: 3,
    maxPerActiveDay: 7,
    minGapMinutes:   45,    // never two actions closer than this
    maxGapMinutes:   180,   // and aim to space them out to roughly this
    activeHours:     { start: 8, end: 23 }, // local hours, see ENGAGEMENT_TZ_OFFSET
  },

};

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

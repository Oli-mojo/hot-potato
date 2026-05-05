// Hot Potato — Social Copy Config
// ─────────────────────────────────────────────────────────────────────────────
// Edit THIS FILE to change what gets auto-posted to X.
//
// HOW IT WORKS
//   • Milestone posts fire ONCE per holder, at a random time within
//     [minHours, maxHours] after they picked up the potato.
//     → The randomness means posts feel reactive, not like a clock.
//   • Daily nudge fires every ~24h if no milestone was posted that day.
//     → A random template is picked each time so it doesn't feel like a bot.
//   • All template functions receive the same context object:
//       addr    — short wallet address, e.g. "0xABCD…1234"
//       price   — current asking price in ETH, e.g. "0.0013"
//       hours   — how long current holder has held (decimal hours)
//       days    — same, rounded to nearest day (for copy use)
//       rarity  — current rarity tier: "common" | "rare" | "epic" | "legendary"
//       siteUrl — the site URL from env
//
// ACCOUNT TAGS
//   Tags listed in the `tags` array are appended after the tweet body.
//   Comment out any you don't want to fire on a given milestone.
//   These are suggestions — be selective so it doesn't feel spammy.
//
// ADDING A MILESTONE
//   Copy an existing milestone block, give it a unique `id`, set your
//   [minHours, maxHours] window, write your template, and you're done.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {

  // ── Milestone posts ────────────────────────────────────────────────────────
  // Each fires once per holder. The scheduler picks a random fire time
  // within [minHours, maxHours] when the holder first picks up the potato.

  milestones: [

    {
      id: 'pickup',
      minHours: 0.75,  // 45 min
      maxHours: 2.5,   // 2.5 hours
      tags: [
        // '@base',
        // '@buildoncbase',
      ],
      template: ({ addr, price, siteUrl }) =>
`🥔 The potato has a new holder.

${addr} just bought in. They can't sell it — it's always for sale. Anyone can take it from them at any time.

The clock is running. The rarity is building.
${siteUrl}
#HotPotato #Base`,
    },

    {
      id: 'warming_up',
      minHours: 4,    // 4 hours
      maxHours: 10,   // 10 hours
      tags: [
        // '@base',
      ],
      template: ({ addr, price, hours, siteUrl }) =>
`${addr} has been holding the potato for ${fmtHours(hours)}.

They didn't choose to keep it — it's just still theirs. Every hour nobody takes it, their souvenir gets rarer.

You could end that right now. ${price} ETH.
${siteUrl}
#HotPotato #Base`,
    },

    {
      id: 'day1',
      minHours: 20,   // 20 hours
      maxHours: 31,   // 31 hours
      tags: [
        // '@base',
        // '@buildoncbase',
      ],
      template: ({ addr, price, siteUrl }) =>
`24 hours. The potato is still with ${addr}.

Not by choice — it's always for sale. But nobody has taken it yet.

Their rarity score is climbing. Take it before it gets any higher.
${price} ETH → ${siteUrl}
#HotPotato #Base`,
    },

    {
      id: 'day3',
      minHours: 60,   // 2.5 days
      maxHours: 85,   // 3.5 days
      tags: [
        // '@base',
        // '@zora',
      ],
      template: ({ addr, price, siteUrl }) =>
`Three days and nobody has touched the potato.

${addr} can't sell it. Can't protect it. All they can do is watch the rarity build — and wait for someone to take it.

That someone could be you. ${price} ETH.
${siteUrl}
#HotPotato #NFT #Base`,
    },

    {
      id: 'day7',
      minHours: 156,  // 6.5 days
      maxHours: 185,  // 7.7 days
      tags: [
        // '@base',
        // '@opensea',
      ],
      template: ({ addr, price, siteUrl }) =>
`A week.

${addr} has been sitting on the potato for 7 days. Not because they want to — because nobody has taken it yet.

When someone finally does, ${addr} walks away with a rare souvenir and a profit. The longer you wait, the better their exit gets.

${siteUrl}
#HotPotato #NFT #Base`,
    },

    {
      id: 'day14',
      minHours: 324,  // 13.5 days
      maxHours: 360,  // 15 days
      tags: [
        // '@base',
        // '@buildoncbase',
      ],
      template: ({ addr, price, rarity, siteUrl }) =>
`Two weeks.

${addr} is still holding the potato. The souvenir tier is ${rarity.toUpperCase()} and it's not slowing down.

The longer this sits, the bigger the win for whoever finally claims it — and for ${addr} when they do.

${siteUrl}
#HotPotato #NFT #Base`,
    },

    {
      id: 'day30',
      minHours: 696,  // 29 days
      maxHours: 756,  // 31.5 days
      tags: [
        // '@base',
        // '@jessepollak',
        // '@buildoncbase',
      ],
      template: ({ addr, price, siteUrl }) =>
`A month.

${addr} has held the potato for 30 days. Every single day, anyone could have taken it. Nobody did.

At this point the souvenir will be Legendary. Whoever finally takes it hands them a win — but earns something too.

The potato is still for sale. It always is.
${siteUrl}
#HotPotato #NFT #Base`,
    },

  ],

  // ── Daily nudge ────────────────────────────────────────────────────────────
  // Fires roughly every 24 hours if no milestone was posted that day.
  // One template is picked at random each time so it doesn't feel repetitive.

  dailyNudge: {
    tags: [
      // '@buildoncbase',
    ],
    templates: [

      ({ addr, price, days, siteUrl }) =>
`The potato is still with ${addr}. Day ${days}.

They're not holding by choice — it's always for sale. Their rarity keeps climbing the longer nobody buys.

Are you going to hand them a Legendary? Or take it first?
${siteUrl} #HotPotato #Base`,

      ({ addr, price, days, siteUrl }) =>
`Day ${days}. ${addr} still has the potato.

Every day it sits there, their souvenir gets rarer. Every day you don't buy, you're doing them a favour.

${price} ETH. ${siteUrl}
#HotPotato #Base`,

      ({ addr, price, days, siteUrl }) =>
`${addr} hasn't moved. Neither has the potato.

${days} days in. The rarity is real. The price is ${price} ETH.

Someone's going to take it eventually. Might as well be you.
${siteUrl} #HotPotato #Base`,

      ({ addr, price, days, siteUrl }) =>
`Friendly reminder: the potato is for sale.

It's been ${days} days. ${addr} can't hold it back — anyone can buy it right now for ${price} ETH.

Their souvenir rarity has been climbing this whole time. The longer you wait, the better their exit.

${siteUrl} #HotPotato #Base`,

    ],
  },

  // ── Discord milestone posts ──────────────────────────────────────────────
  // Same milestone ids as Twitter — they fire together.
  // Each returns a Discord embed object: { title, description, color, fields, mention }
  //   mention: '@here' to ping the channel, null to post silently.
  //            Use sparingly — only for big milestones.
  //
  // Discord markdown works here: **bold**, *italic*, `code`, [link](url)

  discordMilestones: [

    {
      id: 'pickup',
      embed: ({ addr, price, siteUrl }) => ({
        title:       '🥔 The potato has a new holder',
        description: `**${addr}** just picked it up.\n\nThey can't sell it — it's always for sale. Anyone can take it from them at any time. The clock is running and the rarity is building.\n\n**[→ Buy the potato](${siteUrl})**`,
        color:       0x888888,
        fields: [
          { name: 'Current price', value: `${price} ETH`, inline: true },
          { name: 'Holder',        value: addr,            inline: true },
        ],
        mention: null,
      }),
    },

    {
      id: 'warming_up',
      embed: ({ addr, price, hours, siteUrl }) => ({
        title:       `⏳ ${fmtHours(hours)} in — and still holding`,
        description: `**${addr}** didn't choose to keep it. It's just still theirs.\n\nEvery hour nobody takes it, their souvenir gets rarer. You could end that right now.\n\n**[→ Take it for ${price} ETH](${siteUrl})**`,
        color:       0xff8c42,
        fields: [
          { name: 'Held for',      value: fmtHours(hours), inline: true },
          { name: 'Current price', value: `${price} ETH`,  inline: true },
        ],
        mention: null,
      }),
    },

    {
      id: 'day1',
      embed: ({ addr, price, siteUrl }) => ({
        title:       '🌅 24 hours. Still nobody has taken it.',
        description: `**${addr}** has been holding the potato for a full day. Not by choice — it's always for sale.\n\nTheir rarity score is climbing. Every hour you wait, they get a better souvenir when it's eventually taken.\n\n**[→ Take it for ${price} ETH](${siteUrl})**`,
        color:       0xff6b00,
        fields: [
          { name: 'Current price', value: `${price} ETH`, inline: true },
          { name: 'Rarity',        value: 'Climbing 📈',  inline: true },
        ],
        mention: null,
      }),
    },

    {
      id: 'day3',
      embed: ({ addr, price, siteUrl }) => ({
        title:       '🔥 Three days. Nobody has dared.',
        description: `**${addr}** can't sell it. Can't protect it. All they can do is watch the rarity build — and wait for someone brave enough to take it.\n\nThat could be you.\n\n**[→ ${price} ETH](${siteUrl})**`,
        color:       0xe8448c,
        fields: [
          { name: 'Days held',     value: '~3 days',      inline: true },
          { name: 'Current price', value: `${price} ETH`, inline: true },
          { name: 'Rarity',        value: 'Rare+ 💎',     inline: true },
        ],
        mention: null, // consider '@here' if your server is active
      }),
    },

    {
      id: 'day7',
      embed: ({ addr, price, siteUrl }) => ({
        title:       '💎 A week. The rarity is getting serious.',
        description: `**${addr}** has been holding the potato for 7 days. Not because they want to — because nobody has taken it.\n\nWhen someone finally does, ${addr} walks away with a rare souvenir and a profit. The longer you wait, the better their exit gets.\n\nAre you going to hand them that win?\n\n**[→ ${price} ETH](${siteUrl})**`,
        color:       0x4fc3f7,
        fields: [
          { name: 'Days held',     value: '~7 days',      inline: true },
          { name: 'Current price', value: `${price} ETH`, inline: true },
          { name: 'Rarity',        value: 'Epic ⚡',       inline: true },
        ],
        mention: '@here', // ping the channel — a week is a big deal
      }),
    },

    {
      id: 'day14',
      embed: ({ addr, price, rarity, siteUrl }) => ({
        title:       '⚡ Two weeks. This is getting legendary.',
        description: `**${addr}** is still holding. The souvenir tier is now **${rarity.toUpperCase()}** and climbing.\n\nEvery day this sits unclaimed, the eventual winner — whoever takes it — walks into something rare.\n\n**[→ ${price} ETH](${siteUrl})**`,
        color:       0xce93d8,
        fields: [
          { name: 'Days held',     value: '~14 days',                  inline: true },
          { name: 'Current price', value: `${price} ETH`,              inline: true },
          { name: 'Rarity',        value: `${rarity.toUpperCase()} 🔥`, inline: true },
        ],
        mention: '@here',
      }),
    },

    {
      id: 'day30',
      embed: ({ addr, price, siteUrl }) => ({
        title:       '👑 A MONTH. LEGENDARY TERRITORY.',
        description: `**${addr}** has held the potato for **30 days**. Every single day, anyone could have taken it. Nobody did.\n\nAt this point the souvenir will be **Legendary**. Whoever finally takes it hands ${addr} a generational exit — but earns something historic too.\n\nThe potato is still for sale. **It always is.**\n\n**[→ ${price} ETH](${siteUrl})**`,
        color:       0xffd600,
        fields: [
          { name: 'Days held',     value: '~30 days',     inline: true },
          { name: 'Current price', value: `${price} ETH`, inline: true },
          { name: 'Rarity',        value: 'LEGENDARY 👑',  inline: true },
        ],
        mention: '@here',
      }),
    },

  ],

  // ── Discord daily nudge ──────────────────────────────────────────────────
  // Fires ~every 24h if no milestone was posted that day.
  // Picks randomly from the embeds array.

  discordDailyNudge: {
    mention: null, // set '@here' to ping daily — probably too noisy
    embeds: [

      ({ addr, price, days, siteUrl }) => ({
        title:       `🥔 Day ${days}. The potato is still available.`,
        description: `**${addr}** is holding — not by choice, but because nobody has taken it yet.\n\nTheir rarity keeps climbing. Are you going to hand them a Legendary?\n\n**[→ ${price} ETH](${siteUrl})**`,
        color:       0x888888,
      }),

      ({ addr, price, days, siteUrl }) => ({
        title:       `🔥 ${days} days and counting.`,
        description: `The potato has been in **${addr}**'s hands for ${days} days. Every day you don't take it, you're doing them a favour.\n\nThe souvenir rarity is real. The price is **${price} ETH**.\n\n**[→ Buy now](${siteUrl})**`,
        color:       0xff8c42,
      }),

      ({ addr, price, days, siteUrl }) => ({
        title:       `⏳ Still waiting for a brave soul.`,
        description: `**${addr}** can't sell it. They can't protect it. It's been ${days} days.\n\nSomeone is going to take this eventually. The question is whether their souvenir will be Common or Legendary by the time you do.\n\n**[→ ${price} ETH](${siteUrl})**`,
        color:       0xe8448c,
      }),

    ],
  },

};

// ─── Helper (used inside templates) ──────────────────────────────────────────
function fmtHours(hours) {
  if (hours < 1)   return `${Math.round(hours * 60)}m`;
  if (hours < 24)  return `${Math.round(hours)}h`;
  if (hours < 168) return `${(hours / 24).toFixed(1)} days`;
  return `${(hours / 168).toFixed(1)} weeks`;
}

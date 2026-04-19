// Hot Potato — Social Notifications Service
// Fires on every PotatoPassed event: posts to Discord and X automatically.
//
// Required env vars:
//   DISCORD_WEBHOOK_URL  — from Discord Server Settings → Integrations → Webhooks
//   TWITTER_API_KEY      — from developer.twitter.com app credentials
//   TWITTER_API_SECRET
//   TWITTER_ACCESS_TOKEN
//   TWITTER_ACCESS_SECRET
//   SITE_URL             — e.g. https://hotpotato.xyz (no trailing slash)

const axios = require('axios');

const RARITY_EMOJI  = { common: '🥔', rare: '💎', epic: '⚡', legendary: '🌟' };
const RARITY_COLOR  = { common: 0x888888, rare: 0x4FC3F7, epic: 0xCE93D8, legendary: 0xFFD600 };
const RARITY_LABEL  = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function formatDuration(hours) {
  if (hours < 1)    return `${Math.round(hours * 60)}m`;
  if (hours < 24)   return `${hours.toFixed(1)}h`;
  if (hours < 168)  return `${(hours / 24).toFixed(1)} days`;
  if (hours < 720)  return `${(hours / 168).toFixed(1)} weeks`;
  return `${(hours / 720).toFixed(1)} months`;
}

// ─── DISCORD ──────────────────────────────────────────────────────────────────
async function postToDiscord({ hand, fromAddress, holdDurationHours, pricePaid, rarity, newAskingPrice }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('ℹ️  No DISCORD_WEBHOOK_URL set — skipping Discord post');
    return;
  }

  const siteUrl  = process.env.SITE_URL || 'https://hotpotato.xyz';
  const emoji    = RARITY_EMOJI[rarity]  || '🥔';
  const color    = RARITY_COLOR[rarity]  || 0x888888;
  const label    = RARITY_LABEL[rarity]  || 'Common';
  const duration = formatDuration(holdDurationHours);

  const embed = {
    title: '🔥 THE POTATO HAS PASSED!',
    color,
    fields: [
      { name: 'Hand',          value: `#${hand}`,                    inline: true },
      { name: 'Previous holder', value: shortAddr(fromAddress),      inline: true },
      { name: 'Held for',      value: duration,                      inline: true },
      { name: 'Price paid',    value: `${pricePaid} ETH`,            inline: true },
      { name: 'Souvenir',      value: `${emoji} ${label}`,           inline: true },
      { name: 'New ask',       value: `${newAskingPrice} ETH`,       inline: true },
    ],
    description: `The hot potato is back on the market.\n[**Buy now →**](${siteUrl})`,
    footer: { text: 'Hot Potato · Built on Base' },
    timestamp: new Date().toISOString(),
  };

  await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 8000 });
  console.log('📣 Discord notification sent');
}

// ─── X (TWITTER) ──────────────────────────────────────────────────────────────
async function postToX({ hand, fromAddress, holdDurationHours, pricePaid, rarity, newAskingPrice }) {
  const apiKey       = process.env.TWITTER_API_KEY;
  const apiSecret    = process.env.TWITTER_API_SECRET;
  const accessToken  = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.log('ℹ️  Twitter credentials not set — skipping X post');
    return;
  }

  const { TwitterApi } = require('twitter-api-v2');
  const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret });

  const siteUrl  = process.env.SITE_URL || 'https://hotpotato.xyz';
  const emoji    = RARITY_EMOJI[rarity]  || '🥔';
  const label    = RARITY_LABEL[rarity]  || 'Common';
  const duration = formatDuration(holdDurationHours);

  const tweet =
`🔥 THE POTATO HAS PASSED!

Hand #${hand} — ${shortAddr(fromAddress)} held for ${duration}
Paid ${pricePaid} ETH → earned ${emoji} ${label} souvenir

Current asking price: ${newAskingPrice} ETH
👉 ${siteUrl}

#HotPotato #NFT #Base #BaseChain`;

  await client.v2.tweet(tweet);
  console.log('📣 X (Twitter) post sent');
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
// Call this after a PotatoPassed event — fire and forget, never throws.
async function announcePotatoPassed(params) {
  const results = await Promise.allSettled([
    postToDiscord(params),
    postToX(params),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('Social post failed:', r.reason?.message || r.reason);
    }
  }
}

module.exports = { announcePotatoPassed };

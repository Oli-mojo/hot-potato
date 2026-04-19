// Hot Potato — fal.ai Image Generation Service

const FAL_API_KEY = process.env.FAL_API_KEY;
const FAL_LORA_URL = process.env.FAL_LORA_URL;

// Personality roll chances
const SMILE_CHANCE  = 0.25; // 1 in 4 — happy/grinning potato
const FEMALE_CHANCE = 0.05; // 1 in 20 — female variant (very rare, any tier)

const COMMON_BACKGROUNDS = [
  'mint green background',
  'sky blue background',
  'soft coral background',
  'lavender purple background',
  'warm peach background',
  'pastel yellow background',
];

const RARE_ACCESSORIES = [
  'wearing a monocle',
  'wearing a curly moustache',
  'wearing round sunglasses',
  'wearing a bow tie',
  'wearing a top hat',
  'wearing a monocle and moustache',
];

const EPIC_ACCESSORIES = [
  'wearing a golden crown and aviator sunglasses',
  'wearing a golden crown and a wild moustache',
  'wearing a golden crown and war paint on its face',
  'wearing a golden crown and a spiked collar',
  'wearing a golden crown',
];

const LEGENDARY_ACCESSORIES = [
  'wearing a golden crown and a smug grin, deep purple and gold background with glowing embers',
  'wearing a cracked golden crown, monocle, and a thick moustache, rich crimson and black background with floating ash',
  'wearing a golden crown tilted to the side with a wink, teal and black background with glowing sparks',
  'wearing a golden crown and diamond-encrusted sunglasses, midnight blue background with orange ember glow',
  'wearing a golden crown looking impossibly smug, dark violet background with golden light rays',
];

// Female variants — same rarity tiers, distinct feminine styling
const FEMALE_COMMON_ACCESSORIES    = ['wearing a small pink flower bow', 'wearing a cute daisy headband', 'wearing a tiny ribbon bow'];
const FEMALE_RARE_ACCESSORIES      = ['wearing a delicate tiara and long eyelashes', 'wearing pearl earrings and a small tiara', 'wearing a golden flower crown'];
const FEMALE_EPIC_ACCESSORIES      = ['wearing a golden tiara with gemstones and long glamorous eyelashes', 'wearing a floral crown with fire-red petals and long lashes', 'wearing a glittering tiara and fierce eye makeup'];
const FEMALE_LEGENDARY_ACCESSORIES = [
  'wearing a diamond tiara, dramatic smoky eye makeup, long lashes, deep purple and gold background with glowing embers',
  'wearing an ornate jewelled crown with long lashes and a knowing smirk, crimson and black background with floating ash',
  'wearing a cracked gem-studded tiara with fierce war paint, teal and black background with glowing sparks',
  'wearing a diamond tiara and oversized bejewelled sunglasses, midnight blue background with orange ember glow',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrompt(rarity) {
  const isFemale = Math.random() < FEMALE_CHANCE;
  const isSmiling = Math.random() < SMILE_CHANCE;

  const expression = isSmiling
    ? 'big cheerful grin, happy gleaming eyes'
    : null; // use rarity default expression

  if (isFemale) {
    console.log(`   ✨ Female variant rolled!`);
    switch (rarity) {
      case 'common':
        return `a HOTPOTATO cartoon character, female potato, cute chubby baby potato with long eyelashes, rosy cheeks, ${pick(FEMALE_COMMON_ACCESSORIES)}, ${pick(COMMON_BACKGROUNDS)}, ${expression || 'shy sweet smile'}, flat cartoon illustration style, adorable and young`;
      case 'rare':
        return `a HOTPOTATO cartoon character, female potato, golden shimmering skin, long elegant eyelashes, ${pick(FEMALE_RARE_ACCESSORIES)}, warm golden background with sparkles, ${expression || 'proud elegant expression'}, flat cartoon illustration style, gleaming and regal`;
      case 'epic':
        return `a HOTPOTATO cartoon character, female potato, engulfed in roaring flames, ${pick(FEMALE_EPIC_ACCESSORIES)}, dramatic dark background, intense fire and sparks, ${expression || 'fierce determined expression'}, flat cartoon illustration style`;
      case 'legendary':
        return `a HOTPOTATO cartoon character, female potato, skin almost completely black and charred, deep charcoal texture with glowing orange cracks, ${pick(FEMALE_LEGENDARY_ACCESSORIES)}, ash and embers swirling around, ${expression || 'imperious smouldering gaze'}, flat cartoon illustration style`;
    }
  }

  switch (rarity) {
    case 'common':
      return `a HOTPOTATO cartoon character, cute baby potato, chubby and small, big innocent eyes, rosy cheeks, no crown, ${pick(COMMON_BACKGROUNDS)}, ${expression || 'slightly pouty expression'}, flat cartoon illustration style, adorable and young`;
    case 'rare':
      return `a HOTPOTATO cartoon character, golden shimmering skin, ${pick(RARE_ACCESSORIES)}, wearing a small golden crown, warm golden background with sparkles, ${expression || 'proud expression'}, flat cartoon illustration style, gleaming and regal`;
    case 'epic':
      return `a HOTPOTATO cartoon character, engulfed in roaring flames, ${pick(EPIC_ACCESSORIES)}, dramatic dark background, intense fire and sparks, ${expression || 'determined angry expression'}, flat cartoon illustration style`;
    case 'legendary':
      return `a HOTPOTATO cartoon character, skin almost completely black and charred, deep charcoal texture with glowing orange cracks, ${pick(LEGENDARY_ACCESSORIES)}, ash and embers swirling around, ${expression || 'impossibly smug expression'}, flat cartoon illustration style`;
    default:
      return `a HOTPOTATO cartoon character, cute baby potato, ${pick(COMMON_BACKGROUNDS)}, flat cartoon illustration style`;
  }
}

async function generateSouvenirImage(rarity, holdDurationHours, holderAddress) {
  const { fal } = await import('@fal-ai/client');

  fal.config({ credentials: FAL_API_KEY });

  const prompt = buildPrompt(rarity);
  const enhancedPrompt = `${prompt}, held for ${Math.round(holdDurationHours)} hours by ${holderAddress.slice(0, 6)}`;

  console.log(`🎨 Generating ${rarity} souvenir image...`);
  console.log(`   Prompt: ${enhancedPrompt}`);

  const result = await fal.subscribe('fal-ai/flux-lora', {
    input: {
      prompt: enhancedPrompt,
      loras: FAL_LORA_URL ? [{ path: FAL_LORA_URL, scale: 1.0 }] : [],
      num_images: 1,
      image_size: 'square_hd',
      num_inference_steps: 28,
      guidance_scale: 3.5,
    },
    logs: false,
  });

  const imageUrl = result.data?.images?.[0]?.url;
  if (!imageUrl) throw new Error('No image returned from fal.ai');

  console.log(`✅ Image generated: ${imageUrl}`);
  return imageUrl;
}

module.exports = { generateSouvenirImage };

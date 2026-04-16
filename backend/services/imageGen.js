// Hot Potato — fal.ai Image Generation Service

const FAL_API_KEY = process.env.FAL_API_KEY;
const FAL_LORA_URL = process.env.FAL_LORA_URL;

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

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const RARITY_PROMPTS = {
  common: () => `a HOTPOTATO cartoon character, cute baby potato, chubby and small, big innocent eyes, rosy cheeks, no crown, ${pick(COMMON_BACKGROUNDS)}, flat cartoon illustration style, adorable and young`,
  rare: () => `a HOTPOTATO cartoon character, golden shimmering skin, ${pick(RARE_ACCESSORIES)}, wearing a small golden crown, warm golden background with sparkles, proud expression, flat cartoon illustration style, gleaming and regal`,
  epic: () => `a HOTPOTATO cartoon character, engulfed in roaring flames, ${pick(EPIC_ACCESSORIES)}, dramatic dark background, intense fire and sparks, determined angry expression, flat cartoon illustration style`,
  legendary: () => `a HOTPOTATO cartoon character, skin almost completely black and charred, deep charcoal texture with glowing orange cracks, ${pick(LEGENDARY_ACCESSORIES)}, ash and embers swirling around, flat cartoon illustration style`,
};

async function generateSouvenirImage(rarity, holdDurationHours, holderAddress) {
  const { fal } = await import('@fal-ai/client');

  fal.config({ credentials: FAL_API_KEY });

  const prompt = (RARITY_PROMPTS[rarity] || RARITY_PROMPTS.common)();
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

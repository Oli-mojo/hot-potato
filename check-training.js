// Hot Potato — Check fal.ai Training Status
// Run with: node check-training.js

require('dotenv').config();

const FAL_API_KEY = process.env.FAL_API_KEY;
const REQUEST_ID = process.env.FAL_TRAINING_REQUEST_ID;

if (!FAL_API_KEY || !REQUEST_ID) {
  console.error('❌ Missing FAL_API_KEY or FAL_TRAINING_REQUEST_ID in .env');
  process.exit(1);
}

async function checkStatus() {
  const res = await fetch(
    `https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${REQUEST_ID}/status`,
    {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    }
  );

  const data = await res.json();
  console.log('Status:', data.status);

  if (data.status === 'COMPLETED') {
    const resultRes = await fetch(
      `https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${REQUEST_ID}`,
      {
        headers: { Authorization: `Key ${FAL_API_KEY}` },
      }
    );
    const result = await resultRes.json();
    console.log('\n🎉 Training complete!');
    console.log('─────────────────────────────');
    console.log('LoRA URL:', result.diffusers_lora_file?.url);
    console.log('\n📝 Add this to your .env:');
    console.log(`FAL_LORA_URL=${result.diffusers_lora_file?.url}`);
  } else if (data.status === 'FAILED') {
    console.error('❌ Training failed:', data.error);
  } else {
    console.log('⏳ Still training... run this script again in a few minutes.');
  }
}

checkStatus().catch(console.error);

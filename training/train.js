// Hot Potato — fal.ai FLUX LoRA Training Script
// Run with: node train.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FAL_API_KEY = process.env.FAL_API_KEY;

if (!FAL_API_KEY) {
  console.error('❌ FAL_API_KEY not found in .env');
  process.exit(1);
}

async function main() {
  console.log('🥔 Hot Potato — fal.ai FLUX LoRA Training');
  console.log('==========================================\n');

  // Dynamically import fal client (ESM)
  const { fal } = await import('@fal-ai/client');

  fal.config({ credentials: FAL_API_KEY });

  // Step 1: Zip training images
  const imagesDir = path.join(__dirname, 'Training images');
  const zipPath = path.join(__dirname, 'training-images.zip');

  console.log('📦 Zipping training images...');
  execSync(`cd "${__dirname}" && zip -j "${zipPath}" "Training images"/*.jpg`);
  console.log(`✅ Zipped ${fs.readdirSync(imagesDir).length} images\n`);

  // Step 2: Upload zip via fal storage
  console.log('⬆️  Uploading to fal.ai storage...');
  const zipBuffer = fs.readFileSync(zipPath);
  const file = new File([zipBuffer], 'training-images.zip', { type: 'application/zip' });
  const imagesDataUrl = await fal.storage.upload(file);
  console.log(`✅ Uploaded: ${imagesDataUrl}\n`);

  // Step 3: Submit training job
  console.log('🚀 Submitting FLUX LoRA training job...');

  const result = await fal.queue.submit('fal-ai/flux-lora-fast-training', {
    input: {
      images_data_url: imagesDataUrl,
      trigger_word: 'HOTPOTATO',
      steps: 1000,
      create_masks: true,
    },
  });

  console.log('\n✅ Training job submitted!');
  console.log('─────────────────────────────');
  console.log('Request ID:', result.request_id);
  console.log('\n📝 Add this to your .env:');
  console.log(`FAL_TRAINING_REQUEST_ID=${result.request_id}`);
  console.log('\nTraining takes ~10-20 minutes. Run check-training.js to monitor.');

  // Clean up zip
  fs.unlinkSync(zipPath);
}

main().catch(console.error);

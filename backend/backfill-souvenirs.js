// Hot Potato — Backfill souvenir images for existing tokens without URIs
require('dotenv').config({ path: '../.env' });
require('dotenv').config();

const { ethers } = require('ethers');
const { generateSouvenirImage } = require('./services/imageGen');
const { uploadImageToIPFS, uploadMetadataToIPFS, buildMetadata } = require('./services/ipfs');
const { setSouvenirURI } = require('./services/contract');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xd04A4fA2B05874d268Ce8bB8E8EaEc252ef2AB22';
const RPC_URL = process.env.RPC_URL;

const RARITY_MAP = ['common', 'rare', 'epic', 'legendary'];

const ABI = [
  'function souvenirCount() view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function souvenirs(uint256 tokenId) view returns (uint256 transferNumber, uint256 pricePaid, uint256 holdDuration, uint8 rarityTier, address originalOwner)',
];

async function backfill() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  const count = Number(await contract.souvenirCount());
  console.log(`\n🥔 Found ${count - 1} souvenirs to check (tokens 1–${count - 1})\n`);

  let backfilled = 0;
  let skipped = 0;

  for (let i = 1; i < count; i++) {
    try {
      // Check if URI already set
      const existingURI = await contract.tokenURI(i).catch(() => '');
      if (existingURI && existingURI.length > 10) {
        console.log(`⏭️  Token #${i} already has URI — skipping`);
        skipped++;
        continue;
      }

      // Get souvenir data
      const data = await contract.souvenirs(i);
      const holdDurationHours = Number(data.holdDuration) / 3600;
      const rarity = RARITY_MAP[Number(data.rarityTier)] || 'common';
      const owner = data.originalOwner;
      const edition = i;

      console.log(`\n🎨 Backfilling token #${i}`);
      console.log(`   Owner: ${owner}`);
      console.log(`   Hold: ${holdDurationHours.toFixed(1)}h → Rarity: ${rarity}`);

      // Generate image
      const imageUrl = await generateSouvenirImage(rarity, holdDurationHours, owner);

      // Upload to IPFS
      const { cid: imageCid } = await uploadImageToIPFS(imageUrl, `hot-potato-souvenir-${edition}.png`);

      // Build and upload metadata
      const metadata = buildMetadata({ rarity, holdDurationHours, holderAddress: owner, imageCid, edition });
      const { url: tokenURI } = await uploadMetadataToIPFS(metadata);

      // Set on-chain
      await setSouvenirURI(i, tokenURI);
      console.log(`✅ Token #${i} done — ${rarity} — ${tokenURI}`);
      backfilled++;

      // Small delay between tokens to avoid rate limits
      if (i < count - 1) {
        console.log('   Waiting 3s before next...');
        await new Promise(r => setTimeout(r, 3000));
      }

    } catch (err) {
      console.error(`❌ Token #${i} failed: ${err.message}`);
    }
  }

  console.log(`\n✅ Backfill complete — ${backfilled} generated, ${skipped} already had URIs`);
}

backfill().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

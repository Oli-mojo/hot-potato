// Hot Potato — Pinata IPFS Service
const axios = require('axios');
const FormData = require('form-data');

const PINATA_JWT = process.env.PINATA_JWT;

async function uploadImageToIPFS(imageUrl, filename) {
  console.log(`📌 Uploading image to IPFS: ${filename}`);

  // Fetch the image from fal.ai
  const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(imageRes.data);

  // Upload to Pinata
  const form = new FormData();
  form.append('file', imageBuffer, { filename, contentType: 'image/png' });
  form.append('pinataMetadata', JSON.stringify({ name: filename }));

  const res = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
  });

  const cid = res.data.IpfsHash;
  console.log(`✅ Image pinned: ipfs://${cid}`);
  return { cid, url: `ipfs://${cid}` };
}

async function uploadMetadataToIPFS(metadata) {
  console.log(`📌 Uploading metadata to IPFS...`);

  const res = await axios.post(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    {
      pinataContent: metadata,
      pinataMetadata: { name: `hot-potato-souvenir-${metadata.edition}` },
    },
    {
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const cid = res.data.IpfsHash;
  console.log(`✅ Metadata pinned: ipfs://${cid}`);
  return { cid, url: `ipfs://${cid}` };
}

function buildMetadata({ rarity, holdDurationHours, holderAddress, imageCid, edition }) {
  return {
    name: `Hot Potato Souvenir #${edition}`,
    description: `A ${rarity} souvenir from the Hot Potato NFT game. This potato was held for ${Math.round(holdDurationHours)} hours.`,
    image: `ipfs://${imageCid}`,
    attributes: [
      { trait_type: 'Rarity', value: rarity.charAt(0).toUpperCase() + rarity.slice(1) },
      { trait_type: 'Hold Duration (hours)', value: Math.round(holdDurationHours) },
      { trait_type: 'Original Holder', value: holderAddress },
      { trait_type: 'Edition', value: edition },
    ],
  };
}

module.exports = { uploadImageToIPFS, uploadMetadataToIPFS, buildMetadata };

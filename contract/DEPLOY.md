# Hot Potato v4 — Deployment Guide

## What's new in v4
- **Two-contract architecture** — The Hot Potato game contract and the Souvenir NFT collection are now separate contracts. This means souvenirs appear as their own clean collection on OpenSea, separate from the game token.
- All game logic is unchanged from v3 (tiered pricing, rarity, boosts).

---

## Contract overview

| Contract | Token | Purpose |
|---|---|---|
| `HotPotato.sol` | HOTP (token 0 only) | The game. Always for sale. |
| `HotPotatoSouvenir.sol` | HOTPS (tokens 1+) | Souvenir collection. Minted by game on every sale. |

---

## Wallets needed before deployment

| Wallet | Role | Needs |
|---|---|---|
| Deployer | Deploys both contracts | ~0.01 ETH for gas |
| Backend operator | Calls `setSouvenirURI`, `setPotatoURI` | ~0.005 ETH for gas, receives contract ownership |
| Creator | Receives 5% of every sale | Just an address — no ETH needed upfront |

> Use fresh wallets not linked to your personal identity. Fund deployer from CEX or privacy-conscious source.

---

## Step 1 — Compile both contracts in Remix

1. Go to **https://remix.ethereum.org**
2. Create two files: `HotPotatoSouvenir.sol` and `HotPotato.sol`
3. Paste the contents of each from `contract/`
4. **Solidity Compiler** tab:
   - Compiler: `0.8.20`
   - Enable optimization: ✅ (200 runs)
   - Click **Compile HotPotatoSouvenir.sol**, then **Compile HotPotato.sol**
5. Switch MetaMask to **Base Mainnet** (Chain ID: 8453)

---

## Step 2 — Deploy HotPotatoSouvenir first

In **Deploy & Run** tab:
- Environment: **Injected Provider - MetaMask**
- Contract: **HotPotatoSouvenir**
- No constructor args needed
- Click **Deploy** → Confirm in MetaMask

📋 **Copy the deployed address → `SOUVENIR_ADDRESS`**

---

## Step 3 — Deploy HotPotato (game contract)

Still in **Deploy & Run** tab:
- Contract: **HotPotato**
- Constructor arg: paste `SOUVENIR_ADDRESS` from Step 2
- Click **Deploy** → Confirm in MetaMask

📋 **Copy the deployed address → `GAME_ADDRESS`**

---

## Step 4 — Wire the contracts together

In Remix, call these in order:

**On HotPotatoSouvenir:**
```
setGameContract(GAME_ADDRESS)
```
This authorises the game contract as the only minter. Without this, souvenirs can't be minted.

**On HotPotatoSouvenir:**
```
transferOwnership(BACKEND_WALLET_ADDRESS)
```

**On HotPotato:**
```
transferOwnership(BACKEND_WALLET_ADDRESS)
```

After this the deployer wallet is no longer needed. Backend wallet controls URI setting.

---

## Step 5 — Set metadata URIs

**On HotPotato** (as backend wallet owner), call:
```
setPotatoURI("ipfs://bafkreidslwp5mls5bulfem3743z3vsmcvtvkk5vacyl73f2vdsla7jjijq")
```
(Same potato metadata CID as previous versions.)

---

## Step 6 — Update Railway environment variables

```
CONTRACT_ADDRESS=<HotPotato address>
SOUVENIR_ADDRESS=<HotPotatoSouvenir address>
RPC_URL=https://mainnet.base.org   (or your Alchemy/Infura mainnet URL)
WALLET_PRIVATE_KEY=<backend operator private key>
```

Keep existing: `PINATA_JWT`, `FAL_KEY`, `DISCORD_WEBHOOK_URL`, `TWITTER_*`, `SITE_URL`

---

## Step 7 — Update frontend (index.html)

```js
const CONTRACT_ADDRESS = '<HotPotato address>';
const SOUVENIR_ADDRESS = '<HotPotatoSouvenir address>';
const CHAIN_ID         = 8453;          // Base mainnet
const CHAIN_SLUG       = 'base';
const OPENSEA_BASE     = 'https://opensea.io/assets/base';
const OPENSEA_COLLECTION = 'https://opensea.io/collection/<souvenir-collection-slug>';
```

Also update the footer `Contract` link to:
```
https://basescan.org/address/<HotPotato address>
```

---

## Step 8 — Verify contracts on Basescan

Verification lets users read the code directly from Basescan and builds trust.

1. Go to `https://basescan.org/address/<CONTRACT_ADDRESS>#code`
2. Click **Verify and Publish**
3. Compiler: `v0.8.20`, Optimization: Yes (200 runs), License: MIT
4. Flatten the source (Remix → right-click → Flatten) or use Hardhat verify

Repeat for the souvenir contract.

---

## Step 9 — End-to-end test on mainnet

1. Buy the potato with the minimum starting price (0.001 ETH + gas)
2. Confirm `PotatoPassed` event fires in Railway logs
3. Confirm fal.ai image generates
4. Confirm Pinata upload succeeds
5. Confirm `setSouvenirURI` is called and transaction lands on Basescan
6. Confirm souvenir appears on OpenSea

---

## Contract addresses

| Version | Network | Game Contract | Souvenir Contract |
|---------|---------|---------------|-------------------|
| v1 | Base Sepolia | `0x2E8eA15a54Db53375807A8F74ad6ff6eC4a4065e` | — |
| v2 | Base Sepolia | `0xd04A4fA2B05874d268Ce8bB8E8EaEc252ef2AB22` | — |
| v3 | Base Sepolia | `0x90Bfcf98282445B35e3ce48b9Eb21E532E603473` | — |
| v4 | Base Sepolia | `0x12A0C8f0BeaBe3AD904096c77A839f6b87A32bec` | `0x22dCc7cdE4689260ecA455d33EA460812A0fC8e9` |
| v5 | Base Sepolia | `0xf9b3912578893a0c4771db56D7F64B956311524E` | `0xf4C5c825bCC7C36977062cB1376C5548FE698c5E` |
| v5 | Base Mainnet | TBD | TBD |

---

## Rarity reference

| Boost level | Overpayment above minimum | Effect |
|-------------|---------------------------|--------|
| 0 | < 10% | Pure hold-duration odds |
| 1 | 10–24% | +1 rarity tier |
| 2 | 25–49% | +2 rarity tiers |
| 3 | 50–99% | +3 rarity tiers |
| 4 | 100%+ | Max (Legendary odds) |

| Hold duration | Base tier | Common | Rare | Epic | Legendary |
|---------------|-----------|--------|------|------|-----------|
| < 6h | Common | 85% | 12% | 2% | 1% |
| 6h – 2 days | Rare | 60% | 28% | 9% | 3% |
| 2 – 7 days | Epic | 20% | 40% | 25% | 15% |
| 7 – 30 days | Legendary | 5% | 20% | 45% | 30% |
| 30+ days | Max | 1% | 9% | 40% | 50% |

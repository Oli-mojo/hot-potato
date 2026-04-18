# Hot Potato v2 — Deployment Guide

## What's new in v2
- **5% creator fee** on every sale → `0x995a13322683cf42463Cd1bDE6412020Ce685008`
- **Premium boost** — overpaying above minimum banks better rarity odds for your souvenir
- **Starting price** 0.001 ETH (10× lower than v1)
- **ERC-2981** royalty standard (OpenSea etc. will respect the 5% royalty)

---

## Step 1 — Deploy via Remix

1. Go to **https://remix.ethereum.org**
2. Create a new file: `HotPotato.sol`
3. Paste the contents of `contract/HotPotato.sol`
4. Go to **Solidity Compiler** tab:
   - Compiler: `0.8.20`
   - Enable optimization: ✅ (200 runs)
   - Click **Compile HotPotato.sol**
5. Go to **Deploy & Run** tab:
   - Environment: **Injected Provider - MetaMask**
   - Make sure MetaMask is on **Base Sepolia** (Chain ID: 84532)
   - Contract: **HotPotato**
   - Click **Deploy**
   - Confirm in MetaMask
6. Copy the deployed contract address

---

## Step 2 — Update environment variables

Update these in **Railway** (Settings → Variables):

```
CONTRACT_ADDRESS=<new contract address>
```

The `RPC_URL`, `WALLET_PRIVATE_KEY`, `PINATA_JWT`, and `FAL_*` vars stay the same.

---

## Step 3 — Set the Hot Potato's metadata URI

The potato token (ID 0) needs its image URI set on-chain.

In Remix, call `setPotatoURI` with:
```
ipfs://bafkreidslwp5mls5bulfem3743z3vsmcvtvkk5vacyl73f2vdsla7jjijq
```
(Same metadata CID as v1 — no change needed.)

---

## Step 4 — Update frontend contract address

In `index.html`, update line:
```js
const CONTRACT_ADDRESS = '<new contract address>';
```

---

## Step 5 — Redeploy & verify

- Push changes to GitHub
- Railway auto-deploys the backend
- Vercel auto-deploys the frontend
- Visit the site and confirm stats load at 0.0010 ETH starting price

---

## Premium Boost Reference

| Boost Level | Overpayment above minimum | Effect |
|-------------|--------------------------|--------|
| 0 | < 10% | Pure hold-duration odds |
| 1 | 10–24% | +1 rarity tier |
| 2 | 25–49% | +2 rarity tiers |
| 3 | 50–99% | +3 rarity tiers |
| 4 | 100%+ (2× minimum) | Max tier (legendary odds) |

**Example:** You hold for 2 hours (normally Common odds: 85/12/2/1). You paid 60% above minimum → Boost level 3 → Effective tier becomes Tier 3 (1–3 month odds: 5/20/45/30). Your short hold earned you Epic-dominant odds just from overpaying.

---

## Contract addresses

| Version | Network | Address |
|---------|---------|---------|
| v1 | Base Sepolia | `0x2E8eA15a54Db53375807A8F74ad6ff6eC4a4065e` |
| v2 | Base Sepolia | `0xd04A4fA2B05874d268Ce8bB8E8EaEc252ef2AB22` |

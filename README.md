# 🥔 Hot Potato — ACTIVE PROJECT

> **This is the live codebase.** Do not confuse with `jack-the-potato` or `Jack the Potato` — those are old experiments and should be ignored.

## What this is
Hot Potato is a single ERC-721 NFT game on Base where the token is always for sale. Every sale mints a souvenir NFT to the previous holder. Price only goes up.

## Current deployment — Base Sepolia (testnet)

| Contract | Address |
|---|---|
| HotPotato (game, v5) | `0xf9b3912578893a0c4771db56D7F64B956311524E` |
| HotPotatoSouvenir (v2) | `0xf4C5c825bCC7C36977062cB1376C5548FE698c5E` |

Backend: https://hot-potato-production.up.railway.app  
Frontend: Vercel → GitHub repo `Oli-mojo/hot-potato`

## Structure

```
index.html              — Frontend (single file, deployed via Vercel)
backend/
  server.js             — Express API (deployed on Railway)
  routes/               — potato, souvenir, player
  services/             — contract, imageGen, ipfs, social, promoCode
  middleware/           — requireSignature, signedMessage, rateLimiter
contract/
  HotPotato.sol         — Game contract (v5, post-audit)
  HotPotatoSouvenir.sol — Souvenir NFT contract (v2, post-audit)
  DEPLOY.md             — Step-by-step deployment guide
```

## Version history

| Version | Network | Notes |
|---|---|---|
| v1–v3 | Base Sepolia | Early iterations, deprecated |
| v4 | Base Sepolia | Two-contract split (game + souvenir) |
| v5 | Base Sepolia | Post-audit: pull-payment, slippage guard, signed mutations |
| **v5** | **Base Mainnet** | **TBD — pending mainnet deploy** |

## Status
- [x] Security audit round 1 complete
- [x] Security audit round 2 complete + patches applied
- [x] Testnet smoke tests passing (buy, souvenir generation, withdraw)
- [ ] Trade-in flow verified on testnet
- [ ] Mainnet deploy

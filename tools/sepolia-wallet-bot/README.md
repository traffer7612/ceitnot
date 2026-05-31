# Ceitnot Sepolia multi-wallet bot

Runs **on-chain** flows for many wallets on **Arbitrum Sepolia** (same as [ceitnot.io](https://www.ceitnot.io)): mint test wstETH → vault → `depositAndBorrow` → `repay`.

Does **not** drive a browser. For airdrop proof, Arbiscan txs on the Engine are what matter.

## Setup

```bash
cd tools/sepolia-wallet-bot
cp .env.example .env
cp wallets.example.txt wallets.txt
# Edit .env (addresses from frontend/.env) and wallets.txt (one private key per line)
npm install
```

### Auto-fund ETH (testnet)

Public faucets cannot be automated (CAPTCHA). The bot **sends Sepolia ETH** from a **funder wallet**:

1. Fund **one** wallet once via [faucet](https://faucet.quicknode.com/arbitrum/sepolia) (~0.05 ETH for 3 workers).
2. In `.env` set `FUNDER_PRIVATE_KEY=0x...` **or** leave empty — then the **richest** key in `wallets.txt` pays the others.
3. Tune `MIN_ETH_BALANCE` / `TOP_UP_ETH` (defaults `0.003` / `0.008` ETH).

Set `AUTO_FUND=0` to disable. The bot mints mock wstETH itself.

If you see **Cloudflare 403** on `sepolia-rollup.arbitrum.io`, set in `.env`:

`RPC_URL=https://arbitrum-sepolia-rpc.publicnode.com`

(or your Alchemy / Infura Arbitrum Sepolia URL)

## Run

```bash
npm run dry-run   # check balances, no txs
npm start         # execute for all wallets in wallets.txt
```

## Security

- **Never commit** `wallets.txt` or real keys.
- Testnet keys only. Anyone with a key owns the wallet.

## Engine same-block rule

`deposit` and `borrow` in separate txs need **different blocks**; this bot uses `depositAndBorrow` then waits before `repay`.

## Optional

- `APP_URL` — HTTP GET to your Vercel app (analytics only).
- Adjust `WSTETH_MINT`, `BORROW_AMOUNT`, `REPAY_AMOUNT` in `.env`.

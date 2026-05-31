import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { parseEther } from 'viem';
import type { Address, Hex } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: resolve(root, '.env') });

const DEFAULTS: Record<string, Address> = {
  ENGINE_ADDRESS: '0x0348E674020edf3E90BD0F791DeCebe6EbD620b8',
  MOCK_WSTETH_ADDRESS: '0x843989F6D1616812CDa58f54D8f8A37498e67FE3',
  WSTETH_VAULT: '0x6E829cFaA1cEAD52C76f27902517FBe8d22EFD2A',
  CEITUSD_ADDRESS: '0x29E3fee667D8ef595670F5086C6EDE567473fC87',
};

function addr(name: keyof typeof DEFAULTS): Address {
  return (process.env[name] ?? DEFAULTS[name]) as Address;
}

function big(name: string, fallback: string): bigint {
  const v = process.env[name] ?? fallback;
  return BigInt(v);
}

export function normalizePk(s: string): Hex {
  const hex = s.startsWith('0x') ? s : `0x${s}`;
  if (hex.length !== 66) throw new Error(`Invalid private key length: ${s.slice(0, 10)}...`);
  return hex as Hex;
}

export const cfg = {
  // Official rollup RPC often returns Cloudflare 403 from some IPs; use a public fallback.
  rpcUrl:
    process.env.RPC_URL ??
    'https://arbitrum-sepolia-rpc.publicnode.com',
  engine: addr('ENGINE_ADDRESS'),
  wsteth: addr('MOCK_WSTETH_ADDRESS'),
  vault: addr('WSTETH_VAULT'),
  ceitUsd: addr('CEITUSD_ADDRESS'),
  marketId: BigInt(process.env.MARKET_ID ?? '0'),
  appUrl: process.env.APP_URL ?? 'https://www.ceitnot.io',
  wstethMint: big('WSTETH_MINT', '1000000000000000000'),
  borrowAmount: big('BORROW_AMOUNT', '50000000000000000000'),
  repayAmount: big('REPAY_AMOUNT', '25000000000000000000'),
  txDelayMs: Number(process.env.TX_DELAY_MS ?? '4000'),
  walletDelayMs: Number(process.env.WALLET_DELAY_MS ?? '8000'),
  dryRun: process.argv.includes('--dry-run'),
  /** Top up worker if balance below this (ETH string, e.g. 0.003). */
  minEthBalance: parseEther(process.env.MIN_ETH_BALANCE ?? '0.003'),
  /** Amount sent from funder when topping up. */
  topUpEth: parseEther(process.env.TOP_UP_ETH ?? '0.008'),
  /** Set AUTO_FUND=0 to disable. Default: on. */
  autoFund: process.env.AUTO_FUND !== '0' && process.env.AUTO_FUND !== 'false',
  funderPrivateKey: process.env.FUNDER_PRIVATE_KEY
    ? normalizePk(process.env.FUNDER_PRIVATE_KEY)
    : undefined,
};

export function loadPrivateKeys(): Hex[] {
  const keys: Hex[] = [];
  const fromEnv = process.env.PRIVATE_KEYS;
  if (fromEnv?.trim()) {
    for (const part of fromEnv.split(',')) {
      const k = part.trim();
      if (k) keys.push(normalizePk(k));
    }
  }
  const file = resolve(root, 'wallets.txt');
  if (existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      keys.push(normalizePk(t));
    }
  }
  if (keys.length === 0) {
    throw new Error(
      'No wallets: set PRIVATE_KEYS in .env or create wallets.txt (see wallets.example.txt)',
    );
  }
  return keys;
}

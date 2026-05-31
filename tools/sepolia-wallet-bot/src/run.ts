/**
 * Multi-wallet Ceitnot testnet bot — Arbitrum Sepolia.
 *
 * Per wallet: mint mock wstETH → vault deposit → depositAndBorrow on Engine →
 * wait next block → partial repay → optional app URL fetch.
 *
 * Does NOT open a browser; on-chain actions match what the UI does.
 * Auto-fund: FUNDER_PRIVATE_KEY or richest wallet in wallets.txt sends Sepolia ETH.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { cfg, loadPrivateKeys } from './config.js';
import { engineAbi, erc20Abi, vaultAbi } from './abis.js';
import { ensureEth, resolveFunder, type Funder } from './fund.js';

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(cfg.rpcUrl),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const SAME_BLOCK_SIG = '0x416d8cff'; // Ceitnot__SameBlockInteraction()

/** Wait ≥2 blocks after an Engine tx (Arbitrum can reuse block.number within a batch). */
async function waitEngineCooldown(
  engineTxBlock: bigint,
  label: string,
) {
  const target = engineTxBlock + 2n;
  console.log(`  … ${label}: need block >= ${target} (engine tx in ${engineTxBlock})`);
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    const now = await publicClient.getBlockNumber();
    if (now >= target) {
      console.log(`  … ${label} ready: ${now}`);
      return;
    }
  }
  throw new Error(`Timed out waiting for block ${target}`);
}

function isSameBlockError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes(SAME_BLOCK_SIG) || msg.includes('SameBlock');
}

async function waitTx(hash: Hex, label: string) {
  console.log(`  … ${label}: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${label} reverted`);
  return receipt;
}

async function pingApp() {
  try {
    const res = await fetch(cfg.appUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'CeitnotSepoliaBot/1.0' },
    });
    console.log(`  … app ping ${cfg.appUrl} → ${res.status}`);
  } catch (e) {
    console.warn(`  … app ping failed:`, e);
  }
}

async function runWallet(
  pk: Hex,
  index: number,
  funder: Funder | undefined,
): Promise<'ok' | 'skip'> {
  const account = privateKeyToAccount(pk);
  const address = account.address;
  console.log(`\n[${index + 1}] ${address}`);

  if (cfg.dryRun) {
    const ok = await ensureEth(address, funder);
    console.log(
      ok
        ? '  (dry-run) would: mint → vault → depositAndBorrow → repay'
        : '  (dry-run) skipped — insufficient ETH',
    );
    return 'ok';
  }

  const funded = await ensureEth(address, funder);
  if (!funded) {
    console.warn('  ⚠ skipped — could not fund wallet');
    return 'skip';
  }

  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(cfg.rpcUrl),
  });

  await pingApp();

  // 1) Mint mock wstETH (public mint on testnet MockERC20)
  const mintHash = await walletClient.writeContract({
    address: cfg.wsteth,
    abi: erc20Abi,
    functionName: 'mint',
    args: [address, cfg.wstethMint],
  });
  await waitTx(mintHash, 'mint wstETH');
  await sleep(cfg.txDelayMs);

  // 2) Approve vault + deposit → receive shares
  let hash = await walletClient.writeContract({
    address: cfg.wsteth,
    abi: erc20Abi,
    functionName: 'approve',
    args: [cfg.vault, cfg.wstethMint],
  });
  await waitTx(hash, 'approve wstETH → vault');
  await sleep(cfg.txDelayMs);

  hash = await walletClient.writeContract({
    address: cfg.vault,
    abi: vaultAbi,
    functionName: 'deposit',
    args: [cfg.wstethMint, address],
  });
  await waitTx(hash, 'vault deposit');
  await sleep(cfg.txDelayMs);

  // 3) Approve engine for vault shares
  hash = await walletClient.writeContract({
    address: cfg.vault,
    abi: vaultAbi,
    functionName: 'approve',
    args: [cfg.engine, cfg.wstethMint],
  });
  await waitTx(hash, 'approve vault shares → engine');
  await sleep(cfg.txDelayMs);

  // 4) depositAndBorrow (one tx — avoids same-block guard between deposit & borrow)
  hash = await walletClient.writeContract({
    address: cfg.engine,
    abi: engineAbi,
    functionName: 'depositAndBorrow',
    args: [address, cfg.marketId, cfg.wstethMint, cfg.borrowAmount],
  });
  const engineReceipt = await waitTx(hash, 'depositAndBorrow');
  await waitEngineCooldown(engineReceipt.blockNumber, 'cooldown after depositAndBorrow');

  const debt = await publicClient.readContract({
    address: cfg.engine,
    abi: engineAbi,
    functionName: 'getPositionDebt',
    args: [address, cfg.marketId],
  });
  const hf = await publicClient.readContract({
    address: cfg.engine,
    abi: engineAbi,
    functionName: 'getHealthFactor',
    args: [address],
  });
  console.log(`  position debt: ${debt.toString()} | HF (WAD): ${hf.toString()}`);

  // 5) repay (must be a different block than last interaction)
  const repayAmt = cfg.repayAmount > debt ? debt : cfg.repayAmount;
  if (repayAmt > 0n) {
    hash = await walletClient.writeContract({
      address: cfg.ceitUsd,
      abi: erc20Abi,
      functionName: 'approve',
      args: [cfg.engine, maxUint256],
    });
    await waitTx(hash, 'approve ceitUSD → engine');
    const head = await publicClient.getBlockNumber();
    await waitEngineCooldown(head, 'cooldown before repay');

    try {
      hash = await walletClient.writeContract({
        address: cfg.engine,
        abi: engineAbi,
        functionName: 'repay',
        args: [address, cfg.marketId, repayAmt],
      });
      await waitTx(hash, 'repay');
    } catch (err) {
      if (isSameBlockError(err)) {
        console.warn(
          '  ⚠ repay skipped (same-block) — depositAndBorrow is enough for airdrop proof',
        );
      } else {
        throw err;
      }
    }
  }

  console.log(`  ✓ done ${address}`);
  console.log(`    explorer: https://sepolia.arbiscan.io/address/${address}`);
  return 'ok';
}

async function main() {
  const keys = loadPrivateKeys();
  console.log(`Ceitnot Sepolia bot | wallets: ${keys.length} | engine: ${cfg.engine}`);
  if (cfg.dryRun) console.log('DRY RUN — no protocol txs\n');

  const funder = await resolveFunder(keys);
  if (cfg.autoFund && funder) {
    console.log(`Auto-fund enabled | funder: ${funder.address}`);
  } else if (cfg.autoFund) {
    console.log('Auto-fund enabled but no funder resolved — fund one wallet via faucet first');
  }

  let ok = 0;
  let fail = 0;
  let skip = 0;

  for (let i = 0; i < keys.length; i++) {
    try {
      const result = await runWallet(keys[i], i, funder);
      if (result === 'skip') skip++;
      else ok++;
    } catch (e) {
      fail++;
      console.error(`  ✗ wallet ${i + 1} failed:`, e);
    }
    if (i < keys.length - 1) await sleep(cfg.walletDelayMs);
  }

  console.log(`\nDone: ${ok} ok, ${skip} skipped (no ETH), ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

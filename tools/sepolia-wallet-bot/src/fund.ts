import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { cfg } from './config.js';

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(cfg.rpcUrl),
});

export type Funder = {
  privateKey: Hex;
  address: Address;
};

/** Env FUNDER_PRIVATE_KEY, else richest wallet in the list (if AUTO_FUND). */
export async function resolveFunder(workerKeys: Hex[]): Promise<Funder | undefined> {
  if (!cfg.autoFund) return undefined;

  const envPk = cfg.funderPrivateKey;
  if (envPk) {
    const account = privateKeyToAccount(envPk);
    return { privateKey: envPk, address: account.address };
  }

  let best: { pk: Hex; bal: bigint } | undefined;
  for (const pk of workerKeys) {
    const address = privateKeyToAccount(pk).address;
    const bal = await publicClient.getBalance({ address });
    if (!best || bal > best.bal) best = { pk, bal };
  }
  if (!best) return undefined;

  const minFunderBal = cfg.topUpEth + parseEther('0.002');
  if (best.bal < minFunderBal) {
    console.warn(
      `Auto-fund: no wallet has enough ETH (funder needs ≥ ${formatEther(minFunderBal)} per top-up). ` +
        `Fund one wallet via faucet or set FUNDER_PRIVATE_KEY.`,
    );
    return undefined;
  }

  const address = privateKeyToAccount(best.pk).address;
  console.log(
    `Auto-fund: using richest worker as funder ${address} (${formatEther(best.bal)} ETH)`,
  );
  return { privateKey: best.pk, address };
}

export async function ensureEth(address: Address, funder: Funder | undefined): Promise<boolean> {
  let bal = await publicClient.getBalance({ address });
  console.log(`  ETH balance: ${formatEther(bal)}`);

  if (bal >= cfg.minEthBalance) return true;
  if (!funder) {
    console.warn('  ⚠ Low ETH — set FUNDER_PRIVATE_KEY or fund via faucet');
    return false;
  }
  if (address.toLowerCase() === funder.address.toLowerCase()) {
    console.warn('  ⚠ Funder wallet itself is low on ETH');
    return bal >= cfg.minEthBalance;
  }

  const funderBal = await publicClient.getBalance({ address: funder.address });
  if (funderBal < cfg.topUpEth + parseEther('0.0001')) {
    console.warn(
      `  ⚠ Funder ${funder.address} has only ${formatEther(funderBal)} ETH — cannot top up`,
    );
    return false;
  }

  const funderAccount = privateKeyToAccount(funder.privateKey);
  const funderClient = createWalletClient({
    account: funderAccount,
    chain: arbitrumSepolia,
    transport: http(cfg.rpcUrl),
  });

  console.log(`  … topping up +${formatEther(cfg.topUpEth)} ETH from funder ${funder.address}`);
  const hash = await funderClient.sendTransaction({
    to: address,
    value: cfg.topUpEth,
  });
  console.log(`  … fund transfer: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    console.warn('  ⚠ Fund transfer reverted');
    return false;
  }

  bal = await publicClient.getBalance({ address });
  console.log(`  ETH after top-up: ${formatEther(bal)}`);
  return bal >= cfg.minEthBalance;
}

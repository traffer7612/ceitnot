import { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, type Address, type Hash } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ArrowDownUp, Loader2, CheckCircle, Wallet, RefreshCw, Info } from 'lucide-react';
import { ceitnotPsmAbi } from '../abi/ceitnotEngine';
import { erc20Abi } from '../abi/ceitnotEngine';
import { TARGET_CHAIN_ID, gasFor } from '../lib/contracts';
import { contractAddress } from '../lib/chainEnv';
import { formatWad, formatToken, erc20Decimals } from '../lib/utils';
import {
  combineSwapLimits,
  envMaxSwapInPeg,
  envMaxSwapOutAusd,
  formatLimitHuman,
  remainingPegFromCeiling,
} from '../lib/psmSwapLimits';

/* ─── Addresses ───────────────────────────────────────────────────────────── */

const PSM = contractAddress('PSM') as Address | undefined;
const USDC = contractAddress('USDC') as Address | undefined;
const CEITUSD = (contractAddress('CEITUSD') ?? contractAddress('AUSD')) as Address | undefined;
function formatCompactBigintToken(v: bigint | undefined, decimals: number): string {
  if (v === undefined) return '—';
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  if (whole < 1000n) return formatToken(v, decimals, 2);
  const suffixes = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'] as const;
  let unit = 0;
  let divisor = 1n;
  while (unit < suffixes.length && whole >= divisor * 1000n) {
    divisor *= 1000n;
    unit += 1;
  }
  if (unit === 0) return formatToken(v, decimals, 2);
  if (unit >= suffixes.length && whole >= divisor * 1000n) {
    const s = whole.toString();
    const frac = s.length > 1 ? s.slice(1, 3) : '00';
    return `${s[0]}.${frac}e${s.length - 1}`;
  }
  const scaled = (whole * 100n) / divisor;
  const intPart = scaled / 100n;
  const fracPart = (scaled % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  const suffix = suffixes[unit - 1];
  return fracPart ? `${intPart.toString()}.${fracPart}${suffix}` : `${intPart.toString()}${suffix}`;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function SwapPage() {
  const { address, isConnected, chainId } = useAccount();
  const gas = gasFor(chainId);
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });

  /* direction: 'in' = USDC → ceitUSD, 'out' = ceitUSD → USDC */
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [approveHash, setApproveHash] = useState<Hash | undefined>();
  const [errMsg, setErrMsg] = useState('');

  const { writeContractAsync, isPending } = useWriteContract();
  const { isSuccess: swapConfirmed } = useWaitForTransactionReceipt({ hash });
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash });
  const isFeeCapTooLowError = (message: string) => {
    const msg = message.toLowerCase();
    return (
      msg.includes('max fee per gas less than block base fee')
      || (msg.includes('max fee per gas') && msg.includes('base fee'))
      || (msg.includes('maxfeepergas') && msg.includes('basefee'))
    );
  };
  const feeOverridesForBaseFeeRetry = async (baseFeeMultiplier = 2n) => {
    if (!publicClient) return undefined;
    try {
      const pending = await publicClient.getBlock({ blockTag: 'pending' });
      const baseFee = pending.baseFeePerGas;
      if (baseFee == null) return undefined;
      const maxPriorityFeePerGas = baseFee / 10n + 1_000_000n;
      const maxFeePerGas = baseFee * baseFeeMultiplier + maxPriorityFeePerGas;
      return { maxFeePerGas, maxPriorityFeePerGas } as const;
    } catch {
      return undefined;
    }
  };
  const writeWithBaseFeeRetry = async (
    request: Parameters<typeof writeContractAsync>[0],
  ) => {
    const initialFee = await feeOverridesForBaseFeeRetry(2n);
    const firstRequest = (initialFee
      ? { ...request, ...initialFee }
      : request) as Parameters<typeof writeContractAsync>[0];
    try {
      return await writeContractAsync(firstRequest);
    } catch (writeError: unknown) {
      const msg = writeError instanceof Error ? writeError.message : String(writeError);
      if (!isFeeCapTooLowError(msg)) throw writeError;
      const feeRetry = await feeOverridesForBaseFeeRetry(4n);
      if (!feeRetry) throw writeError;
      return await writeContractAsync({ ...request, ...feeRetry } as Parameters<typeof writeContractAsync>[0]);
    }
  };

  const { data: peggedDecimalsRaw } = useReadContract({
    address: PSM,
    abi: ceitnotPsmAbi,
    functionName: 'peggedDecimals',
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!PSM },
  });
  const { data: usdcDecimalsRaw } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'decimals',
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!USDC },
  });
  const { data: maxSwapInOnChain } = useReadContract({
    address: PSM,
    abi: ceitnotPsmAbi,
    functionName: 'maxSwapInPeg',
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!PSM, retry: false },
  });
  const { data: maxSwapOutOnChain } = useReadContract({
    address: PSM,
    abi: ceitnotPsmAbi,
    functionName: 'maxSwapOutAusd',
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!PSM, retry: false },
  });
  /** Native pegged-token decimals (6 on Arbitrum USDC, 18 on Sepolia mock). Prefer ERC-20 metadata over default 6. */
  const peggedDec = useMemo(() => {
    const fromToken = erc20Decimals(usdcDecimalsRaw, undefined);
    const fromPsm = erc20Decimals(peggedDecimalsRaw, undefined);
    return Math.min(fromToken ?? fromPsm ?? 18, 18);
  }, [usdcDecimalsRaw, peggedDecimalsRaw]);

  /* ── On-chain reads ─── */
  const { data, refetch } = useReadContracts({
    contracts: [
      { address: PSM!, abi: ceitnotPsmAbi, functionName: 'tinBps',           chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: ceitnotPsmAbi, functionName: 'toutBps',          chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: ceitnotPsmAbi, functionName: 'availableReserves', chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: ceitnotPsmAbi, functionName: 'ceiling',          chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: ceitnotPsmAbi, functionName: 'mintedViaPsm',     chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: ceitnotPsmAbi, functionName: 'feeReserves',      chainId: TARGET_CHAIN_ID },
      // User balances
      { address: USDC!, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN_ID },
      { address: CEITUSD!, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN_ID },
      // Allowances
      { address: USDC!, abi: erc20Abi, functionName: 'allowance', args: [address!, PSM!], chainId: TARGET_CHAIN_ID },
      { address: CEITUSD!, abi: erc20Abi, functionName: 'allowance', args: [address!, PSM!], chainId: TARGET_CHAIN_ID },
    ],
    query: { enabled: !!PSM && !!USDC && !!CEITUSD && !!address },
  });

  const tinBps           = data?.[0]?.result as number | undefined;
  const toutBps          = data?.[1]?.result as number | undefined;
  const availableReserves= data?.[2]?.result as bigint | undefined;
  const ceiling          = data?.[3]?.result as bigint | undefined;
  const mintedViaPsm     = data?.[4]?.result as bigint | undefined;
  const feeReserves      = data?.[5]?.result as bigint | undefined;
  const usdcBalance      = data?.[6]?.result as bigint | undefined;
  const ceitusdBalance   = data?.[7]?.result as bigint | undefined;
  const usdcAllowance    = data?.[8]?.result as bigint | undefined;
  const ceitusdAllowance = data?.[9]?.result as bigint | undefined;

  /* ── Derived ─── */
  const feeBps   = direction === 'in' ? (tinBps ?? 10) : (toutBps ?? 10);
  const feePct   = (feeBps / 100).toFixed(2);
  const inputToken  = direction === 'in' ? 'USDC' : 'ceitUSD';
  const outputToken = direction === 'in' ? 'ceitUSD' : 'USDC';
  const balance     = direction === 'in' ? usdcBalance : ceitusdBalance;
  const allowance   = direction === 'in' ? usdcAllowance : ceitusdAllowance;
  const tokenToApprove = direction === 'in' ? USDC : CEITUSD;

  const inputDecimals = direction === 'in' ? peggedDec : 18;
  const parsedAmount = useMemo(() => {
    try { return amount ? parseUnits(amount, inputDecimals) : 0n; } catch { return 0n; }
  }, [amount, inputDecimals]);

  const feeAmount = parsedAmount > 0n ? (parsedAmount * BigInt(feeBps)) / 10000n : 0n;
  const scalePow = 18 - peggedDec;
  const scale = scalePow > 0 ? 10n ** BigInt(scalePow) : 1n;

  /** Estimated output amount in output-token wei (matches on-chain rounding). */
  const estimatedOutWei = useMemo(() => {
    if (parsedAmount === 0n) return 0n;
    const net = parsedAmount - feeAmount;
    if (net <= 0n) return 0n;
    if (direction === 'in') return net * scale;
    return net / scale;
  }, [parsedAmount, feeAmount, direction, scale]);

  const feePegForLiquidity = direction === 'out' && feeAmount > 0n ? feeAmount / scale : 0n;

  const maxSwapInPeg = combineSwapLimits(
    maxSwapInOnChain === undefined ? undefined : (maxSwapInOnChain as bigint),
    envMaxSwapInPeg(peggedDec),
  );
  const maxSwapOutAusd = combineSwapLimits(
    maxSwapOutOnChain === undefined ? undefined : (maxSwapOutOnChain as bigint),
    envMaxSwapOutAusd(peggedDec, scale),
  );
  const ceilingPegLeft = remainingPegFromCeiling(ceiling, mintedViaPsm, scale);

  const perTxCap =
    direction === 'in'
      ? maxSwapInPeg
      : maxSwapOutAusd;
  const ceilingCapPeg = direction === 'in' ? ceilingPegLeft : undefined;
  const effectiveMaxInput = useMemo(() => {
    let cap: bigint | undefined = balance;
    if (perTxCap !== undefined) cap = cap === undefined ? perTxCap : (cap < perTxCap ? cap : perTxCap);
    if (ceilingCapPeg !== undefined) {
      cap = cap === undefined ? ceilingCapPeg : (cap < ceilingCapPeg ? cap : ceilingCapPeg);
    }
    return cap;
  }, [balance, perTxCap, ceilingCapPeg]);

  const exceedsPerTx =
    parsedAmount > 0n && perTxCap !== undefined && parsedAmount > perTxCap;
  const exceedsProtocol =
    parsedAmount > 0n
    && direction === 'in'
    && ceilingPegLeft !== undefined
    && parsedAmount > ceilingPegLeft;
  const exceedsLiquidity =
    direction === 'out'
    && parsedAmount > 0n
    && estimatedOutWei > 0n
    && availableReserves !== undefined
    && availableReserves < estimatedOutWei + feePegForLiquidity;

  const needsApproval = parsedAmount > 0n && (allowance === undefined || allowance < parsedAmount);
  const liquidityOk = !exceedsLiquidity;
  const canSwap =
    parsedAmount > 0n
    && !needsApproval
    && balance !== undefined
    && balance >= parsedAmount
    && liquidityOk
    && estimatedOutWei > 0n
    && !exceedsPerTx
    && !exceedsProtocol;
  const availableReservesCompact = useMemo(() => {
    return formatCompactBigintToken(availableReserves, peggedDec);
  }, [availableReserves, peggedDec]);

  /* ── Refresh after confirm ─── */
  useEffect(() => {
    if (swapConfirmed) { refetch(); setAmount(''); setErrMsg(''); }
  }, [swapConfirmed, refetch]);

  useEffect(() => {
    if (approveConfirmed) { refetch(); setApproveHash(undefined); }
  }, [approveConfirmed, refetch]);

  /* ── Handlers ─── */
  async function handleApprove() {
    if (!tokenToApprove || !PSM) return;
    setErrMsg('');
    try {
      const h = await writeWithBaseFeeRetry({
        address: tokenToApprove,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PSM, 2n ** 256n - 1n],
        ...gas,
      });
      setApproveHash(h);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 150) : String(e));
    }
  }

  async function handleSwap() {
    if (!PSM) return;
    setErrMsg('');
    try {
      const h = await writeWithBaseFeeRetry({
        address: PSM,
        abi: ceitnotPsmAbi,
        functionName: direction === 'in' ? 'swapIn' : 'swapOut',
        args: [parsedAmount],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isFeeCapTooLowError(msg)) {
        setErrMsg('RPC отклонил tx: max fee ниже base fee. Повторите попытку.');
      } else {
        setErrMsg(msg.split('\n')[0].slice(0, 150));
      }
    }
  }

  function handleMax() {
    if (effectiveMaxInput !== undefined && effectiveMaxInput > 0n) {
      setAmount(formatUnits(effectiveMaxInput, inputDecimals));
    }
  }

  function flipDirection() {
    setDirection(d => d === 'in' ? 'out' : 'in');
    setAmount('');
    setHash(undefined);
    setApproveHash(undefined);
    setErrMsg('');
  }

  /* ── Not connected ─── */
  if (!isConnected) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm w-full flex flex-col items-center">
          <Wallet size={48} className="text-ceitnot-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
          <p className="text-ceitnot-muted text-sm mb-6">Connect to swap ceitUSD ↔ USDC via the Peg Stability Module.</p>
          <div className="w-full flex justify-center [&>div]:flex [&>div]:justify-center">
            <ConnectButton />
          </div>
        </div>
      </div>
    );
  }

  if (!PSM || !USDC || !CEITUSD) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <p className="text-ceitnot-muted">PSM not configured. Missing environment variables.</p>
      </div>
    );
  }

  /* ── Main UI ─── */
  return (
    <div className="page-container max-w-lg mx-auto">
      <div className="page-header text-center">
        <h1 className="page-title">
          <span className="page-title-accent">Swap</span>
        </h1>
        <p className="page-subtitle">Exchange ceitUSD ↔ USDC at 1:1 via the Peg Stability Module</p>
      </div>

      {(perTxCap !== undefined || (ceiling !== undefined && ceiling > 0n)) && (
        <div className="mb-4 rounded-xl border border-ceitnot-gold/30 bg-ceitnot-gold/5 px-4 py-3 text-xs text-ceitnot-muted">
          <p className="font-medium text-ceitnot-ink mb-1">Soft-launch swap limits</p>
          {perTxCap !== undefined && (
            <p>
              Max per swap ({direction === 'in' ? 'USDC → ceitUSD' : 'ceitUSD → USDC'}):{' '}
              <span className="text-ceitnot-gold font-mono">
                {direction === 'in'
                  ? formatLimitHuman(perTxCap, peggedDec, 'USDC')
                  : formatLimitHuman(perTxCap, 18, 'ceitUSD')}
              </span>
            </p>
          )}
          {direction === 'in' && ceiling !== undefined && ceiling > 0n && ceilingPegLeft !== undefined && (
            <p className="mt-1">
              PSM mint headroom:{' '}
              <span className="font-mono text-ceitnot-ink">{formatLimitHuman(ceilingPegLeft, peggedDec, 'USDC')}</span>
            </p>
          )}
          {direction === 'out' && availableReserves !== undefined && (
            <p className="mt-1">
              PSM USDC available:{' '}
              <span className="font-mono text-ceitnot-ink">{availableReservesCompact} USDC</span>
            </p>
          )}
        </div>
      )}

      {/* Swap Card */}
      <div className="card p-6">
        {/* From */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-ceitnot-muted">From</span>
            <button onClick={handleMax} className="text-xs text-ceitnot-gold hover:underline">
              Balance: {balance !== undefined ? (direction === 'in' ? formatToken(balance, peggedDec, 4) : formatWad(balance, 4)) : '—'} {inputToken}
            </button>
          </div>
          <div className="flex items-center gap-3 bg-ceitnot-surface rounded-xl p-3 border border-ceitnot-border">
            <input
              type="number"
              value={amount}
              onChange={e => { setAmount(e.target.value); setHash(undefined); setErrMsg(''); }}
              placeholder="0.0"
              className="bg-transparent text-xl font-mono flex-1 outline-none w-0 text-ceitnot-ink placeholder-ceitnot-muted"
            />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ceitnot-surface-2 border border-ceitnot-border shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                direction === 'in' ? 'bg-blue-500/20 text-blue-400' : 'bg-ceitnot-gold/20 text-ceitnot-gold'
              }`}>
                {direction === 'in' ? '$' : 'c'}
              </div>
              <span className="font-semibold text-sm">{inputToken}</span>
            </div>
          </div>
        </div>

        {/* Flip button */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            onClick={flipDirection}
            className="w-9 h-9 rounded-full border-2 border-ceitnot-border bg-ceitnot-surface-2 flex items-center justify-center hover:border-ceitnot-gold/50 hover:text-ceitnot-gold transition-colors text-ceitnot-ink"
          >
            <ArrowDownUp size={16} />
          </button>
        </div>

        {/* To */}
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-ceitnot-muted">To (estimated)</span>
            <span className="text-xs text-ceitnot-muted">
              Balance: {direction === 'in' ? formatWad(ceitusdBalance, 4) : formatToken(usdcBalance, peggedDec, 4)} {outputToken}
            </span>
          </div>
          <div className="flex items-center gap-3 bg-ceitnot-surface rounded-xl p-3 border border-ceitnot-border">
            <span className="text-xl font-mono flex-1 text-ceitnot-muted-2">
              {estimatedOutWei > 0n
                ? Number(formatUnits(estimatedOutWei, direction === 'in' ? 18 : peggedDec)).toLocaleString(undefined, { maximumFractionDigits: 4 })
                : '0.0'}
            </span>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ceitnot-surface-2 border border-ceitnot-border shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                direction === 'out' ? 'bg-blue-500/20 text-blue-400' : 'bg-ceitnot-gold/20 text-ceitnot-gold'
              }`}>
                {direction === 'out' ? '$' : 'c'}
              </div>
              <span className="font-semibold text-sm">{outputToken}</span>
            </div>
          </div>
        </div>

        {/* Details */}
        {parsedAmount > 0n && (
          <div className="mt-4 p-3 rounded-lg bg-ceitnot-surface-2/70 border border-ceitnot-border space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-ceitnot-muted">Rate</span>
              <span>1 {inputToken} = 1 {outputToken}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ceitnot-muted">Fee ({feePct}%)</span>
              <span className="text-ceitnot-warning">
                −{Number(formatUnits(feeAmount, inputDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {inputToken}
              </span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-ceitnot-muted">You receive</span>
              <span className="text-ceitnot-success">
                {Number(formatUnits(estimatedOutWei, direction === 'in' ? 18 : peggedDec)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {outputToken}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 space-y-2">
          {needsApproval && parsedAmount > 0n && (
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="btn-secondary w-full flex items-center justify-center gap-2"
            >
              {isPending && approveHash ? <Loader2 size={14} className="animate-spin" /> : null}
              {approveConfirmed ? <><CheckCircle size={14} className="text-ceitnot-success" /> Approved</> : `Approve ${inputToken}`}
            </button>
          )}
          <button
            onClick={handleSwap}
            disabled={isPending || !canSwap || parsedAmount === 0n}
            className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3"
          >
            {isPending && hash ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownUp size={16} />}
            {swapConfirmed ? 'Swapped!' : `Swap ${inputToken} → ${outputToken}`}
          </button>
        </div>

        {/* Status */}
        {hash && !swapConfirmed && (
          <p className="text-xs text-center text-ceitnot-muted font-mono mt-3">Pending: {hash.slice(0, 10)}…</p>
        )}
        {swapConfirmed && hash && (
          <p className="text-xs text-center text-ceitnot-success font-mono mt-3 flex items-center justify-center gap-1">
            <CheckCircle size={12} /> Swap confirmed!
          </p>
        )}
        {exceedsPerTx && perTxCap !== undefined && (
          <p className="text-xs text-ceitnot-warning bg-ceitnot-warning/10 p-3 rounded-lg mt-3">
            Amount exceeds per-swap limit (
            {direction === 'in'
              ? formatLimitHuman(perTxCap, peggedDec, 'USDC')
              : formatLimitHuman(perTxCap, 18, 'ceitUSD')}
            ).
          </p>
        )}
        {exceedsProtocol && (
          <p className="text-xs text-ceitnot-warning bg-ceitnot-warning/10 p-3 rounded-lg mt-3">
            Amount exceeds remaining PSM mint ceiling.
          </p>
        )}
        {!liquidityOk && (
          <p className="text-xs text-ceitnot-warning bg-ceitnot-warning/10 p-3 rounded-lg mt-3">
            Not enough USDC in the PSM for this swapOut. Try a smaller amount or swapIn first.
          </p>
        )}
        {errMsg && (
          <p className="text-xs text-ceitnot-danger bg-ceitnot-danger/10 p-3 rounded-lg mt-3 break-all">{errMsg}</p>
        )}
      </div>

      {/* PSM Stats */}
      <div className="card p-5 mt-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-ceitnot-gold" />
            <h2 className="font-semibold text-sm">PSM Stats</h2>
          </div>
          <button onClick={() => refetch()} className="btn-ghost p-1">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className="text-xs stat-label">PSM Liquidity (USDC)</p>
            <p className="font-semibold mt-0.5 font-mono text-sm whitespace-nowrap" title={availableReserves !== undefined ? formatToken(availableReserves, peggedDec, 6) : undefined}>
              {availableReservesCompact}
              {availableReserves !== undefined ? ' USDC' : ''}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs stat-label">ceitUSD Minted via PSM</p>
            <p className="font-semibold mt-0.5 font-mono text-sm truncate" title={mintedViaPsm !== undefined ? formatWad(mintedViaPsm, 6) : undefined}>
              {formatWad(mintedViaPsm, 2)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs stat-label">Ceiling</p>
            <p className="font-semibold mt-0.5 font-mono text-sm truncate">
              {ceiling !== undefined && ceiling === 0n ? '∞ (unlimited)' : formatWad(ceiling, 2)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs stat-label">Fee Reserves</p>
            <p className="font-semibold mt-0.5 font-mono text-sm truncate" title={feeReserves !== undefined ? formatToken(feeReserves, peggedDec, 6) : undefined}>
              {formatToken(feeReserves, peggedDec, 4)}
            </p>
          </div>
          <div>
            <p className="text-xs stat-label">SwapIn Fee</p>
            <p className="font-semibold mt-0.5 text-sm">{tinBps !== undefined ? (tinBps / 100).toFixed(2) : '—'}%</p>
          </div>
          <div>
            <p className="text-xs stat-label">SwapOut Fee</p>
            <p className="font-semibold mt-0.5 text-sm">{toutBps !== undefined ? (toutBps / 100).toFixed(2) : '—'}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}

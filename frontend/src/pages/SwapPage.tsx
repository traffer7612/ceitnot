import { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, type Address, type Hash } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ArrowDownUp, Loader2, CheckCircle, Wallet, RefreshCw, Info } from 'lucide-react';
import { auraPsmAbi } from '../abi/auraPSM';
import { erc20Abi } from '../abi/auraEngine';
import { TARGET_CHAIN_ID, gasFor } from '../lib/contracts';
import { formatWad } from '../lib/utils';

/* ─── Addresses ───────────────────────────────────────────────────────────── */

const PSM   = import.meta.env.VITE_PSM_ADDRESS  as Address | undefined;
const USDC  = import.meta.env.VITE_USDC_ADDRESS as Address | undefined;
const AUSD  = import.meta.env.VITE_AUSD_ADDRESS as Address | undefined;

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function SwapPage() {
  const { address, isConnected, chainId } = useAccount();
  const gas = gasFor(chainId);

  /* direction: 'in' = USDC → aUSD, 'out' = aUSD → USDC */
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [approveHash, setApproveHash] = useState<Hash | undefined>();
  const [errMsg, setErrMsg] = useState('');

  const { writeContractAsync, isPending } = useWriteContract();
  const { isSuccess: swapConfirmed } = useWaitForTransactionReceipt({ hash });
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash });

  /* ── On-chain reads ─── */
  const { data, refetch } = useReadContracts({
    contracts: [
      { address: PSM!, abi: auraPsmAbi, functionName: 'tinBps',           chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: auraPsmAbi, functionName: 'toutBps',          chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: auraPsmAbi, functionName: 'availableReserves', chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: auraPsmAbi, functionName: 'ceiling',          chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: auraPsmAbi, functionName: 'mintedViaPsm',     chainId: TARGET_CHAIN_ID },
      { address: PSM!, abi: auraPsmAbi, functionName: 'feeReserves',      chainId: TARGET_CHAIN_ID },
      // User balances
      { address: USDC!, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN_ID },
      { address: AUSD!, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN_ID },
      // Allowances
      { address: USDC!, abi: erc20Abi, functionName: 'allowance', args: [address!, PSM!], chainId: TARGET_CHAIN_ID },
      { address: AUSD!, abi: erc20Abi, functionName: 'allowance', args: [address!, PSM!], chainId: TARGET_CHAIN_ID },
    ],
    query: { enabled: !!PSM && !!USDC && !!AUSD && !!address },
  });

  const tinBps           = data?.[0]?.result as number | undefined;
  const toutBps          = data?.[1]?.result as number | undefined;
  const availableReserves= data?.[2]?.result as bigint | undefined;
  const ceiling          = data?.[3]?.result as bigint | undefined;
  const mintedViaPsm     = data?.[4]?.result as bigint | undefined;
  const feeReserves      = data?.[5]?.result as bigint | undefined;
  const usdcBalance      = data?.[6]?.result as bigint | undefined;
  const ausdBalance      = data?.[7]?.result as bigint | undefined;
  const usdcAllowance    = data?.[8]?.result as bigint | undefined;
  const ausdAllowance    = data?.[9]?.result as bigint | undefined;

  /* ── Derived ─── */
  const feeBps   = direction === 'in' ? (tinBps ?? 10) : (toutBps ?? 10);
  const feePct   = (feeBps / 100).toFixed(2);
  const inputToken  = direction === 'in' ? 'USDC' : 'aUSD';
  const outputToken = direction === 'in' ? 'aUSD' : 'USDC';
  const balance     = direction === 'in' ? usdcBalance : ausdBalance;
  const allowance   = direction === 'in' ? usdcAllowance : ausdAllowance;
  const tokenToApprove = direction === 'in' ? USDC : AUSD;

  const parsedAmount = useMemo(() => {
    try { return amount ? parseUnits(amount, 18) : 0n; } catch { return 0n; }
  }, [amount]);

  const feeAmount = parsedAmount > 0n ? (parsedAmount * BigInt(feeBps)) / 10000n : 0n;
  const outputAmount = parsedAmount > 0n ? parsedAmount - feeAmount : 0n;

  const needsApproval = parsedAmount > 0n && (allowance === undefined || allowance < parsedAmount);
  const canSwap = parsedAmount > 0n && !needsApproval && balance !== undefined && balance >= parsedAmount;

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
      const h = await writeContractAsync({
        address: tokenToApprove,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PSM, parsedAmount],
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
      const h = await writeContractAsync({
        address: PSM,
        abi: auraPsmAbi,
        functionName: direction === 'in' ? 'swapIn' : 'swapOut',
        args: [parsedAmount],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 150) : String(e));
    }
  }

  function handleMax() {
    if (balance !== undefined && balance > 0n) {
      setAmount(formatUnits(balance, 18));
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
          <Wallet size={48} className="text-aura-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
          <p className="text-aura-muted text-sm mb-6">Connect to swap aUSD ↔ USDC via the Peg Stability Module.</p>
          <div className="w-full flex justify-center [&>div]:flex [&>div]:justify-center">
            <ConnectButton />
          </div>
        </div>
      </div>
    );
  }

  if (!PSM || !USDC || !AUSD) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <p className="text-aura-muted">PSM not configured. Missing environment variables.</p>
      </div>
    );
  }

  /* ── Main UI ─── */
  return (
    <div className="page-container max-w-lg mx-auto">
      <div className="page-header text-center">
        <h1 className="page-title">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-aura-gold to-aura-accent">Swap</span>
        </h1>
        <p className="page-subtitle">Exchange aUSD ↔ USDC at 1:1 via the Peg Stability Module</p>
      </div>

      {/* Swap Card */}
      <div className="card p-6">
        {/* From */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-aura-muted">From</span>
            <button onClick={handleMax} className="text-xs text-aura-gold hover:underline">
              Balance: {balance !== undefined ? formatWad(balance, 4) : '—'} {inputToken}
            </button>
          </div>
          <div className="flex items-center gap-3 bg-aura-surface rounded-xl p-3 border border-aura-border">
            <input
              type="number"
              value={amount}
              onChange={e => { setAmount(e.target.value); setHash(undefined); setErrMsg(''); }}
              placeholder="0.0"
              className="bg-transparent text-xl font-mono flex-1 outline-none w-0"
            />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-aura-card border border-aura-border shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                direction === 'in' ? 'bg-blue-500/20 text-blue-400' : 'bg-aura-gold/20 text-aura-gold'
              }`}>
                {direction === 'in' ? '$' : 'a'}
              </div>
              <span className="font-semibold text-sm">{inputToken}</span>
            </div>
          </div>
        </div>

        {/* Flip button */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            onClick={flipDirection}
            className="w-9 h-9 rounded-full border-2 border-aura-border bg-aura-card flex items-center justify-center hover:border-aura-gold/50 hover:text-aura-gold transition-colors"
          >
            <ArrowDownUp size={16} />
          </button>
        </div>

        {/* To */}
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-aura-muted">To (estimated)</span>
            <span className="text-xs text-aura-muted">
              Balance: {direction === 'in' ? formatWad(ausdBalance, 4) : formatWad(usdcBalance, 4)} {outputToken}
            </span>
          </div>
          <div className="flex items-center gap-3 bg-aura-surface rounded-xl p-3 border border-aura-border">
            <span className="text-xl font-mono flex-1 text-aura-muted-2">
              {outputAmount > 0n ? Number(formatUnits(outputAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '0.0'}
            </span>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-aura-card border border-aura-border shrink-0">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                direction === 'out' ? 'bg-blue-500/20 text-blue-400' : 'bg-aura-gold/20 text-aura-gold'
              }`}>
                {direction === 'out' ? '$' : 'a'}
              </div>
              <span className="font-semibold text-sm">{outputToken}</span>
            </div>
          </div>
        </div>

        {/* Details */}
        {parsedAmount > 0n && (
          <div className="mt-4 p-3 rounded-lg bg-aura-surface/50 border border-aura-border space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-aura-muted">Rate</span>
              <span>1 {inputToken} = 1 {outputToken}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-aura-muted">Fee ({feePct}%)</span>
              <span className="text-aura-warning">
                −{Number(formatUnits(feeAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {outputToken}
              </span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-aura-muted">You receive</span>
              <span className="text-aura-success">
                {Number(formatUnits(outputAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} {outputToken}
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
              {approveConfirmed ? <><CheckCircle size={14} className="text-aura-success" /> Approved</> : `Approve ${inputToken}`}
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
          <p className="text-xs text-center text-aura-muted font-mono mt-3">Pending: {hash.slice(0, 10)}…</p>
        )}
        {swapConfirmed && hash && (
          <p className="text-xs text-center text-aura-success font-mono mt-3 flex items-center justify-center gap-1">
            <CheckCircle size={12} /> Swap confirmed!
          </p>
        )}
        {errMsg && (
          <p className="text-xs text-aura-danger bg-aura-danger/10 p-3 rounded-lg mt-3 break-all">{errMsg}</p>
        )}
      </div>

      {/* PSM Stats */}
      <div className="card p-5 mt-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-aura-gold" />
            <h2 className="font-semibold text-sm">PSM Stats</h2>
          </div>
          <button onClick={() => refetch()} className="btn-ghost p-1">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs stat-label">Available USDC</p>
            <p className="font-semibold mt-0.5 font-mono text-sm">{formatWad(availableReserves, 2)}</p>
          </div>
          <div>
            <p className="text-xs stat-label">aUSD Minted via PSM</p>
            <p className="font-semibold mt-0.5 font-mono text-sm">{formatWad(mintedViaPsm, 2)}</p>
          </div>
          <div>
            <p className="text-xs stat-label">Ceiling</p>
            <p className="font-semibold mt-0.5 font-mono text-sm">
              {ceiling !== undefined && ceiling === 0n ? '∞ (unlimited)' : formatWad(ceiling, 2)}
            </p>
          </div>
          <div>
            <p className="text-xs stat-label">Fee Reserves</p>
            <p className="font-semibold mt-0.5 font-mono text-sm">{formatWad(feeReserves, 4)}</p>
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

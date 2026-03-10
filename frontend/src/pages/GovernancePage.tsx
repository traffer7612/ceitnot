import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { parseUnits, formatUnits, type Hash, type Address } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  Vote, Lock, Unlock, Plus, Clock, Users, Gift,
  CheckCircle, AlertCircle, Loader2, RefreshCw, HelpCircle,
} from 'lucide-react';
import { erc20Abi, veAuraAbi } from '../abi/auraEngine';
import { gasFor, TARGET_CHAIN_ID } from '../lib/contracts';
import { formatWad, formatAddress } from '../lib/utils';

const VE_AURA   = import.meta.env.VITE_VE_AURA_ADDRESS as Address | undefined;
const AURA_TOKEN = import.meta.env.VITE_AURA_TOKEN_ADDRESS as Address | undefined;

const WEEK = 7 * 24 * 3600;

/** Duration presets in weeks */
const DURATIONS = [
  { label: '1 month',  weeks: 4 },
  { label: '3 months', weeks: 13 },
  { label: '6 months', weeks: 26 },
  { label: '1 year',   weeks: 52 },
  { label: '2 years',  weeks: 104 },
  { label: '4 years',  weeks: 208 },
];

type Step = 'idle' | 'approving' | 'writing' | 'success' | 'error';

export default function GovernancePage() {
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // ── tx tracking ──
  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  // ── lock form ──
  const [lockAmount, setLockAmount] = useState('');
  const [durationWeeks, setDurationWeeks] = useState(52); // default 1 year
  // ── increase form ──
  const [extraAmount, setExtraAmount] = useState('');
  // ── extend form ──
  const [extendWeeks, setExtendWeeks] = useState(52);
  // ── delegate form ──
  const [delegateTo, setDelegateTo] = useState('');
  // ── which action is active ──
  const [activeAction, setActiveAction] = useState<string>('');

  // ── read contract data ──
  const { data: readData, refetch } = useReadContracts({
    contracts: (address && VE_AURA && AURA_TOKEN) ? [
      { address: AURA_TOKEN, abi: erc20Abi,  functionName: 'balanceOf',  args: [address], chainId: TARGET_CHAIN_ID },
      { address: AURA_TOKEN, abi: erc20Abi,  functionName: 'allowance',  args: [address, VE_AURA], chainId: TARGET_CHAIN_ID },
      { address: VE_AURA,    abi: veAuraAbi, functionName: 'locks',      args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_AURA,    abi: veAuraAbi, functionName: 'getVotes',   args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_AURA,    abi: veAuraAbi, functionName: 'delegates',  args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_AURA,    abi: veAuraAbi, functionName: 'totalLocked',                 chainId: TARGET_CHAIN_ID },
      { address: VE_AURA,    abi: veAuraAbi, functionName: 'pendingRevenue', args: [address], chainId: TARGET_CHAIN_ID },
      { address: AURA_TOKEN, abi: erc20Abi,  functionName: 'symbol',                       chainId: TARGET_CHAIN_ID },
    ] : [],
    query: { enabled: !!address && !!VE_AURA && !!AURA_TOKEN },
  });

  const auraBalance   = (readData?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance     = (readData?.[1]?.result as bigint | undefined) ?? 0n;
  const lockData      = readData?.[2]?.result as [bigint, bigint] | undefined;
  const lockedAmount  = lockData?.[0] ?? 0n;
  const unlockTime    = lockData?.[1] ?? 0n;
  const votingPower   = (readData?.[3]?.result as bigint | undefined) ?? 0n;
  const currentDelegate = (readData?.[4]?.result as Address | undefined);
  const totalLocked   = (readData?.[5]?.result as bigint | undefined) ?? 0n;
  const pendingRev    = (readData?.[6]?.result as bigint | undefined) ?? 0n;
  const tokenSymbol   = (readData?.[7]?.result as string | undefined) ?? 'LUMINA';
  const displaySymbol = tokenSymbol === 'AURA' ? 'LUMINA' : tokenSymbol; // UI branding

  const hasLock       = lockedAmount > 0n;
  const lockExpired   = hasLock && BigInt(Math.floor(Date.now() / 1000)) >= unlockTime;
  const nowSec        = Math.floor(Date.now() / 1000);

  // format unlock time
  const unlockDate = hasLock ? new Date(Number(unlockTime) * 1000).toLocaleDateString() : '—';
  const timeLeft   = hasLock && !lockExpired
    ? `${Math.floor((Number(unlockTime) - nowSec) / 86400)} days`
    : lockExpired ? 'Expired' : '—';

  // ── handle tx confirmation ──
  useEffect(() => {
    if (confirmed && hash) {
      if (step === 'approving') {
        refetch();
        setHash(undefined);
        setStep('idle');
      } else if (step === 'writing') {
        setStep('success');
        refetch();
      }
    }
  }, [confirmed, hash, step, refetch]);

  const reset = () => { setHash(undefined); setStep('idle'); setErrMsg(''); setActiveAction(''); };

  // ── helpers ──
  const gas = gasFor(chainId);
  const parseAmt = (v: string) => { try { return v ? parseUnits(v, 18) : 0n; } catch { return 0n; } };

  async function approve() {
    if (!AURA_TOKEN || !VE_AURA) return;
    setStep('approving');
    const h = await writeContractAsync({
      address: AURA_TOKEN, abi: erc20Abi, functionName: 'approve',
      args: [VE_AURA, 2n ** 256n - 1n], ...gas,
    });
    setHash(h);
  }

  // ── LOCK ──
  async function handleLock() {
    if (!VE_AURA || !address) return;
    const raw = parseAmt(lockAmount);
    if (raw === 0n) return;
    setActiveAction('lock');
    try {
      if (allowance < raw) { await approve(); return; }
      setStep('writing');
      const unlock = BigInt(Math.floor((nowSec + durationWeeks * WEEK) / WEEK) * WEEK);
      const h = await writeContractAsync({
        address: VE_AURA, abi: veAuraAbi, functionName: 'lock',
        args: [raw, unlock], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── INCREASE ──
  async function handleIncrease() {
    if (!VE_AURA) return;
    const raw = parseAmt(extraAmount);
    if (raw === 0n) return;
    setActiveAction('increase');
    try {
      if (allowance < raw) { await approve(); return; }
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_AURA, abi: veAuraAbi, functionName: 'increaseAmount',
        args: [raw], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── EXTEND ──
  async function handleExtend() {
    if (!VE_AURA) return;
    setActiveAction('extend');
    try {
      setStep('writing');
      const newUnlock = BigInt(Math.floor((nowSec + extendWeeks * WEEK) / WEEK) * WEEK);
      const h = await writeContractAsync({
        address: VE_AURA, abi: veAuraAbi, functionName: 'extendLock',
        args: [newUnlock], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── WITHDRAW ──
  async function handleWithdraw() {
    if (!VE_AURA) return;
    setActiveAction('withdraw');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_AURA, abi: veAuraAbi, functionName: 'withdraw', ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── CLAIM REVENUE ──
  async function handleClaim() {
    if (!VE_AURA) return;
    setActiveAction('claim');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_AURA, abi: veAuraAbi, functionName: 'claimRevenue', ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── DELEGATE ──
  async function handleDelegate() {
    if (!VE_AURA || !delegateTo) return;
    setActiveAction('delegate');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_AURA, abi: veAuraAbi, functionName: 'delegate',
        args: [delegateTo as Address], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  const isPending = step === 'approving' || step === 'writing';

  // ── Not connected ──
  if (!isConnected) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm w-full flex flex-col items-center">
          <Vote size={48} className="text-aura-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
          <p className="text-aura-muted text-sm mb-6">Connect to lock LUMINA and participate in governance.</p>
          <div className="w-full flex justify-center [&>div]:flex [&>div]:justify-center">
            <ConnectButton />
          </div>
        </div>
      </div>
    );
  }

  // ── Not configured ──
  if (!VE_AURA || !AURA_TOKEN) {
    return (
      <div className="page-container">
        <div className="card p-8 text-center">
          <p className="text-aura-warning font-medium">Governance contracts not configured</p>
          <p className="text-aura-muted text-sm mt-2">
            Set <code className="font-mono text-aura-warning/80">VITE_AURA_TOKEN_ADDRESS</code> and{' '}
            <code className="font-mono text-aura-warning/80">VITE_VE_AURA_ADDRESS</code> (governance token) in your <code>.env</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="page-title">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-aura-gold to-aura-accent">
              Governance
            </span>
          </h1>
          <p className="page-subtitle">Lock LUMINA → get veLUMINA → vote &amp; earn revenue</p>
        </div>
        <button onClick={() => refetch()} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Success / Error overlay */}
      {step === 'success' && (
        <div className="card p-6 mb-6 border-aura-success/30 bg-aura-success/5">
          <div className="flex items-center gap-3">
            <CheckCircle size={24} className="text-aura-success" />
            <div>
              <p className="font-semibold">Transaction confirmed!</p>
              {hash && <p className="text-xs text-aura-muted font-mono mt-1">tx: {hash.slice(0, 10)}…{hash.slice(-8)}</p>}
            </div>
            <button className="ml-auto btn-secondary text-sm" onClick={reset}>Dismiss</button>
          </div>
        </div>
      )}
      {step === 'error' && (
        <div className="card p-6 mb-6 border-aura-danger/30 bg-aura-danger/5">
          <div className="flex items-center gap-3">
            <AlertCircle size={24} className="text-aura-danger" />
            <div>
              <p className="font-semibold text-aura-danger">Transaction failed</p>
              <p className="text-xs text-aura-muted mt-1">{errMsg}</p>
            </div>
            <button className="ml-auto btn-secondary text-sm" onClick={reset}>Dismiss</button>
          </div>
        </div>
      )}

      {/* How to get LUMINA (when balance is zero) */}
      {auraBalance === 0n && (
        <div className="mb-6 p-4 rounded-xl bg-aura-gold/10 border border-aura-gold/20 flex gap-3">
          <HelpCircle size={20} className="text-aura-gold shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-white mb-1">Как получить LUMINA?</p>
            <p className="text-aura-muted">
              В этом приложении LUMINA только блокируется и используется для голосования. Купить или обменять LUMINA здесь нельзя: на мейннете получите токены на DEX (Uniswap, Camelot и т.д.) или бирже и переведите в кошелёк. На тестнете (Sepolia) или localhost тестовые LUMINA появляются при полном деплое: скрипт <code className="text-aura-gold/90">DeployFullSepolia</code> минтит 10 000 000 LUMINA на адрес деплоера — если вы запускали деплой с этого кошелька, токены пришли оттуда.
            </p>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="stat-card">
          <span className="stat-label">Your LUMINA Balance</span>
          <p className="stat-value font-mono">{formatWad(auraBalance, 2)}</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Your Locked LUMINA</span>
          <p className="stat-value font-mono">{formatWad(lockedAmount, 2)}</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Your Voting Power</span>
          <p className="stat-value font-mono">{formatWad(votingPower, 2)}</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Locked (Protocol)</span>
          <p className="stat-value font-mono">{formatWad(totalLocked, 2)}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ═══ LEFT: Lock / Lock Info ═══ */}
        <div className="space-y-6">
          {/* Lock info card (if has lock) */}
          {hasLock && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Lock size={18} className="text-aura-gold" /> Your Lock
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-aura-muted">Amount Locked</p>
                  <p className="font-mono text-white mt-1">{formatWad(lockedAmount, 4)} {displaySymbol}</p>
                </div>
                <div>
                  <p className="text-aura-muted">Unlock Date</p>
                  <p className="font-mono text-white mt-1">{unlockDate}</p>
                </div>
                <div>
                  <p className="text-aura-muted">Time Remaining</p>
                  <p className={`font-mono mt-1 ${lockExpired ? 'text-aura-success' : 'text-white'}`}>{timeLeft}</p>
                </div>
                <div>
                  <p className="text-aura-muted">Voting Power</p>
                  <p className="font-mono text-aura-gold mt-1">{formatWad(votingPower, 4)}</p>
                </div>
              </div>

              {/* Withdraw (if expired) */}
              {lockExpired && (
                <button
                  onClick={handleWithdraw}
                  disabled={isPending && activeAction === 'withdraw'}
                  className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
                >
                  {isPending && activeAction === 'withdraw' && <Loader2 size={16} className="animate-spin" />}
                  <Unlock size={16} /> Withdraw {displaySymbol}
                </button>
              )}
            </div>
          )}

          {/* New Lock (only if no active lock) */}
          {!hasLock && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Lock size={18} className="text-aura-gold" /> Lock LUMINA
              </h2>

              <div className="mb-4">
                <label className="block text-sm text-aura-muted mb-2">Amount</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0" value={lockAmount}
                    onChange={e => setLockAmount(e.target.value)}
                    placeholder="0.0" className="input-field flex-1" disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => auraBalance > 0n && setLockAmount(formatUnits(auraBalance, 18))}
                    className="px-3 py-2 rounded-xl text-sm font-medium bg-aura-gold/15 text-aura-gold hover:bg-aura-gold/25 transition-colors"
                    disabled={isPending || auraBalance === 0n}
                  >Max</button>
                </div>
                <p className="text-xs text-aura-muted mt-1">
                  Balance: <span className="text-white font-mono">{formatWad(auraBalance, 2)} {displaySymbol}</span>
                </p>
              </div>

              <div className="mb-5">
                <label className="block text-sm text-aura-muted mb-2">Lock Duration</label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map(d => (
                    <button
                      key={d.weeks}
                      onClick={() => setDurationWeeks(d.weeks)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        durationWeeks === d.weeks
                          ? 'bg-aura-gold/20 text-aura-gold border border-aura-gold/30'
                          : 'bg-aura-surface-2 text-aura-muted-2 hover:text-white border border-transparent'
                      }`}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleLock}
                disabled={isPending || parseAmt(lockAmount) === 0n}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'lock' && <Loader2 size={16} className="animate-spin" />}
                {step === 'approving' && activeAction === 'lock' ? 'Approving…' : `Lock ${displaySymbol}`}
              </button>
            </div>
          )}

          {/* Increase Amount (if has active lock) */}
          {hasLock && !lockExpired && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Plus size={18} className="text-aura-gold" /> Increase Lock
              </h2>
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="number" min="0" value={extraAmount}
                    onChange={e => setExtraAmount(e.target.value)}
                    placeholder="0.0" className="input-field flex-1" disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => auraBalance > 0n && setExtraAmount(formatUnits(auraBalance, 18))}
                    className="px-3 py-2 rounded-xl text-sm font-medium bg-aura-gold/15 text-aura-gold hover:bg-aura-gold/25 transition-colors"
                    disabled={isPending || auraBalance === 0n}
                  >Max</button>
                </div>
              </div>
              <button
                onClick={handleIncrease}
                disabled={isPending || parseAmt(extraAmount) === 0n}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'increase' && <Loader2 size={16} className="animate-spin" />}
                {step === 'approving' && activeAction === 'increase' ? 'Approving…' : 'Add LUMINA to Lock'}
              </button>
            </div>
          )}

          {/* Extend Lock (if has active lock) */}
          {hasLock && !lockExpired && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Clock size={18} className="text-aura-gold" /> Extend Lock
              </h2>
              <div className="mb-4">
                <label className="block text-sm text-aura-muted mb-2">New Duration (from now)</label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map(d => (
                    <button
                      key={d.weeks}
                      onClick={() => setExtendWeeks(d.weeks)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        extendWeeks === d.weeks
                          ? 'bg-aura-gold/20 text-aura-gold border border-aura-gold/30'
                          : 'bg-aura-surface-2 text-aura-muted-2 hover:text-white border border-transparent'
                      }`}
                    >{d.label}</button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleExtend}
                disabled={isPending}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'extend' && <Loader2 size={16} className="animate-spin" />}
                Extend Lock
              </button>
            </div>
          )}
        </div>

        {/* ═══ RIGHT: Revenue + Delegate ═══ */}
        <div className="space-y-6">
          {/* Revenue */}
          <div className="card p-5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
              <Gift size={18} className="text-aura-gold" /> Revenue
            </h2>
            <div className="p-4 bg-aura-bg rounded-xl mb-4">
              <p className="text-aura-muted text-sm">Pending Revenue</p>
              <p className="text-2xl font-bold font-mono text-white mt-1">{formatWad(pendingRev, 6)}</p>
              <p className="text-xs text-aura-muted mt-1">Earned from protocol fees, proportional to your locked LUMINA</p>
            </div>
            <button
              onClick={handleClaim}
              disabled={isPending || pendingRev === 0n}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isPending && activeAction === 'claim' && <Loader2 size={16} className="animate-spin" />}
              Claim Revenue
            </button>
          </div>

          {/* Delegate */}
          <div className="card p-5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
              <Users size={18} className="text-aura-gold" /> Delegate Votes
            </h2>
            {currentDelegate && (
              <div className="p-3 bg-aura-bg rounded-xl mb-4">
                <p className="text-aura-muted text-xs">Currently delegated to</p>
                <p className="text-white font-mono text-sm mt-1">
                  {currentDelegate === address ? 'Yourself' : formatAddress(currentDelegate)}
                </p>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm text-aura-muted mb-2">Delegate to address</label>
              <input
                type="text"
                value={delegateTo}
                onChange={e => setDelegateTo(e.target.value)}
                placeholder="0x..."
                className="input-field w-full"
                disabled={isPending}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => address && setDelegateTo(address)}
                className="btn-ghost text-sm flex-1 border border-aura-border"
                disabled={isPending}
              >Self</button>
              <button
                onClick={handleDelegate}
                disabled={isPending || !delegateTo || delegateTo.length < 42}
                className="btn-primary text-sm flex-1 flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'delegate' && <Loader2 size={16} className="animate-spin" />}
                Delegate
              </button>
            </div>
          </div>

          {/* Contract info */}
          <div className="text-xs text-aura-muted space-y-1">
            <p>
              <span className="text-aura-muted-2 uppercase tracking-wider">LUMINA Token:</span>{' '}
              <span className="font-mono">{formatAddress(AURA_TOKEN)}</span>
            </p>
            <p>
              <span className="text-aura-muted-2 uppercase tracking-wider">veLUMINA:</span>{' '}
              <span className="font-mono">{formatAddress(VE_AURA)}</span>
            </p>
            {(chainId === 31337 || chainId === 11155111) && (
              <p className="pt-2 text-aura-gold/80">
                Тестовые LUMINA: наминчены скриптом DeployFullSepolia (10M) на адрес деплоера при запуске деплоя.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tx hash */}
      {hash && step !== 'success' && step !== 'error' && (
        <p className="text-xs text-aura-muted mt-4 text-center font-mono">
          tx: {hash.slice(0, 10)}…{hash.slice(-8)}
        </p>
      )}
    </div>
  );
}

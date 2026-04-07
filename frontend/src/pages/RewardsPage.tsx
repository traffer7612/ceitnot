import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { formatUnits, parseUnits, type Hash } from 'viem';
import { Gift, Lock, Clock, Plus, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { erc20Abi, veLockAbi } from '../abi/ceitnotEngine';
import { gasFor, TARGET_CHAIN_ID } from '../lib/contracts';
import { viteAddressLegacy } from '../lib/chainEnv';
import { formatWad } from '../lib/utils';

const env = import.meta.env as Record<string, string | undefined>;
const VE_TOKEN = viteAddressLegacy(import.meta.env.VITE_VE_TOKEN_ADDRESS, env.VITE_VE_AURA_ADDRESS);
const GOV_TOKEN = viteAddressLegacy(import.meta.env.VITE_GOVERNANCE_TOKEN_ADDRESS, env.VITE_AURA_TOKEN_ADDRESS);
const WEEK = 7 * 24 * 3600;

type Step = 'idle' | 'approving' | 'writing' | 'success' | 'error';

const DURATIONS = [
  { label: '1 month', weeks: 4 },
  { label: '3 months', weeks: 13 },
  { label: '6 months', weeks: 26 },
  { label: '1 year', weeks: 52 },
  { label: '2 years', weeks: 104 },
  { label: '4 years', weeks: 208 },
];

export default function RewardsPage() {
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const gas = gasFor(chainId);

  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [activeAction, setActiveAction] = useState('');

  const [lockAmount, setLockAmount] = useState('');
  const [durationWeeks, setDurationWeeks] = useState(52);
  const [extraAmount, setExtraAmount] = useState('');
  const [extendWeeks, setExtendWeeks] = useState(52);

  const { data, refetch } = useReadContracts({
    contracts: (address && VE_TOKEN && GOV_TOKEN) ? [
      { address: GOV_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: TARGET_CHAIN_ID },
      { address: GOV_TOKEN, abi: erc20Abi, functionName: 'allowance', args: [address, VE_TOKEN], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN, abi: veLockAbi, functionName: 'locks', args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN, abi: veLockAbi, functionName: 'pendingRevenue', args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN, abi: veLockAbi, functionName: 'totalLocked', chainId: TARGET_CHAIN_ID },
    ] : [],
    query: { enabled: !!address && !!VE_TOKEN && !!GOV_TOKEN },
  });

  const govTokenBalance = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const lockData = data?.[2]?.result as [bigint, bigint] | undefined;
  const lockedAmount = lockData?.[0] ?? 0n;
  const unlockTime = lockData?.[1] ?? 0n;
  const claimable = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const totalLocked = (data?.[4]?.result as bigint | undefined) ?? 0n;

  const hasLock = lockedAmount > 0n;
  const nowSec = Math.floor(Date.now() / 1000);
  const lockExpired = hasLock && BigInt(nowSec) >= unlockTime;
  const unlockDate = hasLock ? new Date(Number(unlockTime) * 1000).toLocaleDateString() : '—';
  const displaySymbol = 'CEITNOT';

  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (!confirmed || !hash) return;
    if (step === 'approving') {
      setHash(undefined);
      setStep('idle');
      refetch();
      return;
    }
    if (step === 'writing') {
      setStep('success');
      refetch();
    }
  }, [confirmed, hash, step, refetch]);

  const resetStatus = () => {
    setHash(undefined);
    setStep('idle');
    setErrMsg('');
    setActiveAction('');
  };

  const parseAmt = (v: string) => {
    try {
      return v ? parseUnits(v, 18) : 0n;
    } catch {
      return 0n;
    }
  };

  async function approve(raw: bigint) {
    if (!GOV_TOKEN || !VE_TOKEN || raw === 0n) return;
    setStep('approving');
    const h = await writeContractAsync({
      address: GOV_TOKEN,
      abi: erc20Abi,
      functionName: 'approve',
      args: [VE_TOKEN, 2n ** 256n - 1n],
      ...gas,
    });
    setHash(h);
  }

  async function handleLock() {
    if (!VE_TOKEN || !address) return;
    const raw = parseAmt(lockAmount);
    if (raw === 0n) return;
    setActiveAction('lock');
    try {
      if (allowance < raw) {
        await approve(raw);
        return;
      }
      setStep('writing');
      const unlock = BigInt(Math.floor((nowSec + durationWeeks * WEEK) / WEEK) * WEEK);
      const h = await writeContractAsync({
        address: VE_TOKEN,
        abi: veLockAbi,
        functionName: 'lock',
        args: [raw, unlock],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  async function handleIncrease() {
    if (!VE_TOKEN) return;
    const raw = parseAmt(extraAmount);
    if (raw === 0n) return;
    setActiveAction('increase');
    try {
      if (allowance < raw) {
        await approve(raw);
        return;
      }
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_TOKEN,
        abi: veLockAbi,
        functionName: 'increaseAmount',
        args: [raw],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  async function handleExtend() {
    if (!VE_TOKEN) return;
    setActiveAction('extend');
    try {
      setStep('writing');
      const newUnlock = BigInt(Math.floor((nowSec + extendWeeks * WEEK) / WEEK) * WEEK);
      const h = await writeContractAsync({
        address: VE_TOKEN,
        abi: veLockAbi,
        functionName: 'extendLock',
        args: [newUnlock],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  async function handleClaim() {
    if (!VE_TOKEN) return;
    setActiveAction('claim');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_TOKEN,
        abi: veLockAbi,
        functionName: 'claimRevenue',
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  if (!VE_TOKEN || !GOV_TOKEN) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="card border-ceitnot-warning/30 bg-ceitnot-warning/5 p-5">
          <p className="text-ceitnot-warning font-medium">Rewards contracts not configured</p>
          <p className="text-ceitnot-muted text-sm mt-2">
            Set <code className="font-mono text-ceitnot-warning/80">VITE_GOVERNANCE_TOKEN_ADDRESS</code> and{' '}
            <code className="font-mono text-ceitnot-warning/80">VITE_VE_TOKEN_ADDRESS</code> (vote-escrow) in your{' '}
            <code className="font-mono text-ceitnot-warning/80">.env</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2"><Gift size={24} className="text-ceitnot-gold" /> Rewards</h1>
        <p className="page-subtitle">Lock CEITNOT, wait for distribution, and claim rewards.</p>
      </div>

      {!isConnected && (
        <div className="card p-8 text-center space-y-4">
          <p className="text-ceitnot-muted-2">Connect wallet to view your lock and claimable rewards.</p>
          <div className="flex justify-center"><ConnectButton /></div>
        </div>
      )}

      {isConnected && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5">
              <p className="text-ceitnot-muted text-sm">Wallet {displaySymbol}</p>
              <p className="text-2xl font-semibold mt-1">{formatWad(govTokenBalance, 4)}</p>
              <p className="text-xs text-ceitnot-muted mt-2">Available to lock or transfer.</p>
            </div>
            <div className="card p-5">
              <p className="text-ceitnot-muted text-sm">Your Locked CEITNOT</p>
              <p className="text-2xl font-semibold mt-1">{formatWad(lockedAmount, 4)}</p>
              <p className="text-xs text-ceitnot-muted mt-2">Unlock date: {unlockDate}</p>
            </div>
            <div className="card p-5">
              <p className="text-ceitnot-muted text-sm">Claimable now</p>
              <p className="text-2xl font-semibold mt-1 text-ceitnot-gold">{formatWad(claimable, 4)}</p>
              <p className="text-xs text-ceitnot-muted mt-2">Distributed revenue available to claim.</p>
            </div>
            <div className="card p-5">
              <p className="text-ceitnot-muted text-sm">Total Locked (protocol)</p>
              <p className="text-2xl font-semibold mt-1">{formatWad(totalLocked, 2)}</p>
              <p className="text-xs text-ceitnot-muted mt-2">Shows total participation in veCEITNOT.</p>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {!hasLock ? (
              <div className="card p-5 space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2"><Lock size={18} className="text-ceitnot-gold" /> Lock CEITNOT</h2>
                <input
                  className="input"
                  placeholder={`Amount (${displaySymbol})`}
                  value={lockAmount}
                  onChange={(e) => setLockAmount(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.weeks}
                      type="button"
                      onClick={() => setDurationWeeks(d.weeks)}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${durationWeeks === d.weeks ? 'border-ceitnot-gold text-ceitnot-gold bg-ceitnot-gold/10' : 'border-ceitnot-border text-ceitnot-muted-2 hover:text-ceitnot-ink'}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <button className="btn-primary w-full" onClick={handleLock} disabled={step !== 'idle'}>
                  {step === 'approving' && activeAction === 'lock' ? 'Approving…' : `Lock ${displaySymbol}`}
                </button>
              </div>
            ) : (
              <div className="card p-5 space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2"><Clock size={18} className="text-ceitnot-gold" /> Your lock</h2>
                <p className="text-sm text-ceitnot-muted-2">
                  {lockExpired ? 'Lock expired. You can withdraw your CEITNOT in Governance page.' : 'You can add amount or extend lock duration.'}
                </p>
                <input
                  className="input"
                  placeholder={`Add amount (${displaySymbol})`}
                  value={extraAmount}
                  onChange={(e) => setExtraAmount(e.target.value)}
                />
                <button className="btn-secondary w-full" onClick={handleIncrease} disabled={step !== 'idle' || lockExpired}>
                  <span className="inline-flex items-center gap-2"><Plus size={16} /> Add to lock</span>
                </button>
                <div className="flex flex-wrap gap-2 pt-1">
                  {DURATIONS.map((d) => (
                    <button
                      key={`e-${d.weeks}`}
                      type="button"
                      onClick={() => setExtendWeeks(d.weeks)}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${extendWeeks === d.weeks ? 'border-ceitnot-gold text-ceitnot-gold bg-ceitnot-gold/10' : 'border-ceitnot-border text-ceitnot-muted-2 hover:text-ceitnot-ink'}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <button className="btn-secondary w-full" onClick={handleExtend} disabled={step !== 'idle' || lockExpired}>
                  Extend lock
                </button>
              </div>
            )}

            <div className="card p-5 space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Gift size={18} className="text-ceitnot-gold" /> Claim rewards</h2>
              <p className="text-sm text-ceitnot-muted-2">When distributed revenue is available, claim sends it directly to your wallet.</p>
              <button className="btn-primary w-full" onClick={handleClaim} disabled={step !== 'idle' || claimable === 0n}>
                Claim revenue
              </button>
              <p className="text-xs text-ceitnot-muted">Claimable: {formatUnits(claimable, 18)} aUSD</p>
            </div>
          </div>

          {step !== 'idle' && (
            <div className="card p-4 flex items-center gap-2">
              {step === 'success' && <CheckCircle size={18} className="text-ceitnot-success" />}
              {(step === 'approving' || step === 'writing') && <Loader2 size={18} className="animate-spin text-ceitnot-gold" />}
              {step === 'error' && <AlertCircle size={18} className="text-ceitnot-danger" />}
              <span className="text-sm">
                {step === 'approving' && 'Waiting for approve confirmation...'}
                {step === 'writing' && 'Waiting for transaction confirmation...'}
                {step === 'success' && 'Success. Data refreshed.'}
                {step === 'error' && (errMsg || 'Transaction failed')}
              </span>
              <button className="ml-auto text-xs text-ceitnot-muted hover:text-ceitnot-ink" onClick={resetStatus}>Clear</button>
            </div>
          )}

          <div className="text-xs text-ceitnot-muted">
            Simple flow: Connect wallet -&gt; Lock CEITNOT -&gt; Wait distribution -&gt; Claim rewards.
          </div>
        </>
      )}
    </div>
  );
}

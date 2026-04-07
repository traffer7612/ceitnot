import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { isAddress, parseUnits, type Address, type Hash } from 'viem';
import {
  ShieldCheck, ShieldAlert, Lock, Unlock, Zap, UserX, Loader2,
  Copy, CheckCircle, Plus, Settings, ChevronDown, ChevronUp,
  Snowflake, Sun,
} from 'lucide-react';
import { ceitnotEngineAbi, marketRegistryAbi, ceitnotPsmAbi } from '../abi/ceitnotEngine';
import { useAdmin } from '../hooks/useAdmin';
import { useContractAddresses, gasFor, TARGET_CHAIN_ID } from '../lib/contracts';
import { blockExplorerAddressUrl } from '../lib/explorer';
import { useMarkets, type Market } from '../hooks/useMarkets';
import { formatAddress, formatBps, formatWad } from '../lib/utils';

const TIMELOCK_ENV = import.meta.env.VITE_TIMELOCK_ADDRESS as Address | undefined;

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <button onClick={copy} className="btn-ghost p-1 rounded" title="Copy">
      {copied ? <CheckCircle size={13} className="text-ceitnot-success" /> : <Copy size={13} />}
    </button>
  );
}

function AdminAction({ label, description, buttonLabel, buttonClass, onAction, isPending, disabled }: {
  label: string; description: string; buttonLabel: string; buttonClass: string;
  onAction: () => void; isPending: boolean; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-ceitnot-border last:border-0">
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-ceitnot-muted mt-0.5">{description}</p>
      </div>
      <button
        onClick={onAction}
        disabled={isPending || disabled}
        className={`${buttonClass} text-sm flex items-center gap-1.5 shrink-0`}
      >
        {isPending && <Loader2 size={13} className="animate-spin" />}
        {buttonLabel}
      </button>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="text-xs text-ceitnot-muted block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field w-full"
      />
      {hint && <p className="text-[10px] text-ceitnot-muted mt-0.5">{hint}</p>}
    </div>
  );
}

/* ─── Create Market Form ──────────────────────────────────────────────────── */

function CreateMarketForm({ registry, gas, onSuccess }: {
  registry: Address; gas: object; onSuccess: () => void;
}) {
  const { writeContractAsync, isPending } = useWriteContract();
  const [hash, setHash] = useState<Hash | undefined>();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });
  const [errMsg, setErrMsg] = useState('');
  const [expanded, setExpanded] = useState(false);

  const [vault, setVault] = useState('');
  const [oracle, setOracle] = useState('');
  const [ltv, setLtv] = useState('80');
  const [liqThreshold, setLiqThreshold] = useState('85');
  const [liqPenalty, setLiqPenalty] = useState('5');
  const [supplyCap, setSupplyCap] = useState('');
  const [borrowCap, setBorrowCap] = useState('');
  const [isIsolated, setIsIsolated] = useState(false);
  const [isolatedBorrowCap, setIsolatedBorrowCap] = useState('');

  useEffect(() => {
    if (confirmed && hash) {
      onSuccess();
      setErrMsg('');
      setVault(''); setOracle(''); setLtv('80'); setLiqThreshold('85'); setLiqPenalty('5');
      setSupplyCap(''); setBorrowCap(''); setIsIsolated(false); setIsolatedBorrowCap('');
      setHash(undefined);
    }
  }, [confirmed, hash, onSuccess]);

  const pctToBps = (v: string) => Math.round(Number(v) * 100);
  const parseWad = (v: string) => { try { return v ? parseUnits(v, 18) : 0n; } catch { return 0n; } };

  const canSubmit =
    isAddress(vault) && isAddress(oracle) &&
    Number(ltv) > 0 && Number(ltv) <= 100 &&
    Number(liqThreshold) >= Number(ltv) && Number(liqThreshold) <= 100;

  async function handleCreate() {
    setErrMsg('');
    try {
      const h = await writeContractAsync({
        address: registry,
        abi: marketRegistryAbi,
        functionName: 'addMarket',
        args: [
          vault as Address,
          oracle as Address,
          pctToBps(ltv),
          pctToBps(liqThreshold),
          pctToBps(liqPenalty),
          parseWad(supplyCap),
          parseWad(borrowCap),
          isIsolated,
          parseWad(isolatedBorrowCap),
        ],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 150) : String(e));
    }
  }

  return (
    <div className="card p-5 mb-5">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <Plus size={16} className="text-ceitnot-gold" />
          <h2 className="font-semibold">Create New Market</h2>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField label="Vault Address (ERC-4626)" value={vault} onChange={setVault} placeholder="0x..." hint="Must implement ERC-4626 (convertToAssets)" />
            <InputField label="Oracle Address" value={oracle} onChange={setOracle} placeholder="0x..." hint="Must return non-zero price via getLatestPrice()" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <InputField label="LTV (%)" value={ltv} onChange={setLtv} type="number" placeholder="80" hint="Max borrow ratio" />
            <InputField label="Liq. Threshold (%)" value={liqThreshold} onChange={setLiqThreshold} type="number" placeholder="85" hint="Must be ≥ LTV" />
            <InputField label="Liq. Penalty (%)" value={liqPenalty} onChange={setLiqPenalty} type="number" placeholder="5" hint="Penalty on liquidation" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InputField label="Supply Cap (tokens)" value={supplyCap} onChange={setSupplyCap} type="number" placeholder="0 = unlimited" />
            <InputField label="Borrow Cap (tokens)" value={borrowCap} onChange={setBorrowCap} type="number" placeholder="0 = unlimited" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isIsolated} onChange={e => setIsIsolated(e.target.checked)} className="rounded border-ceitnot-border" />
              <span className="text-sm">Isolated Mode</span>
            </label>
            {isIsolated && (
              <div className="flex-1">
                <InputField label="Isolated Borrow Cap" value={isolatedBorrowCap} onChange={setIsolatedBorrowCap} type="number" placeholder="Max borrow in isolation" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCreate} disabled={isPending || !canSubmit} className="btn-primary flex items-center gap-2">
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create Market
            </button>
            {hash && !confirmed && <span className="text-xs text-ceitnot-muted font-mono">Pending: {hash.slice(0, 10)}…</span>}
            {confirmed && hash && <span className="text-xs text-ceitnot-success font-mono flex items-center gap-1"><CheckCircle size={12} /> Market created!</span>}
          </div>
          {errMsg && <p className="text-xs text-ceitnot-danger bg-ceitnot-danger/10 p-3 rounded-lg break-all">{errMsg}</p>}
        </div>
      )}
    </div>
  );
}

/* ─── Market Management Card ──────────────────────────────────────────────── */

function MarketManageCard({ market, registry, gas, onSuccess }: {
  market: Market; registry: Address; gas: object; onSuccess: () => void;
}) {
  const { writeContractAsync, isPending } = useWriteContract();
  const [hash, setHash] = useState<Hash | undefined>();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });
  const [expanded, setExpanded] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [tab, setTab] = useState<'caps' | 'risk' | 'irm' | 'fees' | 'liq'>('caps');

  const [supplyCap, setSupplyCap] = useState('');
  const [borrowCap, setBorrowCap] = useState('');
  const [debtCeiling, setDebtCeiling] = useState('');
  const [ltv, setLtv] = useState('');
  const [liqThreshold, setLiqThreshold] = useState('');
  const [liqPenalty, setLiqPenalty] = useState('');
  const [baseRate, setBaseRate] = useState('');
  const [slope1, setSlope1] = useState('');
  const [slope2, setSlope2] = useState('');
  const [kink, setKink] = useState('');
  const [reserveFactor, setReserveFactor] = useState('');
  const [yieldFee, setYieldFee] = useState('');
  const [origFee, setOrigFee] = useState('');
  const [closeFactor, setCloseFactor] = useState('');
  const [fullLiqThreshold, setFullLiqThreshold] = useState('');
  const [protocolLiqFee, setProtocolLiqFee] = useState('');
  const [dutchAuction, setDutchAuction] = useState(false);
  const [auctionDur, setAuctionDur] = useState('');

  const c = market.config;
  const mid = BigInt(market.id);
  const pctToBps = (v: string) => Math.round(Number(v) * 100);
  const parseWad = (v: string) => { try { return v ? parseUnits(v, 18) : 0n; } catch { return 0n; } };

  useEffect(() => {
    if (confirmed && hash) { onSuccess(); setErrMsg(''); setHash(undefined); }
  }, [confirmed, hash, onSuccess]);

  const exec = async (fn: () => Promise<Hash>) => {
    setErrMsg('');
    try { setHash(await fn()); } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 150) : String(e));
    }
  };

  return (
    <div className="card p-0 overflow-hidden mb-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full px-5 py-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-ceitnot-gold/15 flex items-center justify-center text-ceitnot-gold text-xs font-bold">{market.id}</div>
          <div className="text-left">
            <span className="font-medium text-sm">{market.vaultSymbol ?? `Market #${market.id}`}</span>
            <span className="text-xs text-ceitnot-muted ml-2 font-mono">{formatAddress(c.vault)}</span>
          </div>
          <div className="flex gap-1 ml-2">
            {c.isFrozen ? <span className="badge-frozen text-[10px]">Frozen</span>
              : c.isActive ? <span className="badge-active text-[10px]">Active</span>
              : <span className="badge-inactive text-[10px]">Inactive</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ceitnot-muted">LTV {formatBps(c.ltvBps)}</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-ceitnot-border px-5 py-4 space-y-4">
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'freezeMarket', args: [mid, !c.isFrozen], ...gas }))}
              disabled={isPending}
              className={c.isFrozen ? 'btn-primary text-xs' : 'btn-danger text-xs'}
            >
              {isPending ? <Loader2 size={12} className="animate-spin" /> : c.isFrozen ? <Sun size={12} /> : <Snowflake size={12} />}
              <span className="ml-1">{c.isFrozen ? 'Unfreeze' : 'Freeze'}</span>
            </button>
            {c.isActive ? (
              <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'deactivateMarket', args: [mid], ...gas }))} disabled={isPending} className="btn-danger text-xs">
                Deactivate
              </button>
            ) : (
              <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'activateMarket', args: [mid], ...gas }))} disabled={isPending} className="btn-primary text-xs">
                Activate
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-ceitnot-border">
            {(['caps', 'risk', 'irm', 'fees', 'liq'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === t ? 'border-ceitnot-gold text-ceitnot-gold' : 'border-transparent text-ceitnot-muted hover:text-ceitnot-ink'}`}>
                {t === 'caps' ? 'Caps' : t === 'risk' ? 'Risk' : t === 'irm' ? 'IRM' : t === 'fees' ? 'Fees' : 'Liquidation'}
              </button>
            ))}
          </div>

          {tab === 'caps' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <InputField label={`Supply Cap (now: ${c.supplyCap === 0n ? '∞' : formatWad(c.supplyCap, 2)})`} value={supplyCap} onChange={setSupplyCap} type="number" placeholder="0 = unlimited" />
                <InputField label={`Borrow Cap (now: ${c.borrowCap === 0n ? '∞' : formatWad(c.borrowCap, 2)})`} value={borrowCap} onChange={setBorrowCap} type="number" placeholder="0 = unlimited" />
              </div>
              <InputField label={`Debt Ceiling (now: ${c.debtCeiling === 0n ? '∞' : formatWad(c.debtCeiling, 2)})`} value={debtCeiling} onChange={setDebtCeiling} type="number" placeholder="0 = unlimited" />
              <div className="flex gap-2">
                <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'updateMarketCaps', args: [mid, parseWad(supplyCap), parseWad(borrowCap)], ...gas }))} disabled={isPending || (!supplyCap && !borrowCap)} className="btn-primary text-xs">Update Caps</button>
                {debtCeiling && (
                  <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'updateMarketDebtCeiling', args: [mid, parseWad(debtCeiling)], ...gas }))} disabled={isPending} className="btn-primary text-xs">Update Debt Ceiling</button>
                )}
              </div>
            </div>
          )}

          {tab === 'risk' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <InputField label={`LTV % (now: ${formatBps(c.ltvBps)})`} value={ltv} onChange={setLtv} type="number" placeholder="80" />
                <InputField label={`Liq Threshold % (now: ${formatBps(c.liquidationThresholdBps)})`} value={liqThreshold} onChange={setLiqThreshold} type="number" placeholder="85" />
                <InputField label={`Liq Penalty % (now: ${formatBps(c.liquidationPenaltyBps)})`} value={liqPenalty} onChange={setLiqPenalty} type="number" placeholder="5" />
              </div>
              <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'updateMarketRiskParams', args: [mid, pctToBps(ltv), pctToBps(liqThreshold), pctToBps(liqPenalty)], ...gas }))} disabled={isPending || !ltv || !liqThreshold} className="btn-primary text-xs">Update Risk Params</button>
            </div>
          )}

          {tab === 'irm' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Base Rate (WAD)" value={baseRate} onChange={setBaseRate} placeholder="e.g. 0.02" hint="Annual base rate" />
                <InputField label="Slope 1 (WAD)" value={slope1} onChange={setSlope1} placeholder="e.g. 0.04" hint="Rate below kink" />
                <InputField label="Slope 2 (WAD)" value={slope2} onChange={setSlope2} placeholder="e.g. 3.0" hint="Rate above kink" />
                <InputField label="Kink (WAD)" value={kink} onChange={setKink} placeholder="e.g. 0.8" hint="Utilization breakpoint" />
                <InputField label="Reserve Factor (%)" value={reserveFactor} onChange={setReserveFactor} type="number" placeholder="10" hint="Protocol's interest share" />
              </div>
              <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'updateMarketIrmParams', args: [mid, parseWad(baseRate), parseWad(slope1), parseWad(slope2), parseWad(kink), pctToBps(reserveFactor)], ...gas }))} disabled={isPending} className="btn-primary text-xs">Update IRM</button>
            </div>
          )}

          {tab === 'fees' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <InputField label={`Yield Fee % (now: ${formatBps(c.yieldFeeBps)})`} value={yieldFee} onChange={setYieldFee} type="number" placeholder="10" hint="Fee on harvested yield" />
                <InputField label={`Origination Fee % (now: ${formatBps(c.originationFeeBps)})`} value={origFee} onChange={setOrigFee} type="number" placeholder="0.5" hint="Fee on new borrows" />
              </div>
              <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'updateMarketFeeParams', args: [mid, pctToBps(yieldFee), pctToBps(origFee)], ...gas }))} disabled={isPending || (!yieldFee && !origFee)} className="btn-primary text-xs">Update Fees</button>
            </div>
          )}

          {tab === 'liq' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <InputField label={`Close Factor % (now: ${formatBps(c.closeFactorBps)})`} value={closeFactor} onChange={setCloseFactor} type="number" placeholder="50" hint="Max repay per liquidation" />
                <InputField label={`Full Liq Threshold % (now: ${formatBps(c.fullLiquidationThresholdBps)})`} value={fullLiqThreshold} onChange={setFullLiqThreshold} type="number" placeholder="5" hint="Below → 100% liquidation" />
                <InputField label={`Protocol Liq Fee % (now: ${formatBps(c.protocolLiquidationFeeBps)})`} value={protocolLiqFee} onChange={setProtocolLiqFee} type="number" placeholder="2" />
                <InputField label="Auction Duration (sec)" value={auctionDur} onChange={setAuctionDur} type="number" placeholder="3600" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={dutchAuction} onChange={e => setDutchAuction(e.target.checked)} className="rounded border-ceitnot-border" />
                Dutch Auction Enabled
              </label>
              <button onClick={() => exec(() => writeContractAsync({ address: registry, abi: marketRegistryAbi, functionName: 'updateMarketLiquidationParams', args: [mid, pctToBps(closeFactor), pctToBps(fullLiqThreshold), pctToBps(protocolLiqFee), dutchAuction, BigInt(auctionDur || '0')], ...gas }))} disabled={isPending} className="btn-primary text-xs">Update Liquidation Params</button>
            </div>
          )}

          {hash && !confirmed && <p className="text-xs text-ceitnot-muted font-mono">Pending: {hash.slice(0, 10)}…</p>}
          {confirmed && hash && <p className="text-xs text-ceitnot-success font-mono flex items-center gap-1"><CheckCircle size={12} /> Updated!</p>}
          {errMsg && <p className="text-xs text-ceitnot-danger bg-ceitnot-danger/10 p-2 rounded break-all">{errMsg}</p>}
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */

export default function AdminPage() {
  const { chainId } = useAccount();
  const { engine }  = useContractAddresses();
  const { admin, paused, emergencyShutdown, debtToken, marketRegistry, isAdmin, isLoading, refetch } = useAdmin();
  const { markets, count, refetch: refetchMarkets } = useMarkets();
  const [newAdmin, setNewAdmin] = useState('');
  const [psmWithdrawTo, setPsmWithdrawTo] = useState('');
  const [psmWithdrawAmount, setPsmWithdrawAmount] = useState('');
  const [psmLiqTo, setPsmLiqTo] = useState('');
  const [psmLiqAmount, setPsmLiqAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const psmAddress = import.meta.env.VITE_PSM_ADDRESS as Address | undefined;

  const { data: psmData, refetch: refetchPsm } = useReadContracts({
    contracts: psmAddress ? [
      { address: psmAddress, abi: ceitnotPsmAbi, functionName: 'peggedDecimals', chainId },
      { address: psmAddress, abi: ceitnotPsmAbi, functionName: 'feeReserves', chainId },
      { address: psmAddress, abi: ceitnotPsmAbi, functionName: 'tinBps', chainId },
      { address: psmAddress, abi: ceitnotPsmAbi, functionName: 'toutBps', chainId },
    ] : [],
    query: { enabled: !!psmAddress && !!chainId },
  });
  const psmPeggedDecimals = Number((psmData?.[0]?.result as number | undefined) ?? 6);
  const psmFeeReserves = (psmData?.[1]?.result as bigint | undefined) ?? 0n;
  const psmTinBps = (psmData?.[2]?.result as bigint | undefined) ?? 0n;
  const psmToutBps = (psmData?.[3]?.result as bigint | undefined) ?? 0n;

  const { writeContractAsync, isPending } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });
  if (confirmed && hash) { refetch(); refetchPsm(); }

  const gas = gasFor(chainId);
  const exec = async (fn: () => Promise<Hash>) => { try { setHash(await fn()); } catch (e) { console.error(e); } };
  const handleMarketSuccess = () => { refetch(); refetchMarkets(); };

  const adminIsTimelock =
    !!admin &&
    !!TIMELOCK_ENV &&
    admin.toLowerCase() === TIMELOCK_ENV.toLowerCase();
  const timelockExplorer =
    TIMELOCK_ENV && blockExplorerAddressUrl(chainId ?? TARGET_CHAIN_ID, TIMELOCK_ENV);

  return (
    <div className="page-container max-w-3xl mx-auto">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3">
          <span className="page-title-accent">Admin</span>
        </h1>
        <p className="page-subtitle">Protocol configuration, market management and emergency controls.</p>
      </div>

      {adminIsTimelock && (
        <div className="rounded-xl border border-ceitnot-gold/35 bg-ceitnot-gold/10 p-4 mb-5 text-sm text-ceitnot-muted-2 leading-relaxed">
          <p className="font-medium text-ceitnot-gold mb-1">On-chain admin is the Timelock contract</p>
          <p className="mb-2">
            Direct EOA admin actions from this page are disabled while <span className="text-ceitnot-ink/90">engine.admin()</span> points to Timelock.
            Use{' '}
            <Link to="/governance" className="text-ceitnot-gold hover:underline font-medium">
              Governance
            </Link>
            {' '}to pass proposals (queue → time delay → execute).
          </p>
          {timelockExplorer && (
            <a
              href={timelockExplorer}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-ceitnot-gold hover:underline inline-flex items-center gap-1"
            >
              View Timelock on block explorer
            </a>
          )}
        </div>
      )}

      {/* Protocol status */}
      <div className="card p-5 mb-5">
        <h2 className="font-semibold mb-4">Protocol Status</h2>
        <div className="grid grid-cols-2 gap-5">
          <div className="flex items-center gap-3">
            {paused ? <Lock size={20} className="text-ceitnot-danger shrink-0" /> : <Unlock size={20} className="text-ceitnot-success shrink-0" />}
            <div>
              <p className="text-xs stat-label">Paused</p>
              <p className={`font-semibold mt-0.5 ${paused ? 'text-ceitnot-danger' : 'text-ceitnot-success'}`}>
                {isLoading ? '…' : paused ? 'Yes — paused' : 'No — active'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {emergencyShutdown ? <ShieldAlert size={20} className="text-ceitnot-danger shrink-0" /> : <ShieldCheck size={20} className="text-ceitnot-success shrink-0" />}
            <div>
              <p className="text-xs stat-label">Emergency Shutdown</p>
              <p className={`font-semibold mt-0.5 ${emergencyShutdown ? 'text-ceitnot-danger' : 'text-ceitnot-success'}`}>
                {isLoading ? '…' : emergencyShutdown ? 'ACTIVE' : 'Inactive'}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs stat-label">Total Markets</p>
            <p className="font-semibold mt-0.5">{count} ({markets.filter(m => m.config.isActive).length} active)</p>
          </div>
          <div>
            <p className="text-xs stat-label">Your Role</p>
            <p className={`font-semibold mt-0.5 ${isAdmin ? 'text-ceitnot-gold' : 'text-ceitnot-muted-2'}`}>
              {isAdmin ? '⚡ Admin' : 'Read-only'}
            </p>
          </div>
        </div>
      </div>

      {/* Contract addresses */}
      <div className="card p-5 mb-5">
        <h2 className="font-semibold mb-4">Contract Addresses</h2>
        <div className="space-y-3 text-sm font-mono">
          {([
            ['Engine', engine],
            ['Registry', marketRegistry],
            ['Debt Token', debtToken],
            [adminIsTimelock ? 'Protocol admin' : 'Admin', admin],
          ] as const).map(([label, addr]) => addr && (
            <div key={label} className="flex items-center justify-between gap-2 py-2 border-b border-ceitnot-border last:border-0">
              <span className="text-ceitnot-muted text-xs min-w-[80px]">{label}</span>
              <span className="text-ceitnot-ink truncate">{addr}</span>
              <CopyButton text={addr} />
            </div>
          ))}
        </div>
      </div>

      {isAdmin ? (
        <>
          {/* Create Market */}
          {marketRegistry && <CreateMarketForm registry={marketRegistry} gas={gas} onSuccess={handleMarketSuccess} />}

          {/* Market Management */}
          {markets.length > 0 && marketRegistry && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Settings size={16} className="text-ceitnot-gold" />
                <h2 className="font-semibold">Manage Markets</h2>
              </div>
              {markets.map(m => (
                <MarketManageCard key={m.id} market={m} registry={marketRegistry} gas={gas} onSuccess={handleMarketSuccess} />
              ))}
            </div>
          )}

          {/* Protocol Controls */}
          <div className="card p-5 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={16} className="text-ceitnot-gold" />
              <h2 className="font-semibold">Protocol Controls</h2>
            </div>
            <div>
              <AdminAction label="Pause Protocol" description="Halts all borrows and deposits." buttonLabel="Pause" buttonClass="btn-danger" isPending={isPending} disabled={paused === true} onAction={() => exec(() => writeContractAsync({ address: engine!, abi: ceitnotEngineAbi, functionName: 'pause', ...gas }))} />
              <AdminAction label="Unpause Protocol" description="Resume normal operations." buttonLabel="Unpause" buttonClass="btn-primary" isPending={isPending} disabled={paused === false} onAction={() => exec(() => writeContractAsync({ address: engine!, abi: ceitnotEngineAbi, functionName: 'unpause', ...gas }))} />
              <AdminAction label="Enable Emergency Shutdown" description="Disables all borrows permanently until lifted." buttonLabel="Activate" buttonClass="btn-danger" isPending={isPending} disabled={emergencyShutdown === true} onAction={() => exec(() => writeContractAsync({ address: engine!, abi: ceitnotEngineAbi, functionName: 'setEmergencyShutdown', args: [true], ...gas }))} />
              <AdminAction label="Disable Emergency Shutdown" description="Re-enables borrowing." buttonLabel="Deactivate" buttonClass="btn-primary" isPending={isPending} disabled={emergencyShutdown === false} onAction={() => exec(() => writeContractAsync({ address: engine!, abi: ceitnotEngineAbi, functionName: 'setEmergencyShutdown', args: [false], ...gas }))} />
            </div>
            <div className="mt-5 pt-5 border-t border-ceitnot-border">
              <div className="flex items-center gap-2 mb-3 text-ceitnot-danger">
                <UserX size={15} />
                <h3 className="font-semibold text-sm">Transfer Admin</h3>
              </div>
              <div className="flex gap-2">
                <input type="text" value={newAdmin} onChange={e => setNewAdmin(e.target.value)} placeholder="New admin address (0x…)" className="input-field flex-1" />
                <button onClick={() => exec(() => writeContractAsync({ address: engine!, abi: ceitnotEngineAbi, functionName: 'transferAdmin', args: [newAdmin as Address], ...gas }))} disabled={isPending || !isAddress(newAdmin)} className="btn-danger shrink-0">
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : 'Transfer'}
                </button>
              </div>
              <p className="text-xs text-ceitnot-danger mt-2">⚠ This is irreversible. Verify the address carefully.</p>
            </div>
          </div>

          {/* PSM Fee Reserves */}
          {psmAddress && (
            <div className="card p-5 mb-5">
              <div className="flex items-center gap-2 mb-4">
                <Settings size={16} className="text-ceitnot-gold" />
                <h2 className="font-semibold">PSM Fee Reserves</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
                <div className="p-3 rounded-lg bg-ceitnot-surface-2/80">
                  <p className="text-ceitnot-muted text-xs">PSM Address</p>
                  <p className="font-mono text-xs mt-1">{formatAddress(psmAddress)}</p>
                </div>
                <div className="p-3 rounded-lg bg-ceitnot-surface-2/80">
                  <p className="text-ceitnot-muted text-xs">Fee Reserves</p>
                  <p className="font-mono mt-1">{formatWad(psmFeeReserves, 6)}</p>
                </div>
                <div className="p-3 rounded-lg bg-ceitnot-surface-2/80">
                  <p className="text-ceitnot-muted text-xs">Fees</p>
                  <p className="font-mono mt-1">tin {formatBps(psmTinBps)} / tout {formatBps(psmToutBps)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <InputField
                  label="Withdraw to"
                  value={psmWithdrawTo}
                  onChange={setPsmWithdrawTo}
                  placeholder="0x..."
                />
                <InputField
                  label={`Amount (pegged token, ${psmPeggedDecimals} decimals)`}
                  value={psmWithdrawAmount}
                  onChange={setPsmWithdrawAmount}
                  placeholder="0.0"
                  type="number"
                />
              </div>
              <button
                onClick={() => exec(() => writeContractAsync({
                  address: psmAddress,
                  abi: ceitnotPsmAbi,
                  functionName: 'withdrawFeeReserves',
                  args: [psmWithdrawTo as Address, parseUnits(psmWithdrawAmount || '0', psmPeggedDecimals)],
                  ...gas,
                }))}
                disabled={isPending || !isAddress(psmWithdrawTo) || Number(psmWithdrawAmount) <= 0}
                className="btn-primary"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : 'Withdraw PSM Fees'}
              </button>
              <p className="text-xs text-ceitnot-muted mt-2">
                Withdraws accumulated PSM swap fees (`feeReserves`) only.
              </p>

              <div className="mt-6 pt-5 border-t border-ceitnot-border">
                <h3 className="font-semibold text-sm mb-3 text-ceitnot-danger">Withdraw swap liquidity</h3>
                <p className="text-xs text-ceitnot-muted mb-3">
                  Moves USDC (or other pegged token) above fee reserves to another address — for migrating to a new PSM. Users cannot swap out until liquidity is restored.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <InputField label="Withdraw to" value={psmLiqTo} onChange={setPsmLiqTo} placeholder="0x..." />
                  <InputField
                    label={`Amount (${psmPeggedDecimals} decimals)`}
                    value={psmLiqAmount}
                    onChange={setPsmLiqAmount}
                    placeholder="0.0"
                    type="number"
                  />
                </div>
                <button
                  onClick={() => exec(() => writeContractAsync({
                    address: psmAddress,
                    abi: ceitnotPsmAbi,
                    functionName: 'withdrawLiquidity',
                    args: [psmLiqTo as Address, parseUnits(psmLiqAmount || '0', psmPeggedDecimals)],
                    ...gas,
                  }))}
                  disabled={isPending || !isAddress(psmLiqTo) || Number(psmLiqAmount) <= 0}
                  className="btn-danger"
                >
                  {isPending ? <Loader2 size={14} className="animate-spin" /> : 'Withdraw PSM liquidity'}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card p-6 text-center">
          <ShieldCheck size={32} className="text-ceitnot-muted mx-auto mb-3" />
          <p className="text-ceitnot-muted-2 text-sm">Admin controls are only visible to the protocol admin.</p>
          {admin && <p className="text-xs text-ceitnot-muted mt-2 font-mono">Admin: {formatAddress(admin)}</p>}
        </div>
      )}

      {hash && (
        <p className="text-xs text-center text-ceitnot-muted font-mono mt-4">
          {confirmed ? '✓ Confirmed' : 'Pending'}: {hash.slice(0, 12)}…{hash.slice(-8)}
        </p>
      )}
    </div>
  );
}

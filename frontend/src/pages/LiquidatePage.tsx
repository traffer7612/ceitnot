import { useState } from 'react';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, isAddress, type Address, type Hash } from 'viem';
import { Search, Zap, AlertTriangle, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { auraEngineAbi, erc20Abi } from '../abi/auraEngine';
import { useContractAddresses, gasFor } from '../lib/contracts';
import { useAdmin } from '../hooks/useAdmin';
import { useMarkets } from '../hooks/useMarkets';
import { formatWad, formatHf, parseHf, hfColor } from '../lib/utils';

export default function LiquidatePage() {
  const { address: liquidator, chainId } = useAccount();
  const { engine } = useContractAddresses();
  const { debtToken } = useAdmin();
  const { markets } = useMarkets();
  const [target, setTarget] = useState('');
  const [queried, setQueried] = useState<Address | null>(null);
  const [liqMarket, setLiqMarket] = useState<number | null>(null);
  const [liqAmount, setLiqAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [txState, setTxState] = useState<'idle' | 'approving' | 'liquidating' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  // Fetch queried user's health factor + market positions
  const { data: targetData, isLoading: targetLoading } = useReadContracts({
    contracts: queried && engine ? [
      { address: engine, abi: auraEngineAbi, functionName: 'getHealthFactor' as const, args: [queried] as const },
      { address: engine, abi: auraEngineAbi, functionName: 'getUserMarkets'  as const, args: [queried] as const },
    ] : [],
    query: { enabled: !!queried && !!engine },
  });

  const targetHfRaw = targetData?.[0]?.result as bigint | undefined;
  const targetMarkets = (targetData?.[1]?.result ?? []) as bigint[];
  const targetHf = parseHf(targetHfRaw);
  const isLiquidatable = isFinite(targetHf) && targetHf < 1.0;

  // Per-market position data
  const { data: posData } = useReadContracts({
    contracts: queried && engine ? targetMarkets.flatMap(mid => [
      { address: engine, abi: auraEngineAbi, functionName: 'getPositionDebt'            as const, args: [queried, mid] as const },
      { address: engine, abi: auraEngineAbi, functionName: 'getPositionCollateralShares' as const, args: [queried, mid] as const },
      { address: engine, abi: auraEngineAbi, functionName: 'getPositionCollateralValue'  as const, args: [queried, mid] as const },
    ]) : [],
    query: { enabled: !!queried && !!engine && targetMarkets.length > 0 },
  });

  // Check liquidator allowance
  const liqAmountRaw = (() => {
    try { return liqAmount ? parseUnits(liqAmount, 18) : 0n; } catch { return 0n; }
  })();
  const { data: allowData, refetch: refetchAllow } = useReadContracts({
    contracts: debtToken && liquidator && engine ? [{
      address: debtToken,
      abi: erc20Abi,
      functionName: 'allowance' as const,
      args: [liquidator, engine] as const,
    }] : [],
    query: { enabled: !!debtToken && !!liquidator && !!engine },
  });
  const allowance = (allowData?.[0]?.result as bigint | undefined) ?? 0n;
  const needsApproval = liqAmountRaw > 0n && allowance < liqAmountRaw;

  const handleLookup = () => {
    const addr = target.trim();
    if (!isAddress(addr)) return;
    setQueried(addr as Address);
    setLiqMarket(null);
    setLiqAmount('');
    setHash(undefined);
    setTxState('idle');
  };

  if (confirmed && hash && txState === 'approving') {
    refetchAllow();
    setTxState('idle');
  }
  if (confirmed && hash && txState === 'liquidating') {
    setTxState('done');
  }

  const executeLiquidate = async () => {
    if (!liquidator || !engine || liqMarket === null || !queried) return;
    const gas = gasFor(chainId);
    try {
      if (needsApproval && debtToken) {
        setTxState('approving');
        const h = await writeContractAsync({
          address: debtToken,
          abi: erc20Abi,
          functionName: 'approve',
          args: [engine, 2n ** 256n - 1n],
          ...gas,
        });
        setHash(h);
        return;
      }
      setTxState('liquidating');
      const h = await writeContractAsync({
        address: engine,
        abi: auraEngineAbi,
        functionName: 'liquidate',
        args: [queried, BigInt(liqMarket), liqAmountRaw],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setTxState('error');
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg.split('\n')[0].slice(0, 120));
    }
  };

  return (
    <div className="page-container max-w-3xl mx-auto">
      <div className="page-header">
        <h1 className="page-title">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-aura-gold to-aura-accent">Liquidate</span>
        </h1>
        <p className="page-subtitle">Look up any address and liquidate under-collateralised positions.</p>
      </div>

      {/* Lookup form */}
      <div className="card p-5 mb-6">
        <label className="block text-sm text-aura-muted mb-2">Target address</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="0x…"
            className="input-field flex-1"
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
          />
          <button
            onClick={handleLookup}
            disabled={!target || !isAddress(target.trim())}
            className="btn-primary flex items-center gap-2"
          >
            <Search size={15} /> Lookup
          </button>
        </div>
      </div>

      {/* Loading */}
      {queried && targetLoading && (
        <div className="card p-8 text-center text-aura-muted text-sm">Loading position data…</div>
      )}

      {/* Results */}
      {queried && !targetLoading && targetData && (
        <div className="space-y-4">
          {/* Health factor banner */}
          <div className={`card p-5 flex items-center justify-between ${
            isLiquidatable ? 'border-aura-danger/50 bg-aura-danger/5' : ''
          }`}>
            <div>
              <p className="text-xs stat-label">Health Factor for</p>
              <p className="font-mono text-xs text-aura-muted mt-0.5">{queried}</p>
            </div>
            <div className="text-right">
              <span className={`text-3xl font-bold font-mono ${hfColor(targetHf)}`}>
                {formatHf(targetHfRaw)}
              </span>
              {isLiquidatable && (
                <p className="text-xs text-aura-danger mt-0.5 flex items-center gap-1 justify-end">
                  <AlertTriangle size={12} /> Liquidatable
                </p>
              )}
            </div>
          </div>

          {/* Per-market positions */}
          {targetMarkets.length === 0 && (
            <div className="card p-6 text-center text-aura-muted text-sm">No open positions.</div>
          )}

          {targetMarkets.map((mid, i) => {
            const debt   = (posData?.[i * 3]?.result     as bigint | undefined) ?? 0n;
            const shares = (posData?.[i * 3 + 1]?.result as bigint | undefined) ?? 0n;
            const value  = (posData?.[i * 3 + 2]?.result as bigint | undefined) ?? 0n;
            const market = markets.find(m => m.id === Number(mid));
            const closeFactor = market?.config.closeFactorBps ?? 5000n;
            const maxRepay = (debt * closeFactor) / 10000n;
            const isSelected = liqMarket === Number(mid);

            return (
              <div key={mid.toString()} className={`card p-5 ${isSelected ? 'border-aura-gold/50' : ''}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-medium">{market?.vaultSymbol ?? `Market #${mid.toString()}`}</h3>
                    <span className="text-xs text-aura-muted">Market #{mid.toString()}</span>
                  </div>
                  {isLiquidatable && debt > 0n && (
                    <button
                      onClick={() => { setLiqMarket(Number(mid)); setLiqAmount(''); }}
                      className={isSelected ? 'btn-danger text-xs' : 'btn-primary text-xs flex items-center gap-1.5'}
                    >
                      <Zap size={13} /> {isSelected ? 'Selected' : 'Liquidate'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="stat-label">Debt</p>
                    <p className="font-mono text-aura-warning mt-1">{formatWad(debt, 4)}</p>
                  </div>
                  <div>
                    <p className="stat-label">Collateral Shares</p>
                    <p className="font-mono text-white mt-1">{formatWad(shares, 4)}</p>
                  </div>
                  <div>
                    <p className="stat-label">Collateral Value</p>
                    <p className="font-mono text-white mt-1">{formatWad(value, 4)}</p>
                  </div>
                </div>

                {isSelected && (
                  <div className="mt-4 pt-4 border-t border-aura-border space-y-3">
                    <p className="text-xs text-aura-muted">
                      Max repay (close factor {Number(closeFactor) / 100}%): <span className="text-white font-mono">{formatWad(maxRepay, 4)}</span>
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        value={liqAmount}
                        onChange={e => setLiqAmount(e.target.value)}
                        placeholder="Repay amount"
                        className="input-field flex-1"
                      />
                      <button
                        onClick={() => setLiqAmount(formatUnits(maxRepay, 18))}
                        className="px-3 py-2 rounded-xl text-sm font-medium bg-aura-gold/15 text-aura-gold hover:bg-aura-gold/25 transition-colors"
                      >
                        Max
                      </button>
                    </div>

                    {txState === 'done' ? (
                      <div className="flex items-center gap-2 text-aura-success text-sm">
                        <CheckCircle size={16} /> Liquidation successful
                      </div>
                    ) : txState === 'error' ? (
                      <div>
                        <div className="flex items-center gap-2 text-aura-danger text-sm mb-2">
                          <AlertCircle size={16} /> {errMsg}
                        </div>
                        <button onClick={() => { setTxState('idle'); setErrMsg(''); }} className="btn-secondary text-xs">
                          Retry
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={executeLiquidate}
                        disabled={!liqAmountRaw || liqAmountRaw <= 0n || txState === 'approving' || txState === 'liquidating'}
                        className="btn-danger w-full flex items-center justify-center gap-2"
                      >
                        {(txState === 'approving' || txState === 'liquidating') && (
                          <Loader2 size={15} className="animate-spin" />
                        )}
                        {txState === 'approving'
                          ? 'Approving debt token…'
                          : txState === 'liquidating'
                          ? 'Confirming liquidation…'
                          : needsApproval
                          ? 'Approve Debt Token first'
                          : 'Execute Liquidation'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

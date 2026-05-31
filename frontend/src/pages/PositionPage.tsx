import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { usePosition } from '../hooks/usePosition';
import { useMarkets } from '../hooks/useMarkets';
import { useAdmin } from '../hooks/useAdmin';
import { formatToken, parseHf, hfColor, hfBarColor, hfBarPct, formatAddress } from '../lib/utils';
import ActionModal, { type ActionType } from '../components/position/ActionModal';
import MintSharesModal from '../components/position/MintSharesModal';
import TestnetOracleRefreshBar from '../components/position/TestnetOracleRefreshBar';
import { Wallet, RefreshCw, PlusCircle, MinusCircle, ArrowUpCircle, ArrowDownCircle, Coins, ChevronDown } from 'lucide-react';

type ModalState = { open: true; action: ActionType; marketId: number } | { open: false };
type MintState  = { open: true; marketId: number; vaultAddress: `0x${string}` } | { open: false };

export default function PositionPage() {
  const { address, isConnected } = useAccount();
  const { positions, healthFactor, refetch } = usePosition();
  const { markets, browseMarkets } = useMarkets();
  const DUST_DISPLAY_WAD = 10n ** 14n; // 0.0001 (18 decimals)
  const hasMeaningfulDebt = (v: bigint | undefined) => (v ?? 0n) > DUST_DISPLAY_WAD;
  const sharesDustRaw = (decimals: number) => (decimals > 4 ? 10n ** BigInt(decimals - 4) : 1n);
  const nonEmptyPositions = positions.filter((p) => {
    const market = markets.find(m => m.id === p.marketId);
    if (!market || !market.config.isActive || market.config.isIsolated) return false;
    const shareDust = sharesDustRaw(market?.vaultDecimals ?? 18);
    return p.shares > shareDust || p.value > DUST_DISPLAY_WAD || hasMeaningfulDebt(p.debt);
  });
  const marketById = new Map(markets.map(m => [m.id, m]));
  const positionIds = new Set(nonEmptyPositions.map(p => p.marketId));
  const selectableMarkets = markets.filter(
    m => browseMarkets.some(b => b.id === m.id) || positionIds.has(m.id),
  );
  const { debtToken } = useAdmin();
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [mintModal, setMintModal] = useState<MintState>({ open: false });
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const totalDebtRaw = positions.reduce((sum, p) => sum + p.debt, 0n);
  const hasOnlyDustDebt = totalDebtRaw > 0n && totalDebtRaw <= DUST_DISPLAY_WAD;
  const hf    = hasOnlyDustDebt ? Infinity : parseHf(healthFactor);
  const hfPct = hfBarPct(hf);
  const hfLabel = isFinite(hf) ? hf.toFixed(2) : '∞';
  const isZeroFormatted = (value: string) => /^0([.,]0+)?$/.test(value.replace(/\s/g, ''));
  const formatWithDust = (v: bigint | undefined, decimals = 18, dp = 4) => {
    if (v === undefined) return '—';
    const shown = formatToken(v, decimals, dp);
    if (v > 0n && isZeroFormatted(shown)) return '<0.0001';
    return shown;
  };
  const formatDebtDisplay = (v: bigint | undefined) => {
    if (v === undefined) return '—';
    if (v <= DUST_DISPLAY_WAD) return '0';
    return formatWithDust(v, 18, 4);
  };
  const marketLabel = (marketId: number) => {
    const symbol = marketById.get(marketId)?.vaultSymbol;
    return symbol ? `${symbol} (#${marketId})` : `Market #${marketId}`;
  };
  const isFrontendInactiveMarket = (marketId: number) =>
    !!marketById.get(marketId)?.config.isIsolated;
  const frontendInactiveReason = (marketId: number) =>
    isFrontendInactiveMarket(marketId)
      ? `Рынок ${marketLabel(marketId)} отключён на фронте (inactive).`
      : undefined;
  const isolationBlockReasonFor = (action: ActionType, targetMarketId: number): string | undefined => {
    if (action !== 'deposit' && action !== 'borrow') return undefined;
    const targetMarket = marketById.get(targetMarketId);
    if (!targetMarket) return undefined;
    if (targetMarket.config.isIsolated) {
      return `Рынок ${marketLabel(targetMarketId)} помечен как inactive на фронте. Deposit/Borrow для изолированных рынков отключены.`;
    }

    return undefined;
  };

  const openModal = (action: ActionType, marketId: number) =>
    setModal({ open: true, action, marketId });
  const closeModal = () => setModal({ open: false });

  const openMint = (marketId: number, vaultAddress: `0x${string}`) =>
    setMintModal({ open: true, marketId, vaultAddress });
  const closeMint = () => setMintModal({ open: false });

  if (!isConnected) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm w-full flex flex-col items-center">
          <Wallet size={48} className="text-ceitnot-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
          <p className="text-ceitnot-muted text-sm mb-6">Connect to view and manage your positions.</p>
          <div className="w-full flex justify-center [&>div]:flex [&>div]:justify-center">
            <ConnectButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="page-title">
            <span className="page-title-accent">Position</span>
          </h1>
          <p className="page-subtitle text-xs font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</p>
        </div>
        <button onClick={refetch} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Market Selector */}
      {selectableMarkets.length > 1 && (
        <div className="relative mb-6">
          <button
            onClick={() => setSelectorOpen(!selectorOpen)}
            className="card px-5 py-3 flex items-center justify-between w-full hover:border-ceitnot-border-2 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-ceitnot-muted">Market:</span>
              {selectedMarketId === null ? (
                <span className="font-medium">All Markets</span>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-ceitnot-gold/15 flex items-center justify-center text-ceitnot-gold text-xs font-bold">
                    {selectedMarketId}
                  </div>
                  <span className="font-medium">
                    {selectableMarkets.find(m => m.id === selectedMarketId)?.vaultSymbol ?? `Market #${selectedMarketId}`}
                  </span>
                  <span className="text-xs text-ceitnot-muted font-mono">
                    {formatAddress(selectableMarkets.find(m => m.id === selectedMarketId)?.config.vault ?? '')}
                  </span>
                </div>
              )}
            </div>
            <ChevronDown size={16} className={`text-ceitnot-muted transition-transform ${selectorOpen ? 'rotate-180' : ''}`} />
          </button>

          {selectorOpen && (
            <div className="absolute z-20 top-full left-0 right-0 mt-1 card border border-ceitnot-border shadow-xl max-h-64 overflow-y-auto">
              <button
                onClick={() => { setSelectedMarketId(null); setSelectorOpen(false); }}
                className={`w-full px-5 py-3 text-left text-sm hover:bg-white/[0.03] transition-colors ${
                  selectedMarketId === null ? 'text-ceitnot-gold' : ''
                }`}
              >
                All Markets
              </button>
              {selectableMarkets.map(m => {
                const hasPos = nonEmptyPositions.some(p => p.marketId === m.id);
                const marketInactive =
                  !m.config.isActive || isFrontendInactiveMarket(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedMarketId(m.id); setSelectorOpen(false); }}
                    className={`w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition-colors ${
                      selectedMarketId === m.id ? 'text-ceitnot-gold' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded bg-ceitnot-gold/15 flex items-center justify-center text-ceitnot-gold text-xs font-bold">
                        {m.id}
                      </div>
                      <span className="text-sm font-medium">{m.vaultSymbol ?? `Market #${m.id}`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasPos && <span className="text-[10px] bg-ceitnot-gold/20 text-ceitnot-gold px-1.5 py-0.5 rounded">Has position</span>}
                      {marketInactive
                        ? <span className="badge-inactive text-[10px]">Inactive</span>
                        : <span className="badge-active text-[10px]">Active</span>}
                      {m.config.isIsolated && <span className="badge-isolated text-[10px]">Isolated</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <TestnetOracleRefreshBar markets={markets} positions={positions} onRefreshed={refetch} />

      {/* Global Health Factor */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="stat-label">Global Health Factor</span>
          <span className={`text-2xl font-bold font-mono ${hfColor(hf)}`}>
            {hfLabel}
          </span>
        </div>
        <div className="h-2 bg-ceitnot-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${hfBarColor(hf)}`}
            style={{ width: `${hfPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-ceitnot-muted mt-1.5">
          <span>Liquidation</span>
          <span>1.0</span>
          <span>1.5</span>
          <span>Safe ≥ 2.0</span>
        </div>
      </div>

      {/* Selected market with no position — show open position prompt */}
      {selectedMarketId !== null && !nonEmptyPositions.some(p => p.marketId === selectedMarketId) && (() => {
        const m = selectableMarkets.find(mk => mk.id === selectedMarketId);
        if (!m) return null;
        const marketInactive =
          !m.config.isActive || isFrontendInactiveMarket(m.id);
        const blockedReason =
          isolationBlockReasonFor('deposit', m.id)
          ?? (marketInactive ? `Рынок ${marketLabel(m.id)} сейчас неактивен на фронте.` : undefined);
        const mintBlockedReason = frontendInactiveReason(m.id) ?? blockedReason;
        const disableDeposit = marketInactive || !!blockedReason;
        return (
          <div className="card p-8 text-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-ceitnot-gold/15 flex items-center justify-center text-ceitnot-gold text-lg font-bold mx-auto mb-3">
              {m.id}
            </div>
            <h3 className="font-semibold text-lg">{m.vaultSymbol ?? `Market #${m.id}`}</h3>
            <p className="text-ceitnot-muted text-sm mt-1">No position in this market yet. Deposit collateral to open one.</p>
            <div className="flex justify-center gap-3 mt-5">
              <button
                onClick={() => openMint(m.id, m.config.vault)}
                className="btn-secondary text-sm flex items-center gap-2"
                disabled={!!mintBlockedReason}
                title={mintBlockedReason}
              >
                <Coins size={14} /> Get Shares
              </button>
              <button
                onClick={() => openModal('deposit', m.id)}
                className={`${disableDeposit ? 'btn-secondary' : 'btn-primary'} text-sm flex items-center gap-2`}
                disabled={disableDeposit}
                title={blockedReason}
              >
                <PlusCircle size={14} /> Deposit
              </button>
            </div>
            {blockedReason && (
              <p className="text-xs text-ceitnot-warning mt-3 max-w-2xl mx-auto">{blockedReason}</p>
            )}
          </div>
        );
      })()}

      {/* No positions at all */}
      {nonEmptyPositions.length === 0 && selectedMarketId === null && (
        <div className="card p-10 text-center">
          <p className="text-ceitnot-muted">No active positions found.</p>
          <p className="text-xs text-ceitnot-muted mt-1">Select a market above or deposit collateral to open a position.</p>
          <div className="flex justify-center gap-3 mt-5 flex-wrap">
            {browseMarkets.slice(0, 3).map(m => {
              const marketInactive =
                !m.config.isActive || isFrontendInactiveMarket(m.id);
              const blockedReason =
                isolationBlockReasonFor('deposit', m.id)
                ?? (marketInactive ? `Рынок ${marketLabel(m.id)} сейчас неактивен на фронте.` : undefined);
              const mintBlockedReason = frontendInactiveReason(m.id) ?? blockedReason;
              const disableDeposit = marketInactive || !!blockedReason;
              return (
              <div key={m.id} className="flex gap-2">
                <button
                  onClick={() => openMint(m.id, m.config.vault)}
                  className="btn-secondary text-sm flex items-center gap-2"
                  disabled={!!mintBlockedReason}
                  title={mintBlockedReason}
                >
                  <Coins size={14} />
                  Get Shares #{m.id}
                </button>
                <button
                  onClick={() => openModal('deposit', m.id)}
                  className={`${disableDeposit ? 'btn-secondary' : 'btn-primary'} text-sm flex items-center gap-2`}
                  disabled={disableDeposit}
                  title={blockedReason}
                >
                  <PlusCircle size={14} />
                  Deposit #{m.id}
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Position cards */}
      {(() => {
        const filtered = selectedMarketId === null
          ? nonEmptyPositions
          : nonEmptyPositions.filter(p => p.marketId === selectedMarketId);
        if (filtered.length === 0) return null;
        return (
        <div className="space-y-4">
          {filtered.map(pos => {
            const market = markets.find(m => m.id === pos.marketId);
            const isolatedMarket = !!market?.config.isIsolated;
            const marketInactive =
              !market?.config.isActive
              || isFrontendInactiveMarket(pos.marketId);
            const enterBlockedReason = isolationBlockReasonFor('deposit', pos.marketId);
            const inactiveMarketActionReason = isolatedMarket
              ? `Рынок ${marketLabel(pos.marketId)} неактивен на фронте: все действия отключены.`
              : undefined;
            const sharedActionBlockedReason =
              inactiveMarketActionReason
              ?? enterBlockedReason
              ?? (marketInactive ? `Рынок ${marketLabel(pos.marketId)} сейчас неактивен на фронте.` : undefined);
            const mintBlockedReason = frontendInactiveReason(pos.marketId) ?? sharedActionBlockedReason;
            const disableGetShares = !!mintBlockedReason;
            const disableDeposit = marketInactive || !!sharedActionBlockedReason;
            const disableWithdraw = !!inactiveMarketActionReason;
            const disableRepay = !hasMeaningfulDebt(pos.debt) || !!inactiveMarketActionReason;
            const disableBorrow =
              !!sharedActionBlockedReason || !!market?.config.isFrozen || marketInactive;
            const ltvBps = market?.config.ltvBps;
            const ltv = ltvBps ? Number(ltvBps) / 100 : null;

            // Utilization: debt / (max borrow capacity in debt units; engine returns value in debt decimals)
            const maxBorrow = (pos.value > 0n && ltvBps)
              ? (pos.value * ltvBps) / 10000n
              : null;
            const utilPct = (maxBorrow && maxBorrow > 0n)
              ? Math.min(100, Number((pos.debt * 10000n) / maxBorrow) / 100)
              : 0;

            return (
              <div key={pos.marketId} className="card p-0 overflow-hidden">
                {/* Position header */}
                <div className="px-5 py-4 border-b border-ceitnot-border flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">
                      {market?.vaultSymbol ?? `Market #${pos.marketId}`}
                    </h3>
                    <span className="text-xs text-ceitnot-muted">Market #{pos.marketId}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      {market?.config.isFrozen
                        ? <span className="badge-frozen">Frozen</span>
                        : marketInactive
                        ? <span className="badge-inactive">Inactive</span>
                        : <span className="badge-active">Active</span>}
                      {market?.config.isIsolated && <span className="badge-isolated">Isolated</span>}
                    </div>
                  </div>
                </div>

                {/* Utilization bar */}
                {!!maxBorrow && maxBorrow > 0n && (
                  <div className="px-5 py-3 border-b border-ceitnot-border">
                    <div className="flex justify-between text-xs text-ceitnot-muted mb-1">
                      <span>LTV utilization</span>
                      <span className="font-mono text-ceitnot-ink">{utilPct.toFixed(1)}%  <span className="text-ceitnot-muted">of {ltv?.toFixed(0)}% max</span></span>
                    </div>
                    <div className="h-1.5 bg-ceitnot-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          utilPct > 90 ? 'bg-ceitnot-danger' : utilPct > 70 ? 'bg-ceitnot-warning' : 'bg-ceitnot-gold'
                        }`}
                        style={{ width: `${utilPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="px-5 py-4 grid grid-cols-3 gap-4 text-sm border-b border-ceitnot-border">
                  <div>
                    <p className="stat-label">Collateral Shares</p>
                    <p className="font-mono text-ceitnot-ink mt-1">
                      {formatWithDust(pos.shares, market?.vaultDecimals ?? 18, 4)}
                    </p>
                  </div>
                  <div>
                    <p className="stat-label">Collateral Value</p>
                    <p className="font-mono text-ceitnot-ink mt-1">{formatWithDust(pos.value, 18, 4)}</p>
                  </div>
                  <div>
                    <p className="stat-label">Outstanding Debt</p>
                    <p className={`font-mono mt-1 ${hasMeaningfulDebt(pos.debt) ? 'text-ceitnot-warning' : 'text-ceitnot-success'}`}>
                      {formatDebtDisplay(pos.debt)}
                    </p>
                  </div>
                </div>

                {enterBlockedReason && (
                  <div className="px-5 py-3 border-b border-ceitnot-border bg-ceitnot-warning/10">
                    <p className="text-xs text-ceitnot-warning whitespace-pre-wrap">{enterBlockedReason}</p>
                  </div>
                )}
                {/* Action buttons */}
                <div className="px-5 py-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => market?.config.vault && openMint(pos.marketId, market.config.vault)}
                    className="btn-ghost text-xs flex items-center gap-1.5 py-2 border border-ceitnot-border"
                    disabled={disableGetShares}
                    title={mintBlockedReason}
                  >
                    <Coins size={13} /> Get Shares
                  </button>
                  <button
                    onClick={() => openModal('deposit', pos.marketId)}
                    className={`${disableDeposit ? 'btn-secondary' : 'btn-primary'} text-xs flex items-center gap-1.5 py-2`}
                    disabled={disableDeposit}
                    title={sharedActionBlockedReason}
                  >
                    <PlusCircle size={13} /> Deposit
                  </button>
                  <button
                    onClick={() => openModal('withdraw', pos.marketId)}
                    className="btn-secondary text-xs flex items-center gap-1.5 py-2"
                    disabled={disableWithdraw}
                    title={inactiveMarketActionReason}
                  >
                    <MinusCircle size={13} /> Withdraw
                  </button>
                  <button
                    onClick={() => openModal('borrow', pos.marketId)}
                    className={`${disableBorrow ? 'btn-secondary' : 'btn-primary'} text-xs flex items-center gap-1.5 py-2`}
                    disabled={disableBorrow}
                    title={sharedActionBlockedReason}
                  >
                    <ArrowUpCircle size={13} /> Borrow
                  </button>
                  <button
                    onClick={() => openModal('repay', pos.marketId)}
                    className="btn-secondary text-xs flex items-center gap-1.5 py-2"
                    disabled={disableRepay}
                    title={inactiveMarketActionReason}
                  >
                    <ArrowDownCircle size={13} /> Repay
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        );
      })()}

      {/* Action modal */}
      {modal.open && (
        <ActionModal
          open
          action={modal.action}
          marketId={modal.marketId}
          vaultAddress={markets.find(m => m.id === modal.marketId)?.config.vault}
          debtTokenAddress={debtToken}
          sharesBalance={nonEmptyPositions.find(p => p.marketId === modal.marketId)?.shares}
          debtBalance={nonEmptyPositions.find(p => p.marketId === modal.marketId)?.debt}
          isolationBlockedReason={isolationBlockReasonFor(modal.action, modal.marketId)}
          onClose={closeModal}
          onSuccess={() => { closeModal(); refetch(); }}
        />
      )}

      {/* Mint shares modal */}
      {mintModal.open && (
        <MintSharesModal
          open
          marketId={mintModal.marketId}
          vaultAddress={mintModal.vaultAddress}
          onClose={closeMint}
          onSuccess={() => { closeMint(); refetch(); }}
        />
      )}
    </div>
  );
}

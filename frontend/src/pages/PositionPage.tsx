import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { usePosition } from '../hooks/usePosition';
import { useMarkets } from '../hooks/useMarkets';
import { useAdmin } from '../hooks/useAdmin';
import { formatWad, formatHf, parseHf, hfColor, hfBarColor, hfBarPct } from '../lib/utils';
import ActionModal, { type ActionType } from '../components/position/ActionModal';
import MintSharesModal from '../components/position/MintSharesModal';
import { Wallet, RefreshCw, PlusCircle, MinusCircle, ArrowUpCircle, ArrowDownCircle, Coins } from 'lucide-react';

type ModalState = { open: true; action: ActionType; marketId: number } | { open: false };
type MintState  = { open: true; marketId: number; vaultAddress: `0x${string}` } | { open: false };

export default function PositionPage() {
  const { address, isConnected } = useAccount();
  const { positions, healthFactor, refetch } = usePosition();
  const { markets } = useMarkets();
  const { debtToken } = useAdmin();
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [mintModal, setMintModal] = useState<MintState>({ open: false });

  const hf    = parseHf(healthFactor);
  const hfPct = hfBarPct(hf);

  const openModal = (action: ActionType, marketId: number) =>
    setModal({ open: true, action, marketId });
  const closeModal = () => setModal({ open: false });

  const openMint = (marketId: number, vaultAddress: `0x${string}`) =>
    setMintModal({ open: true, marketId, vaultAddress });
  const closeMint = () => setMintModal({ open: false });

  if (!isConnected) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm">
          <Wallet size={48} className="text-aura-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
          <p className="text-aura-muted text-sm mb-6">Connect to view and manage your positions.</p>
          <ConnectButton />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="page-title">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-aura-gold to-aura-accent">Position</span>
          </h1>
          <p className="page-subtitle text-xs font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</p>
        </div>
        <button onClick={refetch} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Global Health Factor */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="stat-label">Global Health Factor</span>
          <span className={`text-2xl font-bold font-mono ${hfColor(hf)}`}>
            {formatHf(healthFactor)}
          </span>
        </div>
        <div className="h-2 bg-aura-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${hfBarColor(hf)}`}
            style={{ width: `${hfPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-aura-muted mt-1.5">
          <span>Liquidation</span>
          <span>1.0</span>
          <span>1.5</span>
          <span>Safe ≥ 2.0</span>
        </div>
      </div>

      {/* No positions */}
      {positions.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-aura-muted">No active positions found.</p>
          <p className="text-xs text-aura-muted mt-1">Deposit collateral to open a position in a market.</p>
          <div className="flex justify-center gap-3 mt-5 flex-wrap">
            {markets.slice(0, 3).map(m => (
              <div key={m.id} className="flex gap-2">
                <button
                  onClick={() => openMint(m.id, m.config.vault)}
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  <Coins size={14} />
                  Get Shares #{m.id}
                </button>
                <button
                  onClick={() => openModal('deposit', m.id)}
                  className="btn-primary text-sm flex items-center gap-2"
                >
                  <PlusCircle size={14} />
                  Deposit #{m.id}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Position cards */}
      {positions.length > 0 && (
        <div className="space-y-4">
          {positions.map(pos => {
            const market = markets.find(m => m.id === pos.marketId);
            const ltvBps = market?.config.ltvBps;
            const ltv = ltvBps ? Number(ltvBps) / 100 : null;

            // Utilization: debt / (value * LTV)
            const maxBorrow = (pos.value > 0n && ltvBps)
              ? (pos.value * ltvBps) / 10000n
              : null;
            const utilPct = (maxBorrow && maxBorrow > 0n)
              ? Math.min(100, Number((pos.debt * 10000n) / maxBorrow) / 100)
              : 0;

            return (
              <div key={pos.marketId} className="card p-0 overflow-hidden">
                {/* Position header */}
                <div className="px-5 py-4 border-b border-aura-border flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">
                      {market?.vaultSymbol ?? `Market #${pos.marketId}`}
                    </h3>
                    <span className="text-xs text-aura-muted">Market #{pos.marketId}</span>
                  </div>
                  <div>
                    {market?.config.isFrozen
                      ? <span className="badge-frozen">Frozen</span>
                      : market?.config.isActive
                      ? <span className="badge-active">Active</span>
                      : <span className="badge-inactive">Inactive</span>}
                  </div>
                </div>

                {/* Utilization bar */}
                {!!maxBorrow && maxBorrow > 0n && (
                  <div className="px-5 py-3 border-b border-aura-border">
                    <div className="flex justify-between text-xs text-aura-muted mb-1">
                      <span>LTV utilization</span>
                      <span className="font-mono text-white">{utilPct.toFixed(1)}%  <span className="text-aura-muted">of {ltv?.toFixed(0)}% max</span></span>
                    </div>
                    <div className="h-1.5 bg-aura-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          utilPct > 90 ? 'bg-aura-danger' : utilPct > 70 ? 'bg-aura-warning' : 'bg-aura-gold'
                        }`}
                        style={{ width: `${utilPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="px-5 py-4 grid grid-cols-3 gap-4 text-sm border-b border-aura-border">
                  <div>
                    <p className="stat-label">Collateral Shares</p>
                    <p className="font-mono text-white mt-1">{formatWad(pos.shares, 4)}</p>
                  </div>
                  <div>
                    <p className="stat-label">Collateral Value</p>
                    <p className="font-mono text-white mt-1">{formatWad(pos.value, 4)}</p>
                  </div>
                  <div>
                    <p className="stat-label">Outstanding Debt</p>
                    <p className={`font-mono mt-1 ${pos.debt > 0n ? 'text-aura-warning' : 'text-aura-success'}`}>
                      {formatWad(pos.debt, 4)}
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="px-5 py-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => market?.config.vault && openMint(pos.marketId, market.config.vault)}
                    className="btn-ghost text-xs flex items-center gap-1.5 py-2 border border-aura-border"
                  >
                    <Coins size={13} /> Get Shares
                  </button>
                  <button
                    onClick={() => openModal('deposit', pos.marketId)}
                    className="btn-primary text-xs flex items-center gap-1.5 py-2"
                  >
                    <PlusCircle size={13} /> Deposit
                  </button>
                  <button
                    onClick={() => openModal('withdraw', pos.marketId)}
                    className="btn-secondary text-xs flex items-center gap-1.5 py-2"
                  >
                    <MinusCircle size={13} /> Withdraw
                  </button>
                  <button
                    onClick={() => openModal('borrow', pos.marketId)}
                    className="btn-primary text-xs flex items-center gap-1.5 py-2"
                    disabled={market?.config.isFrozen || !market?.config.isActive}
                  >
                    <ArrowUpCircle size={13} /> Borrow
                  </button>
                  <button
                    onClick={() => openModal('repay', pos.marketId)}
                    className="btn-secondary text-xs flex items-center gap-1.5 py-2"
                    disabled={pos.debt === 0n}
                  >
                    <ArrowDownCircle size={13} /> Repay
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action modal */}
      {modal.open && (
        <ActionModal
          open
          action={modal.action}
          marketId={modal.marketId}
          vaultAddress={markets.find(m => m.id === modal.marketId)?.config.vault}
          debtTokenAddress={debtToken}
          sharesBalance={positions.find(p => p.marketId === modal.marketId)?.shares}
          debtBalance={positions.find(p => p.marketId === modal.marketId)?.debt}
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

import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Wallet, ArrowRight, TrendingUp, Layers, DollarSign, Activity } from 'lucide-react';
import { useAdmin } from '../hooks/useAdmin';
import { useMarkets } from '../hooks/useMarkets';
import { formatWad, formatBps, formatAddress } from '../lib/utils';
import { useContractAddresses } from '../lib/contracts';

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: LucideIcon }) {
  return (
    <div className="stat-card hover:border-aura-border-2 transition-colors group">
      <div className="flex items-center justify-between mb-3">
        <span className="stat-label">{label}</span>
        <div className="p-2 rounded-lg bg-aura-gold/10 text-aura-gold group-hover:bg-aura-gold/20 transition-colors">
          <Icon size={14} />
        </div>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-xs text-aura-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { engine, registry } = useContractAddresses();
  const { markets, count, isLoading } = useMarkets();
  const { paused, emergencyShutdown, debtToken } = useAdmin();

  const totalDebt       = markets.reduce((s, m) => s + m.totalDebt, 0n);
  const totalCollateral = markets.reduce((s, m) => s + m.totalCollateral, 0n);
  const activeMarkets   = markets.filter(m => m.config.isActive).length;

  const configured = !!engine;

  return (
    <div className="page-container">
      {/* Protocol alerts */}
      {(paused || emergencyShutdown) && (
        <div className="mb-6 p-4 rounded-xl border border-aura-danger/40 bg-aura-danger/10 flex items-center gap-3">
          <Activity size={18} className="text-aura-danger shrink-0" />
          <p className="text-sm text-aura-danger font-medium">
            {emergencyShutdown ? 'Emergency shutdown active — borrows disabled.' : 'Protocol is paused.'}
          </p>
        </div>
      )}

      {/* Config missing banner */}
      {!configured && (
        <div className="mb-6 p-4 rounded-xl border border-aura-warning/30 bg-aura-warning/8">
          <p className="text-sm text-aura-warning font-medium mb-1">Contract addresses not configured</p>
          <p className="text-xs text-aura-muted">
            Set <code className="font-mono text-aura-warning/80">VITE_ENGINE_ADDRESS</code> and{' '}
            <code className="font-mono text-aura-warning/80">VITE_REGISTRY_ADDRESS</code> in your <code className="font-mono">.env</code> file.
          </p>
        </div>
      )}

      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-aura-gold to-aura-accent">
            Yield-Backed Credit
          </span>
        </h1>
        <p className="text-aura-muted-2 text-lg mt-3 max-w-2xl">
          Deposit ERC-4626 vault shares as collateral and borrow against them across isolated markets — without selling your yield.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <Link to="/position" className="btn-primary flex items-center gap-2">
            <Wallet size={16} /> Open Position
          </Link>
          <Link to="/markets" className="btn-secondary flex items-center gap-2">
            <BarChart3 size={16} /> View Markets
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Active Markets"   value={isLoading ? '…' : String(activeMarkets)}        sub={`${count} total`}                          icon={Layers} />
        <StatCard label="Total Collateral" value={isLoading ? '…' : formatWad(totalCollateral, 2)} sub="WAD (vault shares)"                         icon={TrendingUp} />
        <StatCard label="Total Borrows"    value={isLoading ? '…' : formatWad(totalDebt, 2)}       sub="WAD (debt tokens)"                         icon={DollarSign} />
        <StatCard label="Protocol"         value={paused ? 'Paused' : 'Active'}                    sub={emergencyShutdown ? 'Emergency shutdown' : 'All systems go'} icon={Activity} />
      </div>

      {/* Markets preview */}
      <div className="card">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-aura-border">
          <h2 className="font-semibold text-lg">Markets</h2>
          <Link to="/markets" className="flex items-center gap-1 text-sm text-aura-gold hover:text-aura-gold-bright transition-colors">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-aura-muted text-sm">Loading markets…</div>
        )}

        {!isLoading && markets.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-aura-muted text-sm">
              {configured ? 'No markets found. Check your registry address.' : 'Configure contract addresses to see markets.'}
            </p>
          </div>
        )}

        {markets.length > 0 && (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Market</th>
                <th className="table-th hidden sm:table-cell">LTV</th>
                <th className="table-th hidden md:table-cell">Liq. Threshold</th>
                <th className="table-th text-right">Total Debt</th>
                <th className="table-th text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {markets.slice(0, 5).map(m => (
                <tr key={m.id} className="table-row">
                  <td className="table-td">
                    <div>
                      <span className="font-medium">{m.vaultSymbol ?? `Market #${m.id}`}</span>
                      <span className="ml-2 text-xs text-aura-muted">#{m.id}</span>
                    </div>
                    <div className="text-xs text-aura-muted font-mono mt-0.5">
                      {formatAddress(m.config.vault)}
                    </div>
                  </td>
                  <td className="table-td hidden sm:table-cell text-aura-muted-2 font-mono">
                    {formatBps(m.config.ltvBps)}
                  </td>
                  <td className="table-td hidden md:table-cell text-aura-muted-2 font-mono">
                    {formatBps(m.config.liquidationThresholdBps)}
                  </td>
                  <td className="table-td text-right font-mono text-sm">
                    {formatWad(m.totalDebt, 2)}
                  </td>
                  <td className="table-td text-right">
                    {m.config.isFrozen
                      ? <span className="badge-frozen">Frozen</span>
                      : m.config.isActive
                      ? <span className="badge-active">Active</span>
                      : <span className="badge-inactive">Inactive</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer info */}
      <div className="mt-8 grid sm:grid-cols-3 gap-4 text-xs text-aura-muted">
        {engine && (
          <div>
            <span className="text-aura-muted-2 uppercase tracking-wider">Engine</span>
            <p className="font-mono mt-0.5">{formatAddress(engine)}</p>
          </div>
        )}
        {registry && (
          <div>
            <span className="text-aura-muted-2 uppercase tracking-wider">Registry</span>
            <p className="font-mono mt-0.5">{formatAddress(registry)}</p>
          </div>
        )}
        {debtToken && (
          <div>
            <span className="text-aura-muted-2 uppercase tracking-wider">Debt Token</span>
            <p className="font-mono mt-0.5">{formatAddress(debtToken)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

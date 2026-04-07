import { Link } from 'react-router-dom';
import { useMarkets } from '../hooks/useMarkets';
import { useContractAddresses } from '../lib/contracts';
import { formatWad, formatBps, formatRate, formatAddress } from '../lib/utils';
import { TrendingUp, RefreshCw } from 'lucide-react';

function MarketCard({ market }: { market: ReturnType<typeof useMarkets>['markets'][number] }) {
  const { id, config, totalDebt, totalCollateral, vaultSymbol } = market;

  const utilPct = config.borrowCap > 0n
    ? Number((totalDebt * 10000n) / config.borrowCap) / 100
    : 0;

  return (
    <div className="card p-0 overflow-hidden hover:border-ceitnot-border-2 transition-all group">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-ceitnot-border flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-ceitnot-gold/15 flex items-center justify-center text-ceitnot-gold text-xs font-bold">
              {id}
            </div>
            <div>
              <h3 className="font-semibold">{vaultSymbol ?? `Market #${id}`}</h3>
              <p className="text-xs text-ceitnot-muted font-mono">{formatAddress(config.vault)}</p>
            </div>
          </div>
        </div>
        <div>
          {config.isFrozen
            ? <span className="badge-frozen">Frozen</span>
            : config.isActive
            ? <span className="badge-active">Active</span>
            : <span className="badge-inactive">Inactive</span>}
          {config.isIsolated && <span className="badge-isolated ml-1">Isolated</span>}
        </div>
      </div>

      {/* Borrow utilization bar */}
      <div className="px-5 py-3 border-b border-ceitnot-border">
        <div className="flex justify-between text-xs text-ceitnot-muted mb-1.5">
          <span>Borrow utilization</span>
          <span className="font-mono text-ceitnot-ink">{utilPct.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-ceitnot-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              utilPct > 90 ? 'bg-ceitnot-danger' : utilPct > 70 ? 'bg-ceitnot-warning' : 'bg-ceitnot-gold'
            }`}
            style={{ width: `${Math.min(100, utilPct)}%` }}
          />
        </div>
      </div>

      {/* Params grid */}
      <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="LTV"                  value={formatBps(config.ltvBps)} />
        <Row label="Liq. Threshold"       value={formatBps(config.liquidationThresholdBps)} />
        <Row label="Liq. Penalty"         value={formatBps(config.liquidationPenaltyBps)} />
        <Row label="Base Rate"            value={formatRate(config.baseRate)} />
        <Row label="Slope 1"              value={formatRate(config.slope1)} />
        <Row label="Kink"                 value={formatRate(config.kink)} />
        <Row label="Reserve Factor"       value={formatBps(config.reserveFactorBps)} />
        <Row label="Origination Fee"      value={formatBps(config.originationFeeBps)} />
        <Row label="Total Collateral"     value={formatWad(totalCollateral, 2)} />
        <Row label="Total Debt"           value={formatWad(totalDebt, 2)} />
        <Row label="Borrow Cap"           value={config.borrowCap === 0n ? 'Unlimited' : formatWad(config.borrowCap, 2)} />
        <Row label="Supply Cap"           value={config.supplyCap === 0n ? 'Unlimited' : formatWad(config.supplyCap, 2)} />
        {config.dutchAuctionEnabled && (
          <Row label="Auction Duration" value={`${config.auctionDuration}s`} />
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-3 border-t border-ceitnot-border">
        <Link
          to="/position"
          className="block text-center text-sm font-medium text-ceitnot-gold hover:text-ceitnot-gold-bright transition-colors"
        >
          Open Position →
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ceitnot-muted">{label}</p>
      <p className="font-mono text-ceitnot-ink mt-0.5">{value}</p>
    </div>
  );
}

export default function MarketsPage() {
  const { registry, engine, isLoading: addressesLoading } = useContractAddresses();
  const { markets, count, isLoading, refetch } = useMarkets();
  const addressesReady = !!registry;
  const configuredForMarkets = !!(registry && engine);

  return (
    <div className="page-container">
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="page-title">
            <span className="page-title-accent">Markets</span>
          </h1>
          <p className="page-subtitle">{count} market{count !== 1 ? 's' : ''} on the protocol</p>
        </div>
        <button onClick={refetch} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {(addressesLoading || isLoading) && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-5 w-32" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!addressesLoading && !isLoading && markets.length === 0 && (
        <div className="card p-12 text-center">
          <TrendingUp size={40} className="text-ceitnot-muted mx-auto mb-3" />
          <p className="text-ceitnot-muted">
            {!addressesReady
              ? 'Registry address not available yet.'
              : !configuredForMarkets
              ? 'Engine or registry address missing.'
              : count === 0
              ? 'No markets on this registry yet.'
              : 'Could not load market data (check RPC or chain).'}
          </p>
          {(!addressesReady || !configuredForMarkets) && (
            <p className="text-xs text-ceitnot-muted mt-1">
              Set <code className="font-mono">VITE_ENGINE_ADDRESS</code> and{' '}
              <code className="font-mono">VITE_REGISTRY_ADDRESS</code> for the build (e.g. in Vercel env), then redeploy.
            </p>
          )}
        </div>
      )}

      {!isLoading && markets.length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {markets.map(m => <MarketCard key={m.id} market={m} />)}
        </div>
      )}
    </div>
  );
}

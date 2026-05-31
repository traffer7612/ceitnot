import { Link } from 'react-router-dom';
import { useMarkets } from '../hooks/useMarkets';
import { useContractAddresses } from '../lib/contracts';
import { formatWad, formatBps, formatRate, formatAddress, formatToken, formatRateApr } from '../lib/utils';
import { TrendingUp, RefreshCw } from 'lucide-react';
const IRM_PER_SECOND_MAX = 10n ** 24n;

function MarketCard({ market }: { market: ReturnType<typeof useMarkets>['markets'][number] }) {
  const { id, config, totalDebt, totalCollateral, vaultSymbol, vaultDecimals } = market;
  const marketInactive = !config.isActive || config.isIsolated;
  const irmUsesPerSecondRates = [config.baseRate, config.slope1, config.slope2]
    .some(v => v > 0n && v < IRM_PER_SECOND_MAX);
  const formatIrmRate = (v: bigint) => irmUsesPerSecondRates ? formatRateApr(v) : formatRate(v);

  /** Share of market borrow cap used. When cap is 0 = unlimited, there is no percentage — do not show 0% (misleading). */
  const capUnlimited = config.borrowCap === 0n;
  const utilPct = !capUnlimited
    ? Number((totalDebt * 10000n) / config.borrowCap) / 100
    : null;

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
            : marketInactive
            ? <span className="badge-inactive">Inactive</span>
            : <span className="badge-active">Active</span>}
          {config.isIsolated && <span className="badge-isolated ml-1">Isolated</span>}
        </div>
      </div>

      {/* Borrow cap utilization (debt / borrowCap); not LTV and not “pool” utilization */}
      <div className="px-5 py-3 border-b border-ceitnot-border">
        <div className="flex justify-between text-xs text-ceitnot-muted mb-1.5">
          <span title="Outstanding market debt as a share of the borrow cap. If the cap is unlimited, no percentage applies.">
            Borrow cap usage
          </span>
          <span className="font-mono text-ceitnot-ink">
            {capUnlimited ? '— (no cap)' : `${utilPct!.toFixed(1)}%`}
          </span>
        </div>
        <div className="h-1.5 bg-ceitnot-border rounded-full overflow-hidden">
          {!capUnlimited && (
            <div
              className={`h-full rounded-full transition-all ${
                utilPct! > 90 ? 'bg-ceitnot-danger' : utilPct! > 70 ? 'bg-ceitnot-warning' : 'bg-ceitnot-gold'
              }`}
              style={{ width: `${Math.min(100, utilPct!)}%` }}
            />
          )}
        </div>
      </div>

      {/* Params grid */}
      <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label="LTV"                  value={formatBps(config.ltvBps)} />
        <Row label="Liq. Threshold"       value={formatBps(config.liquidationThresholdBps)} />
        <Row label="Liq. Penalty"         value={formatBps(config.liquidationPenaltyBps)} />
        <Row label="Base Rate"            value={formatIrmRate(config.baseRate)} />
        <Row label="Slope 1"              value={formatIrmRate(config.slope1)} />
        <Row label="Kink"                 value={formatRate(config.kink)} />
        <Row label="Reserve Factor"       value={formatBps(config.reserveFactorBps)} />
        <Row label="Origination Fee"      value={formatBps(config.originationFeeBps)} />
        <Row label="Total Collateral"     value={formatToken(totalCollateral, vaultDecimals ?? 18, 2)} />
        <Row label="Total Debt"           value={formatWad(totalDebt, 2)} />
        <Row label="Borrow Cap"           value={config.borrowCap === 0n ? 'Unlimited' : formatWad(config.borrowCap, 2)} />
        <Row label="Supply Cap"           value={config.supplyCap === 0n ? 'Unlimited' : formatToken(config.supplyCap, vaultDecimals ?? 18, 2)} />
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
  const { markets, browseMarkets, count, isLoading, refetch } = useMarkets();
  const addressesReady = !!registry;
  const configuredForMarkets = !!(registry && engine);

  return (
    <div className="page-container">
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="page-title">
            <span className="page-title-accent">Markets</span>
          </h1>
          <p className="page-subtitle">
            {browseMarkets.length} market{browseMarkets.length !== 1 ? 's' : ''} listed
            {browseMarkets.length < count && (
              <span className="text-ceitnot-muted"> ({count} on-chain)</span>
            )}
          </p>
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

      {!isLoading && markets.length > 0 && browseMarkets.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-ceitnot-muted text-sm">
            All markets are inactive, frozen, or hidden. Adjust{' '}
            <code className="font-mono">VITE_HIDDEN_MARKET_IDS</code> or registry state to list markets here.
          </p>
        </div>
      )}

      {!isLoading && browseMarkets.length > 0 && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {browseMarkets.map(m => <MarketCard key={m.id} market={m} />)}
        </div>
      )}
    </div>
  );
}

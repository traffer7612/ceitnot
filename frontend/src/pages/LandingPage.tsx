import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Shield, Wallet, TrendingUp, Vote, Coins, ExternalLink, Users } from 'lucide-react';
import { TARGET_CHAIN_ID, LANDING_STATS_CHAIN_ID, viteAddress, viteAddressLegacy } from '../lib/chainEnv';
import { usePublicStats } from '../hooks/usePublicStats';
import { blockExplorerAddressUrl } from '../lib/explorer';
import {
  DOCS_TREE_URL,
  DOC_TOKENOMICS_CHECKLIST_URL,
  DOC_PRODUCTION_ADDRESSES_URL,
} from '../lib/publicDocs';

const TIMELOCK_ENV = import.meta.env.VITE_TIMELOCK_ADDRESS as string | undefined;
const GOVERNANCE_TOKEN_ADDRESS = viteAddress(import.meta.env.VITE_GOVERNANCE_TOKEN_ADDRESS as string | undefined);
const CEITUSD_TOKEN_ADDRESS =
  viteAddress(import.meta.env.VITE_CEITUSD_ADDRESS as string | undefined)
  ?? viteAddressLegacy(
    import.meta.env.VITE_AUSD_ADDRESS as string | undefined,
    import.meta.env.VITE_DEBT_TOKEN_ADDRESS as string | undefined,
  );

const CHART_BARS = [38, 62, 48, 78, 55, 88, 68, 82, 58, 92, 72, 85];

const CHART_WIDTH = 400;
const CHART_HEIGHT = 115;
const PADDING = { top: 26, right: 16, bottom: 22, left: 38 };
const PLOT_W = CHART_WIDTH - PADDING.left - PADDING.right;
const PLOT_H = CHART_HEIGHT - PADDING.top - PADDING.bottom;

/** Smooth path through points (Catmull-Rom style cubic Bezier) */
function smoothPathD(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  const p = (i: number) => points[Math.max(0, Math.min(i, points.length - 1))];
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

function useLineChartData() {
  const gen = () => Array.from({ length: 10 }, () => 20 + Math.round(Math.random() * 75));
  const [values, setValues] = useState(() => gen());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setValues(gen());
      setVersion((v) => v + 1);
    }, 4000);
    return () => clearInterval(t);
  }, []);
  return { values, version };
}

function LineChartSvg() {
  const { values, version } = useLineChartData();
  const points = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values.map((v, i) => {
      const x = PADDING.left + (i / (values.length - 1)) * PLOT_W;
      const y = PADDING.top + PLOT_H - ((v - min) / range) * PLOT_H * 0.85 - PLOT_H * 0.05;
      return { x, y, value: v };
    });
  }, [values]);

  const pathD = useMemo(() => smoothPathD(points), [points]);
  const areaD = useMemo(() => {
    const first = points[0];
    const last = points[points.length - 1];
    const bottom = PADDING.top + PLOT_H;
    return `${pathD} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
  }, [pathD, points]);

  const yTicks = [0, 25, 50, 75, 100];
  const xLabels = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10'];

  return (
    <svg className="w-full h-full lp-line-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} fill="none" overflow="visible">
      <defs>
        <linearGradient id="lpLineFill" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#2dd4bf" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#8b5cf6" stopOpacity="0.14" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lpLineStroke" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#14b8a6" />
          <stop offset="0.45" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* Ось Y: линия и подписи по одной вертикали */}
      <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={PADDING.top + PLOT_H} className="stroke-ceitnot-border" strokeWidth="1" />
      {yTicks.map((tick) => {
        const y = PADDING.top + PLOT_H - (tick / 100) * PLOT_H;
        return (
          <g key={tick}>
            <line x1={PADDING.left} y1={y} x2={PADDING.left + PLOT_W} y2={y} className="stroke-ceitnot-border/50" strokeWidth="0.5" strokeDasharray="4 4" strokeLinecap="round" />
            <text x={PADDING.left - 10} y={y} textAnchor="end" dominantBaseline="middle" className="lp-axis-text fill-ceitnot-muted-2" fontSize="11">
              {tick}%
            </text>
          </g>
        );
      })}
      {/* X-axis labels */}
      {points.map((p, i) => (
        <text key={`x-${i}`} x={p.x} y={CHART_HEIGHT - 4} textAnchor="middle" className="lp-axis-text fill-ceitnot-muted" fontSize="9">
          {xLabels[i]}
        </text>
      ))}
      {/* Area & line */}
      <path d={areaD} fill="url(#lpLineFill)" className="lp-area lp-area-morph" />
      <path key={version} d={pathD} stroke="url(#lpLineStroke)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="lp-line lp-line-redraw" />
      {/* Value labels on points — выше точки, если точка низко; иначе ниже, чтобы не обрезало */}
      {points.map((p, i) => {
        const labelAbove = p.y > PADDING.top + 20;
        const labelY = labelAbove ? p.y - 10 : p.y + 14;
        return (
          <g key={`v-${version}-${i}`}>
            <circle cx={p.x} cy={p.y} r="4" className="fill-ceitnot-gold stroke-ceitnot-bg stroke-[2]" />
            <text x={p.x} y={labelY} textAnchor="middle" className="lp-value-text fill-ceitnot-gold" fontSize="11" fontWeight="600">
              {p.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ProtocolUsersLine() {
  const { uniqueUsers, loading } = usePublicStats(LANDING_STATS_CHAIN_ID);
  return (
    <div
      className="mb-8 mx-auto max-w-lg rounded-xl border border-ceitnot-border bg-ceitnot-surface/60 px-4 py-3 shadow-sm"
      role="region"
      aria-label="Protocol usage stats"
    >
      <p className="text-[11px] uppercase tracking-wide text-ceitnot-muted text-center mb-1.5">On-chain activity</p>
      <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-ceitnot-muted">
        <Users size={16} className="text-ceitnot-gold shrink-0" aria-hidden />
        {loading ? (
          <span className="animate-pulse">Loading community stats…</span>
        ) : uniqueUsers !== null ? (
          <>
            <span className="font-semibold text-ceitnot-ink tabular-nums">{uniqueUsers.toLocaleString()}</span>
            <span className="text-ceitnot-muted-2">unique wallets have interacted with the protocol</span>
          </>
        ) : (
          <span className="text-ceitnot-muted-2 max-w-md text-center">
            Live wallet count isn&apos;t available right now—check stats API config on Railway (
            <code className="font-mono text-[11px] px-1 rounded bg-ceitnot-surface-2">CEITNOT_ENGINE_ADDRESS</code>,{' '}
            <code className="font-mono text-[11px] px-1 rounded bg-ceitnot-surface-2">CEITNOT_ENGINE_DEPLOY_BLOCK</code>,{' '}
            <code className="font-mono text-[11px] px-1 rounded bg-ceitnot-surface-2">ARBITRUM_RPC_URL</code>).
          </span>
        )}
      </p>
    </div>
  );
}

export default function LandingPage() {
  const govTokenExplorer = GOVERNANCE_TOKEN_ADDRESS
    ? blockExplorerAddressUrl(TARGET_CHAIN_ID, GOVERNANCE_TOKEN_ADDRESS)
    : null;
  const ceitusdExplorer = CEITUSD_TOKEN_ADDRESS
    ? blockExplorerAddressUrl(TARGET_CHAIN_ID, CEITUSD_TOKEN_ADDRESS)
    : null;

  return (
    <div className="min-h-screen text-ceitnot-ink landing-pg bg-transparent">
      {/* Hero — анимация появления */}
      <section className="relative px-4 pt-24 pb-20 sm:pt-32 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-500/12 via-teal-500/8 to-transparent pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h1 className="lp-hero-title text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ceitnot-ink mb-6">
            DeFi lending.
            <br />
            <span className="page-title-accent">On your terms.</span>
          </h1>
          <p className="lp-hero-sub text-lg text-ceitnot-ink/90 mb-6 max-w-xl mx-auto leading-relaxed">
            Deposit collateral. Borrow stablecoins. Everything on-chain, non-custodial.
          </p>
          <ProtocolUsersLine />
          <Link
            to="/dashboard"
            className="lp-hero-cta inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold bg-ceitnot-gold text-ceitnot-on-primary hover:bg-ceitnot-gold-bright transition-all hover:opacity-95"
            style={{ boxShadow: 'var(--ceitnot-shadow-primary)' }}
          >
            Open app
            <ArrowRight size={18} />
          </Link>
        </div>
        <p className="lp-hero-badge text-center text-ceitnot-muted text-sm mt-10">Arbitrum · Base · Sepolia testnet</p>
      </section>

      {/* Графики — столбцы + линия */}
      <section className="px-4 py-16 sm:py-20 border-t border-ceitnot-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="lp-fade text-xl font-bold text-center mb-1 text-ceitnot-ink">Protocol metrics</h2>
          <p className="lp-fade text-sm text-center mb-10 text-ceitnot-muted-2">TVL & growth</p>
          <div className="lp-chart-row group flex items-end justify-center gap-2 h-40 mb-14">
            {CHART_BARS.map((h, i) => (
              <div
                key={i}
                className="lp-bar rounded-t min-w-[28px] max-w-[40px] flex-1 cursor-pointer transition-all duration-300 ease-out"
                style={{ height: `${h}%`, animationDelay: `${0.05 * i}s` }}
                title={`${h}%`}
              >
                <span className="lp-bar-value absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded text-xs font-medium bg-ceitnot-surface-2 text-ceitnot-gold border border-ceitnot-border whitespace-nowrap shadow-lg">
                  {h}%
                </span>
              </div>
            ))}
          </div>
          <div className="lp-line-wrap h-44 sm:h-48 cursor-crosshair">
            <LineChartSvg />
          </div>
        </div>
      </section>

      {/* How it works — карточки с анимацией */}
      <section className="px-4 py-20 border-t border-ceitnot-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="lp-fade text-2xl font-bold text-center mb-12 text-ceitnot-ink">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { Icon: Wallet, title: '1. Deposit', text: 'Lock vault shares (e.g. wstETH) as collateral in the protocol.' },
              { Icon: TrendingUp, title: '2. Borrow', text: 'Borrow stablecoins against your collateral. Rates and limits are on-chain.' },
              { Icon: Shield, title: '3. Manage', text: 'Repay, add collateral, or withdraw. Smart contract enforces the rules.' },
            ].map((item, i) => (
              <div key={item.title} className="lp-step text-center" style={{ animationDelay: `${0.12 * i}s` }}>
                <div className="w-14 h-14 rounded-2xl bg-ceitnot-gold/10 flex items-center justify-center text-ceitnot-gold mx-auto mb-4">
                  <item.Icon size={28} />
                </div>
                <h3 className="font-semibold text-ceitnot-ink mb-2">{item.title}</h3>
                <p className="text-sm text-ceitnot-muted-2 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Beginner visual guide: Yield Siphon + Death Spiral */}
      <section className="px-4 py-20 border-t border-ceitnot-border bg-ceitnot-surface/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-ceitnot-ink mb-3">
            Beginner guide: Yield Siphon in diagrams
          </h2>
          <p className="text-sm text-center text-ceitnot-muted-2 max-w-3xl mx-auto mb-12 leading-relaxed">
            Yield Siphon is not magic auto-repay every second. A keeper bot triggers harvest, the protocol converts vault yield into debt value, and your debt goes down through a global scale update.
          </p>

          <div className="rounded-2xl border border-ceitnot-border bg-ceitnot-surface p-5 sm:p-6 mb-8">
            <h3 className="text-base font-semibold text-ceitnot-ink mb-4">Flow diagram (simple)</h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center">
              <div className="rounded-xl border border-ceitnot-border bg-ceitnot-surface-2 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-ceitnot-muted">Step 1</p>
                <p className="text-sm font-medium text-ceitnot-ink mt-1">User deposits collateral</p>
                <p className="text-xs text-ceitnot-muted-2 mt-1">Example: $1,000 in vault shares</p>
              </div>
              <p className="hidden sm:block text-ceitnot-gold text-center">→</p>
              <div className="rounded-xl border border-ceitnot-border bg-ceitnot-surface-2 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-ceitnot-muted">Step 2</p>
                <p className="text-sm font-medium text-ceitnot-ink mt-1">User borrows stablecoin</p>
                <p className="text-xs text-ceitnot-muted-2 mt-1">Example: debt = $600</p>
              </div>
              <p className="hidden sm:block text-ceitnot-gold text-center">→</p>
              <div className="rounded-xl border border-ceitnot-border bg-ceitnot-surface-2 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-ceitnot-muted">Step 3</p>
                <p className="text-sm font-medium text-ceitnot-ink mt-1">Keeper calls harvest</p>
                <p className="text-xs text-ceitnot-muted-2 mt-1">`harvestYield(marketId)`</p>
              </div>
              <p className="hidden sm:block text-ceitnot-gold text-center">→</p>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-200">Step 4</p>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-100 mt-1">Debt decreases globally</p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-200/80 mt-1">Example: $600 → $573</p>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mb-8">
            <div className="rounded-2xl border border-ceitnot-border bg-ceitnot-surface p-5">
              <p className="text-xs uppercase tracking-wide text-ceitnot-muted">Role</p>
              <h3 className="font-semibold text-ceitnot-ink mt-1 mb-2">Borrower (you)</h3>
              <p className="text-sm text-ceitnot-muted-2 leading-relaxed">
                Deposits collateral and borrows stablecoins. Debt can go down after each successful harvest.
              </p>
            </div>
            <div className="rounded-2xl border border-ceitnot-border bg-ceitnot-surface p-5">
              <p className="text-xs uppercase tracking-wide text-ceitnot-muted">Role</p>
              <h3 className="font-semibold text-ceitnot-ink mt-1 mb-2">Keeper bot</h3>
              <p className="text-sm text-ceitnot-muted-2 leading-relaxed">
                Sends transactions that trigger harvest on schedule. Without keeper calls, yield is not applied to debt.
              </p>
            </div>
            <div className="rounded-2xl border border-ceitnot-border bg-ceitnot-surface p-5">
              <p className="text-xs uppercase tracking-wide text-ceitnot-muted">Role</p>
              <h3 className="font-semibold text-ceitnot-ink mt-1 mb-2">Liquidator</h3>
              <p className="text-sm text-ceitnot-muted-2 leading-relaxed">
                Steps in when health factor is below 1. Repays risky debt and receives collateral with penalty incentives.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-ceitnot-border bg-ceitnot-surface p-5 sm:p-6">
            <h3 className="text-base font-semibold text-ceitnot-ink mb-4">Scenario diagram with numbers</h3>
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-200">Bull market</p>
                <p className="text-sm text-emerald-800 dark:text-emerald-100 mt-2">Collateral: $1,000 → $1,120</p>
                <p className="text-sm text-emerald-800 dark:text-emerald-100">Debt: $600 → $565 (yield + harvest)</p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-200/80 mt-2">Result: position gets safer over time.</p>
              </div>
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-sky-700 dark:text-sky-200">Flat market</p>
                <p className="text-sm text-sky-800 dark:text-sky-100 mt-2">Collateral: $1,000 → $1,000</p>
                <p className="text-sm text-sky-800 dark:text-sky-100">Debt: $600 → $582 (yield only)</p>
                <p className="text-xs text-sky-700/80 dark:text-sky-200/80 mt-2">Result: slow auto-repay if keeper keeps harvesting.</p>
              </div>
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                <p className="text-xs uppercase tracking-wide text-rose-700 dark:text-rose-200">Crash market (death spiral risk)</p>
                <p className="text-sm text-rose-800 dark:text-rose-100 mt-2">Collateral: $1,000 → $700</p>
                <p className="text-sm text-rose-800 dark:text-rose-100">Debt: $600 → $590 (yield too slow)</p>
                <p className="text-xs text-rose-700/80 dark:text-rose-200/80 mt-2">Result: liquidation may trigger before yield can save the position.</p>
              </div>
            </div>
            <p className="mt-5 text-xs sm:text-sm text-ceitnot-muted-2 leading-relaxed">
              Key idea: Yield Siphon improves outcomes, but liquidations are still the main safety mechanism when collateral price drops too fast.
            </p>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="lp-fade px-4 py-12 border-t border-ceitnot-border bg-ceitnot-surface/40">
        <div className="max-w-3xl mx-auto flex flex-wrap justify-center gap-x-12 gap-y-4 text-ceitnot-muted-2 text-sm">
          <span className="flex items-center gap-2"><Lock size={16} className="text-ceitnot-gold" /> Non-custodial</span>
          <span className="flex items-center gap-2"><Shield size={16} className="text-ceitnot-gold" /> On-chain execution</span>
        </div>
        {TIMELOCK_ENV && (
          <p className="max-w-xl mx-auto mt-8 text-center text-xs sm:text-sm text-ceitnot-muted-2 leading-relaxed px-2">
            Protocol administration is handled by the{' '}
            <span className="text-ceitnot-ink/90 font-medium">Timelock</span> contract (not a personal EOA). Changes go through{' '}
            <Link to="/governance" className="text-ceitnot-gold hover:underline font-medium">
              governance
            </Link>
            {blockExplorerAddressUrl(TARGET_CHAIN_ID, TIMELOCK_ENV) && (
              <>
                {' '}
                <a
                  href={blockExplorerAddressUrl(TARGET_CHAIN_ID, TIMELOCK_ENV)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-ceitnot-gold hover:underline font-medium"
                >
                  Timelock on explorer
                  <ExternalLink size={12} className="opacity-80 shrink-0" aria-hidden />
                </a>
              </>
            )}
            .
          </p>
        )}
        <p className="max-w-xl mx-auto mt-6 text-center text-xs text-ceitnot-muted px-2">
          <a
            href={DOCS_TREE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-ceitnot-gold hover:underline font-medium"
          >
            Documentation
            <ExternalLink size={12} className="opacity-80 shrink-0" aria-hidden />
          </a>
          <span className="text-ceitnot-border mx-2">·</span>
          <a
            href={DOC_TOKENOMICS_CHECKLIST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ceitnot-gold hover:underline font-medium"
          >
            Go-live checklist
          </a>
          <span className="text-ceitnot-border mx-2">·</span>
          <a
            href={DOC_PRODUCTION_ADDRESSES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ceitnot-gold hover:underline font-medium"
          >
            Arbitrum contracts
          </a>
        </p>
      </section>

      {/* CEITNOT token */}
      <section className="px-4 py-20 border-t border-ceitnot-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="lp-fade text-2xl font-bold text-center mb-3 text-ceitnot-ink">CEITNOT token</h2>
          <p className="lp-fade text-ceitnot-muted-2 text-center text-sm mb-12 max-w-md mx-auto">Governance and revenue sharing. Lock CEITNOT → veCEITNOT → vote and earn.</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { Icon: Vote, title: 'Governance', text: 'Vote on proposals with veCEITNOT.' },
              { Icon: Coins, title: 'Revenue share', text: 'Earn from protocol fees.' },
              { Icon: Lock, title: 'Lock & stake', text: 'Lock CEITNOT for voting power.' },
            ].map((item, i) => (
              <div key={item.title} className="lp-token p-5 rounded-2xl bg-ceitnot-surface border border-ceitnot-border hover:border-ceitnot-gold/25 transition-colors" style={{ animationDelay: `${0.1 * i}s` }}>
                <item.Icon size={22} className="text-ceitnot-gold mb-3" />
                <h3 className="font-semibold text-ceitnot-ink mb-1">{item.title}</h3>
                <p className="text-xs text-ceitnot-muted-2">{item.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-2xl border border-ceitnot-border bg-ceitnot-surface p-5">
            <h3 className="text-sm font-semibold text-ceitnot-ink mb-3">Canonical token references</h3>
            <div className="space-y-2 text-xs sm:text-sm text-ceitnot-muted-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ceitnot-ink font-medium">Governance token symbol:</span>
                <code className="px-2 py-0.5 rounded bg-ceitnot-surface-2 border border-ceitnot-border">CEITNOT</code>
                {GOVERNANCE_TOKEN_ADDRESS && (
                  <>
                    <span className="text-ceitnot-ink font-medium">address:</span>
                    {govTokenExplorer ? (
                      <a href={govTokenExplorer} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ceitnot-gold hover:underline font-medium">
                        {GOVERNANCE_TOKEN_ADDRESS}
                        <ExternalLink size={12} className="opacity-80 shrink-0" aria-hidden />
                      </a>
                    ) : (
                      <code className="px-2 py-0.5 rounded bg-ceitnot-surface-2 border border-ceitnot-border">{GOVERNANCE_TOKEN_ADDRESS}</code>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-ceitnot-ink font-medium">Stable token symbol:</span>
                <code className="px-2 py-0.5 rounded bg-ceitnot-surface-2 border border-ceitnot-border">ceitUSD</code>
                {CEITUSD_TOKEN_ADDRESS && (
                  <>
                    <span className="text-ceitnot-ink font-medium">address:</span>
                    {ceitusdExplorer ? (
                      <a href={ceitusdExplorer} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ceitnot-gold hover:underline font-medium">
                        {CEITUSD_TOKEN_ADDRESS}
                        <ExternalLink size={12} className="opacity-80 shrink-0" aria-hidden />
                      </a>
                    ) : (
                      <code className="px-2 py-0.5 rounded bg-ceitnot-surface-2 border border-ceitnot-border">{CEITUSD_TOKEN_ADDRESS}</code>
                    )}
                  </>
                )}
              </div>
              <p>
                Full canonical address list:{' '}
                <a href={DOC_PRODUCTION_ADDRESSES_URL} target="_blank" rel="noopener noreferrer" className="text-ceitnot-gold hover:underline font-medium">
                  Arbitrum production addresses
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ — naming and contract identity */}
      <section className="px-4 py-16 border-t border-ceitnot-border bg-ceitnot-surface/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-ceitnot-ink text-center mb-10">FAQ</h2>
          <div className="space-y-4">
            <details className="rounded-xl border border-ceitnot-border bg-ceitnot-surface p-4">
              <summary className="cursor-pointer font-medium text-ceitnot-ink">Why can token name in wallet/explorer differ from current brand?</summary>
              <p className="mt-3 text-sm text-ceitnot-muted-2 leading-relaxed">
                Some contracts were deployed before the latest branding update. The protocol uses canonical contract
                addresses and symbols published in official docs. Treat contract address as the source of truth.
              </p>
            </details>
            <details className="rounded-xl border border-ceitnot-border bg-ceitnot-surface p-4">
              <summary className="cursor-pointer font-medium text-ceitnot-ink">How do I verify official token addresses?</summary>
              <p className="mt-3 text-sm text-ceitnot-muted-2 leading-relaxed">
                Use the production address table in docs and cross-check on Arbiscan before any transfer, approval,
                or governance action.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-24 border-t border-ceitnot-border">
        <div className="max-w-xl mx-auto text-center">
          <p className="lp-fade text-ceitnot-muted-2 mb-6">Ready to use the protocol?</p>
          <Link
            to="/dashboard"
            className="lp-fade inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold bg-ceitnot-gold text-ceitnot-on-primary hover:bg-ceitnot-gold-bright transition-all hover:opacity-95"
            style={{ boxShadow: 'var(--ceitnot-shadow-primary)' }}
          >
            Open app
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Shield, Wallet, TrendingUp, Vote, Coins } from 'lucide-react';

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
          <stop stopColor="#d4a853" stopOpacity="0.35" />
          <stop offset="1" stopColor="#d4a853" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lpLineStroke" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#9a7b3a" />
          <stop offset="0.5" stopColor="#d4a853" />
          <stop offset="1" stopColor="#e8c070" />
        </linearGradient>
      </defs>
      {/* Ось Y: линия и подписи по одной вертикали */}
      <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={PADDING.top + PLOT_H} className="stroke-aura-border" strokeWidth="1" />
      {yTicks.map((tick) => {
        const y = PADDING.top + PLOT_H - (tick / 100) * PLOT_H;
        return (
          <g key={tick}>
            <line x1={PADDING.left} y1={y} x2={PADDING.left + PLOT_W} y2={y} className="stroke-aura-border/50" strokeWidth="0.5" strokeDasharray="4 4" strokeLinecap="round" />
            <text x={PADDING.left - 10} y={y} textAnchor="end" dominantBaseline="middle" className="lp-axis-text fill-aura-muted-2" fontSize="11">
              {tick}%
            </text>
          </g>
        );
      })}
      {/* X-axis labels */}
      {points.map((p, i) => (
        <text key={`x-${i}`} x={p.x} y={CHART_HEIGHT - 4} textAnchor="middle" className="lp-axis-text fill-aura-muted" fontSize="9">
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
            <circle cx={p.x} cy={p.y} r="4" className="fill-aura-gold stroke-aura-bg stroke-[2]" />
            <text x={p.x} y={labelY} textAnchor="middle" className="lp-value-text fill-aura-gold" fontSize="11" fontWeight="600">
              {p.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen text-white landing-pg">
      {/* Hero — анимация появления */}
      <section className="relative px-4 pt-24 pb-20 sm:pt-32 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-aura-gold/5 to-transparent pointer-events-none" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h1 className="lp-hero-title text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-6">
            DeFi lending.
            <br />
            <span className="text-aura-gold">On your terms.</span>
          </h1>
          <p className="lp-hero-sub text-lg text-aura-muted-2 mb-10 max-w-xl mx-auto leading-relaxed">
            Deposit collateral. Borrow stablecoins. Everything on-chain, non-custodial.
          </p>
          <Link
            to="/dashboard"
            className="lp-hero-cta inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold bg-aura-gold text-aura-bg hover:bg-aura-gold-bright transition-all hover:shadow-lg hover:shadow-aura-gold/20"
          >
            Open app
            <ArrowRight size={18} />
          </Link>
        </div>
        <p className="lp-hero-badge text-center text-aura-muted text-sm mt-10">Arbitrum · Base · Sepolia testnet</p>
      </section>

      {/* Графики — столбцы + линия */}
      <section className="px-4 py-16 sm:py-20 border-t border-aura-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="lp-fade text-xl font-bold text-center mb-1">Protocol metrics</h2>
          <p className="lp-fade text-aura-muted text-sm text-center mb-10">TVL & growth</p>
          <div className="lp-chart-row group flex items-end justify-center gap-2 h-40 mb-14">
            {CHART_BARS.map((h, i) => (
              <div
                key={i}
                className="lp-bar rounded-t min-w-[28px] max-w-[40px] flex-1 cursor-pointer transition-all duration-300 ease-out"
                style={{ height: `${h}%`, animationDelay: `${0.05 * i}s` }}
                title={`${h}%`}
              >
                <span className="lp-bar-value absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded text-xs font-medium bg-aura-gold text-aura-bg whitespace-nowrap">
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
      <section className="px-4 py-20 border-t border-aura-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="lp-fade text-2xl font-bold text-center mb-12">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { Icon: Wallet, title: '1. Deposit', text: 'Lock vault shares (e.g. wstETH) as collateral in the protocol.' },
              { Icon: TrendingUp, title: '2. Borrow', text: 'Borrow stablecoins against your collateral. Rates and limits are on-chain.' },
              { Icon: Shield, title: '3. Manage', text: 'Repay, add collateral, or withdraw. Smart contract enforces the rules.' },
            ].map((item, i) => (
              <div key={item.title} className="lp-step text-center" style={{ animationDelay: `${0.12 * i}s` }}>
                <div className="w-14 h-14 rounded-2xl bg-aura-gold/10 flex items-center justify-center text-aura-gold mx-auto mb-4">
                  <item.Icon size={28} />
                </div>
                <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-sm text-aura-muted-2 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="lp-fade px-4 py-12 border-t border-aura-border bg-aura-surface/40">
        <div className="max-w-3xl mx-auto flex flex-wrap justify-center gap-x-12 gap-y-4 text-aura-muted-2 text-sm">
          <span className="flex items-center gap-2"><Lock size={16} className="text-aura-gold" /> Non-custodial</span>
          <span className="flex items-center gap-2"><Shield size={16} className="text-aura-gold" /> On-chain execution</span>
        </div>
      </section>

      {/* LUMINA token */}
      <section className="px-4 py-20 border-t border-aura-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="lp-fade text-2xl font-bold text-center mb-3">LUMINA token</h2>
          <p className="lp-fade text-aura-muted-2 text-center text-sm mb-12 max-w-md mx-auto">Governance and revenue sharing. Lock LUMINA → veLUMINA → vote and earn.</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { Icon: Vote, title: 'Governance', text: 'Vote on proposals with veLUMINA.' },
              { Icon: Coins, title: 'Revenue share', text: 'Earn from protocol fees.' },
              { Icon: Lock, title: 'Lock & stake', text: 'Lock LUMINA for voting power.' },
            ].map((item, i) => (
              <div key={item.title} className="lp-token p-5 rounded-2xl bg-aura-surface border border-aura-border hover:border-aura-gold/25 transition-colors" style={{ animationDelay: `${0.1 * i}s` }}>
                <item.Icon size={22} className="text-aura-gold mb-3" />
                <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-xs text-aura-muted-2">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-24 border-t border-aura-border">
        <div className="max-w-xl mx-auto text-center">
          <p className="lp-fade text-aura-muted-2 mb-6">Ready to use the protocol?</p>
          <Link to="/dashboard" className="lp-fade inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold bg-aura-gold text-aura-bg hover:bg-aura-gold-bright transition-all hover:shadow-lg hover:shadow-aura-gold/20">
            Open app
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}

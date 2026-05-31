import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import ThemeToggle from '../../theme/ThemeToggle';
import NetworkSwitcher from './NetworkSwitcher';

const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/markets', label: 'Markets' },
  { to: '/position', label: 'Position' },
  { to: '/swap', label: 'Swap' },
  { to: '/rewards', label: 'Rewards' },
  { to: '/governance', label: 'Governance' },
  { to: '/liquidate', label: 'Liquidate' },
  { to: '/security', label: 'Security' },
  { to: '/admin', label: 'Admin' },
];

const COMPACT_NAV_OPTIONS = [
  { to: '/', label: 'Home' },
  ...NAV_LINKS,
  { to: '/lightpaper', label: 'Lightpaper' },
];

function isRouteActive(pathname: string, route: string): boolean {
  if (route === '/') return pathname === '/';
  return pathname === route || pathname.startsWith(`${route}/`);
}

function selectedCompactRoute(pathname: string): string {
  const matched = COMPACT_NAV_OPTIONS.find(({ to }) => isRouteActive(pathname, to));
  return matched?.to ?? '/dashboard';
}

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const compactRoute = selectedCompactRoute(location.pathname);

  return (
    <header
      className="app-header sticky top-0 z-50 border-b border-ceitnot-border text-ceitnot-ink overflow-x-hidden"
      style={{ boxShadow: 'var(--ceitnot-shadow-nav)' }}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-w-0 flex flex-wrap items-center justify-between gap-2 sm:gap-3 py-2 sm:h-16">
        <NavLink to="/" className="flex items-center gap-2 shrink-0" end>
          <span className="text-xl font-bold text-ceitnot-ink">
            <span className="text-ceitnot-gold">⬡</span>
            <span className="ml-1.5 tracking-tight">Ceitnot</span>
          </span>
          <span className="hidden sm:block text-[10px] uppercase tracking-[0.2em] text-ceitnot-muted leading-none mt-0.5">
            Protocol
          </span>
        </NavLink>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
          <NetworkSwitcher showLabel={false} className="shrink-0" selectClassName="w-24 sm:w-28" />
          <ThemeToggle />
          <ConnectButton
            label="Connect"
            accountStatus="avatar"
            chainStatus="icon"
            showBalance={false}
          />
        </div>
      </nav>

      <div className="border-t border-ceitnot-border/70 bg-ceitnot-surface/70 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="xl:hidden py-2">
            <label className="flex items-center gap-2 text-xs text-ceitnot-muted">
              <span className="whitespace-nowrap">Page</span>
              <select
                value={compactRoute}
                onChange={(e) => navigate(e.target.value)}
                className="network-switcher-select w-full rounded-lg border border-ceitnot-border bg-ceitnot-surface px-3 py-1.5 text-sm text-ceitnot-ink outline-none"
                title="Navigate between app pages"
              >
                {COMPACT_NAV_OPTIONS.map((opt) => (
                  <option key={opt.to} value={opt.to}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="hidden xl:flex items-center justify-center gap-1 py-2 flex-wrap">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/dashboard'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-ceitnot-gold/12 text-ceitnot-gold'
                      : 'text-ceitnot-ink/80 hover:text-ceitnot-ink hover:bg-ceitnot-surface-2/80'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
            <NavLink
              to="/dashboard"
              className="ml-2 px-4 py-2 rounded-xl text-sm font-semibold bg-ceitnot-gold text-ceitnot-on-primary hover:bg-ceitnot-gold-bright transition-colors"
              style={{ boxShadow: 'var(--ceitnot-shadow-primary)' }}
            >
              Open App
            </NavLink>
          </div>
        </div>
      </div>
    </header>
  );
}
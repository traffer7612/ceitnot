import { NavLink } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LayoutDashboard, BarChart3, Wallet, Zap, Shield, ShieldCheck, Vote, ArrowDownUp, Menu, X, Gift } from 'lucide-react';
import { useState } from 'react';
import ThemeToggle from '../../theme/ThemeToggle';

const NAV_LINKS = [
  { to: '/dashboard',   label: 'Dashboard',   Icon: LayoutDashboard },
  { to: '/markets',     label: 'Markets',     Icon: BarChart3 },
  { to: '/position',    label: 'Position',    Icon: Wallet },
  { to: '/swap',        label: 'Swap',        Icon: ArrowDownUp },
  { to: '/rewards',     label: 'Rewards',     Icon: Gift },
  { to: '/governance',  label: 'Governance',  Icon: Vote },
  { to: '/liquidate',   label: 'Liquidate',   Icon: Zap },
  { to: '/security',    label: 'Security',    Icon: Shield },
  { to: '/admin',       label: 'Admin',       Icon: ShieldCheck },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className="app-header sticky top-0 z-50 border-b border-ceitnot-border text-ceitnot-ink"
      style={{ boxShadow: 'var(--ceitnot-shadow-nav)' }}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2 shrink-0" end>
          <span className="text-xl font-bold text-ceitnot-ink">
            <span className="text-ceitnot-gold">⬡</span>
            <span className="ml-1.5 tracking-tight">Ceitnot</span>
          </span>
          <span className="hidden sm:block text-[10px] uppercase tracking-[0.2em] text-ceitnot-muted leading-none mt-0.5">
            Protocol
          </span>
        </NavLink>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
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

        {/* Wallet button + mobile toggle */}
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ConnectButton
            accountStatus="avatar"
            chainStatus="icon"
            showBalance={false}
          />
          <button
            className="md:hidden btn-ghost p-2"
            onClick={() => setMobileOpen(v => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-ceitnot-border bg-ceitnot-surface/95 backdrop-blur-md">
          {NAV_LINKS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-ceitnot-gold bg-ceitnot-gold/10'
                    : 'text-ceitnot-ink/85 hover:text-ceitnot-ink'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  );
}

import { NavLink } from 'react-router-dom';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { LayoutDashboard, BarChart3, Wallet, Zap, ShieldCheck, Vote, ArrowDownUp, Menu, X } from 'lucide-react';
import { useState } from 'react';

const NAV_LINKS = [
  { to: '/dashboard',   label: 'Dashboard',   Icon: LayoutDashboard },
  { to: '/markets',     label: 'Markets',     Icon: BarChart3 },
  { to: '/position',    label: 'Position',    Icon: Wallet },
  { to: '/swap',        label: 'Swap',        Icon: ArrowDownUp },
  { to: '/governance',  label: 'Governance',  Icon: Vote },
  { to: '/liquidate',   label: 'Liquidate',   Icon: Zap },
  { to: '/admin',       label: 'Admin',       Icon: ShieldCheck },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-aura-border bg-aura-bg/80 backdrop-blur-md">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2 shrink-0" end>
          <span className="text-xl font-bold">
            <span className="text-aura-gold">⬡</span>
            <span className="ml-1.5 tracking-tight">LUMINA</span>
          </span>
          <span className="hidden sm:block text-[10px] uppercase tracking-[0.2em] text-aura-muted leading-none mt-0.5">
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
                    ? 'bg-aura-gold/15 text-aura-gold'
                    : 'text-aura-muted-2 hover:text-white hover:bg-aura-surface-2'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/dashboard"
            className="ml-2 px-4 py-2 rounded-xl text-sm font-semibold bg-aura-gold text-aura-bg hover:bg-aura-gold-bright transition-colors"
          >
            Open App
          </NavLink>
        </div>

        {/* Wallet button + mobile toggle */}
        <div className="flex items-center gap-3">
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
        <div className="md:hidden border-t border-aura-border bg-aura-surface">
          {NAV_LINKS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-aura-gold bg-aura-gold/10'
                    : 'text-aura-muted-2 hover:text-white'
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

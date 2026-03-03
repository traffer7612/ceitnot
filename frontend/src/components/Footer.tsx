export function Footer() {
  return (
    <footer className="border-t border-aura-border mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-aura-muted">
        <span>Aura — Autonomous Yield-Backed Credit Engine</span>
        <div className="flex gap-6">
          <a href="https://arbiscan.io" target="_blank" rel="noreferrer" className="hover:text-aura-gold transition-colors">
            Arbitrum
          </a>
          <a href="https://basescan.org" target="_blank" rel="noreferrer" className="hover:text-aura-gold transition-colors">
            Base
          </a>
        </div>
      </div>
    </footer>
  );
}

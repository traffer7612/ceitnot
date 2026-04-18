import { Shield, FileSearch, Bug, ExternalLink, CheckCircle } from 'lucide-react';
import { DOCS_BLOB_BASE } from '../lib/publicDocs';
import ContractWolfAuditBlock from '../components/layout/ContractWolfAuditBlock';

export default function SecurityPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Shield size={28} className="text-ceitnot-gold" />
          Security
        </h1>
        <p className="page-subtitle">
          Audits, static analysis (Slither), and Bug Bounty program.
        </p>
      </div>

      <ContractWolfAuditBlock layout="card" />

      <div className="grid md:grid-cols-2 gap-6">
        {/* Slither */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-ceitnot-gold/15 flex items-center justify-center">
              <FileSearch size={24} className="text-ceitnot-gold" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Slither</h2>
              <p className="text-xs text-ceitnot-muted">Static analyzer</p>
            </div>
          </div>
          <p className="text-sm text-ceitnot-muted-2 mb-4">
            Ceitnot protocol contracts are analyzed with <strong className="text-ceitnot-ink">Slither v0.11.3</strong> (82 contracts, 100 detectors). 
            High and Medium findings have been fixed; Low/Informational are documented and accepted where appropriate.
          </p>
          <ul className="text-sm text-ceitnot-muted-2 space-y-1.5 mb-4">
            <li className="flex items-center gap-2">
              <CheckCircle size={14} className="text-ceitnot-success shrink-0" />
              Unchecked transfer return values (Router) — fixed
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle size={14} className="text-ceitnot-success shrink-0" />
              Reentrancy / CEI (VeCeitnot, PSM) — fixed
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle size={14} className="text-ceitnot-success shrink-0" />
              Zero-address validation — added where required
            </li>
          </ul>
          <a
            href={`${DOCS_BLOB_BASE}/SECURITY-AUDIT.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-ceitnot-gold hover:text-ceitnot-gold-bright"
          >
            Full audit report
            <ExternalLink size={14} />
          </a>
          <span className="text-ceitnot-muted text-xs ml-2">·</span>
          <a
            href={`${DOCS_BLOB_BASE}/SLITHER.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-ceitnot-gold hover:text-ceitnot-gold-bright ml-2"
          >
            How to run Slither
            <ExternalLink size={14} />
          </a>
        </div>

        {/* Bug Bounty */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-ceitnot-gold/15 flex items-center justify-center">
              <Bug size={24} className="text-ceitnot-gold" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Bug Bounty</h2>
              <p className="text-xs text-ceitnot-muted">Responsible disclosure</p>
            </div>
          </div>
          <p className="text-sm text-ceitnot-muted-2 mb-4">
            We reward responsible disclosure of vulnerabilities in smart contracts and critical app bugs. 
            Rewards can be <strong className="text-ceitnot-ink">points</strong> or <strong className="text-ceitnot-ink">CEITNOT tokens</strong> (testnet or future).
          </p>
          <ul className="text-sm text-ceitnot-muted-2 space-y-1.5 mb-4">
            <li><strong className="text-ceitnot-ink">Critical:</strong> direct loss of funds, protocol bypass</li>
            <li><strong className="text-ceitnot-ink">High:</strong> significant impact, invariant violations</li>
            <li><strong className="text-ceitnot-ink">Medium / Low:</strong> limited impact, edge cases</li>
          </ul>
          <a
            href={`${DOCS_BLOB_BASE}/BUG-BOUNTY.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-ceitnot-gold hover:text-ceitnot-gold-bright"
          >
            Bug Bounty program (scope, rules, contact)
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      {/* Docs link */}
      <div className="mt-8 p-4 rounded-xl bg-ceitnot-surface border border-ceitnot-border">
        <p className="text-sm text-ceitnot-muted-2">
          <strong className="text-ceitnot-ink">Documentation</strong> (interest rates math, liquidation mechanics, contract addresses):{' '}
          <a
            href={`${DOCS_BLOB_BASE}/README-GITBOOK.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ceitnot-gold hover:text-ceitnot-gold-bright"
          >
            docs in repo
          </a>
          {' '}— when publishing a docs site, mirror the <code className="text-ceitnot-gold/90">docs/</code> folder from this repository.
        </p>
        <p className="text-sm text-ceitnot-muted-2 mt-3">
          Rebranding transparency: if wallet/explorer token metadata differs from current public naming, use official
          contract addresses as the source of truth:{' '}
          <a
            href={`${DOCS_BLOB_BASE}/PRODUCTION-ADDRESSES-ARBITRUM.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ceitnot-gold hover:text-ceitnot-gold-bright"
          >
            canonical address table
          </a>
          {' '}and{' '}
          <a
            href={`${DOCS_BLOB_BASE}/BRANDING-AND-NAMING.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ceitnot-gold hover:text-ceitnot-gold-bright"
          >
            branding guidance
          </a>
          .
        </p>
      </div>
    </div>
  );
}

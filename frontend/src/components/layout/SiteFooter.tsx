import { Link } from 'react-router-dom';
import { Shield, ExternalLink } from 'lucide-react';
import {
  DOCS_TREE_URL,
  DOC_TOKENOMICS_CHECKLIST_URL,
  DOC_PRODUCTION_ADDRESSES_URL,
  DOC_BRANDING_NAMING_URL,
  DOC_SOCIAL_ANNOUNCEMENT_TEMPLATE_URL,
  REPO_ROOT_URL,
} from '../../lib/publicDocs';
import ContractWolfAuditBlock from './ContractWolfAuditBlock';

/** Ceitnot lending / CDP UI; not affiliated with unrelated third-party products. */
export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-ceitnot-border bg-ceitnot-surface/60">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div className="relative overflow-hidden rounded-2xl border border-ceitnot-border bg-gradient-to-br from-ceitnot-surface via-ceitnot-surface-2/90 to-ceitnot-surface p-6 sm:p-8 footer-spotlight-card">
          <div className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full bg-ceitnot-accent-dim/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-ceitnot-gold/12 blur-3xl" />

          <div className="relative flex flex-col sm:flex-row sm:items-start gap-5">
            <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-xl bg-ceitnot-gold/15 ring-1 ring-ceitnot-gold/25">
              <Shield className="h-5 w-5 text-ceitnot-gold" aria-hidden />
            </div>
            <div className="min-w-0 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ceitnot-gold/90">
                Independent protocol
              </p>
              <p className="text-sm sm:text-[15px] text-ceitnot-muted-2 leading-relaxed">
                <span className="text-ceitnot-ink font-medium">Ceitnot</span> — lending and CDP on
                Ethereum-compatible networks. This interface and repository are{' '}
                <span className="text-ceitnot-accent font-medium">not affiliated</span> with unrelated third-party protocols
                or teams unless explicitly stated.
              </p>
              <p className="text-xs text-ceitnot-muted leading-relaxed border-l-2 border-ceitnot-accent-dim/35 pl-3">
                Ceitnot — независимый кредитный протокол на EVM. Не связан со сторонними проектами, если не
                указано иное.
              </p>
              <p className="text-xs text-ceitnot-muted leading-relaxed">
                Branding note: on-chain token metadata can differ from current public naming on legacy deployments.
                Verify symbol + canonical address table before interacting.
              </p>
            </div>
          </div>
        </div>

        <ContractWolfAuditBlock layout="footer" />

        <nav
          className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-ceitnot-muted"
          aria-label="Footer"
        >
          <Link to="/security" className="hover:text-ceitnot-gold transition-colors">
            Security
          </Link>
          <a
            href={DOCS_TREE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ceitnot-gold transition-colors"
          >
            Docs
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </a>
          <a
            href={DOC_TOKENOMICS_CHECKLIST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ceitnot-gold transition-colors"
          >
            Go-live checklist
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </a>
          <a
            href={DOC_PRODUCTION_ADDRESSES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ceitnot-gold transition-colors"
          >
            Contract addresses
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </a>
          <a
            href={DOC_BRANDING_NAMING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ceitnot-gold transition-colors"
          >
            Branding note
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </a>
          <a
            href={DOC_SOCIAL_ANNOUNCEMENT_TEMPLATE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ceitnot-gold transition-colors"
          >
            Pinned post template
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </a>
          <a
            href={REPO_ROOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-ceitnot-gold transition-colors"
          >
            GitHub
            <ExternalLink size={12} className="opacity-70" aria-hidden />
          </a>
        </nav>
      </div>
    </footer>
  );
}

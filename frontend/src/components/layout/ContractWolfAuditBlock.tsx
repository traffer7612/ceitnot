import { ExternalLink } from 'lucide-react';
import {
  CONTRACT_WOLF_PROJECT_URL,
  CONTRACT_WOLF_AUDIT_TOKEN_PDF_URL,
  CONTRACT_WOLF_AUDIT_UTILITIES_PDF_URL,
} from '../../lib/publicDocs';

const linkClass =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ceitnot-gold hover:text-ceitnot-gold-bright hover:bg-ceitnot-gold/10 transition-colors';

type Props = {
  /** `footer` — compact strip; `card` — full Security page card */
  layout: 'footer' | 'card';
};

export default function ContractWolfAuditBlock({ layout }: Props) {
  const links = (
    <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-1.5 sm:gap-2" role="list">
      <li>
        <a href={CONTRACT_WOLF_PROJECT_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          Live report
          <ExternalLink size={13} className="opacity-70 shrink-0" aria-hidden />
        </a>
      </li>
      <li>
        <a href={CONTRACT_WOLF_AUDIT_TOKEN_PDF_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          Token audit (PDF)
          <ExternalLink size={13} className="opacity-70 shrink-0" aria-hidden />
        </a>
      </li>
      <li>
        <a
          href={CONTRACT_WOLF_AUDIT_UTILITIES_PDF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Utilities audit (PDF)
          <ExternalLink size={13} className="opacity-70 shrink-0" aria-hidden />
        </a>
      </li>
    </ul>
  );

  const badgeImgClass =
    layout === 'card'
      ? 'h-16 w-auto sm:h-20 md:h-24 lg:h-[5.5rem] rounded-xl'
      : 'h-14 w-auto sm:h-16 md:h-[4.5rem] rounded-xl';

  const badgeShellClass =
    layout === 'card'
      ? 'p-2 sm:p-2.5 rounded-2xl'
      : 'p-2 sm:p-2.5 rounded-2xl';

  const badge = (
    <a
      href={CONTRACT_WOLF_PROJECT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`group shrink-0 inline-block ring-1 ring-ceitnot-border bg-ceitnot-surface-2/80 shadow-sm transition-shadow hover:ring-ceitnot-gold/35 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ceitnot-gold ${badgeShellClass}`}
      aria-label="Contract Wolf — Ceitnot audits (opens project page)"
    >
      <img
        src="/contract-wolf-badge.png"
        width={440}
        height={124}
        className={badgeImgClass}
        alt="Audited and KYC — Contract Wolf"
        loading="lazy"
        decoding="async"
      />
    </a>
  );

  if (layout === 'card') {
    return (
      <div className="card p-6 mb-6 border-ceitnot-border">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ceitnot-gold/90">Contract Wolf</p>
            <h2 className="text-lg font-semibold text-ceitnot-ink">Independent smart contract audit</h2>
            <p className="text-sm text-ceitnot-muted-2 leading-relaxed max-w-2xl">
              Governance token and utilities packages reviewed by Contract Wolf. Open the project page for the live
              certificate, or download the PDF reports below.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 lg:gap-8 shrink-0">
            {badge}
            <div className="min-w-0">{links}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-ceitnot-border bg-ceitnot-surface/50 px-5 py-5 sm:px-6 sm:py-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ceitnot-muted mb-4">Contract Wolf audit</p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
        {badge}
        <div className="min-w-0 flex-1 border-t border-ceitnot-border pt-4 sm:border-t-0 sm:border-l sm:pl-5 sm:pt-0">
          {links}
        </div>
      </div>
    </div>
  );
}

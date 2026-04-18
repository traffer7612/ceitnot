/** Public documentation on GitHub (same repo as the app). Must match `git remote` / published repo. */
const REPO = ((import.meta.env.VITE_PUBLIC_GITHUB_REPO as string | undefined)?.trim() || 'traffer7612/ceitnot');
const BRANCH = ((import.meta.env.VITE_PUBLIC_GITHUB_BRANCH as string | undefined)?.trim() || 'master');

export const DOCS_TREE_URL = `https://github.com/${REPO}/tree/${BRANCH}/docs`;

export const DOC_TOKENOMICS_CHECKLIST_URL =
  `https://github.com/${REPO}/blob/${BRANCH}/docs/TOKENOMICS-PROD-CHECKLIST.md`;

export const DOC_PRODUCTION_ADDRESSES_URL =
  `https://github.com/${REPO}/blob/${BRANCH}/docs/PRODUCTION-ADDRESSES-ARBITRUM.md`;

export const DOC_BRANDING_NAMING_URL =
  `https://github.com/${REPO}/blob/${BRANCH}/docs/BRANDING-AND-NAMING.md`;

export const DOC_SOCIAL_ANNOUNCEMENT_TEMPLATE_URL =
  `https://github.com/${REPO}/blob/${BRANCH}/docs/SOCIAL-PINNED-POST-TEMPLATE.md`;

export const REPO_ROOT_URL = `https://github.com/${REPO}`;

/** Base path for `docs/*.md` on GitHub (blob view). */
export const DOCS_BLOB_BASE = `${REPO_ROOT_URL}/blob/${BRANCH}/docs`;

/** ContractWolf — public project page + published PDF audits (third-party repo). */
export const CONTRACT_WOLF_PROJECT_URL = 'https://contractwolf.io/projects/ceitnot';
export const CONTRACT_WOLF_AUDIT_TOKEN_PDF_URL =
  'https://github.com/ContractWolf/smart-contract-audits/blob/main/ContractWolf_Audit_Ceitnot.pdf';
export const CONTRACT_WOLF_AUDIT_UTILITIES_PDF_URL =
  'https://github.com/ContractWolf/smart-contract-audits/blob/main/ContractWolf_Audit_Ceitnot_Utilities.pdf';

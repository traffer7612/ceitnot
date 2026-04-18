# Contract Wolf — Ceitnot audit

Independent smart contract audit by [Contract Wolf](https://contractwolf.io/). This document lists public artefacts for transparency.

## Links

| Resource | URL |
|----------|-----|
| **Live report (project page)** | https://contractwolf.io/projects/ceitnot |
| **Token audit (PDF)** | https://github.com/ContractWolf/smart-contract-audits/blob/main/ContractWolf_Audit_Ceitnot.pdf |
| **Utilities audit (PDF)** | https://github.com/ContractWolf/smart-contract-audits/blob/main/ContractWolf_Audit_Ceitnot_Utilities.pdf |
| **ContractWolf audit repository** | https://github.com/ContractWolf/smart-contract-audits |

## Summary (Token report)

Per **ContractWolf_Audit_Ceitnot.pdf** (verified date shown on the certificate: **04/06/2026**):

- **Chain (scope header):** Arbitrum  
- **Outcome:** audit marked **passed**; **0 Critical / 0 Major / 0 Medium / 0 Minor**; **1 Informational** finding **resolved** (floating `pragma` — SWC-103, files `CeitnotToken.sol` / vote-escrow contract as named in the report).  
- **Disclaimer:** any third-party audit is not a guarantee of bug-free code or an investment recommendation; review the full PDF and deployed bytecode yourself.

## Frontend

The Ceitnot web app surfaces the same links in the **site footer** and on the **Security** page (`/security`), with the Contract Wolf badge asset under `frontend/public/contract-wolf-badge.png`.

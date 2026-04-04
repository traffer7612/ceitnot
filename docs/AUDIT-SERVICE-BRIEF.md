# Audit service intake — Ceitnot Protocol

Short brief for security auditors and audit platforms (English). **Ребрендинг:** публичное имя продукта — **Ceitnot**; см. раздел *Rebrand vs on-chain scope* ниже.

---

## Required fields

| Field | Details |
|--------|---------|
| **Logo (PNG)** | Supply a **PNG** export for the audit portal. In-repo asset: [`frontend/public/ceitnot.svg`](../frontend/public/ceitnot.svg) — convert or use the same artwork as **1024×1024** (or platform-required) PNG. |
| **Project name** | **Ceitnot Protocol** (public name: **Ceitnot**) |
| **Symbol(s)** | **CEITNOT** — governance token (`CeitnotToken`). **aUSD** — USD-pegged stable unit (`CeitnotUSD`). Collateral markets use per-asset symbols (e.g. vault shares) per deployment. |
| **Network** | **Arbitrum One** (chain ID **42161**) — primary production deployment referenced in [`PRODUCTION-ADDRESSES-ARBITRUM.md`](PRODUCTION-ADDRESSES-ARBITRUM.md). EVM / Ethereum L2 (not BSC/AVAX for this deployment). Other networks may exist for testnets; scope should be confirmed per engagement. |
| **Short project description** | Ceitnot is an EVM lending and CDP protocol: multi-market collateralised debt, stablecoin (aUSD), PSM, router, oracle integration, governance (token + vote-escrow + OpenZeppelin Governor + Timelock), and treasury flows. |
| **Launch date** | *Confirm with the team for the exact public launch / TVL milestone.* On-chain deployment dates are visible on [Arbiscan](https://arbiscan.io/) for the addresses in [`PRODUCTION-ADDRESSES-ARBITRUM.md`](PRODUCTION-ADDRESSES-ARBITRUM.md). |
| **Website** | **https://ceitnot.io** (intended public site). App and documentation may also reference the GitHub repository. |
| **Socials** | *To be confirmed by the team* (Twitter / X, Telegram, Discord). Technical reference: GitHub org/repo used for open-source contracts and `docs/`. |

---

## Rebrand vs on-chain scope (important for auditors)

1. **Ceitnot rebrand**  
   The product, website, documentation, and frontend have been aligned under the name **Ceitnot** (replacing earlier public naming). This is **branding and communication**, not a new protocol fork.

2. **Deployed contracts**  
   For the **production deployment(s)** you are asked to audit, **the same proxy and implementation addresses** apply as in [`PRODUCTION-ADDRESSES-ARBITRUM.md`](PRODUCTION-ADDRESSES-ARBITRUM.md). The rebrand **does not** imply replacement of that deployment with new bytecode: **on-chain logic at those addresses is the in-scope system**; match it to the **current Solidity sources** in this repository (`src/`, `test/`).

3. **Source tree**  
   Contract **file and type names** in the repo use the **Ceitnot** prefix (e.g. `CeitnotEngine`, `CeitnotToken`). Explorer labels may still show older metadata in some wallets; **trust the canonical address table and repo ABI/source** for review.

---

## Pointers for the audit packet

- **Addresses:** [`docs/PRODUCTION-ADDRESSES-ARBITRUM.md`](PRODUCTION-ADDRESSES-ARBITRUM.md)  
- **Security testing & Slither:** [`docs/SECURITY-AUDIT.md`](SECURITY-AUDIT.md)  
- **Architecture / contracts overview:** [`docs/CONTRACTS.md`](CONTRACTS.md)  

---

*Last updated for audit intake. Update launch date and socials when finalized.*

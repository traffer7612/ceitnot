# Production contract addresses — Arbitrum One (42161)

Canonical reference for **public** deployments of **Ceitnot Protocol**. Имена в первом столбце — **как в Solidity/эксплорере** (`CeitnotEngine`, …); см. [BRANDING-AND-NAMING.md](BRANDING-AND-NAMING.md).

Keep in sync with `frontend/.env.example` and GitBook after any governance upgrade.

Explorer: [Arbitrum One](https://arbiscan.io/).

> Branding notice: token metadata displayed in wallets/explorers can differ from current public naming on legacy deployments. Use this address table as the canonical reference.

## Core protocol (full deploy set)

| Contract | Address |
|----------|---------|
| CeitnotEngine (implementation) | `0x023463264bd5a21ad29a23aff150ba816bf985e2` |
| CeitnotProxy (engine) | `0xf8631eA8D16f67A4FfBAb691dcF55c6d0D31b928` |
| CeitnotUSD (ceitUSD) | `0x01C169D51BA6a218B92af77D4c36eD17B5Ef2115` |
| CeitnotMarketRegistry | `0x41678342398f4827154120E8d7aA0c384B0c7015` |
| CeitnotRouter | `0x3E4121d253f1513edB4b3077f613a5F37c8273F1` |
| CeitnotTreasury | `0x4D8FC1F286644c9098Eb39FBe0C7aCcbeCd9bc7D` |
| **Legacy PSM (USDC)** | `0xcb18d815e5b686372d9494583812cd46ca869919` |
| CeitnotToken (CEITNOT ticker in UI) | `0xe8388286545d6016BE38eE56710Ca768B7074826` |
| VeCeitnot | `0x6A18AC84a8E2cA9556556c1cDDa3bC4414414F28` |
| TimelockController | `0x26A46142901F14196132Ea212970Cf13286Dc32D` |
| CeitnotGovernor | `0x70DF0a55aCf6D2DC2C8C236DA6E2C602A8BC5cD1` |

## PSM migration (active vs legacy)

| Role | Address | Notes |
|------|---------|--------|
| **Current production PSM (frontend `VITE_PSM_ADDRESS`)** | `0xc3DeA5605DDEA1Cb768c040D5FD14ec6DedFbB54` | Deployed with correct pegged-token decimals; admin = Timelock. |
| Legacy PSM | `0xcb18d815e5b686372d9494583812cd46ca869919` | Deprecate after liquidity moved and `CeitnotUSD.removeMinter(legacy)` executed via governance. |

Confirm `CeitnotUSD.minters(newPSM) == true` on Arbiscan after Timelock executes `addMinter`.

## Reference assets (verify script)

Used by verification / test markets; not all are production collateral.

| Item | Address |
|------|---------|
| Mock wstETH (if used) | `0x54eb3b26220eb901349a2dfa5011e89ba62e458b` |
| Mock vault | `0x91799566f1384f5d0ea847aa3720d76faa73caaa` |

## Governance timing

Timelock minimum delay from deploy encoding: **86400** seconds (1 day). Confirm on-chain on the Timelock contract if it was later changed.

## Related docs

- [`TOKENOMICS-PROD-CHECKLIST.md`](TOKENOMICS-PROD-CHECKLIST.md)
- [`PSM-ORACLE-MARKET-RISK.md`](PSM-ORACLE-MARKET-RISK.md)
- [`INCIDENT-ROLLBACK-RUNBOOK.md`](INCIDENT-ROLLBACK-RUNBOOK.md)

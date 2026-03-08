# Changelog — Aura Protocol

Все изменения по фазам разработки.

---

## Phase 10 — DX & Composability
- **AuraRouter** — stateless маршрутизатор: `depositCollateral`, `depositAndBorrow`, `repayAndWithdraw`, `leverageUp/Down` + EIP-2612 permit flows
- **Delegate system** — `setDelegate(address, bool)` в AuraEngine: позволяет внешним контрактам (Router) действовать от имени пользователя
- **Multicall** — батч-вызовы через `delegatecall` для атомарных admin-операций
- **EIP-2612 permit** — gasless approve для vault tokens и aUSD через Router

## Phase 9 — CDP Mode & PSM
- **AuraUSD** — mintable стейблкоин: minter management, global debt ceiling, EIP-2612 permit, custom ERC-20 (без OZ зависимости)
- **CDP mode** в AuraEngine — `borrow` минтит aUSD (вместо transfer USDC), `repay`/`liquidate` сжигают aUSD, per-market debt ceiling
- **AuraPSM** — Peg Stability Module: 1:1 свопы aUSD ↔ pegged stable (USDC/DAI), настраиваемые комиссии tin/tout, ceiling, fee reserves

## Phase 8 — Oracle V2
- **OracleRelayV2** — multi-source median oracle (до 8 feeds), circuit breaker (maxDeviationBps), L2 sequencer uptime feed с grace period
- Per-market oracle: каждый рынок указывает на свой OracleRelayV2

## Phase 7 — Governance
- **AuraToken** — ERC-20 + ERC20Votes, timestamp-based clock (EIP-6372)
- **VeAura** — Vote-Escrow: lock AURA (до 4 лет), линейное затухание voting power, delegation, revenue distribution (reward-per-token)
- **AuraGovernor** — OpenZeppelin Governor + TimelockControl + VotesQuorumFraction
- **AuraTreasury** — казначейство: deposit, withdraw, batch distribute

## Phase 6 — Advanced Liquidation
- **Dutch-аукцион** — линейное снижение penalty от `liquidationPenaltyBps` до 0 за `auctionDuration`
- **Close factor** — максимальная доля долга для ликвидации за раз (closeFactorBps)
- **Protocol liquidation fee** — часть seized коллатерала идёт в протокол
- **Full liquidation threshold** — ниже порога разрешается полная ликвидация

## Phase 5 — Yield & Fees
- **Harvest yield** — автоматическое применение дохода от коллатерала к долгу через `globalDebtScale`
- **Yield fee** — протокол забирает % от yield (yieldFeeBps)
- **Origination fee** — комиссия при займе (originationFeeBps)
- **Reserve factor** — часть начисленных процентов идёт в reserves протокола
- **Flash-loan reserves** — отдельные reserves от flash-loan комиссий

## Phase 4 — Interest Rate Model
- **Kink-based IRM** — `baseRate + slope1 × min(u, kink) + slope2 × max(0, u − kink)`
- Per-market IRM параметры через MarketRegistry
- Автоматическое начисление процентов через `borrowIndex` (RAY precision)
- Reserve factor: часть начисленных процентов → протокол

## Phase 3 — Multi-Market & Isolation
- **AuraMarketRegistry** — standalone реестр рынков
- Multi-market: пользователь может иметь позиции в нескольких рынках
- **Isolation mode** — изолированные рынки с отдельным borrowCap
- Supply/borrow caps per market
- Freeze/deactivate market

## Phase 2 — Security & Admin
- **Timelock** — все критические параметры (LTV, liquidation threshold/penalty) через timelock
- **Pause / Unpause** — остановка всех мутирующих операций
- **Emergency shutdown** — необратимое отключение (только withdrawCollateral разрешён)
- **Same-block guard** — защита от flash-loan манипуляций (noSameBlock modifier)
- **Flash loans** — ERC-3156 с configurable fee

## Phase 1 — Core
- **AuraEngine** — deposit/withdraw collateral, borrow/repay
- **AuraProxy** — UUPS proxy (EIP-1822) с EIP-1967 storage slot
- **AuraStorage** — EIP-7201 namespaced storage
- **OracleRelay** — Chainlink primary + fallback, staleness check, TWAP
- **FixedPoint** — WAD/RAY математика
- **AuraVault4626** — ERC-4626 view adapter

---

## Security Fixes (post-Slither audit)
- **AuraRouter**: проверка return value `transferFrom`/`approve` (8 мест) + error `Router__TransferFailed`
- **AuraPSM**: CEI pattern в `swapIn`/`swapOut` — state updates до external calls
- **VeAura**: CEI pattern в `lock`/`increaseAmount`/`distributeRevenue` — `_transferIn` после state updates
- **AuraMarketRegistry**: zero-address check в `setEngine()`
- **AuraProxy**: zero-address check в конструкторе (`Proxy__ZeroImplementation`)
- **AuraVault4626**: zero-address check в конструкторе (`Vault4626__ZeroAddress`)
- **OracleRelay**: zero-address check для `primaryFeed` (`OracleRelay__ZeroPrimaryFeed`)
- **VeAura**: zero-address check в `setRevenueToken()`

---

## Testing
- **296 тестов**: юнит (66), security (60), flash-loan (19), governance (23), Phase9 (25), Phase10 (24), OracleV2 (40), fuzz (8×1000), invariants (5×256×50), gas benchmarks (6), slot (1), treasury (19)
- **Slither v0.11.3**: 264 findings → все High/Medium исправлены; Low/Info — принятые паттерны
- **0 critical vulnerabilities**

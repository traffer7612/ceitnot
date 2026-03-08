# Аудит безопасности Aura Protocol

Документ описывает полный набор тестов безопасности, результаты статического анализа Slither и исправления, внесённые по итогам аудита.

---

## 1. Тестовые сьюты

### 1.1. Юнит-тесты (`test/Aura.t.sol`)
**66 тестов** — покрытие основных функций движка: инициализация, депозит/вывод коллатерала, займ/погашение, начисление процентов, harvest yield, ликвидация, пауза, shutdown, timelock, апгрейд прокси, multi-market, изоляционный режим.

### 1.2. Тесты безопасности (`test/Security.t.sol`)
**60 тестов** — направлены на выявление уязвимостей:
- **Reentrancy**: reentrancy-атаки на deposit, borrow, repay, withdraw, liquidate
- **Flash-loan**: попытки манипуляции позицией внутри flash-loan callback
- **Oracle manipulation**: подмена оракула, zero price, stale data
- **Access control**: вызовы admin-функций от неавторизованных адресов
- **Liquidation edge-cases**: частичная/полная ликвидация, Dutch-аукцион, close factor
- **Timelock**: обход/исполнение pending-параметров
- **Proxy**: безопасность upgradeToAndCall, reinitialize protection
- **Pause/Shutdown**: корректное ограничение операций
- **Edge-cases**: нулевые суммы, overflow, dust amounts
- **Stress-тесты**: 100 пользователей, массовые ликвидации

### 1.3. Flash-loan тесты (`test/FlashLoan.t.sol`)
**19 тестов** — ERC-3156 flash-loan: корректность выдачи, fee accounting, reentrancy protection, maxFlashLoan, невалидный callback return, insufficient repay.

### 1.4. Governance тесты (`test/Governance.t.sol`)
**23 теста** — AuraToken, VeAura (lock, extend, withdraw, delegation, revenue), AuraGovernor (propose, vote, execute через timelock), AuraTreasury (deposit, withdraw, distribute).

### 1.5. Phase 9 — CDP / PSM (`test/Phase9.t.sol`)
**25 тестов** — AuraUSD (mint/burn, minter management, global debt ceiling), CDP-режим (borrow mints aUSD, repay/liquidate burns aUSD, per-market debt ceiling), PSM (swapIn/swapOut, fee accounting, ceiling, reserves).

### 1.6. Phase 10 — Router / Delegates (`test/Phase10.t.sol`)
**24 теста** — AuraRouter (depositCollateral, depositAndBorrow, repayAndWithdraw, leverageUp/Down), Delegate system (set/get, borrow/repay via delegate, unauthorized reverts), Multicall, EIP-2612 permit.

### 1.7. OracleV2 (`test/OracleV2.t.sol`)
**40 тестов** — Multi-source median oracle, circuit breaker (trip/reset, large/small deviation), feed management (add/disable/max feeds), Chainlink normalisation, stale price exclusion, L2 sequencer uptime feed, TWAP.

### 1.8. Fuzz-тесты (`test/fuzz/AuraFuzz.t.sol`)
**8 тестов × 1000 прогонов** — рандомизированные сценарии:
- `fuzz_depositWithdraw`: депозит → вывод (collateral conservation)
- `fuzz_borrowRepay`: займ → погашение (debt conservation)
- `fuzz_ltvAlwaysEnforced`: LTV-лимит при любых суммах
- `fuzz_healthFactorAboveOneAfterDeposit`: HF ≥ 1 после депозита
- `fuzz_liquidationOnlyWhenUnhealthy`: ликвидация только при HF < 1
- `fuzz_harvestReducesDebt`: yield harvest уменьшает долг
- `fuzz_interestAccrues`: процент начисляется корректно
- `fuzz_multiMarketIsolation`: изоляция рынков

### 1.9. Инвариантные тесты (`test/invariants/`)
**5 тестов × 256 прогонов × 50 вызовов** (12800 вызовов):
- `invariant_debtIndex_monotonic`: borrowIndex монотонно возрастает
- `invariant_totalDebt_solvency`: совокупный долг ≤ коллатерал
- `invariant_collateral_conservation`: shares не создаются из воздуха
- `invariant_noFreeLoans`: нельзя занять без коллатерала
- `invariant_pauseBlocksAll`: пауза блокирует все мутирующие операции

### 1.10. Gas-бенчмарки (`test/benchmarks/`)
**6 бенчмарков** — замер газа для ключевых операций: deposit, borrow, repay, withdraw, liquidate, harvest.

---

## 2. Результаты тестирования

| Сьют | Тесты | Статус |
|------|-------|--------|
| Aura.t.sol (юнит) | 66 | ✅ PASS |
| Security.t.sol | 60 | ✅ PASS |
| FlashLoan.t.sol | 19 | ✅ PASS |
| Governance.t.sol | 23 | ✅ PASS |
| Phase9.t.sol (CDP/PSM) | 25 | ✅ PASS |
| Phase10.t.sol (Router/Delegates) | 24 | ✅ PASS |
| OracleV2.t.sol | 40 | ✅ PASS |
| Fuzz (1000 runs) | 8 | ✅ PASS |
| Invariants (256 runs, 12800 calls) | 5 | ✅ PASS |
| GasBenchmark | 6 | ✅ PASS |
| Slot.t.sol | 1 | ✅ PASS |
| Treasury.t.sol | 19 | ✅ PASS |
| **Итого** | **296** | **✅ 296 passed, 0 failed** |

> 4 fork-теста (`test/fork/AuraFork.t.sol`) требуют Infura API key и не считаются в основной набор.

---

## 3. Статический анализ — Slither v0.11.3

Slither проанализировал **82 контракта** с **100 детекторами**, обнаружив **264 результата**.

### 3.1. Категоризация по нашему коду (`src/`)

#### High — исправлены ✅

**Unchecked transfer return values** — `AuraRouter`
- 4 вызова `IERC4626.transferFrom()` и 4 вызова `IERC4626.approve()` без проверки return value
- **Исправление**: добавлен error `Router__TransferFailed`, все 8 вызовов обёрнуты в `if (!...) revert`

**Controlled delegatecall** — `AuraEngine.upgradeToAndCall()`
- Ложное срабатывание: стандартный UUPS proxy upgrade pattern, защищён `onlyAdmin` модификатором

#### Medium — исправлены ✅

**Reentrancy (CEI violation)** — `VeAura`, `AuraPSM`
- `VeAura.lock()`, `increaseAmount()`, `distributeRevenue()`: `_transferIn` вызывался до обновления state
- `AuraPSM.swapIn()`, `swapOut()`: state обновлялся после external calls
- **Исправление**: переупорядочены в паттерн Checks-Effects-Interactions (state updates → external calls)

**Missing zero-address validation**
- `AuraMarketRegistry.setEngine()`, `AuraProxy` конструктор, `AuraVault4626` конструктор, `OracleRelay` конструктор (`primaryFeed`), `VeAura.setRevenueToken()`
- **Исправление**: добавлены проверки `if (addr == address(0)) revert`

#### Low / Informational — принято (не требует правок)

| Детектор | Кол-во | Причина допуска |
|----------|--------|-----------------|
| Divide before multiply | ~15 | Стандартная WAD/RAY математика; потеря точности ≤ 1 wei |
| Dangerous strict equalities | 6 | Намеренные проверки (same-block guard, zero deltaT) |
| Uninitialized local variables | 10 | Solidity инициализирует в 0; переменные заполняются условно |
| Calls inside a loop | ~20 | `_healthFactor` итерирует рынки пользователя (by design) |
| Timestamp comparisons | ~25 | Необходимо для time-dependent логики (lock expiry, staleness, interest) |
| Events after external calls | ~15 | Информационное; не уязвимость |
| Low-level calls | ~15 | Работа с произвольными ERC-20 токенами (safeTransfer pattern) |
| Assembly usage | 5 | Proxy pattern, EIP-7201 storage |
| Naming convention | 5 | `ENGINE`, `PRIMARY_FEED` — осознанный выбор стиля для immutables |
| Missing inheritance | 3 | Косметическое; контракты реализуют нужные методы |
| Solidity ^0.8.20 known bugs | 1 | VerbatimInvalidDeduplication и др. — не задействованы в коде |
| Cache array length | 1 | `_feeds.length` в OracleRelayV2; минимальное влияние на газ |
| State variable could be immutable | 1 | `twapPeriod` в OracleRelay; газ-оптимизация, не уязвимость |

#### Findings в OpenZeppelin (`lib/`)

Все предупреждения по `lib/openzeppelin-contracts/` — стандартный аудированный код (Governor, TimelockController, ERC20, Votes). Эти findings — known patterns в OpenZeppelin и не представляют реальной угрозы.

---

## 4. Резюме исправлений

| # | Файл | Что исправлено | Коммит |
|---|------|---------------|--------|
| 1 | `AuraRouter.sol` | Проверка return value `transferFrom`/`approve` (8 мест) | текущий |
| 2 | `AuraPSM.sol` | CEI pattern: state updates до external calls в `swapIn`/`swapOut` | текущий |
| 3 | `VeAura.sol` | CEI pattern: `_transferIn` после state updates в `lock`/`increaseAmount`/`distributeRevenue` | текущий |
| 4 | `AuraMarketRegistry.sol` | Zero-address check в `setEngine()` | текущий |
| 5 | `AuraProxy.sol` | Zero-address check в конструкторе | текущий |
| 6 | `AuraVault4626.sol` | Zero-address check в конструкторе | текущий |
| 7 | `OracleRelay.sol` | Zero-address check для `primaryFeed` в конструкторе | текущий |
| 8 | `VeAura.sol` | Zero-address check в `setRevenueToken()` | текущий |

---

## 5. Рекомендации для production

1. **Внешний аудит** — перед mainnet-деплоем рекомендуется профессиональный аудит (Trail of Bits, OpenZeppelin, Spearbit и др.)
2. **Bug bounty** — запустить программу вознаграждений через Immunefi
3. **Мониторинг** — настроить алерты через OpenZeppelin Defender или Forta для отслеживания аномальных транзакций
4. **Формальная верификация** — расширить halmos-тесты для критических инвариантов (solvency, no-free-loans)
5. **Gas optimization** — после финализации логики провести оптимизацию (cache array length, immutables)

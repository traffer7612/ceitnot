# Справочник контрактов Aura Protocol

Полное описание всех смарт-контрактов, их функций, событий и ошибок.

---

## Обзор архитектуры

```
AuraProxy (UUPS) ──delegatecall──► AuraEngine (implementation)
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                  ▼
           AuraMarketRegistry   OracleRelay(V2)    ERC-4626 Vault
                    │                                    │
                    ▼                                    ▼
               AuraUSD (CDP)                     Debt Token (USDC)
                    │
                    ▼
               AuraPSM ◄──► Pegged Stablecoin

Governance: AuraToken → VeAura → AuraGovernor → TimelockController
Treasury:   AuraTreasury
Router:     AuraRouter (composability)
```

---

## 1. AuraEngine (`src/AuraEngine.sol`)

Основной движок протокола. Работает за UUPS-прокси.

### Инициализация
- `initialize(address debtToken, address registry, uint256 heartbeat, uint256 timelockDelay)` — однократная инициализация через прокси

### Коллатерал
- `depositCollateral(address user, uint256 marketId, uint256 shares)` — внести vault-shares как залог
- `withdrawCollateral(address user, uint256 marketId, uint256 shares)` — вывести залог (если позиция здорова)

### Займы
- `borrow(address user, uint256 marketId, uint256 amount)` — взять в долг (legacy: USDC transfer / CDP: mint aUSD)
- `repay(address user, uint256 marketId, uint256 amount)` — погасить долг

### Комбинированные
- `depositAndBorrow(address user, uint256 marketId, uint256 shares, uint256 borrowAmount)` — депозит + займ атомарно
- `repayAndWithdraw(address user, uint256 marketId, uint256 repayAmount, uint256 withdrawShares)` — погашение + вывод атомарно

### Yield & Interest
- `harvestYield(uint256 marketId)` — собрать yield с коллатерала, применить к долгу
- Interest accrual — автоматическое начисление процентов при каждом взаимодействии

### Ликвидация
- `initiateLiquidation(address user, uint256 marketId)` — инициировать Dutch-аукцион (если включён)
- `liquidate(address user, uint256 marketId, uint256 repayAmount)` — ликвидировать позицию (частично/полностью)

### Flash Loans (ERC-3156)
- `maxFlashLoan(address token)` — максимальная сумма flash-loan
- `flashFee(address token, uint256 amount)` — комиссия за flash-loan
- `flashLoan(IERC3156FlashBorrower receiver, address token, uint256 amount, bytes data)` — выдать flash-loan

### Делегирование
- `setDelegate(address delegate, bool enabled)` — разрешить/запретить адресу действовать от вашего имени

### Admin & Timelock
- `proposeParam(bytes32 paramId, uint256 value)` — предложить изменение параметра (timelock)
- `executeParam(bytes32 paramId)` — исполнить после timelock
- `proposeMarketParam(uint256 marketId, bytes32 paramId, uint256 value)` — предложить изменение параметра рынка
- `executeMarketParam(uint256 marketId, bytes32 paramId)` — исполнить
- `pause()` / `unpause()` — пауза протокола
- `emergencyShutdown()` — аварийное отключение (необратимое)
- `upgradeToAndCall(address newImpl, bytes data)` — обновить реализацию

### View
- `getPosition(address user, uint256 marketId)` — данные позиции
- `getHealthFactor(address user)` — фактор здоровья
- `getPositionCollateralValue(address user, uint256 marketId)` — стоимость коллатерала
- `totalDebt()` — общий долг протокола
- `totalCollateralAssets()` — общий коллатерал
- `asset()` — адрес базового актива

### Ключевые события
- `CollateralDeposited`, `CollateralWithdrawn`
- `Borrowed`, `Repaid`
- `Liquidated`, `LiquidationInitiated`
- `YieldHarvested`
- `FlashLoan`
- `Paused`, `Unpaused`, `EmergencyShutdown`
- `ParamProposed`, `ParamExecuted`, `MarketParamProposed`, `MarketParamExecuted`
- `Upgraded`

---

## 2. AuraProxy (`src/AuraProxy.sol`)

UUPS-прокси (EIP-1822). Все вызовы пользователей идут через этот адрес.

- Конструктор: `(address implementation_, bytes data_)` — задаёт начальную реализацию и вызывает initializer
- `fallback()` — delegatecall к текущей реализации
- `receive()` — приём ETH
- Storage slot: `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` (EIP-1967)

### Ошибки
- `Proxy__ZeroImplementation()` — нулевой адрес реализации

---

## 3. AuraStorage (`src/AuraStorage.sol`)

EIP-7201 namespaced storage. Все переменные состояния Engine.

### Ключевые поля
- `admin`, `debtToken`, `marketRegistry`
- `paused`, `shutdown`
- `heartbeat`, `timelockDelay`
- `globalDebtScale` (WAD) — глобальный масштаб долга после yield
- `totalDebt`, `totalPrincipalDebt`
- `borrowIndex` (RAY) — глобальный индекс начисления процентов
- Per-market: `MarketState` (totalShares, totalPrincipalDebt, borrowIndex, lastAccrual, lastHarvestPricePerShare, ...)
- Per-user per-market: `Position` (collateralShares, principalDebt, userBorrowIndex, lastInteractionBlock)

---

## 4. AuraMarketRegistry (`src/AuraMarketRegistry.sol`)

Реестр рынков коллатерала. Каждый рынок: vault + oracle + risk params.

### Управление рынками
- `addMarket(vault, oracle, ltvBps, liquidationThresholdBps, liquidationPenaltyBps, supplyCap, borrowCap, isIsolated, isolatedBorrowCap)` → `marketId`
- `updateMarketRiskParams(marketId, ltvBps, liquidationThresholdBps, liquidationPenaltyBps)`
- `updateMarketCaps(marketId, supplyCap, borrowCap)`
- `updateMarketIrmParams(marketId, baseRate, slope1, slope2, kink, reserveFactorBps)`
- `updateMarketLiquidationParams(marketId, closeFactorBps, fullLiquidationThresholdBps, protocolLiquidationFeeBps, dutchAuctionEnabled, auctionDuration)`
- `updateMarketFeeParams(marketId, yieldFeeBps, originationFeeBps)`
- `updateMarketDebtCeiling(marketId, debtCeiling)`
- `freezeMarket(marketId, frozen)` / `deactivateMarket(marketId)` / `activateMarket(marketId)`
- `setEngine(address)` — назначить движок

### View
- `getMarket(marketId)` → `MarketConfig`
- `marketExists(marketId)` → `bool`
- `marketCount()` → `uint256`

### MarketConfig struct
```solidity
vault, oracle, ltvBps, liquidationThresholdBps, liquidationPenaltyBps,
supplyCap, borrowCap, isActive, isFrozen, isIsolated, isolatedBorrowCap,
baseRate, slope1, slope2, kink, reserveFactorBps,
closeFactorBps, fullLiquidationThresholdBps, protocolLiquidationFeeBps,
dutchAuctionEnabled, auctionDuration, yieldFeeBps, originationFeeBps, debtCeiling
```

---

## 5. OracleRelay (`src/OracleRelay.sol`)

Мульти-оракул v1: Chainlink primary + generic fallback. Staleness check (24h).

- `getLatestPrice()` → `(uint256 value, uint256 timestamp)` — цена в WAD (1e18)
- `getTwapPrice()` → `uint256` — TWAP цена
- `isPrimaryValid()` / `isFallbackValid()` → `bool`
- `updateTwap()` — обновить TWAP-аккумулятор (keeper)

---

## 6. OracleRelayV2 (`src/OracleRelayV2.sol`)

Оракул v2: multi-source median, circuit breaker, L2 sequencer uptime.

### Price
- `getLatestPrice()` → `(uint256, uint256)` — медиана из всех валидных feeds
- `getTwapPrice()` → `uint256`
- `isPrimaryValid()` / `isFallbackValid()` → `bool`

### Circuit Breaker
- `updatePrice()` — keeper: обновить цену, триггернуть circuit breaker при сильном отклонении
- `resetCircuitBreaker()` — admin: сбросить circuit breaker
- `isCircuitBroken()` → `bool`
- `setMaxDeviation(uint256 newBps)` — admin: установить порог отклонения

### Sequencer
- `isSequencerUp()` → `bool`
- `setSequencerFeed(address feed, uint256 gracePeriod)` — admin

### Feed Management
- `addFeed(address feed, bool isChainlink, uint256 heartbeat)`
- `setFeedEnabled(uint256 index, bool enabled)`
- `feedCount()` / `getFeed(uint256 index)`

---

## 7. AuraUSD (`src/AuraUSD.sol`)

Mintable стейблкоин для CDP-режима. Поддерживает EIP-2612 permit.

- `mint(address to, uint256 amount)` — только minter (Engine/PSM)
- `burn(uint256 amount)` / `burnFrom(address from, uint256 amount)`
- `addMinter(address)` / `removeMinter(address)` — admin
- `setGlobalDebtCeiling(uint256)` — admin
- `permit(owner, spender, value, deadline, v, r, s)` — EIP-2612
- `transfer`, `transferFrom`, `approve`, `balanceOf`, `totalSupply` — стандартный ERC-20

---

## 8. AuraPSM (`src/AuraPSM.sol`)

Peg Stability Module — 1:1 свопы aUSD ↔ pegged stablecoin (USDC/DAI).

- `swapIn(uint256 amount)` → `uint256 ausdOut` — отдать stable, получить aUSD (fee: `tinBps`)
- `swapOut(uint256 amount)` → `uint256 stableOut` — отдать aUSD, получить stable (fee: `toutBps`)
- `setCeiling(uint256)` — max aUSD для mint через PSM
- `setFee(uint16 tinBps, uint16 toutBps)`
- `withdrawFeeReserves(address to, uint256 amount)` — вывести комиссии
- `availableReserves()` → `uint256` — доступные reserves для swapOut

---

## 9. AuraRouter (`src/AuraRouter.sol`)

Stateless маршрутизатор для UX: atomic compound операции + permit.

- `depositCollateral(uint256 marketId, address vault, uint256 shares)`
- `depositCollateralWithPermit(marketId, vault, shares, deadline, v, r, s)` — с EIP-2612
- `depositAndBorrow(marketId, vault, shares, borrowAmount)` — депозит + займ в 1 tx
- `repayAndWithdraw(marketId, repayAmount, withdrawShares)` — погашение + вывод в 1 tx
- `repayWithPermit(marketId, amount, deadline, v, r, s)` — погашение через permit
- `leverageUp(marketId, vault, shares, borrowAmount)` — alias для depositAndBorrow
- `leverageDown(marketId, repayAmount, withdrawShares)` — alias для repayAndWithdraw

---

## 10. AuraTreasury (`src/AuraTreasury.sol`)

Казначейство протокола. Аккумулирует protocol revenue.

- `deposit(address token, uint256 amount)` — внести токены
- `withdraw(address token, uint256 amount, address to)` — admin: вывести
- `distribute(address token, address[] recipients, uint256[] amounts)` — admin: раздать нескольким
- `balanceOf(address token)` → `uint256`

---

## 11. Governance

### AuraToken (`src/governance/AuraToken.sol`)
ERC-20 + ERC20Votes. Governance токен протокола.
- Стандартный ERC-20 + delegation (delegate, delegateBySig)
- Timestamp-based clock (EIP-6372)

### VeAura (`src/governance/VeAura.sol`)
Vote-Escrow AURA. Lock AURA → получить voting power + revenue share.

- `lock(uint256 amount, uint256 unlockTime)` — заблокировать AURA
- `increaseAmount(uint256 extra)` — увеличить locked amount
- `extendLock(uint256 newUnlockTime)` — продлить срок
- `withdraw()` — вывести после истечения lock
- `delegate(address delegatee)` — делегировать голос
- `getVotes(address)` / `getPastVotes(address, uint256 timepoint)`
- `getPastTotalSupply(uint256 timepoint)`
- `distributeRevenue(uint256 amount)` — admin: раздать revenue
- `claimRevenue()` — пользователь: забрать свою долю
- `pendingRevenue(address user)` → `uint256`

Voting power = `amount × (unlockTime − now) / MAX_LOCK_DURATION` (линейное затухание)

### AuraGovernor (`src/governance/AuraGovernor.sol`)
OpenZeppelin Governor + TimelockControl + VotesQuorumFraction.
- `propose`, `castVote`, `execute` — стандартный governance flow
- Quorum: настраиваемый % от totalSupply
- Всё исполняется через TimelockController

---

## 12. Вспомогательные

### FixedPoint (`src/FixedPoint.sol`)
- `wadMul(a, b)`, `wadDiv(a, b)` — арифметика с точностью 1e18
- `rayMul(a, b)`, `rayDiv(a, b)` — арифметика с точностью 1e27
- `wadToRay(a)`, `rayToWad(a)` — конвертация

### InterestRateModel (`src/InterestRateModel.sol`)
- `getRate(baseRate, slope1, slope2, kink, utilization)` → `uint256 ratePerSecondRay`
- Kink-based model: `rate = baseRate + slope1 × min(u, kink) + slope2 × max(0, u − kink)`

### Multicall (`src/Multicall.sol`)
- `multicall(bytes[] data)` → `bytes[] results` — батч delegatecall к self

### AuraVault4626 (`src/AuraVault4626.sol`)
- View-only ERC-4626 адаптер: `asset()`, `totalAssets()`, `convertToAssets()`, `convertToShares()`

---

## 13. Deployment-адреса (Sepolia testnet)

| Контракт | Адрес |
|----------|-------|
| Engine (proxy) | `0xc87F0c55837F932B59ca71fC1A915E0063D3664c` |
| MarketRegistry | `0x684c264916fc31ba540fecbF1aC8fde668422666` |
| OracleRelay | `0xfD5Fe52bdbffA5E4D464D0D3b568Aff5cA1F2f54` |
| Vault (wstETH mock) | `0x929357b964f146421DEed6feDf643b7758666648` |
| Asset (wstETH mock) | `0x3Ab7387B155Ab180Ca2f12EBaCd21701E5806F12` |
| Debt Token (USDC mock) | `0x1f74eA407c8d52F3047240bdB2775DA2157a48B3` |
| Chainlink ETH/USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |

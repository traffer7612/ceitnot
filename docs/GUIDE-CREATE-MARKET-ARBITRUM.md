# Создание нового маркета на Arbitrum One (от и до)

Это пошаговый гайд для тех, кто **никогда** не добавлял маркет в Ceitnot на боевой сети.
После этого гайда у вас будет новый маркет в протоколе, куда пользователи смогут вносить коллатерал и занимать aUSD / USDC.

---

## Что такое «маркет» в Ceitnot

Маркет — это тройка:

1. **Collateral vault** — ERC-4626 хранилище, чьи «доли» (shares) пользователи вносят как залог.
2. **Oracle** — контракт, который отдаёт цену коллатерала в USD.
3. **Risk-параметры** — LTV, порог ликвидации, штраф, caps и т.д.

Маркет регистрируется в реестре Ceitnot — контракт **`CeitnotMarketRegistry`** — вызовом `addMarket(...)`. После этого пользователи могут вносить коллатерал и занимать.

---

## Терминология для новичка

- **LTV (Loan-to-Value)** — максимальный % от стоимости залога, который можно занять. LTV 75% = внёс $1000 залога → можно занять до $750.
- **Liquidation Threshold** — при каком % начинается ликвидация. Порог 82% = если долг достигает 82% от стоимости залога, позицию ликвидируют.
- **Liquidation Penalty** — штраф при ликвидации. 6% = ликвидатор забирает залог со скидкой 6%.
- **Supply Cap** — максимум залоговых shares во всём маркете. Защита от чрезмерной концентрации.
- **Borrow Cap** — максимум долга во всём маркете.
- **Isolation mode** — если включён, пользователь не может иметь позиции в других маркетах одновременно. Используется для рискованных активов.
- **IRM (Interest Rate Model)** — модель процентных ставок: как меняется ставка при разной утилизации.
- **ERC-4626** — стандарт «хранилища». Пользователь вносит токен, получает «доли» (shares). Пример: вносишь wstETH, получаешь aWstETH.
- **Chainlink feed** — контракт от Chainlink, который возвращает текущую цену актива (например ETH/USD).

---

## Шаг 0. Что нужно заранее

1. **Foundry** установлен (`forge --version` работает).
2. **Кошелёк** с ETH на Arbitrum One (на газ). Даже 0.001 ETH хватит на десяток транзакций.
3. **Приватный ключ** этого кошелька (только для деплоя, не храните крупные суммы).
4. **Доступ к RPC Arbitrum**: `https://arb1.arbitrum.io/rpc` (бесплатный) или свой Alchemy/Infura.
5. **Протокол Ceitnot уже задеплоен** — у вас есть адреса Engine (proxy) и Registry.

---

## Шаг 1. Выбрать коллатеральный актив

Решите, какой токен принимать в залог. Примеры для Arbitrum One:

**Популярные активы:**
- wstETH (Lido): `0x5979D7b546E38E414F7E9822514be443A4800529`
- wETH: `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`
- ARB: `0x912CE59144191C1204E64559FE8253a0e49E6548`
- GMX: `0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a`
- USDT: `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`

**Где искать адреса:**
1. Зайдите на https://arbiscan.io
2. В поиске введите название токена (например «wstETH»)
3. Убедитесь, что контракт верифицирован и символ совпадает
4. Скопируйте адрес

---

## Шаг 2. Найти или создать ERC-4626 vault

Engine принимает коллатерал в виде **ERC-4626 vault shares**, не сырых токенов.

### Вариант A: Актив уже является ERC-4626

Некоторые токены сами по себе ERC-4626 (например, некоторые vault-токены DeFi протоколов).
Проверить:

```powershell
# Если вернёт адрес — это ERC-4626
cast call <TOKEN_ADDRESS> "asset()(address)" --rpc-url https://arb1.arbitrum.io/rpc
```

Если вернул адрес → токен сам является vault, можно использовать его напрямую.

### Вариант B: Нужна обёртка

Если актив НЕ является ERC-4626 (например, обычный ERC-20), нужно написать vault-обёртку.

Простейший вариант — 1:1 vault без yield (как MockVault4626, но для mainnet):

```solidity
// src/vaults/SimpleVault.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC4626, ERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract SimpleVault is ERC4626 {
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_
    ) ERC4626(asset_) ERC20(name_, symbol_) {}
}
```

Либо используйте существующие ERC-4626 vault'ы из DeFi:
- **Aave** — aToken-обёртки
- **Pendle** — PT/YT vault'ы
- **Silo, Yearn** — нативные ERC-4626

---

## Шаг 3. Найти Chainlink price feed

Оракул нужен для определения цены коллатерала в USD.

### Где искать:
1. Зайдите на https://data.chain.link
2. Выберите сеть **Arbitrum One**
3. Найдите нужную пару (например **ETH / USD**)
4. Скопируйте адрес контракта (Proxy Address)

### Популярные фиды на Arbitrum One:
- ETH / USD: `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`
- USDT / USD (Standard): `0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7` ([data.chain.link — USDT/USD Arbitrum](https://data.chain.link/feeds/arbitrum/mainnet/usdt-usd))
- BTC / USD: `0x6ce185860a4963106506C203335A2910413708e9`
- ARB / USD: `0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6`
- LINK / USD: `0x86E53CF1B870786351Da77A57575e79CB55812CB`
- GMX / USD: `0xDB98056FecFff59D032aB628337A4887110df3dB`

### Особенность wstETH:
wstETH = stETH * коэффициент. Для точной цены нужен **ETH/USD feed** + учёт exchange rate wstETH→stETH.
Наш OracleRelay поддерживает `PRIMARY_FEED` (ETH/USD) и может работать с ним напрямую.
Для более точного решения: создать адаптер, который умножает цену ETH на курс wstETH/stETH.

---

## Шаг 4. Определить risk-параметры

Это самый важный шаг. Неправильные параметры = потеря средств.

### Рекомендации по типу актива:

**Blue chip (wstETH, wETH, wBTC):**
- LTV: 75-80%
- Liquidation threshold: 82-85%
- Liquidation penalty: 5%
- Supply cap: зависит от ликвидности (начните с $1M-$5M в эквиваленте)
- Borrow cap: 60-70% от supply cap
- Isolation: false

**Средний риск (ARB, LINK, GMX):**
- LTV: 60-70%
- Liquidation threshold: 70-78%
- Liquidation penalty: 8-10%
- Supply cap: $500K-$2M
- Borrow cap: 50-60% от supply cap
- Isolation: рекомендуется true для новых

**Высокий риск (новые токены, мемкоины):**
- LTV: 40-50%
- Liquidation threshold: 55-65%
- Liquidation penalty: 10-15%
- Supply/Borrow cap: маленькие ($100K-$500K)
- Isolation: true обязательно

### Interest Rate Model (IRM):

Если хотите начислять проценты на займы, нужно настроить IRM.
Значения в RAY (1e27 = 100%/год):

```
baseRate = 0                        # Ставка при 0% утилизации
slope1   = 40000000000000000000000000  # ~4%/год при утилизации ниже kink
slope2   = 3000000000000000000000000000 # ~300%/год при утилизации выше kink (штраф)
kink     = 800000000000000000000000000  # 80% — оптимальная утилизация
reserveFactorBps = 1000             # 10% процентов идут в резервы протокола
```

Для начала можно оставить IRM = 0 (без процентов) и настроить позже.

---

## Шаг 5. Написать скрипт деплоя

Создайте файл `script/DeployNewMarket.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script }  from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";

import { CeitnotMarketRegistry } from "../src/CeitnotMarketRegistry.sol";
import { OracleRelay }        from "../src/OracleRelay.sol";

contract DeployNewMarket is Script {
    // === ИЗМЕНИТЕ ЭТИ АДРЕСА ===

    // Ваш Registry (уже задеплоен)
    address constant REGISTRY = 0x05a585117DF7a0b909F611cC40aFd3b04dCf7A12;

    // ERC-4626 vault для коллатерала (уже существует в сети или деплоите свой)
    address constant VAULT = 0x5979D7b546E38E414F7E9822514be443A4800529; // пример: wstETH

    // Chainlink price feed
    address constant CHAINLINK_FEED = 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612; // ETH/USD

    // Fallback oracle (0x0 = без fallback)
    address constant FALLBACK_FEED = address(0);

    function run() external {
        vm.startBroadcast();

        // 1. Деплоим OracleRelay (подключает Chainlink feed)
        OracleRelay oracle = new OracleRelay(
            CHAINLINK_FEED,
            FALLBACK_FEED,
            0               // twapPeriod: 0 = без TWAP, только spot price
        );

        // 2. Регистрируем маркет
        CeitnotMarketRegistry registry = CeitnotMarketRegistry(REGISTRY);
        uint256 marketId = registry.addMarket(
            VAULT,                   // ERC-4626 vault
            address(oracle),         // OracleRelay
            uint16(7500),            // LTV 75%
            uint16(8200),            // Liquidation threshold 82%
            uint16(600),             // Liquidation penalty 6%
            500_000e18,              // Supply cap: 500k shares
            300_000e18,              // Borrow cap: 300k долговых токенов
            false,                   // НЕ изолированный
            0                        // isolatedBorrowCap (0 т.к. не isolated)
        );

        vm.stopBroadcast();

        console.log("=== MARKET DEPLOYED ===");
        console.log("ORACLE:     %s", address(oracle));
        console.log("VAULT:      %s", VAULT);
        console.log("MARKET ID:  %s", marketId);
    }
}
```

---

## Шаг 6. Собрать и задеплоить

```powershell
cd F:\ceitnot

# Проверить что компилируется
forge build

# Задеплоить на Arbitrum One
forge script script/DeployNewMarket.s.sol:DeployNewMarket `
  --rpc-url https://arb1.arbitrum.io/rpc `
  --broadcast `
  --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
```

В выводе увидите:
```
=== MARKET DEPLOYED ===
ORACLE:     0x...
VAULT:      0x...
MARKET ID:  N
```

Запишите MARKET ID — это ID вашего нового маркета.

---

## Шаг 7. Настроить IRM (опционально)

Если хотите проценты на займы, вызовите после деплоя:

```powershell
cast send <REGISTRY_ADDRESS> "updateMarketIrmParams(uint256,uint256,uint256,uint256,uint256,uint16)" `
  <MARKET_ID> `
  0 `
  40000000000000000000000000 `
  3000000000000000000000000000 `
  800000000000000000000000000 `
  1000 `
  --rpc-url https://arb1.arbitrum.io/rpc `
  --private-key ВАШ_КЛЮЧ
```

Аргументы по порядку: marketId, baseRate, slope1, slope2, kink, reserveFactorBps.

---

## Шаг 8. Настроить ликвидационные параметры (опционально)

```powershell
cast send <REGISTRY_ADDRESS> "updateMarketLiquidationParams(uint256,uint16,uint16,uint16,bool,uint256)" `
  <MARKET_ID> `
  5000 `
  5000 `
  500 `
  false `
  0 `
  --rpc-url https://arb1.arbitrum.io/rpc `
  --private-key ВАШ_КЛЮЧ
```

Аргументы: marketId, closeFactorBps (50%), fullLiquidationThresholdBps (HF < 0.5 → полная ликвидация), protocolLiquidationFeeBps (5% протоколу), dutchAuctionEnabled, auctionDuration.

---

## Шаг 9. Проверить что маркет работает

```powershell
# Проверить количество маркетов
cast call <REGISTRY_ADDRESS> "marketCount()" --rpc-url https://arb1.arbitrum.io/rpc

# Проверить конфиг нового маркета
cast call <REGISTRY_ADDRESS> "getMarket(uint256)(address,address,uint16,uint16,uint16,uint256,uint256,bool,bool,bool,uint256)" `
  <MARKET_ID> --rpc-url https://arb1.arbitrum.io/rpc

# Проверить что оракул отдаёт цену
cast call <ORACLE_ADDRESS> "getLatestPrice()(uint256,uint256)" --rpc-url https://arb1.arbitrum.io/rpc
```

---

## Шаг 10. Обновить фронтенд

Фронтенд автоматически подтянет новый маркет из Registry (через `marketCount` + `getMarket`).
Достаточно обновить страницу Markets.

Если используете бэкенд — убедитесь что `VITE_REGISTRY_ADDRESS` в `frontend/.env` указывает на правильный Registry.

---

## Чеклист перед деплоем на mainnet

- [ ] Vault — проверен, аудирован, реально ERC-4626
- [ ] Chainlink feed — актуальный, не deprecated, heartbeat < 24h
- [ ] LTV < Liquidation Threshold (иначе registry отклонит)
- [ ] Supply cap и Borrow cap установлены (НЕ 0 на mainnet!)
- [ ] Isolation mode — включён для новых/рискованных активов
- [ ] IRM настроен (если нужны проценты)
- [ ] Оракул проверен: `getLatestPrice()` возвращает адекватную цену
- [ ] Тестовый депозит + borrow + repay + withdraw прошли на тестнете

---

## Частые ошибки

**«Транзакция не удастся» при депозите:**
- Нет approve vault-shares → engine
- Supply cap превышен
- Isolation mode конфликт (есть позиции в других маркетах)
- Маркет заморожен или деактивирован

**Оракул возвращает 0:**
- Chainlink feed deprecated или stale
- Неправильный адрес feed
- feed отдаёт цену для другой пары

**addMarket ревертится:**
- LTV > Liquidation Threshold
- Vault не ERC-4626 (нет `convertToAssets`)
- Oracle не возвращает цену (или цена = 0)
- Вызывающий не admin Registry

---

## Полная последовательность команд (копипаст)

```powershell
# 0. Перейти в проект
cd F:\ceitnot

# 1. Собрать
forge build

# 2. Задеплоить маркет (отредактируйте адреса в скрипте!)
forge script script/DeployNewMarket.s.sol:DeployNewMarket `
  --rpc-url https://arb1.arbitrum.io/rpc `
  --broadcast `
  --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ

# 3. (Опционально) Настроить IRM
cast send REGISTRY "updateMarketIrmParams(uint256,uint256,uint256,uint256,uint256,uint16)" `
  MARKET_ID 0 40000000000000000000000000 3000000000000000000000000000 800000000000000000000000000 1000 `
  --rpc-url https://arb1.arbitrum.io/rpc --private-key ВАШ_КЛЮЧ

# 4. (Опционально) Настроить ликвидации
cast send REGISTRY "updateMarketLiquidationParams(uint256,uint16,uint16,uint16,bool,uint256)" `
  MARKET_ID 5000 5000 500 false 0 `
  --rpc-url https://arb1.arbitrum.io/rpc --private-key ВАШ_КЛЮЧ

# 5. Проверить
cast call REGISTRY "marketCount()" --rpc-url https://arb1.arbitrum.io/rpc
cast call ORACLE "getLatestPrice()(uint256,uint256)" --rpc-url https://arb1.arbitrum.io/rpc
```

Замените `REGISTRY`, `MARKET_ID`, `ORACLE`, `ВАШ_КЛЮЧ` на реальные значения.

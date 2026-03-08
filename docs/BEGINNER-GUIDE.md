# Aura — Полный гайд для новичка (от и до)

Этот документ — **единая инструкция** для человека, который видит проект Aura впервые. Здесь собрано всё: что это за проект, как его установить, запустить, задеплоить контракты и начать пользоваться.

---

## Содержание

1. [Что такое Aura](#1-что-такое-aura)
2. [Ключевые понятия](#2-ключевые-понятия)
3. [Архитектура проекта](#3-архитектура-проекта)
4. [Что нужно установить](#4-что-нужно-установить)
5. [Структура файлов проекта](#5-структура-файлов-проекта)
6. [Сборка контрактов (Foundry)](#6-сборка-контрактов-foundry)
7. [Запуск бэкенда и фронтенда (локально)](#7-запуск-бэкенда-и-фронтенда-локально)
8. [Деплой контрактов на Sepolia (тестнет)](#8-деплой-контрактов-на-sepolia-тестнет)
9. [Первый депозит, займ и погашение](#9-первый-депозит-займ-и-погашение)
10. [Проверка данных через терминал (cast)](#10-проверка-данных-через-терминал-cast)
11. [Как устроены контракты (обзор)](#11-как-устроены-контракты-обзор)
12. [Деплой на боевую сеть (Arbitrum / Base)](#12-деплой-на-боевую-сеть-arbitrum--base)
13. [Апгрейд контракта](#13-апгрейд-контракта)
14. [Тестирование](#14-тестирование)
15. [Частые проблемы и решения](#15-частые-проблемы-и-решения)
16. [Полезные ссылки](#16-полезные-ссылки)

---

## 1. Что такое Aura

**Aura** — это DeFi-протокол (децентрализованные финансы), который работает на блокчейне. Его суть:

- Пользователь **вносит залог** (коллатерал) — это токены, которые приносят доход (yield-bearing assets, например wstETH).
- Под этот залог можно **взять стейблкоин в долг** (например USDC).
- **Yield Siphon** — фишка Aura: доход от залога автоматически уменьшает ваш долг. Чем дольше лежит коллатерал — тем меньше долг. Это называется **самоликвидирующийся долг**.

Простая аналогия: вы кладёте акции в банк, под них берёте кредит, а дивиденды от акций автоматически гасят ваш кредит.

---

## 2. Ключевые понятия

**Коллатерал (collateral)** — залог, который вы вносите в протокол. В Aura это доли (shares) ERC-4626 хранилища (vault). Чем больше и дороже коллатерал — тем больше можно занять.

**ERC-4626 Vault** — стандартное «хранилище» в блокчейне. Вы кладёте токены (assets), получаете доли (shares). Со временем доли дорожают, потому что хранилище зарабатывает доход.

**Долговой токен (debt token)** — то, что вы берёте в долг. В боевой сети это стейблкоин (USDC, DAI и т.п.). На тестнете — мок-токен.

**LTV (Loan-to-Value)** — максимальная доля от стоимости коллатерала, которую можно занять. Если LTV = 80%, а ваш залог стоит $1000, максимальный долг = $800.

**Health Factor (фактор здоровья)** — число, показывающее, насколько «безопасна» ваша позиция. Выше 1 — всё ок. Ниже 1 — позиция может быть ликвидирована.

**Ликвидация** — если цена залога упала и Health Factor < 1, любой может погасить часть вашего долга и забрать часть коллатерала со штрафом. Это защищает протокол от безнадёжных долгов.

**Оракул (Oracle)** — внешний сервис (например Chainlink), который сообщает контракту актуальную цену коллатерала в USD.

**Прокси (Proxy, UUPS)** — контракт-обёртка. Пользователи всегда обращаются к одному и тому же адресу (прокси), а «начинка» (логика) может обновляться без смены адреса.

**WAD / RAY** — единицы точности: WAD = 1e18, RAY = 1e27. Используются для математики с фиксированной точкой (вместо дробей, которых нет в Solidity).

---

## 3. Архитектура проекта

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ПОЛЬЗОВАТЕЛЬ                                 │
│                 (браузер + кошелёк MetaMask/Rabby)                    │
└─────────────────────────────────────────────────────────────────────┘
                │                               │
                │ Открывает сайт                │ Подписывает транзакции
                ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│       ФРОНТЕНД (React)       │   │         БЛОКЧЕЙН                  │
│  Vite + Wagmi + RainbowKit   │   │  AuraProxy → AuraEngine           │
│  Показывает позицию, формы   │──▶│  AuraMarketRegistry               │
│  Deposit / Borrow / Repay    │   │  OracleRelay (Chainlink)          │
└──────────────────────────────┘   │  ERC-4626 Vault (wstETH)          │
                │                   │  USDC (долговой токен)             │
                │ /api запросы      └──────────────────────────────────┘
                ▼
┌──────────────────────────────┐
│        БЭКЕНД (Node.js)      │
│  Express + Viem              │
│  /api/config — адреса        │
│  /api/stats  — статистика    │
│  /api/rpc    — прокси RPC    │
└──────────────────────────────┘
```

**Три слоя:**

- **Смарт-контракты** (`src/`) — вся логика денег и залогов живёт в блокчейне.
- **Бэкенд** (`backend/`) — Node.js API: отдаёт фронту адреса контрактов, статистику, проксирует RPC.
- **Фронтенд** (`frontend/`) — React-приложение: интерфейс для подключения кошелька и управления позицией.

---

## 4. Что нужно установить

### 4.1. Node.js (версия 18+)

Нужен для запуска бэкенда и фронтенда.

- Скачать: https://nodejs.org
- Проверить в терминале:

```powershell
node -v
npm -v
```

### 4.2. Git

Нужен для клонирования зависимостей (forge-std, OpenZeppelin).

- Скачать: https://git-scm.com
- Проверить:

```powershell
git --version
```

### 4.3. Foundry (forge, cast, anvil)

Набор инструментов для компиляции, тестирования и деплоя Solidity-контрактов.

```powershell
winget install Foundry.Foundry
```

После установки **закройте и откройте терминал заново**. Проверьте:

```powershell
forge --version
cast --version
```

Если `forge` не находится — перезагрузите компьютер или вручную добавьте путь к Foundry в PATH.

### 4.4. MetaMask (расширение для браузера)

Кошелёк для подписания транзакций.

- Установить: https://metamask.io
- Создайте **отдельный тестовый кошелёк** (без реальных денег).
- Сохраните seed-фразу в надёжном месте.

---

## 5. Структура файлов проекта

```
aura/
├── src/                          # Solidity-контракты
│   ├── AuraEngine.sol            # Движок: депозит, займ, погашение, ликвидация, harvest
│   ├── AuraProxy.sol             # UUPS-прокси
│   ├── AuraStorage.sol           # EIP-7201 хранилище (все переменные состояния)
│   ├── AuraMarketRegistry.sol    # Реестр рынков (vault, oracle, LTV, caps)
│   ├── AuraUSD.sol               # Mintable-стейблкоин (aUSD) для CDP-режима
│   ├── AuraRouter.sol            # Маршрутизатор для composability
│   ├── AuraTreasury.sol          # Казначейство протокола
│   ├── AuraPSM.sol               # Peg Stability Module
│   ├── AuraVault4626.sol         # ERC-4626 адаптер поверх движка
│   ├── FixedPoint.sol            # Математика WAD/RAY
│   ├── InterestRateModel.sol     # Модель процентной ставки
│   ├── OracleRelay.sol           # Мульти-оракул (Chainlink + fallback)
│   ├── OracleRelayV2.sol         # Оракул v2 (TWAP, multi-hop)
│   ├── Multicall.sol             # Батч-вызовы
│   ├── interfaces/               # Интерфейсы (IERC4626, IOracleRelay, ...)
│   └── governance/               # Governance-контракты
│
├── test/                         # Тесты (Foundry)
│   ├── Aura.t.sol                # Основные юнит-тесты
│   ├── Security.t.sol            # Тесты безопасности
│   ├── FlashLoan.t.sol           # Flash-loan тесты
│   ├── Governance.t.sol          # Governance-тесты
│   ├── fuzz/                     # Фаззинг-тесты
│   ├── invariants/               # Инвариантные тесты
│   ├── fork/                     # Форк-тесты (реальные данные)
│   ├── halmos/                   # Формальная верификация
│   ├── benchmarks/               # Газ-бенчмарки
│   └── mocks/                    # Моки для тестов (MockERC20, MockVault4626, MockOracle)
│
├── script/                       # Деплой-скрипты (Foundry)
│   ├── Deploy.s.sol              # Деплой с моками (для Sepolia / Anvil)
│   ├── DeploySepolia.s.sol       # Деплой на Sepolia с настоящим Chainlink-оракулом
│   ├── DeployProduction.s.sol    # Продакшн деплой (Arbitrum / Base)
│   ├── UpgradeEngine.s.sol       # Скрипт апгрейда движка
│   └── VerifyArbitrum.*          # Скрипты верификации на Arbiscan
│
├── backend/                      # Бэкенд (Node.js + Express + Viem)
│   ├── src/index.ts              # Точка входа
│   ├── .env.example              # Шаблон конфигурации
│   └── package.json
│
├── frontend/                     # Фронтенд (React + Vite + Wagmi + TailwindCSS)
│   ├── src/
│   │   ├── App.tsx               # Маршрутизация (Dashboard, Markets, Position, Liquidate, Admin)
│   │   ├── components/           # UI-компоненты
│   │   ├── hooks/                # React-хуки (useConfig, ...)
│   │   └── abi/                  # ABI контрактов
│   ├── .env.example              # Шаблон конфигурации фронта
│   └── package.json
│
├── docs/                         # Документация
├── foundry.toml                  # Конфиг Foundry (компилятор, фаззинг, RPC)
├── remappings.txt                # Маппинги импортов Solidity
└── README.md
```

---

## 6. Сборка контрактов (Foundry)

### 6.1. Установить зависимости (один раз)

Если папка `lib/forge-std` пуста или отсутствует:

```powershell
# Из корня проекта
git submodule update --init --recursive
```

Или вручную:

```powershell
git clone https://github.com/foundry-rs/forge-std.git F:\aura\lib\forge-std
git clone https://github.com/OpenZeppelin/openzeppelin-contracts.git F:\aura\lib\openzeppelin-contracts
```

### 6.2. Собрать

```powershell
forge build
```

В конце должно быть **Compiler run successful**. Артефакты попадут в папку `out/`.

### 6.3. Запустить тесты

```powershell
forge test
```

Подробный вывод (с трассировкой):

```powershell
forge test -vvv
```

---

## 7. Запуск бэкенда и фронтенда (локально)

### 7.1. Бэкенд

Открыть терминал:

```powershell
# Установить зависимости (один раз)
npm install --prefix F:\aura\backend

# Создать .env из шаблона (один раз)
Copy-Item F:\aura\backend\.env.example F:\aura\backend\.env

# Запустить
npm run dev --prefix F:\aura\backend
```

Должно появиться: **Aura backend running at http://localhost:3001**

Проверка: открыть в браузере http://localhost:3001/api/health — должен вернуть `{"status":"ok"}`.

**Не закрывайте** этот терминал.

### 7.2. Фронтенд

Открыть **второй** терминал:

```powershell
# Установить зависимости (один раз)
npm install --prefix F:\aura\frontend

# Создать .env из шаблона (один раз)
Copy-Item F:\aura\frontend\.env.example F:\aura\frontend\.env

# Запустить
npm run dev --prefix F:\aura\frontend
```

Должно появиться: **Local: http://localhost:5173/**

### 7.3. Открыть сайт

В браузере: **http://localhost:5173**

Вы увидите интерфейс Aura с кнопкой **Connect wallet**. Пока контракт не задеплоен — кнопки Deposit/Borrow не будут работать, это нормально.

### 7.4. Остановка

В каждом терминале нажмите **Ctrl+C**.

---

## 8. Деплой контрактов на Sepolia (тестнет)

Sepolia — тестовая сеть Ethereum, где все токены «ненастоящие» и бесплатные.

### 8.1. Настроить MetaMask для Sepolia

В MetaMask: **Настройки → Сети → Добавить сеть вручную:**

- Имя: **Sepolia**
- RPC URL: `https://ethereum-sepolia.publicnode.com`
- Chain ID: **11155111**
- Валюта: **ETH**

### 8.2. Получить тестовые ETH

Без них деплой не пройдёт — нужно платить за газ (комиссия сети).

1. Скопируйте адрес кошелька из MetaMask.
2. Зайдите на один из кранов (faucet):
   - https://sepoliafaucet.com
   - https://www.alchemy.com/faucets/ethereum-sepolia
3. Запросите ETH. Подождите, пока на счёте появится хотя бы **0.01–0.05 ETH**.

### 8.3. Экспортировать приватный ключ

> **Важно:** используйте **только тестовый кошелёк** без реальных денег!

В MetaMask: меню → Настройки аккаунта → Экспорт приватного ключа → введите пароль → скопируйте ключ (начинается с `0x`).

### 8.4. Деплой (с моками)

Это задеплоит мок-контракты (тестовые токены, мок-оракул) — подходит для первого знакомства:

```powershell
forge script script/Deploy.s.sol:DeployScript --rpc-url https://ethereum-sepolia.publicnode.com --broadcast --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
```

Замените `ВАШ_ПРИВАТНЫЙ_КЛЮЧ` на ваш ключ (с `0x`).

В конце выведутся адреса:

```
AURA_ENGINE_ADDRESS=0x...   ← адрес движка (прокси) — главный
AURA_REGISTRY_ADDRESS=0x... ← реестр рынков
AURA_VAULT_4626_ADDRESS=0x... ← VAULT (хранилище)
MOCK_ASSET_ADDRESS=0x...      ← ASSET (тестовый токен)
```

**Скопируйте все адреса** — они понадобятся.

### 8.5. Деплой с настоящим Chainlink-оракулом (опционально)

Использует реальный Chainlink ETH/USD фид на Sepolia:

```powershell
forge script script/DeploySepolia.s.sol:DeploySepolia --rpc-url https://ethereum-sepolia.publicnode.com --broadcast --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
```

### 8.6. Прописать адреса в приложение

**Бэкенд** — откройте `backend\.env` и впишите:

```env
AURA_ENGINE_ADDRESS=0x_АДРЕС_ДВИЖКА_ИЗ_ВЫВОДА_ДЕПЛОЯ
```

**Фронтенд** — откройте `frontend\.env` и впишите:

```env
VITE_ENGINE_ADDRESS=0x_АДРЕС_ДВИЖКА_ИЗ_ВЫВОДА_ДЕПЛОЯ
VITE_REGISTRY_ADDRESS=0x_АДРЕС_РЕЕСТРА_ИЗ_ВЫВОДА_ДЕПЛОЯ
VITE_CHAIN_ID=11155111
```

Перезапустите бэкенд (Ctrl+C → `npm run dev` в `backend`) и перезагрузите страницу фронтенда.

---

## 9. Первый депозит, займ и погашение

### 9.0. Как это работает

В Aura коллатерал — это **доли (shares)** ERC-4626 хранилища. После деплоя у вашего кошелька есть тестовые токены (ASSET), но нет долей (shares). Их нужно **один раз создать**, сделав два шага: approve → deposit в vault. Потом уже на сайте внести эти доли как коллатерал.

### 9.1. Создать доли (в терминале)

Подставьте адреса из вывода деплоя (шаг 8.4):

- `ASSET` = значение `MOCK_ASSET_ADDRESS`
- `VAULT` = значение `AURA_VAULT_4626_ADDRESS`
- `ВАШ_АДРЕС` = адрес кошелька из MetaMask
- `ВАШ_КЛЮЧ` = приватный ключ

**Шаг 1 — Approve (разрешить vault забирать токены):**

```powershell
cast send ASSET "approve(address,uint256)" VAULT 1000000000000000000 --rpc-url https://ethereum-sepolia.publicnode.com --private-key ВАШ_КЛЮЧ
```

**Шаг 2 — Deposit в vault (получить доли):**

```powershell
cast send VAULT "deposit(uint256,address)" 1000000000000000000 ВАШ_АДРЕС --rpc-url https://ethereum-sepolia.publicnode.com --private-key ВАШ_КЛЮЧ
```

После этого у вас на кошельке будет **1 доля** (1e18 wei). Этого хватит для первого депозита.

### 9.2. Депозит коллатерала (на сайте)

1. Откройте http://localhost:5173
2. **Connect wallet** → выберите MetaMask → подтвердите подключение.
3. В MetaMask выберите сеть **Sepolia**.
4. Вкладка **Deposit** → введите **1** → нажмите **Deposit collateral** → подтвердите в MetaMask.

Если всё сделано верно, в блоке **Your position** появится коллатерал (1.0 shares).

### 9.3. Займ (Borrow)

На вкладке **Borrow**:

1. Введите сумму (не больше, чем позволяет LTV, обычно 80% от стоимости коллатерала).
2. Нажмите **Borrow** → подтвердите в MetaMask.
3. Долговые токены придут на ваш кошелёк. Health Factor обновится.

### 9.4. Погашение (Repay)

Перед первым погашением нужно **один раз** разрешить движку забирать долговые токены:

```powershell
cast send DEBT_TOKEN "approve(address,uint256)" ENGINE 1000000000000000000000 --rpc-url https://ethereum-sepolia.publicnode.com --private-key ВАШ_КЛЮЧ
```

Где:
- `DEBT_TOKEN` — адрес второго MockERC20 из broadcast-файла (или `MOCK_DEBT_ADDRESS` из вывода DeploySepolia)
- `ENGINE` — адрес AuraProxy (`AURA_ENGINE_ADDRESS`)

После approve на сайте: вкладка **Repay** → введите сумму → **Repay** → подтвердите в MetaMask.

### 9.5. Добавить ещё коллатерала

Если хотите внести больше — повторите шаги 9.1 (approve + deposit в vault), чтобы на кошельке появились новые доли, и затем Deposit на сайте.

---

## 10. Проверка данных через терминал (cast)

`cast` — утилита Foundry для чтения данных из блокчейна.

**Проверить коллатерал:**

```powershell
cast call ENGINE "getPositionCollateralShares(address)(uint256)" ВАШ_АДРЕС --rpc-url https://ethereum-sepolia.publicnode.com
```

Ответ в wei: `1000000000000000000` = 1 доля.

**Проверить долг:**

```powershell
cast call ENGINE "getPositionDebt(address)(uint256)" ВАШ_АДРЕС --rpc-url https://ethereum-sepolia.publicnode.com
```

**Проверить баланс долговых токенов:**

```powershell
cast call DEBT_TOKEN "balanceOf(address)(uint256)" ВАШ_АДРЕС --rpc-url https://ethereum-sepolia.publicnode.com
```

**Проверить цену от оракула:**

```powershell
cast call ORACLE "latestPrice()(uint256)" --rpc-url https://ethereum-sepolia.publicnode.com
```

---

## 11. Как устроены контракты (обзор)

### Контракты и их роли

**AuraProxy** — единственный адрес, с которым общается пользователь. Все вызовы идут через прокси, который перенаправляет их в AuraEngine через `delegatecall`. Позволяет обновлять логику без смены адреса.

**AuraEngine** — движок протокола. Содержит всю логику:
- `depositCollateral(marketId, shares)` — внести коллатерал
- `withdrawCollateral(marketId, shares)` — вывести коллатерал
- `borrow(marketId, user, amount)` — взять займ
- `repay(marketId, user, amount)` — погасить долг
- `harvestYield(marketId)` — собрать доход с коллатерала и применить к долгу (Yield Siphon)
- `liquidate(marketId, user, repayAmount)` — ликвидировать нездоровую позицию
- `flashLoan(...)` — flash-кредит (EIP-3156)

**AuraMarketRegistry** — реестр рынков. Каждый рынок — это набор: vault (коллатерал), oracle, LTV, liquidation threshold, penalty, supply/borrow caps, isolation mode.

**AuraStorage** — EIP-7201 хранилище. Все переменные состояния движка лежат здесь в одном namespace, чтобы не было коллизий при апгрейдах.

**OracleRelay** — мульти-оракул: основной (Chainlink) + fallback. Защита от устаревших данных (staleness check).

**FixedPoint** — библиотека математики WAD/RAY. Округление всегда в пользу протокола: долг вверх, коллатерал вниз.

**InterestRateModel** — модель процентной ставки (растёт при высокой утилизации пула).

### Yield Siphon — как работает

1. Кто-то (keeper или пользователь) вызывает `harvestYield(marketId)`.
2. Движок смотрит, насколько подорожали доли vault'а с прошлого harvest.
3. Рост конвертируется в «доход» в единицах долга.
4. `globalDebtScale` уменьшается — все долги пропорционально снижаются.
5. **Ни один пользователь не обновляется** — они «подтягивают» новый масштаб при следующем взаимодействии.

Итого: O(1) операция, без циклов по пользователям.

### Безопасность

- **Same-block guard** — нельзя дважды взаимодействовать с позицией в одном блоке (защита от flash-loan атак).
- **Reentrancy guard** — защита от reentrancy.
- **Timelock** — критические параметры (LTV, порог ликвидации) можно менять только с задержкой.
- **Pause / Emergency Shutdown** — админ или guardian может поставить протокол на паузу.

---

## 12. Деплой на боевую сеть (Arbitrum / Base)

### 12.1. Подготовка

1. Получите RPC URL (Infura, Alchemy или публичный).
2. Получите API-ключ Arbiscan / Basescan для верификации контрактов.
3. Подготовьте кошелёк-деплоер с реальными ETH на L2.

Заполните `.env` в корне проекта:

```env
ARBISCAN_API_KEY=ваш_ключ
ARBITRUM_RPC_URL=https://arbitrum-mainnet.infura.io/v3/ваш_project_id
```

### 12.2. Деплой

```powershell
forge script script/DeployProduction.s.sol:DeployProduction --rpc-url $ARBITRUM_RPC_URL --broadcast --private-key ВАШ_КЛЮЧ --verify
```

Скрипт деплоит: OracleRelay → AuraMarketRegistry → AuraEngine (impl) → AuraProxy → регистрирует движок в реестре.

### 12.3. После деплоя

1. Пропишите `AURA_ENGINE_ADDRESS` в `backend/.env`.
2. Переведите стейблкоин (USDC) на адрес прокси — это пул ликвидности, из которого пользователи берут займы.
3. Верифицируйте контракты на Arbiscan (скрипт `script/VerifyArbitrum.sh` или `.ps1`).

### 12.4. Кто что делает в проде

- **Пользователи** — вносят свой коллатерал (доли vault'а), берут займы, погашают долг.
- **Протокол / админ** — один раз (или периодически) пополняет движок долговым токеном (USDC), чтобы из пула можно было выдавать займы. Коллатерал ETH админ **не** вносит — его приносят пользователи.

---

## 13. Апгрейд контракта

Aura использует UUPS-прокси, что позволяет обновлять логику движка без смены адреса.

### 13.1. Процедура

1. Напишите новую версию `AuraEngine.sol`.
2. Запустите скрипт:

```powershell
forge script script/UpgradeEngine.s.sol:UpgradeEngine --rpc-url $RPC_URL --broadcast --private-key ВАШ_КЛЮЧ
```

3. Проверьте storage layout (скрипт `script/CheckStorageLayout.sh`) — **нельзя** менять порядок существующих переменных, только добавлять новые в конец.

### 13.2. Важно

- Апгрейд может делать только **admin**.
- Новые переменные добавляются в `__gap` (storage gap) в `AuraStorage.sol`.
- Подробный чек-лист: см. `UPGRADE_CHECKLIST.md` в корне проекта.

---

## 14. Тестирование

### Юнит-тесты

```powershell
forge test
```

### Конкретный файл

```powershell
forge test --match-path test/Aura.t.sol -vvv
```

### Конкретный тест

```powershell
forge test --match-test testDepositAndBorrow -vvv
```

### Фаззинг (автоматические рандомные входные данные)

```powershell
forge test --match-path test/fuzz/ -vvv
```

Настройки фаззинга (`foundry.toml`): 1000 прогонов, seed `0x1234`.

### Инвариантные тесты

```powershell
forge test --match-path test/invariants/ -vvv
```

256 прогонов, глубина 50.

### Форк-тесты (на реальных данных)

```powershell
forge test --match-path test/fork/ --fork-url https://ethereum-sepolia.publicnode.com -vvv
```

### Gas snapshot

```powershell
forge snapshot
```

Результат сохраняется в `.gas-snapshot`.

---

## 15. Частые проблемы и решения

### Установка и сборка

| Проблема | Решение |
|----------|---------|
| `forge` не находится | Перезапустите терминал. Если не помогло — перезагрузите ПК или вручную добавьте Foundry в PATH. |
| `npm: command not found` | Установите Node.js с https://nodejs.org и перезапустите терминал. |
| `forge build` — ошибка компиляции | Проверьте, что `lib/forge-std` и `lib/openzeppelin-contracts` скачаны: `git submodule update --init --recursive`. |

### Деплой

| Проблема | Решение |
|----------|---------|
| Таймаут при деплое | Попробуйте другой RPC: `https://rpc2.sepolia.org` или `https://eth-sepolia.g.alchemy.com/v2/demo`. |
| `insufficient funds` | На кошельке не хватает тестового ETH для оплаты газа. Получите ещё через faucet. |

### Фронтенд и сайт

| Проблема | Решение |
|----------|---------|
| Порт 3001 или 5173 занят | Закройте другое приложение на этом порту или задайте другой `PORT` в `.env`. |
| «Failed to fetch» на сайте | Убедитесь, что бэкенд запущен на http://localhost:3001. |
| «Set AURA_ENGINE_ADDRESS» | Пропишите адрес движка в `backend/.env` и перезапустите бэкенд. |
| Кнопка Connect не реагирует | Проверьте, что MetaMask установлен и разблокирован. |

### Транзакции

| Проблема | Решение |
|----------|---------|
| «Транзакция не удастся» при Deposit | Убедитесь, что выполнили approve + deposit в vault (шаги 9.1). Без долей на кошельке депозит не пройдёт. |
| `ExceedsLTV` при Borrow | Вы пытаетесь занять больше, чем позволяет LTV. Уменьшите сумму. |
| `Execution reverted` при Repay | Выполните approve долгового токена для движка (шаг 9.4). Сумма repay не должна превышать ваш долг и баланс токенов. |
| Нечётный nonce в кошельке | В Rabby: меню → **Clear Pending**. В MetaMask: Settings → Advanced → Reset Activity. |

---

## 16. Полезные ссылки

- **Foundry Book** (документация Foundry): https://book.getfoundry.sh
- **Solidity Docs**: https://docs.soliditylang.org
- **ERC-4626 (Tokenized Vault Standard)**: https://eips.ethereum.org/EIPS/eip-4626
- **EIP-7201 (Namespaced Storage)**: https://eips.ethereum.org/EIPS/eip-7201
- **UUPS (EIP-1822)**: https://eips.ethereum.org/EIPS/eip-1822
- **Chainlink Docs**: https://docs.chain.link
- **Wagmi (React + Ethereum)**: https://wagmi.sh
- **Viem (TypeScript Ethereum)**: https://viem.sh
- **Sepolia Faucet**: https://sepoliafaucet.com

---

### Другая документация проекта

- [NOVICE-SEPOLIA.md](NOVICE-SEPOLIA.md) — пошаговая инструкция с конкретными адресами для Sepolia
- [QUICKSTART.md](QUICKSTART.md) — быстрый запуск фронта и бэкенда
- [DEPLOY.md](DEPLOY.md) — подробный деплой на любые сети
- [ARCHITECTURE.md](ARCHITECTURE.md) — архитектура проекта (диаграммы)
- [ARCHITECTURE-AND-DEATH-SPIRAL.md](ARCHITECTURE-AND-DEATH-SPIRAL.md) — алгоритм yield-siphon и защита от death spiral
- [EIP-7201-STORAGE-MAP.md](EIP-7201-STORAGE-MAP.md) — карта хранилища (storage layout)

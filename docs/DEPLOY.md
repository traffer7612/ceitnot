# Как задеплоить контракт Aura (по шагам)

Деплой делается через **Foundry** (инструмент для сборки и деплоя Solidity). Скрипт поднимает моки (тестовые токен и оракул) и сам движок Aura, после чего вы получаете адрес прокси — его нужно прописать в бэкенде.

---

## 1. Установить Foundry

**Где выполнять:** команды ниже можно вводить **из любой папки** — вы просто ставите программу Foundry в систему. Переходить в каталог `aura` на этом шаге **не нужно** (он понадобится на шаге 2).

В терминале (PowerShell или cmd) выполните:

```powershell
# Один раз: установка Foundry
winget install Foundry.Foundry
```

Либо установите с официального сайта: https://getfoundry.sh  

После установки **закройте и снова откройте терминал**, затем проверьте:

```bash
forge --version
```

Должна отобразиться версия (например `forge 0.2.0`). Если команда не находится — снова откройте терминал или перезагрузите компьютер.

---

## 2. Открыть папку проекта и поставить зависимости

**Здесь уже нужно быть в каталоге проекта.** Откройте терминал и перейдите в папку `aura` (подставьте свой путь, если проект лежит в другом месте):

```powershell
cd F:\aura
```

**Если команда `forge` не находится** (ошибка «Имя "forge" не распознано»), один раз добавьте Foundry в PATH (в том же терминале):

```powershell
$env:Path = "C:\Users\admin\.foundry\versions\stable;$env:Path"
```

Либо закройте терминал/Cursor и откройте заново — PATH мог обновиться после установки Foundry.

Установить библиотеку **forge-std** (один раз). Команда `forge install` работает только в git-репозитории, поэтому клонируйте вручную:

```powershell
cd F:\aura\lib
git clone https://github.com/foundry-rs/forge-std.git
cd F:\aura
```

Если папка `lib\forge-std` уже есть — этот шаг можно пропустить.

Собрать контракты:

```bash
forge build
```

Если сборка прошла без ошибок — переходите к шагу 3.

---

## 3. Подготовить кошелёк и сеть

- Создайте или используйте кошелёк в Метамаске (или другом).
- Узнайте **приватный ключ** этого кошелька (Настройки → Безопасность → Экспорт приватного ключа).  
  **Важно:** используйте кошелёк только для тестов и без больших средств.
- Выберите сеть:
  - **Ethereum Sepolia** (тестнет): https://sepolia.etherscan.io  
  - **Arbitrum Sepolia** (тестнет): https://sepolia.arbiscan.io  
  - Или **локальная нода** (Anvil): `anvil` в отдельном терминале, RPC: `http://127.0.0.1:8545`.

Для деплоя нужен RPC сети и приватный ключ кошелька (с которого будут списаны комиссии).

**Вариант А — Ethereum Sepolia**

- RPC (если один не отвечает — попробуйте другой):
  - `https://ethereum-sepolia.publicnode.com`
  - `https://rpc2.sepolia.org`
  - `https://eth-sepolia.g.alchemy.com/v2/demo`
  - `https://rpc.sepolia.org`
- Chain ID: 11155111
- Тестовые ETH: https://sepoliafaucet.com или https://www.alchemy.com/faucets/ethereum-sepolia
- Эксплорер: https://sepolia.etherscan.io

**Вариант Б — тестнет Arbitrum Sepolia**

- RPC: `https://sepolia-rollup.arbitrum.io/rpc`
- Тестовые ETH: https://faucet.quicknode.com/arbitrum/sepolia (или другой фаусет).

**Вариант В — локальная нода Anvil (без интернета)**

В отдельном терминале запустите:

```bash
anvil
```

Оставьте окно открытым. RPC: `http://127.0.0.1:8545`. В Anvil уже есть тестовые аккаунты с ETH.

Сохраните в переменные (в терминале, где будете запускать деплой):

**Windows (PowerShell):**

```powershell
# Ethereum Sepolia (если rpc.sepolia.org не отвечает — см. список RPC выше):
$env:RPC_URL = "https://ethereum-sepolia.publicnode.com"
# Arbitrum Sepolia:
# $env:RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc"
# Anvil:
# $env:RPC_URL = "http://127.0.0.1:8545"
```

Приватный ключ задаётся в команде деплоя на шаге 4 (см. ниже).

---

## 4. Запустить деплой

В папке `F:\aura` выполните (подставьте свой RPC и ключ):

**Свой кошелёк (подставьте свой приватный ключ и RPC):**

```powershell
forge script script/Deploy.s.sol:DeployScript --rpc-url $env:RPC_URL --broadcast --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
```

Пример для **локальной Anvil** (тестовый ключ из Anvil):

1. В **одном** терминале запустите и не закрывайте: **`anvil`**
2. В **другом** терминале выполните:

```powershell
cd F:\aura
$env:RPC_URL = "http://127.0.0.1:8545"
forge script script/Deploy.s.sol:DeployScript --rpc-url $env:RPC_URL --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**Или** одной командой (Anvil должен быть уже запущен в другом окне):

```powershell
cd F:\aura
.\scripts\deploy-anvil.ps1
```

Скрипт `deploy-anvil.ps1` сам подставит адрес контракта в `backend\.env`; после этого перезапустите бэкенд.

**Пример для Ethereum Sepolia:**

1. Получите тестовые ETH на Sepolia (см. фаусеты выше).
2. В терминале:

```powershell
cd F:\aura
forge script script/Deploy.s.sol:DeployScript --rpc-url https://ethereum-sepolia.publicnode.com --broadcast --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
```

3. В выводе скопируйте адрес из строки `AURA_ENGINE_ADDRESS=0x...` и вставьте в `backend\.env`. Перезапустите бэкенд.
4. В приложении подключите кошелёк и выберите сеть **Sepolia** в MetaMask/Rabby — Deposit/Borrow/Repay будут отправляться в Sepolia.

Скрипт деплоя:

- задеплоит моки (тестовый токен, «валюту» и оракул);
- задеплоит AuraEngine и прокси;
- выведет в конец строку вида: **`AURA_ENGINE_ADDRESS=0x...`**

Скопируйте этот адрес `0x...` (без слова `AURA_ENGINE_ADDRESS=`).

---

## 5. Прописать адрес в бэкенде

1. Откройте файл **`backend\.env`**.
2. Замените значение в строке с движком:

```env
AURA_ENGINE_ADDRESS=0xВставьте_сюда_адрес_из_шага_4
```

3. Сохраните файл и **перезапустите бэкенд** (остановите через Ctrl+C и снова запустите `npm run dev` в папке `backend`).

После этого фронтенд сможет обращаться к контракту: покажет позицию и кнопки Deposit / Borrow / Repay.

---

## 6. Первый депозит на Sepolia (если MetaMask пишет «транзакция не удастся»)

В интерфейсе **Deposit** отправляет в движок **доли валюты (vault shares)**, а не ETH. У деплоера есть только «сырой» мок-токен; доли нужно один раз получить.

**Шаг 1.** Узнайте адрес валюты и токена (подставьте свой `ENGINE` и RPC):

```powershell
# Адрес валюты (ERC-4626) — это и есть «asset» движка
cast call ENGINE "asset()(address)" --rpc-url https://ethereum-sepolia.publicnode.com
# Пусть это VAULT (например 0x...)

# Адрес базового токена валюты
cast call VAULT "asset()(address)" --rpc-url https://ethereum-sepolia.publicnode.com
# Пусть это ASSET (например 0x...)
```

Либо в выводе деплоя теперь есть строки `AURA_VAULT_4626_ADDRESS=0x...` и `MOCK_ASSET_ADDRESS=0x...` — можно взять оттуда (при следующем деплое).

**Шаг 2.** Разрешите валюте забирать ваш мок-токен и положите токены в валюту (получите доли). Пример на 1e18 (1 токен):

```powershell
# Approve: ASSET разрешает VAULT забирать токены
cast send ASSET "approve(address,uint256)" VAULT 1000000000000000000 --rpc-url https://ethereum-sepolia.publicnode.com --private-key ВАШ_КЛЮЧ

# Deposit: вы отдаёте 1e18 токенов валюте и получаете 1e18 долей на свой адрес
cast send VAULT "deposit(uint256,address)" 1000000000000000000 ВАШ_АДРЕС --rpc-url https://ethereum-sepolia.publicnode.com --private-key ВАШ_КЛЮЧ
```

**Шаг 3.** В приложении на сайте в поле **Deposit** введите **1** (это 1e18 долей) и нажмите кнопку — транзакция должна пройти.

Итого: коллатерал в Aura — это доли валюты; сначала нужно получить доли через `approve` + `vault.deposit`, затем уже вызывать Deposit в интерфейсе.

---

## Как проверить

**Контракты (без деплоя):**

```powershell
cd F:\aura
forge --version          # должна быть версия (например 1.5.1-stable)
forge build              # в конце: Compiler run successful
forge test               # тесты проходят (опционально)
```

**Бэкенд:**

```powershell
cd F:\aura\backend
npm run dev
```

В браузере откройте: **http://localhost:3001/api/health** — должна вернуться строка с `"status":"ok"`.

**Фронтенд:**

В другом терминале:

```powershell
cd F:\aura\frontend
npm run dev
```

Откройте **http://localhost:5173** — должна загрузиться страница Aura, кнопка «Connect wallet».

**После деплоя:**

1. В `backend\.env` записан адрес из вывода скрипта (`AURA_ENGINE_ADDRESS=0x...`), бэкенд перезапущен.
2. На http://localhost:5173 подключаете кошелёк (в той же сети, куда деплоили: Anvil или Arbitrum Sepolia).
3. Должны отображаться блок «Your position» (коллатерал, долг, health factor) и вкладки Deposit / Borrow / Repay без сообщения «Set AURA_ENGINE_ADDRESS…».

---

## Кратко по шагам

| Шаг | Действие |
|-----|----------|
| 1 | Установить Foundry (`winget install Foundry.Foundry`), перезапустить терминал |
| 2 | `cd F:\aura` → `forge install foundry-rs/forge-std --no-commit` → `forge build` |
| 3 | Задать `RPC_URL` (тестнет или Anvil); ключ передать в команде деплоя |
| 4 | `forge script script/Deploy.s.sol:DeployScript --rpc-url $env:RPC_URL --broadcast --private-key ВАШ_КЛЮЧ` |
| 5 | Скопировать из вывода `AURA_ENGINE_ADDRESS=0x...` и вставить в `backend\.env` → перезапустить бэкенд |

Если на каком-то шаге появится ошибка — пришлите её текст (или скрин), можно будет точечно подсказать, что исправить.

---

## Ошибка «HTTP error 502 with empty body» при деплое в Anvil

1. **Anvil должен быть запущен до команды forge script.** В одном терминале: `anvil`, в другом — деплой.
2. **Проверьте, что RPC доступен.** В PowerShell:
   ```powershell
   Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method Post -Body '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' -ContentType "application/json"
   ```
   Должен вернуться объект с `result` (например `0x7a69`). Если ошибка — Anvil не слушает или порт занят.
3. **Укажите URL явно** (без переменной):
   ```powershell
   forge script script/Deploy.s.sol:DeployScript --rpc-url "http://127.0.0.1:8545" --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
   Или попробуйте **http://localhost:8545** вместо 127.0.0.1.
4. **Запустите Anvil с явным хостом:** `anvil --host 127.0.0.1`
5. **Прокси / 502:** часто 502 даёт прокси (VPN, антивирус, корпоративная сеть). В **том же** терминале, где запускаете forge, выполните и сразу после — команду деплоя:
   ```powershell
   $env:NO_PROXY = "localhost,127.0.0.1"
   $env:HTTP_PROXY = ""
   $env:HTTPS_PROXY = ""
   forge script script/Deploy.s.sol:DeployScript --rpc-url "http://127.0.0.1:8545" --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
   Или откройте **cmd.exe** (не PowerShell), перейдите в `F:\aura` и выполните:
   ```cmd
   set NO_PROXY=localhost,127.0.0.1
   set HTTP_PROXY=
   set HTTPS_PROXY=
   forge script script/Deploy.s.sol:DeployScript --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```
6. **Если 502 не исчезает** — деплой в **Arbitrum Sepolia** (тестнет в интернете): получите тестовые ETH с фаусета, затем:
   ```powershell
   forge script script/Deploy.s.sol:DeployScript --rpc-url "https://sepolia-rollup.arbitrum.io/rpc" --broadcast --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
   ```
   Адрес из вывода запишите в `backend\.env`; во фронте подключите кошелёк к сети Arbitrum Sepolia.

---

## Боевой деплой с USDC

Чтобы запустить протокол в боевой сети с **USDC** как долговым токеном (без моков), нужны уже существующие контракты в выбранной сети и отдельный скрипт деплоя.

### Что нужно заранее (простыми словами)

Перед деплоем нужны **три вещи** — у каждой есть свой контракт в сети. Вам нужны только их **адреса** (как ссылки), сами контракты вы не пишете.

**1. USDC (то, что выдают в долг)**  
Это стабильная монета, которую пользователи будут занимать. В каждой сети у USDC свой адрес контракта. Вы его просто подставляете в скрипт. Важно: новые USDC вы создать не можете — кто-то (вы или казна протокола) должен **перевести** уже существующие USDC на контракт движка, чтобы из них выдавать займы.

**2. Collateral vault (залог)**  
Это контракт, чьи «доли» пользователи вносят как **залог**. Например, wstETH — это обёртка над стейкированным эфиром: пользователь вносит такие доли, протокол считает их залогом и даёт под них займ в USDC. Нужен любой контракт стандарта ERC-4626 (такой vault). Вам нужен только его адрес в выбранной сети.

**3. Оракул (цена залога)**  
Протоколу нужно знать, сколько стоит залог в USDC — чтобы решать, сколько можно дать в долг и когда ликвидировать. Для этого подключают **оракул** — контракт, который отдаёт текущую цену. Обычно используют Chainlink: у них есть «фиды» (агрегаторы) типа ETH/USD. Наш код ждёт, что оракул вернёт цену в определённом формате (сколько USDC за одну условную единицу коллатерала). У Chainlink цена часто в 8 знаках после запятой, а у USDC — 6; тогда между Chainlink и движком ставят маленький контракт-**адаптер**, который переводит формат. Если не хочется разбираться — можно взять уже готовый адаптер или попросить кого-то написать один раз.

### Шаг 1. Где взять адреса

Их ищут в блокэксплорере (Etherscan и т.п.) или в списках контрактов сети. Примеры (проверьте актуальность):

- **Ethereum Mainnet:** USDC — `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`. Цена ETH в долларах (Chainlink) — например `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`. Vault под ваш залог (например wstETH) — по документации Lido или другого сервиса.
- **Arbitrum One:** USDC — `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`. Остальное — в каталоге Chainlink для Arbitrum и в доке выбранного vault.
- **Base:** USDC — `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Аналогично: свой vault и фид цены для коллатерала.

#### Как искать адреса по шагам

**USDC**  
Официальный список контрактов Circle (эмитент USDC): https://developers.circle.com/stablecoins/docs/usdc-on-main-networks — выберите сеть (Ethereum, Arbitrum, Base) и скопируйте адрес USDC. Либо в Google: «USDC contract address Arbitrum» (подставьте свою сеть) — обычно первая ссылка ведёт на Etherscan или на Circle.

**Оракул цены (Chainlink)**  
Сайт с фидами Chainlink: https://data.chain.link (или https://docs.chain.link/data-feeds/price-feeds). Выберите сеть (Ethereum, Arbitrum, Base) и пару, например **ETH / USD**. В таблице будет колонка «Contract Address» — это адрес агрегатора, его и подставляете в `CHAINLINK_FEED`. Если залог не ETH, а например stETH, ищите пару **STETH / USD** или **ETH / USD** (часто используют цену ETH для stETH).

**Collateral vault (залог)**  
Зависит от того, что вы принимаете в залог. Примеры:
- **wstETH (Lido):** зайдите на https://lido.fi или в их документацию, раздел «Contract addresses» — выберите сеть и найдите адрес контракта wstETH (это и есть ERC-4626 vault в их случае).
- **Другой протокол:** откройте официальный сайт или docs, найдите раздел «Smart contracts» / «Addresses» и скопируйте адрес токена или vault’а, который соответствует ERC-4626 (доли, которые можно вносить в Aura как коллатерал).

**Токен есть в одной сети, нужен в другой (например wstETH на Arbitrum)**  
Адрес контракта в каждой сети свой. Как найти:
1. Документация протокола — раздел с адресами по сетям (Lido: [lido.fi](https://lido.fi), раздел про L2).
2. Блокэксплорер нужной сети: Arbiscan → в поиске ввести название токена (например «wstETH») и посмотреть верифицированные контракты с таким именем.
3. В Google: «wstETH contract address Arbitrum» — часто ведёт на Arbiscan или на официальную страницу.  
На Arbitrum One адрес wstETH (Lido): **`0x5979D7b546E38E414F7E9822514be443A4800529`** (прокси, его и подставляют в скрипт). Проверьте актуальность на [Arbiscan](https://arbiscan.io) или в документации Lido.

**Проверка адреса**  
Откройте блокэксплорер нужной сети (etherscan.io для Ethereum, arbiscan.io для Arbitrum, basescan.org для Base), вставьте адрес в поиск. Убедитесь, что контракт верифицирован и что это тот токен (название, символ совпадают).

В скрипт деплоя вы передаёте адрес **Chainlink-агрегатора** (или вашего адаптера). Если фид отдаёт цену в 8 decimals, а долг в USDC (6 decimals), между ними нужен адаптер с функцией `getLatestPrice() returns (uint256 value, uint256 timestamp)`, где `value` — цена в том формате, который ждёт движок (сколько USDC за 1e18 единиц коллатерала).

### Шаг 2. Скрипт боевого деплоя

В проекте есть скрипт `script/DeployProduction.s.sol`. Он не создаёт моки, а принимает адреса через переменные окружения и деплоит только движок и оракул.

Задайте переменные (подставьте свои адреса и сеть):

```powershell
$env:COLLATERAL_VAULT = "0x..."   # ERC-4626 vault
$env:USDC_ADDRESS = "0x..."       # USDC в выбранной сети
$env:CHAINLINK_FEED = "0x..."     # Chainlink-агрегатор (или адрес вашего адаптера)
$env:FALLBACK_FEED = "0x0"        # или адрес fallback-оракула
$env:TWAP_PERIOD = "0"            # 0 = только spot
```

Запуск (подставьте RPC и приватный ключ):

```powershell
cd F:\aura
forge script script/DeployProduction.s.sol:DeployProduction --rpc-url https://... --broadcast --private-key ВАШ_КЛЮЧ
```

В выводе будут строки `AURA_ENGINE_ADDRESS=0x...` и `ORACLE_RELAY_ADDRESS=0x...`. Адрес движка запишите в `backend\.env`.

#### Пример: Arbitrum One (готовые адреса)

Если деплоите на **Arbitrum One** с USDC, ETH/USD-фидом и wstETH как залогом:

1. **Перед деплоем:** на кошельке должны быть **ETH в сети Arbitrum** (на газ). RPC Arbitrum, например: `https://arb1.arbitrum.io/rpc` или `https://arbitrum-one-rpc.publicnode.com`.

2. **Переменные и деплой** (подставьте только `ВАШ_ПРИВАТНЫЙ_КЛЮЧ`):

```powershell
cd F:\aura

$env:COLLATERAL_VAULT = "0x5979D7b546E38E414F7E9822514be443A4800529"
$env:USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
$env:CHAINLINK_FEED = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"
$env:FALLBACK_FEED = "0x0000000000000000000000000000000000000000"
$env:TWAP_PERIOD = "0"

forge script script/DeployProduction.s.sol:DeployProduction --rpc-url https://arb1.arbitrum.io/rpc --broadcast --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ
```

3. В выводе скопируйте значение **`AURA_ENGINE_ADDRESS=0x...`** и вставьте в `backend\.env` в строку `AURA_ENGINE_ADDRESS=...`. Перезапустите бэкенд.

4. **Пополнить движок USDC** (см. шаг 3 ниже): переведите USDC на адрес движка. Без этого займы выдавать не из чего.

### Шаг 3. Пополнить движок USDC

После деплоя на балансе движка (прокси) **0 USDC**. Пользователи смогут брать в долг только после того, как кто-то переведёт USDC на контракт движка.

Пример (сумма в wei USDC; у USDC 6 decimals, 10_000 USDC = 10_000 * 1e6):

```powershell
cast send USDC_ADDRESS "transfer(address,uint256)" AURA_ENGINE_ADDRESS 10000000000 --rpc-url ... --private-key ВАШ_КЛЮЧ
```

(10_000_000_000 = 10_000 USDC). Дальше ликвидность пополняется и за счёт погашений (Repay).

### Шаг 4. Фронт и бэкенд

- В `backend\.env` укажите `AURA_ENGINE_ADDRESS` и при необходимости RPC для боевой сети.
- Бэкенд уже поддерживает chainId для Arbitrum (42161) и Base (8453); при необходимости добавьте mainnet (1) в `stats.ts` и в конфиг цепочки фронта.
- **Важно:** USDC имеет **6 decimals**. В текущем фронте Borrow/Repay используют `parseEther` (18 decimals). Для боевого USDC нужно передавать в контракт суммы в 6 decimals (например, через `parseUnits(amount, 6)` и отображать через `formatUnits(..., 6)`). Это потребует правки фронта и/или конфига «децималы долгового токена».

### Краткий чеклист боевого запуска

1. Выбрать сеть (Ethereum / Arbitrum / Base).
2. Подготовить адреса: USDC, ERC-4626 vault, оракул (Chainlink или адаптер).
3. Выставить `COLLATERAL_VAULT`, `USDC_ADDRESS`, `CHAINLINK_FEED` и выполнить `DeployProduction`.
4. Перевести USDC на адрес движка.
5. Прописать движок в `backend\.env`, при необходимости добавить сеть во фронт и бэкенд.
6. На фронте учесть 6 decimals для USDC (Borrow/Repay и отображение).

# Полные команды: коллатерал (wstETH) на Arbitrum One

Используются адреса твоего деплоя на **Arbitrum One**:

- **wstETH (vault = коллатерал):** `0x5979D7b546E38E414F7E9822514be443A4800529`
- **Движок Aura (proxy):** `0xeE18DcB25F95459BF3174ADB8792f83d8B9b0D70`

На Arbitrum коллатерал — сам токен wstETH (1:1 с «долями»), отдельный vault не нужен.

---

## Что подставить

- `ВАШ_ПРИВАТНЫЙ_КЛЮЧ` — приватный ключ кошелька (с которого делаешь депозит).
- RPC Arbitrum — можно взять, например: `https://arb1.arbitrum.io/rpc` или задать переменную `$env:ARBITRUM_RPC_URL`.

---

## Шаг 1. Разрешить движку забирать wstETH (approve)

Выполнить **один раз** (или повторно, если сменил сумму):

```powershell
cd F:\aura

cast send 0x5979D7b546E38E414F7E9822514be443A4800529 "approve(address,uint256)" 0xeE18DcB25F95459BF3174ADB8792f83d8B9b0D70 (cast max-uint) --rpc-url "https://arb1.arbitrum.io/rpc" --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ --chain 42161
```

Если используешь переменную RPC:

```powershell
$env:ARBITRUM_RPC_URL = "https://arb1.arbitrum.io/rpc"
cast send 0x5979D7b546E38E414F7E9822514be443A4800529 "approve(address,uint256)" 0xeE18DcB25F95459BF3174ADB8792f83d8B9b0D70 (cast max-uint) --rpc-url $env:ARBITRUM_RPC_URL --private-key ВАШ_ПРИВАТНЫЙ_КЛЮЧ --chain 42161
```

---

## Шаг 2. Внести коллатерал на сайте Aura

1. Открой фронт (например `http://localhost:5173`), подключи кошелёк, выбери сеть **Arbitrum One**.
2. Вкладка **Deposit**.
3. В поле «Collateral shares (wstETH)» введи **количество wstETH** (как на балансе, например `0.00332`).
4. Нажми **Deposit collateral** и подтверди транзакцию в MetaMask.

После этого в «Your position» появится внесённый коллатерал, можно переходить к **Borrow** (займ USDC).

---

## Кратко

| Действие | Команда / место |
|----------|------------------|
| Approve wstETH → движок | `cast send` выше (шаг 1) |
| Deposit коллатерала | Сайт Aura → Deposit → ввести сумму wstETH → «Deposit collateral» |

---

## Borrow (после депозита)

Когда коллатерал внесён, на вкладке **Borrow** вводишь сумму USDC и подтверждаешь — USDC придут на кошелёк. Для **Repay** нужны USDC на кошельке и один раз approve долгового токена (USDC) движку, затем кнопка Repay на сайте.

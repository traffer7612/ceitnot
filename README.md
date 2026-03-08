# Aura: The Autonomous Yield-Backed Credit Engine

Production-ready DeFi primitive that lets protocols or users deposit **yield-bearing assets** (ERC-4626, e.g. stETH or sDAI) as collateral to **borrow stablecoins**. The **Yield Siphon** captures yield from collateral and applies it directly to principal debt in real time (self-liquidating debt).

## Features

- **UUPS upgradeability (EIP-1822)** and **EIP-7201 namespaced storage** for zero storage collision across upgrades
- **ERC-4626**: Collateral is any ERC-4626 vault; 4626 view adapter for `totalAssets` / `convertTo*`
- **High-precision accounting**: WAD (1e18) and RAY (1e27); global debt index for yield distribution
- **O(1) stream-settlement**: Yield applied via `globalDebtScale`; users settle lazily on next interaction
- **Multi-oracle**: Chainlink primary + RedStone (or other) fallback with staleness checks
- **Circuit breakers**: Pause and emergency shutdown
- **Flash-loan protection**: Same-block interaction guard per position
- **AccessControl & Timelock**: Admin role; critical params (LTV, liquidation threshold/penalty) changed only after timelock
- **L2-ready**: Arbitrum / Base compatible (Cancun EVM, no L1-specific opcodes)

## Contracts

| Contract | Description |
|----------|-------------|
| `AuraEngine` | Core logic: deposit/withdraw collateral, borrow/repay, harvest yield, liquidate, flash loans, delegation |
| `AuraProxy` | UUPS proxy (EIP-1822 / EIP-1967); deploy with implementation + initializer calldata |
| `AuraStorage` | EIP-7201 namespaced storage layout |
| `AuraMarketRegistry` | Multi-market registry: vault, oracle, risk params, caps, isolation mode |
| `OracleRelay` | Multi-oracle V1 (Chainlink primary + fallback, TWAP, staleness check) |
| `OracleRelayV2` | Multi-source median oracle, circuit breaker, L2 sequencer uptime feed |
| `AuraUSD` | Mintable stablecoin (aUSD) for CDP mode, EIP-2612 permit |
| `AuraPSM` | Peg Stability Module: 1:1 swaps aUSD ↔ pegged stable (USDC/DAI) |
| `AuraRouter` | Stateless router: atomic deposit+borrow, repay+withdraw, permit, leverage |
| `AuraTreasury` | Protocol treasury: deposit, withdraw, batch distribute |
| `AuraToken` | Governance ERC-20 + ERC20Votes (EIP-6372 timestamp clock) |
| `VeAura` | Vote-Escrow AURA: lock → voting power + revenue share |
| `AuraGovernor` | OpenZeppelin Governor + TimelockControl + VotesQuorumFraction |
| `InterestRateModel` | Kink-based interest rate model |
| `FixedPoint` | WAD/RAY math and scale-after-yield |
| `Multicall` | Batch delegatecall for atomic admin operations |
| `AuraVault4626` | ERC-4626 view adapter over engine collateral |

## Build & Test

```bash
# Install dependencies (OpenZeppelin optional; UUPS is in-repo)
forge install

# Build
forge build

# Test
forge test
```

## Deployment (conceptual)

1. Deploy `AuraEngine` (implementation).
2. Deploy `AuraProxy(implementation, abi.encodeCall(AuraEngine.initialize, (collateralVault, debtToken, oracleRelay, ltvBps, liquidationThresholdBps, liquidationPenaltyBps, heartbeat, timelockDelay)))`.
3. Use the proxy address as the “engine” for integrations.
4. Optionally deploy `OracleRelay(chainlinkFeed, redstoneFeed, twapPeriod)` and `AuraVault4626(proxy)`.

## Быстрый старт (для новичков)

- **Всё по шагам от нуля до депозита на Sepolia:** **[docs/NOVICE-SEPOLIA.md](docs/NOVICE-SEPOLIA.md)** — одна инструкция, копируй команды и вставляй в терминал.
- Запуск бэкенда и фронта: **[docs/QUICKSTART.md](docs/QUICKSTART.md)**.
- Задеплоить контракт (подробно, любые сети): **[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

## Frontend & Backend

**Backend** (API: config, stats, health):

```bash
cd backend
cp .env.example .env   # set AURA_ENGINE_ADDRESS if you have a deployed engine
npm install
npm run dev           # http://localhost:3001
```

**Frontend** (Vite + React + Wagmi):

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173, proxies /api to backend
```

Connect a wallet (Arbitrum or Base); the dashboard shows your position and lets you deposit collateral, borrow, and repay. Set `AURA_ENGINE_ADDRESS` in the backend so the app can read stats and contract addresses.

## Security

- **296 tests passing** (unit, security, flash-loan, governance, CDP/PSM, router, oracle, fuzz ×1000, invariants ×256)
- **Slither v0.11.3** static analysis: 264 findings → all High/Medium fixed; Low/Info accepted
- **0 critical vulnerabilities**
- Full report: **[docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)**

## Documentation

- **Contracts API reference:** [docs/CONTRACTS.md](docs/CONTRACTS.md)
- **Security audit:** [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)
- **Changelog:** [docs/CHANGELOG.md](docs/CHANGELOG.md)
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Storage layout:** [docs/EIP-7201-STORAGE-MAP.md](docs/EIP-7201-STORAGE-MAP.md)
- **Death-spiral analysis:** [docs/ARCHITECTURE-AND-DEATH-SPIRAL.md](docs/ARCHITECTURE-AND-DEATH-SPIRAL.md)
- **Beginner guide (RU):** [docs/BEGINNER-GUIDE.md](docs/BEGINNER-GUIDE.md)

## License

MIT

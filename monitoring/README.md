# Aura Protocol — Monitoring & Alerting

Operational monitoring for AuraEngine on Arbitrum One.
Two parallel stacks are supported: **OpenZeppelin Defender** and **Tenderly**.

---

## Directory Structure

```
monitoring/
├── defender/
│   ├── liquidation-monitor.json   — Large liquidations + bad debt
│   ├── oracle-monitor.json        — OracleRelayV2 circuit breaker
│   ├── pause-monitor.json         — Pause, emergency shutdown, admin changes
│   └── autotasks/
│       └── alert-webhook.js       — Webhook relay Autotask (Slack / PagerDuty)
└── tenderly.yaml                  — Equivalent alerts for Tenderly
```

---

## Events Monitored

| Event | Contract | Severity | Description |
|-------|----------|----------|-------------|
| `Liquidated` | AuraEngine | Warning | Any liquidation (filter by `repayAmount` threshold) |
| `BadDebtRealized` | AuraEngine | Critical | Uncollateralised bad debt written off |
| `PriceDeviationBreached` | OracleRelayV2 | Critical | Circuit breaker tripped; price feeds halted |
| `CircuitBreakerReset` | OracleRelayV2 | Info | Admin cleared the circuit breaker |
| `PausedSet` | AuraEngine | Warning | Protocol paused or unpaused |
| `EmergencyShutdownSet` | AuraEngine | Critical | Emergency shutdown toggled |
| `AdminTransferred` | AuraEngine | Warning | Admin role transferred |
| `AdminProposed` | AuraEngine | Info | Two-step admin transfer initiated |
| `YieldHarvested` | AuraEngine | Info | Yield applied to debt principal |

---

## Setup — OpenZeppelin Defender

### Prerequisites
- Defender account at https://defender.openzeppelin.com
- Contracts verified on Arbiscan (run `script/VerifyArbitrum.sh`)

### Steps

1. **Create a Notification Channel**
   Defender Dashboard → Notifications → Create Channel (Email, Slack, PagerDuty, or Webhook).
   Copy the channel ID into `${DEFENDER_NOTIFICATION_CHANNEL_ID}` in each JSON file.

2. **Create Monitors**
   For each JSON file in `monitoring/defender/`:
   - Replace placeholder addresses:
     - `${ENGINE_PROXY_ADDRESS}` → your AuraEngine proxy address
     - `${ORACLE_RELAY_V2_ADDRESS}` → your OracleRelayV2 address
   - Defender Dashboard → Monitors → Create Monitor → paste the JSON, or
   - Use the Defender API: `POST https://defender.openzeppelin.com/v2/monitor`

3. **Deploy the Autotask** (optional — for Slack/PagerDuty relay)
   - Defender Dashboard → Autotasks → Create Autotask
   - Upload `monitoring/defender/autotasks/alert-webhook.js`
   - Set Secrets: `WEBHOOK_URL`, `PAGERDUTY_KEY`, `SLACK_WEBHOOK_URL`
   - Attach the Autotask as the trigger action in each Monitor

### Required Secrets (Autotask)

| Secret | Description |
|--------|-------------|
| `WEBHOOK_URL` | Generic POST webhook endpoint |
| `PAGERDUTY_KEY` | PagerDuty Events API v2 integration key |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

---

## Setup — Tenderly

### Prerequisites
- Tenderly account and project at https://dashboard.tenderly.co
- Tenderly CLI: `npm install -g @tenderly/cli`

### Steps

1. Update `monitoring/tenderly.yaml`:
   - Replace `${ENGINE_PROXY_ADDRESS}` and `${ORACLE_RELAY_V2_ADDRESS}`
   - Replace `${ALERT_WEBHOOK_URL}` with your webhook endpoint
   - Set `project.slug` to match your Tenderly project

2. Import via dashboard or CLI:
   ```bash
   tenderly login
   tenderly push   # deploys Tenderly Actions if configured
   # Alerts are created manually in the dashboard using the YAML as reference
   ```

3. In the Tenderly Dashboard:
   - Navigate to your project → Alerts → Create Alert
   - Configure each alert using the event signatures and addresses from `tenderly.yaml`

---

## ABI Event Signatures Reference

```
Liquidated(address,address,uint256,uint256,uint256)
BadDebtRealized(address,uint256,uint256)
PriceDeviationBreached(uint256,uint256,uint256)
CircuitBreakerReset(address,uint256)
PausedSet(bool)
EmergencyShutdownSet(bool)
AdminTransferred(address,address)
AdminProposed(address,address)
YieldHarvested(uint256,uint256,uint256,uint256,uint256)
```

---

## Incident Response

| Alert | Immediate Action |
|-------|-----------------|
| `PriceDeviationBreached` | Investigate oracle feeds; Safe calls `resetCircuitBreaker()` when confirmed |
| `EmergencyShutdownSet(true)` | All new borrows halted; users may still repay/withdraw |
| `BadDebtRealized` | Assess protocol solvency; consider pausing new markets |
| `AdminTransferred` | Verify the new admin is the expected Safe address |

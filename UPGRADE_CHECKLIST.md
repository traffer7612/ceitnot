# AuraEngine Upgrade Checklist

This document must be followed in full before and during every AuraEngine upgrade.
All steps are mandatory. Do not proceed to the next step until the current step passes.

---

## 0. Pre-work (days before upgrade)

- [ ] Prepare the new `AuraEngine` implementation in a feature branch
- [ ] Open a PR; ensure CI is green (all 296+ tests passing)
- [ ] Request an audit or internal security review of the diff
- [ ] Confirm `UPGRADE_INTERFACE_VERSION` constant has been updated in the new implementation
- [ ] Confirm no new state variables were added directly to `AuraEngine.sol`
      (all new fields must go into `AuraStorage.EngineStorage` and consume from `__gap`)
- [ ] Confirm `__gap` size was reduced by exactly the number of new fields added

---

## 1. Storage Layout Verification (required gate)

Run the check script from the repo root. It must exit 0 before proceeding.

```bash
bash script/CheckStorageLayout.sh
```

Expected output:
```
[PASS] AuraEngine: no regular storage variables (EIP-7201 intact)
[PASS] AuraStorage.sol hash matches baseline
[PASS] AuraMarketRegistry layout matches baseline
[PASS] OracleRelayV2 layout matches baseline
Results: 4 passed, 0 failed
```

If the AuraStorage struct was intentionally extended:
1. Verify the diff only appends new fields (no insertions / reorderings)
2. Verify `__gap` shrank by the correct number of slots
3. Update the baseline: `bash script/CheckStorageLayout.sh --update`
4. Commit the updated baseline files in `storage-layouts/`

---

## 2. Test Suite Verification

```bash
forge test --via-ir -v
```

All tests must pass. Zero failures, zero unexpected skips.

---

## 3. Deploy New Implementation

Deploy the new implementation contract (do NOT call initialize):

```bash
forge script script/DeployMultisig.s.sol ... # or a dedicated impl-only script
```

Or deploy manually:
```bash
forge create src/AuraEngine.sol:AuraEngine \
  --rpc-url $RPC_URL \
  --private-key $DEPLOYER_KEY
```

Note the new implementation address as `NEW_IMPLEMENTATION`.

Verify it on Arbiscan:
```bash
forge verify-contract $NEW_IMPLEMENTATION src/AuraEngine.sol:AuraEngine \
  --chain-id 42161 --watch
```

---

## 4. Dry-Run — Generate Safe Calldata

Generate the `upgradeToAndCall` calldata without broadcasting:

```bash
DRY_RUN=true \
ENGINE_PROXY=$ENGINE_PROXY \
NEW_IMPLEMENTATION=$NEW_IMPLEMENTATION \
forge script script/UpgradeEngine.s.sol --rpc-url $RPC_URL -vv
```

Copy the printed calldata. Verify it decodes correctly:
```bash
cast 4byte-decode <calldata>
# Should show: upgradeToAndCall(address, bytes)
```

---

## 5. TimelockController Queue (if governance-gated)

If the engine admin is a `TimelockController` (governance flow):

```bash
# Queue the upgrade (minimum delay must elapse before execution)
cast send $TIMELOCK_ADDRESS \
  "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  $ENGINE_PROXY 0 <upgrade_calldata> 0x00 <salt> $TIMELOCK_MIN_DELAY \
  --rpc-url $RPC_URL \
  --private-key $PROPOSER_KEY

# Wait for delay period (check: cast call $TIMELOCK "getMinDelay()")

# Execute after delay
cast send $TIMELOCK_ADDRESS \
  "execute(address,uint256,bytes,bytes32,bytes32)" \
  $ENGINE_PROXY 0 <upgrade_calldata> 0x00 <salt> \
  --rpc-url $RPC_URL \
  --private-key $EXECUTOR_KEY
```

---

## 6. Gnosis Safe Execution (primary flow)

If the engine admin is the Gnosis Safe:

1. Open the Safe at https://app.safe.global
2. Navigate to **Transaction Builder** (Apps → Transaction Builder)
3. Enter:
   - **To**: `ENGINE_PROXY` address
   - **Value**: 0
   - **Data**: paste the calldata from Step 4
4. Review decoded function call: `upgradeToAndCall(newImpl, data)`
5. Submit and collect the required signatures (3/5 or 4/7)
6. Execute the transaction once threshold is reached

---

## 7. Post-Upgrade Verification

Immediately after the Safe transaction confirms:

### 7a. Verify the implementation slot
```bash
cast storage $ENGINE_PROXY \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
# Should equal: 0x000...000<NEW_IMPLEMENTATION_ADDRESS>
```

### 7b. Verify UPGRADE_INTERFACE_VERSION
```bash
cast call $ENGINE_PROXY "UPGRADE_INTERFACE_VERSION()(string)"
# Should return the new version string
```

### 7c. Smoke test — read key state (must not revert)
```bash
cast call $ENGINE_PROXY "admin()(address)"
cast call $ENGINE_PROXY "getGlobalDebtScale(uint256)(uint256)" 0
cast call $ENGINE_PROXY "healthFactor(address)(uint256)" $SOME_USER
```

### 7d. Run fork tests against live state
```bash
ARBITRUM_RPC_URL=$RPC_URL forge test --match-path test/fork/AuraFork.t.sol -v
```

### 7e. Check Defender / Tenderly monitors are receiving events
Submit a small test transaction (e.g. a tiny deposit) and confirm the monitors
fire without errors.

---

## 8. Post-Upgrade Documentation

- [ ] Update deployment addresses doc with new implementation address
- [ ] Tag the git commit: `git tag v<major>.<minor>.<patch>-impl`
- [ ] Update `UPGRADE_INTERFACE_VERSION` in `src/AuraEngine.sol` if not already done
- [ ] Update storage layout baselines if struct was extended:
      `bash script/CheckStorageLayout.sh --update && git commit -m "chore: update storage layout baselines"`
- [ ] Post upgrade summary to governance forum / Discord

---

## Emergency Rollback

If the upgrade introduces a critical bug:

1. Prepare a rollback implementation (the previous `AuraEngine` binary)
2. Repeat Steps 4–6 pointing `NEW_IMPLEMENTATION` to the rollback address
3. The previous implementation still has `UPGRADE_INTERFACE_VERSION` = old value
4. Note: storage changes from the upgrade cannot be rolled back — only code changes

---

## Key Addresses Reference

| Name | Address |
|------|---------|
| AuraEngine Proxy | *(fill in after deploy)* |
| AuraMarketRegistry | *(fill in after deploy)* |
| OracleRelayV2 | *(fill in after deploy)* |
| Gnosis Safe (Admin) | *(fill in)* |
| TimelockController | *(fill in if governance-gated)* |
| EIP-1967 Implementation Slot | `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` |
| EIP-7201 Storage Slot | `0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500` |

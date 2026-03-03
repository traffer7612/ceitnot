# Aura: Architecture & Death-Spiral Handling

## 1. Yield-Distribution Algorithm (Stream-Settlement)

### Design

- **Global index:** One `globalDebtScale` (RAY) is shared by all positions. Effective total debt is  
  `totalDebt = totalPrincipalDebt * globalDebtScale / RAY`.
- **Per-position:** Each position stores `principalDebt` (WAD) and `scaleAtLastUpdate` (RAY). Current debt is computed as  
  `debt = principalDebt * globalDebtScale / scaleAtLastUpdate` (rounded up in the protocol’s favor).
- **Yield application:** When yield is harvested:
  1. Compute yield in debt terms (from collateral share-price increase and oracle).
  2. Compute current total debt: `totalDebt = totalPrincipalDebt * globalDebtScale / RAY`.
  3. Update scale:  
     `newScale = scale * (totalDebt - yieldApplied) / totalDebt`  
     (rounded down so we never over-apply yield).
  4. Do **not** update any per-user storage. Users “settle” lazily on their next interaction: we set `principalDebt = currentDebt` and `scaleAtLastUpdate = globalDebtScale` when they borrow, repay, withdraw, or get liquidated.

So yield is applied in **O(1)** by moving a single global variable; no loops over positions. This is the “stream-settlement” pattern: yield is distributed via the global index, and each user’s share is implied by their principal and their snapshot of the scale.

### Rounding (vs rounding attacks)

- **Debt (user owes):** Always round **up** when computing `currentDebt` from principal and scales. So the protocol never understates what is owed.
- **Scale after yield:** `newScale` is rounded **down**, so we never reduce total debt by more than the yield we actually attribute.
- **Liquidation / collateral:** Seized collateral is rounded so the protocol does not over-seize (e.g. use ceiling only where it benefits the protocol and is consistent with the spec).

These choices prevent attackers from exploiting rounding to underpay debt or over-withdraw.

---

## 2. Death-Spiral Scenario

**“Death spiral”:** Collateral value falls faster than yield can repay debt, so the position becomes underwater (debt > collateral value) without a market-based correction.

### How Aura Handles It

1. **Liquidation threshold**  
   Positions are liquidatable when health factor &lt; 1, where  
   `healthFactor = (collateralValue * 10000) / (debt * liquidationThresholdBps)`.  
   We liquidate **before** the position is underwater (liquidation threshold &gt; LTV). So as collateral value drops, the position becomes liquidatable while there is still excess collateral to cover debt + penalty.

2. **Liquidators restore solvency**  
   When liquidated, the liquidator repays debt and receives collateral (with a penalty). That repayment reduces system debt and removes the underwater or at-risk position. So even if yield is slow, **market participants** are incentivized to close unhealthy positions, keeping the system solvent.

3. **No “yield-only” reliance**  
   The protocol does **not** assume yield will always repay debt. It assumes:
   - Collateral value can go down.
   - Liquidations are the main mechanism to keep positions solvent when value drops or yield is insufficient.
   - Yield siphon is an automatic **reduction** of debt over time when collateral earns yield, not a guarantee that debt will be fully repaid before any price move.

4. **Emergency shutdown**  
   If the system is paused or in emergency shutdown, new borrows and deposits can be disabled. Existing positions can still be repaid and collateral withdrawn (subject to health checks), and liquidations can continue if enabled, so the protocol can be frozen in a controlled way if needed.

### Summary

- **Death spiral** is mitigated by **liquidations** (and conservative LTV/liquidation thresholds), not by assuming yield will always outpace collateral depreciation.
- **Yield siphon** improves user outcomes when collateral yields; it does not replace the need for liquidations when collateral value falls.

---

## 3. Flash-Loan and Manipulation Protection

- **Same-block guard:** A position cannot be borrowed, repaid, withdrawn, or liquidated more than once in the same block (`lastInteractionBlock`). This prevents same-block deposit → borrow → withdraw collateral → default, and limits flash-loan-driven price manipulation against a single position in one block.
- **Oracle:** Multi-feed (e.g. Chainlink + RedStone) with staleness checks so one bad or manipulated feed does not alone drive liquidations.
- **Optional TWAP:** Oracle relay can use a TWAP over a configurable period to smooth spot-price manipulation (e.g. around harvest or liquidation).

---

## 4. ERC-4626 Compatibility

- The engine accepts **any ERC-4626 vault** as `collateralVault`. Collateral is deposited and held as **vault shares**; we use `convertToAssets` / `convertToShares` for valuation and accounting.
- An **AuraVault4626** view adapter exposes `totalAssets()`, `convertToAssets`, and `convertToShares` backed by the engine’s total collateral, so 4626-based integrators can read engine state without holding a position.

---

## 5. L2 (Arbitrum / Base) Compatibility

- No use of `SELFDESTRUCT` or of L1-specific opcodes that would conflict with L2.
- Uses standard EVM (e.g. Cancun) and Solidity 0.8.20+ with `via_ir` and optimizer runs tuned for size/cost; suitable for deployment on Arbitrum or Base.

#!/usr/bin/env bash
# CheckStorageLayout.sh
# ---------------------
# Verifies that no unsafe storage layout changes have been introduced since the
# last committed baseline. Must exit 0 before any upgrade proceeds.
#
# Requirements: forge (in PATH), jq (in PATH), sha256sum (GNU coreutils / Git Bash)
# Usage:
#   bash script/CheckStorageLayout.sh           # compare against baselines
#   bash script/CheckStorageLayout.sh --update  # overwrite baselines with current layout
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAYOUTS_DIR="$REPO_ROOT/storage-layouts"
PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

UPDATE_MODE=false
[[ "${1:-}" == "--update" ]] && UPDATE_MODE=true

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)) || true; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)) || true; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# ─────────────────────────────────────────────────────────────────────────────
# Helper: extract [label, slot, offset] array from forge inspect output
# ─────────────────────────────────────────────────────────────────────────────
extract_layout() {
    local contract="$1"
    forge inspect "$contract" storage-layout --json 2>/dev/null \
        | jq '[.storage[] | {label, slot, offset}]'
}

# ─────────────────────────────────────────────────────────────────────────────
# Check 1 — AuraEngine must have EMPTY regular storage (EIP-7201 guard)
# Any variable declared directly on AuraEngine collides with the proxy admin slot.
# ─────────────────────────────────────────────────────────────────────────────
log_info "Checking AuraEngine storage (must be empty — EIP-7201)"
ENGINE_LAYOUT=$(extract_layout "AuraEngine")
ENGINE_BASELINE=$(cat "$LAYOUTS_DIR/AuraEngine.json")

if [[ "$ENGINE_LAYOUT" == "$ENGINE_BASELINE" ]]; then
    log_pass "AuraEngine: no regular storage variables (EIP-7201 intact)"
else
    log_fail "AuraEngine: unexpected storage variables detected!"
    echo "  Current: $ENGINE_LAYOUT"
    echo "  Expected: $ENGINE_BASELINE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Check 2 — AuraStorage.sol hash (guards EngineStorage struct definition)
# Inserting / reordering fields in EngineStorage corrupts all user positions.
# ─────────────────────────────────────────────────────────────────────────────
log_info "Checking AuraStorage.sol content hash"
AURA_STORAGE_HASH_FILE="$LAYOUTS_DIR/AuraStorage.sha256"
CURRENT_HASH=$(sha256sum "$REPO_ROOT/src/AuraStorage.sol" | awk '{print $1}')
BASELINE_HASH=$(awk '{print $1}' "$AURA_STORAGE_HASH_FILE")

if $UPDATE_MODE; then
    echo "$CURRENT_HASH  src/AuraStorage.sol" > "$AURA_STORAGE_HASH_FILE"
    log_info "AuraStorage.sha256 updated to $CURRENT_HASH"
elif [[ "$CURRENT_HASH" == "$BASELINE_HASH" ]]; then
    log_pass "AuraStorage.sol hash matches baseline"
else
    log_fail "AuraStorage.sol CHANGED — review EngineStorage struct carefully!"
    echo "  Baseline: $BASELINE_HASH"
    echo "  Current:  $CURRENT_HASH"
    echo "  Run 'git diff src/AuraStorage.sol' and verify only __gap-consuming appends."
    echo "  If the change is intentional: bash script/CheckStorageLayout.sh --update"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Check 3 — AuraMarketRegistry label/slot/offset layout
# ─────────────────────────────────────────────────────────────────────────────
log_info "Checking AuraMarketRegistry storage layout"
REG_LAYOUT=$(extract_layout "AuraMarketRegistry")
REG_BASELINE=$(cat "$LAYOUTS_DIR/AuraMarketRegistry.json")

if $UPDATE_MODE; then
    echo "$REG_LAYOUT" > "$LAYOUTS_DIR/AuraMarketRegistry.json"
    log_info "AuraMarketRegistry.json baseline updated"
elif [[ "$REG_LAYOUT" == "$REG_BASELINE" ]]; then
    log_pass "AuraMarketRegistry layout matches baseline"
else
    log_fail "AuraMarketRegistry layout CHANGED!"
    diff <(echo "$REG_BASELINE") <(echo "$REG_LAYOUT") || true
fi

# ─────────────────────────────────────────────────────────────────────────────
# Check 4 — OracleRelayV2 label/slot/offset layout
# ─────────────────────────────────────────────────────────────────────────────
log_info "Checking OracleRelayV2 storage layout"
ORACLE_LAYOUT=$(extract_layout "OracleRelayV2")
ORACLE_BASELINE=$(cat "$LAYOUTS_DIR/OracleRelayV2.json")

if $UPDATE_MODE; then
    echo "$ORACLE_LAYOUT" > "$LAYOUTS_DIR/OracleRelayV2.json"
    log_info "OracleRelayV2.json baseline updated"
elif [[ "$ORACLE_LAYOUT" == "$ORACLE_BASELINE" ]]; then
    log_pass "OracleRelayV2 layout matches baseline"
else
    log_fail "OracleRelayV2 layout CHANGED!"
    diff <(echo "$ORACLE_BASELINE") <(echo "$ORACLE_LAYOUT") || true
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Storage layout check FAILED — do NOT proceed with upgrade.${NC}"
    exit 1
else
    echo -e "${GREEN}All storage layout checks passed. Safe to proceed.${NC}"
    exit 0
fi

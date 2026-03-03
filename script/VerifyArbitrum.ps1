# Verify contracts on Arbitrum One (Arbiscan).
# Set $env:ARBISCAN_API_KEY first: https://arbiscan.io/myapikey
# Optional: $env:ARBITRUM_RPC_URL for RPC (or from .env)
if (-not $env:ARBISCAN_API_KEY) { throw "Set env ARBISCAN_API_KEY" }
$rpc = if ($env:ARBITRUM_RPC_URL) { $env:ARBITRUM_RPC_URL } else { "https://arb1.arbitrum.io/rpc" }

# --- 1. OracleRelay (0xc018269BfC8c8efF1A62d51E58d4bBa16E9573D2) ---
# constructor(primaryFeed, fallbackFeed, twapPeriod) — Chainlink ETH/USD Arbitrum, no fallback, no TWAP
$oracleArgs = cast abi-encode "constructor(address,address,uint256)" 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612 0x0000000000000000000000000000000000000000 0
forge verify-contract 0xc018269BfC8c8efF1A62d51E58d4bBa16E9573D2 src/OracleRelay.sol:OracleRelay --chain-id 42161 --constructor-args $oracleArgs --watch

# --- 2. AuraEngine implementation (0x5eb10909170bdf4cb78dfef1e1298dbb7ffd3a39) ---
forge verify-contract 0x5eb10909170bdf4cb78dfef1e1298dbb7ffd3a39 src/AuraEngine.sol:AuraEngine --chain-id 42161 --watch

# --- 3. AuraProxy (0x71dd67F561cA7F1AcBcA89fB416bCe3A51E75a1A) ---
# constructor(implementation, initData)
$initData = "0x7d3594df0000000000000000000000005979d7b546e38e414f7e9822514be443a4800529000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831000000000000000000000000c018269bfc8c8eff1a62d51e58d4bba16e9573d20000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000213400000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000015180000000000000000000000000000000000000000000000000000000000002a300"
$proxyArgs = cast abi-encode "constructor(address,bytes)" 0x5eb10909170bdf4cb78dfef1e1298dbb7ffd3a39 $initData
forge verify-contract 0x71dd67F561cA7F1AcBcA89fB416bCe3A51E75a1A src/AuraProxy.sol:AuraProxy --chain-id 42161 --constructor-args $proxyArgs --watch

Write-Host "Done."
Write-Host "Proxy (engine): 0x71dd67F561cA7F1AcBcA89fB416bCe3A51E75a1A"
Write-Host "OracleRelay:    0xc018269BfC8c8efF1A62d51E58d4bBa16E9573D2"

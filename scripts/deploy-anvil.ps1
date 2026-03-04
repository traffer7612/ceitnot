# Deploy Aura to local Anvil and write engine address to backend\.env
# Prerequisite: run "anvil" in another terminal and leave it running.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$rpc = "http://127.0.0.1:8545"
$pk  = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Bypass proxy for local RPC (often fixes 502)
$env:NO_PROXY = "localhost,127.0.0.1"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""

# Check Anvil is reachable before running forge
try {
    $body = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
    $resp = Invoke-RestMethod -Uri $rpc -Method Post -Body $body -ContentType "application/json" -TimeoutSec 3
    Write-Host "Anvil OK (chainId: $($resp.result))"
} catch {
    Write-Host "ERROR: Cannot reach Anvil at $rpc"
    Write-Host "1. Start Anvil in another terminal:  anvil"
    Write-Host "2. If 502 persists, try:  anvil --host 127.0.0.1"
    Write-Host "3. Or use URL explicitly:  forge script ... --rpc-url http://localhost:8545 ..."
    exit 1
}

Write-Host "Deploying to Anvil at $rpc ..."
$out = forge script script/Deploy.s.sol:DeployScript --rpc-url $rpc --broadcast --private-key $pk 2>&1 | Out-String

if ($LASTEXITCODE -ne 0) {
    Write-Host $out
    Write-Host "`nMake sure Anvil is running in another terminal: anvil"
    exit 1
}

$match = [regex]::Match($out, "AURA_ENGINE_ADDRESS=(0x[a-fA-F0-9]{40})")
if (-not $match.Success) {
    Write-Host $out
    Write-Host "`nCould not find AURA_ENGINE_ADDRESS in output."
    exit 1
}

$addr = $match.Groups[1].Value
Write-Host "Deployed engine at: $addr"

$registryMatch = [regex]::Match($out, "AURA_REGISTRY_ADDRESS=(0x[a-fA-F0-9]{40})")
$registryAddr = if ($registryMatch.Success) { $registryMatch.Groups[1].Value } else { "" }
if ($registryAddr) { Write-Host "Registry at: $registryAddr" }

$vaultMatch = [regex]::Match($out, "AURA_VAULT_4626_ADDRESS=(0x[a-fA-F0-9]{40})")
$vaultAddr = if ($vaultMatch.Success) { $vaultMatch.Groups[1].Value } else { "" }
if ($vaultAddr) { Write-Host "Vault at: $vaultAddr" }

$envPath = Join-Path $PSScriptRoot "..\backend\.env"
$content = Get-Content $envPath -Raw
$content = $content -replace "AURA_ENGINE_ADDRESS=0x[a-fA-F0-9]{40}", "AURA_ENGINE_ADDRESS=$addr"
if ($registryAddr) {
    if ($content -match "AURA_REGISTRY_ADDRESS") {
        $content = $content -replace "#?\s*AURA_REGISTRY_ADDRESS=.*", "AURA_REGISTRY_ADDRESS=$registryAddr"
    } else {
        $content = $content + "`nAURA_REGISTRY_ADDRESS=$registryAddr"
    }
}
if ($vaultAddr -and $content -match "AURA_VAULT_4626_ADDRESS") {
    $content = $content -replace "#?\s*AURA_VAULT_4626_ADDRESS=.*", "AURA_VAULT_4626_ADDRESS=$vaultAddr"
}
Set-Content $envPath $content -NoNewline
Write-Host "Updated backend\.env with AURA_ENGINE_ADDRESS=$addr"
Write-Host "Restart the backend (npm run dev in backend folder) and refresh the frontend."

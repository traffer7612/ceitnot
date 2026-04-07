# Broadcast full Ceitnot stack to Arbitrum Sepolia (421614).
# Prereqs:
#   1. In repo root .env set: DEPLOYER_PRIVATE_KEY=0x... (or PRIVATE_KEY)
#   2. That address holds Arbitrum Sepolia ETH (gas).
# Usage (from repo root): pwsh -File script/broadcast-arbitrum-sepolia.ps1

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) { throw "Missing $envFile — create it with DEPLOYER_PRIVATE_KEY=0x..." }

foreach ($line in Get-Content $envFile) {
  $t = $line.Trim()
  if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
  $p = $t.IndexOf('=')
  if ($p -lt 1) { continue }
  $k = $t.Substring(0, $p).Trim()
  $v = $t.Substring($p + 1).Trim()
  if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
  if ($v.StartsWith("'") -and $v.EndsWith("'")) { $v = $v.Substring(1, $v.Length - 2) }
  Set-Item -Path "env:$k" -Value $v
}

if (-not $env:DEPLOYER_PRIVATE_KEY -and $env:PRIVATE_KEY) { $env:DEPLOYER_PRIVATE_KEY = $env:PRIVATE_KEY }
if (-not $env:DEPLOYER_PRIVATE_KEY) {
  throw 'Add DEPLOYER_PRIVATE_KEY=0x... (or PRIVATE_KEY) to repo root .env'
}

forge script script/DeployFullArbitrumSepolia.s.sol:DeployFullArbitrumSepolia `
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc `
  --broadcast --slow -vvv

Write-Host ''
Write-Host 'Next: copy ENGINE / REGISTRY / AUSD / PSM / USDC / GOVERNANCE addresses from the log above into Vercel + frontend .env (VITE_*).'

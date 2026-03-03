#!/usr/bin/env bash
# Verify contracts on Arbitrum One (Arbiscan).
# Set ARBISCAN_API_KEY first: https://arbiscan.io/myapikey
set -e
: "${ARBISCAN_API_KEY:?Set ARBISCAN_API_KEY}"

# OracleRelay - constructor(primaryFeed, fallbackFeed, twapPeriod)
forge verify-contract 0x7b631f0BE284f66fB45C2eF56c96441F347f6219 \
  src/OracleRelay.sol:OracleRelay \
  --chain-id 42161 \
  --constructor-args $(cast abi-encode "constructor(address,address,uint256)" \
    0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612 \
    0x0000000000000000000000000000000000000000 \
    0) \
  --watch

# AuraEngine (no constructor args)
forge verify-contract 0xf5D05B2AAD0B8BC73Cf03B6882F9d080934D253F \
  src/AuraEngine.sol:AuraEngine \
  --chain-id 42161 \
  --watch

# AuraProxy - constructor(implementation, data)
forge verify-contract 0xeE18DcB25F95459BF3174ADB8792f83d8B9b0D70 \
  src/AuraProxy.sol:AuraProxy \
  --chain-id 42161 \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" \
    0xf5D05B2AAD0B8BC73Cf03B6882F9d080934D253F \
    0x7d3594df0000000000000000000000005979d7b546e38e414f7e9822514be443a4800529000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e58310000000000000000000000007b631f0be284f66fb45c2ef56c96441f347f62190000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000213400000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000015180000000000000000000000000000000000000000000000000000000000002a300) \
  --watch

echo "Done."

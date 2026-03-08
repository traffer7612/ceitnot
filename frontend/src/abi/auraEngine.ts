// ─── Shared struct components ────────────────────────────────────────────────
const MARKET_CONFIG_COMPONENTS = [
  { name: 'vault',                        type: 'address'  },
  { name: 'oracle',                       type: 'address'  },
  { name: 'ltvBps',                       type: 'uint256'  },
  { name: 'liquidationThresholdBps',      type: 'uint256'  },
  { name: 'liquidationPenaltyBps',        type: 'uint256'  },
  { name: 'supplyCap',                    type: 'uint256'  },
  { name: 'borrowCap',                    type: 'uint256'  },
  { name: 'isActive',                     type: 'bool'     },
  { name: 'isFrozen',                     type: 'bool'     },
  { name: 'isIsolated',                   type: 'bool'     },
  { name: 'isolatedBorrowCap',            type: 'uint256'  },
  { name: 'baseRate',                     type: 'uint256'  },
  { name: 'slope1',                       type: 'uint256'  },
  { name: 'slope2',                       type: 'uint256'  },
  { name: 'kink',                         type: 'uint256'  },
  { name: 'reserveFactorBps',             type: 'uint256'  },
  { name: 'closeFactorBps',               type: 'uint256'  },
  { name: 'fullLiquidationThresholdBps',  type: 'uint256'  },
  { name: 'protocolLiquidationFeeBps',    type: 'uint256'  },
  { name: 'dutchAuctionEnabled',          type: 'bool'     },
  { name: 'auctionDuration',              type: 'uint256'  },
  { name: 'yieldFeeBps',                  type: 'uint256'  },
  { name: 'originationFeeBps',            type: 'uint256'  },
  { name: 'debtCeiling',                  type: 'uint256'  },
] as const;

// ─── AuraEngine ABI ───────────────────────────────────────────────────────────
export const auraEngineAbi = [
  // ── Read: position ──
  { inputs: [{ name: 'user', type: 'address' }], name: 'getHealthFactor', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }], name: 'getPositionDebt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }], name: 'getPositionCollateralShares', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }], name: 'getPositionCollateralValue', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'getUserMarkets', outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view', type: 'function' },
  // ── Read: market stats ──
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'totalDebt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'totalCollateralAssets', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'getMarket', outputs: [{ name: '', type: 'tuple', components: MARKET_CONFIG_COMPONENTS }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'getMarketTotalCollateralShares', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'getMarketPrincipalDebt', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getGlobalDebtScale', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  // ── Read: addresses & state ──
  { inputs: [], name: 'debtToken', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'marketRegistry', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'admin', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'paused', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'emergencyShutdown', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  // ── Write: user actions ──
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'shares', type: 'uint256' }], name: 'depositCollateral', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'shares', type: 'uint256' }], name: 'withdrawCollateral', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], name: 'borrow', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], name: 'repay', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'borrowAmount', type: 'uint256' }], name: 'depositAndBorrow', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'repayAmount', type: 'uint256' }, { name: 'withdrawShares', type: 'uint256' }], name: 'repayAndWithdraw', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'marketId', type: 'uint256' }, { name: 'repayAmount', type: 'uint256' }], name: 'liquidate', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  // ── Write: admin ──
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'enabled', type: 'bool' }], name: 'setEmergencyShutdown', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'newAdmin', type: 'address' }], name: 'transferAdmin', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

// ─── AuraMarketRegistry ABI ───────────────────────────────────────────────────
export const auraRegistryAbi = [
  { inputs: [], name: 'marketCount', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'getMarket', outputs: [{ name: '', type: 'tuple', components: MARKET_CONFIG_COMPONENTS }], stateMutability: 'view', type: 'function' },
] as const;

// ─── Minimal ERC-20 ABI ───────────────────────────────────────────────────────
export const erc20Abi = [
  { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
] as const;

// ─── Minimal ERC-4626 Vault ABI ───────────────────────────────────────────────
export const erc4626Abi = [
  { inputs: [], name: 'asset', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'shares', type: 'uint256' }], name: 'convertToAssets', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'assets', type: 'uint256' }], name: 'convertToShares', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], name: 'deposit', outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], name: 'redeem', outputs: [{ name: 'assets', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
] as const;

// ─── MarketConfig type ────────────────────────────────────────────────────────
export type MarketConfig = {
  vault:                       `0x${string}`;
  oracle:                      `0x${string}`;
  ltvBps:                      bigint;
  liquidationThresholdBps:     bigint;
  liquidationPenaltyBps:       bigint;
  supplyCap:                   bigint;
  borrowCap:                   bigint;
  isActive:                    boolean;
  isFrozen:                    boolean;
  isIsolated:                  boolean;
  isolatedBorrowCap:           bigint;
  baseRate:                    bigint;
  slope1:                      bigint;
  slope2:                      bigint;
  kink:                        bigint;
  reserveFactorBps:            bigint;
  closeFactorBps:              bigint;
  fullLiquidationThresholdBps: bigint;
  protocolLiquidationFeeBps:   bigint;
  dutchAuctionEnabled:         boolean;
  auctionDuration:             bigint;
  yieldFeeBps:                 bigint;
  originationFeeBps:           bigint;
  debtCeiling:                 bigint;
};

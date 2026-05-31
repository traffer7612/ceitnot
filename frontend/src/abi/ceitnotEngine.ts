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

// ─── CeitnotEngine ABI ─────────────────────────────────────────────────────────
export const ceitnotEngineAbi = [
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

// ─── CeitnotMarketRegistry ABI ────────────────────────────────────────────────
export const marketRegistryAbi = [
  // Read
  { inputs: [], name: 'marketCount', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'getMarket', outputs: [{ name: '', type: 'tuple', components: MARKET_CONFIG_COMPONENTS }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'admin', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'marketExists', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  // Write: market creation
  { inputs: [
    { name: 'vault', type: 'address' }, { name: 'oracle', type: 'address' },
    { name: 'ltvBps', type: 'uint16' }, { name: 'liquidationThresholdBps', type: 'uint16' },
    { name: 'liquidationPenaltyBps', type: 'uint16' },
    { name: 'supplyCap', type: 'uint256' }, { name: 'borrowCap', type: 'uint256' },
    { name: 'isIsolated', type: 'bool' }, { name: 'isolatedBorrowCap', type: 'uint256' },
  ], name: 'addMarket', outputs: [{ name: 'marketId', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  // Write: market management
  { inputs: [
    { name: 'marketId', type: 'uint256' }, { name: 'ltvBps', type: 'uint16' },
    { name: 'liquidationThresholdBps', type: 'uint16' }, { name: 'liquidationPenaltyBps', type: 'uint16' },
  ], name: 'updateMarketRiskParams', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [
    { name: 'marketId', type: 'uint256' }, { name: 'supplyCap', type: 'uint256' }, { name: 'borrowCap', type: 'uint256' },
  ], name: 'updateMarketCaps', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [
    { name: 'marketId', type: 'uint256' }, { name: 'baseRate', type: 'uint256' },
    { name: 'slope1', type: 'uint256' }, { name: 'slope2', type: 'uint256' },
    { name: 'kink', type: 'uint256' }, { name: 'reserveFactorBps', type: 'uint16' },
  ], name: 'updateMarketIrmParams', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [
    { name: 'marketId', type: 'uint256' }, { name: 'yieldFeeBps', type: 'uint16' }, { name: 'originationFeeBps', type: 'uint16' },
  ], name: 'updateMarketFeeParams', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [
    { name: 'marketId', type: 'uint256' }, { name: 'debtCeiling', type: 'uint256' },
  ], name: 'updateMarketDebtCeiling', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }, { name: 'frozen', type: 'bool' }], name: 'freezeMarket', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'deactivateMarket', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'marketId', type: 'uint256' }], name: 'activateMarket', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [
    { name: 'marketId', type: 'uint256' }, { name: 'closeFactorBps', type: 'uint16' },
    { name: 'fullLiquidationThresholdBps', type: 'uint16' }, { name: 'protocolLiquidationFeeBps', type: 'uint16' },
    { name: 'dutchAuctionEnabled', type: 'bool' }, { name: 'auctionDuration', type: 'uint256' },
  ], name: 'updateMarketLiquidationParams', outputs: [], stateMutability: 'nonpayable', type: 'function' },
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
  // MockERC20 on testnets (Sepolia): anyone can mint
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'mint', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

// ─── Minimal ERC-4626 Vault ABI ───────────────────────────────────────────────
export const erc4626Abi = [
  { inputs: [], name: 'asset', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'shares', type: 'uint256' }], name: 'convertToAssets', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'assets', type: 'uint256' }], name: 'convertToShares', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], name: 'deposit', outputs: [{ name: 'shares', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], name: 'redeem', outputs: [{ name: 'assets', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
] as const;

// ─── VeCeitnot (vote-escrow) ABI ──────────────────────────────────────────────
export const veLockAbi = [
  // Read
  { inputs: [], name: 'token', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalLocked', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'locks', outputs: [{ name: 'amount', type: 'uint128' }, { name: 'unlockTime', type: 'uint48' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'getVotes', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'account', type: 'address' }], name: 'delegates', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'pendingRevenue', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'revenueToken', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_LOCK_DURATION', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  // Write
  { inputs: [{ name: 'amount', type: 'uint256' }, { name: 'unlockTime', type: 'uint256' }], name: 'lock', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'extra', type: 'uint256' }], name: 'increaseAmount', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'newUnlockTime', type: 'uint256' }], name: 'extendLock', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'withdraw', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'claimRevenue', outputs: [{ name: 'reward', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'delegatee', type: 'address' }], name: 'delegate', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

// ─── CeitnotPSM ABI (swap + admin) ────────────────────────────────────────────
export const ceitnotPsmAbi = [
  { inputs: [], name: 'ausd', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'peggedToken', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'peggedDecimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'tinBps', outputs: [{ name: '', type: 'uint16' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'toutBps', outputs: [{ name: '', type: 'uint16' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'ceiling', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mintedViaPsm', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'feeReserves', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'availableReserves', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxSwapInPeg', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxSwapOutAusd', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'admin', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'swapIn', outputs: [{ name: 'ausdOut', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'swapOut', outputs: [{ name: 'stableOut', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'withdrawFeeReserves', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'withdrawLiquidity', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  {
    inputs: [
      { name: 'maxSwapInPeg_', type: 'uint256' },
      { name: 'maxSwapOutAusd_', type: 'uint256' },
    ],
    name: 'setSwapLimits',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ─── Governor ABI (OpenZeppelin Governor v5) ─────────────────────────────────
export const governorAbi = [
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'votingDelay', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'votingPeriod', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'proposalThreshold', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'timepoint', type: 'uint256' }], name: 'quorum', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'state', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'account', type: 'address' }], name: 'hasVoted', outputs: [{ name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'proposalSnapshot', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'proposalDeadline', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'proposalId', type: 'uint256' }], name: 'proposalProposer', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'calldatas', type: 'bytes[]' },
      { name: 'description', type: 'string' },
    ],
    name: 'propose',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  { inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'support', type: 'uint8' }], name: 'castVote', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  {
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'calldatas', type: 'bytes[]' },
      { name: 'descriptionHash', type: 'bytes32' },
    ],
    name: 'queue',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'calldatas', type: 'bytes[]' },
      { name: 'descriptionHash', type: 'bytes32' },
    ],
    name: 'execute',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
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

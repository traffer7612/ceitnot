import { Router } from "express";
import {
  createPublicClient,
  http,
  formatEther,
  defineChain,
  parseAbiItem,
  getAddress,
  type Chain,
  type PublicClient,
} from "viem";
import { arbitrum, base, sepolia, foundry } from "viem/chains";

/** Indexed `user` as topics[1] for each event */
const ENGINE_USER_EVENTS = [
  parseAbiItem(
    "event CollateralDeposited(address indexed user, uint256 indexed marketId, uint256 shares)",
  ),
  parseAbiItem(
    "event DepositAndBorrowed(address indexed user, uint256 indexed marketId, uint256 shares, uint256 borrowed)",
  ),
  parseAbiItem("event Borrowed(address indexed user, uint256 indexed marketId, uint256 amount)"),
  parseAbiItem("event Repaid(address indexed user, uint256 indexed marketId, uint256 amount)"),
  parseAbiItem(
    "event RepaidAndWithdrawn(address indexed user, uint256 indexed marketId, uint256 repaid, uint256 withdrawShares)",
  ),
  parseAbiItem(
    "event CollateralWithdrawn(address indexed user, uint256 indexed marketId, uint256 shares)",
  ),
  parseAbiItem(
    "event Liquidated(address indexed user, address indexed liquidator, uint256 indexed marketId, uint256 repayAmount, uint256 collateralSeized)",
  ),
] as const;

const USER_COUNT_CHUNK_BLOCKS = 4999n;
const USER_COUNT_CACHE_MS = 120_000;

type UserCountCache = { count: number; expires: number };
const userCountCache = new Map<string, UserCountCache>();

function deployBlockOrDefault(chainId: number): bigint | null {
  const raw = process.env.CEITNOT_ENGINE_DEPLOY_BLOCK?.trim();
  if (raw !== undefined && raw !== "") {
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }
  if (chainId === 31337) return 0n;
  return null;
}

async function countUniqueEngineUsers(
  client: PublicClient,
  engineAddress: `0x${string}`,
  fromBlock: bigint,
): Promise<number> {
  const latest = await client.getBlockNumber();
  if (fromBlock > latest) return 0;

  const users = new Set<string>();
  for (let start = fromBlock; start <= latest; start += USER_COUNT_CHUNK_BLOCKS) {
    const end =
      start + USER_COUNT_CHUNK_BLOCKS - 1n > latest ? latest : start + USER_COUNT_CHUNK_BLOCKS - 1n;
    const logsArrays = await Promise.all(
      ENGINE_USER_EVENTS.map((event) =>
        client
          .getLogs({
            address: engineAddress,
            event,
            fromBlock: start,
            toBlock: end,
          })
          .catch(() => []),
      ),
    );
    for (const logs of logsArrays) {
      for (const log of logs) {
        const t = log.topics[1];
        if (t) {
          try {
            users.add(getAddress(t as `0x${string}`));
          } catch {
            /* ignore malformed */
          }
        }
      }
    }
  }
  return users.size;
}

const arbitrumSepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
});

const CEITNOT_ENGINE_READ_ABI = [
  { inputs: [], name: "totalDebt", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalCollateralAssets", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "asset", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
] as const;

export const statsRouter = Router();

function getRpc(chainId: number): string {
  if (chainId === 31337) {
    return process.env.FAUCET_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8545";
  }
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const rpcs: Record<number, string> = {
    11155111: "https://ethereum-sepolia.publicnode.com",
    42161: arbitrum.rpcUrls.default.http[0],
    421614: arbitrumSepolia.rpcUrls.default.http[0],
    8453: base.rpcUrls.default.http[0],
  };
  return rpcs[chainId] ?? "";
}

const chains: Record<number, Chain> = {
  31337: foundry,
  11155111: sepolia,
  42161: arbitrum,
  421614: arbitrumSepolia,
  8453: base,
};

statsRouter.get("/:chainId", async (req, res) => {
  const chainId = Number(req.params.chainId);
  const engineAddress = process.env.CEITNOT_ENGINE_ADDRESS as `0x${string}` | undefined;
  if (!engineAddress) {
    return res.json({ totalDebt: "0", totalCollateralAssets: "0", uniqueUsers: null });
  }
  const chain = chains[chainId];
  if (!chain) {
    return res.json({ totalDebt: "0", totalCollateralAssets: "0", uniqueUsers: null });
  }
  try {
    const client = createPublicClient({
      chain,
      transport: http(getRpc(chainId)),
    });
    const [totalDebt, totalCollateralAssets] = await Promise.all([
      client.readContract({
        address: engineAddress,
        abi: CEITNOT_ENGINE_READ_ABI,
        functionName: "totalDebt",
      }),
      client.readContract({
        address: engineAddress,
        abi: CEITNOT_ENGINE_READ_ABI,
        functionName: "totalCollateralAssets",
      }),
    ]);

    const fromBlock = deployBlockOrDefault(chainId);
    let uniqueUsers: number | null = null;
    if (fromBlock !== null) {
      const cacheKey = `${chainId}-${engineAddress}-${fromBlock}`;
      const now = Date.now();
      const hit = userCountCache.get(cacheKey);
      if (hit && hit.expires > now) {
        uniqueUsers = hit.count;
      } else {
        uniqueUsers = await countUniqueEngineUsers(client, engineAddress, fromBlock);
        userCountCache.set(cacheKey, { count: uniqueUsers, expires: now + USER_COUNT_CACHE_MS });
      }
    }

    return res.json({
      totalDebt: formatEther(totalDebt),
      totalCollateralAssets: formatEther(totalCollateralAssets),
      uniqueUsers,
    });
  } catch (_e) {
    return res.json({ totalDebt: "0", totalCollateralAssets: "0", uniqueUsers: null });
  }
});

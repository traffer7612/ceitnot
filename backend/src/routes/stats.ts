import { Router } from "express";
import { createPublicClient, http, formatEther } from "viem";
import { arbitrum, base, sepolia } from "viem/chains";
import { foundry } from "viem/chains";

const AURA_ENGINE_ABI = [
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
    8453: base.rpcUrls.default.http[0],
  };
  return rpcs[chainId] ?? "";
}

const chains: Record<number, typeof arbitrum> = {
  31337: foundry,
  11155111: sepolia,
  42161: arbitrum,
  8453: base,
};

statsRouter.get("/:chainId", async (req, res) => {
  const chainId = Number(req.params.chainId);
  const engineAddress = process.env.AURA_ENGINE_ADDRESS as `0x${string}` | undefined;
  if (!engineAddress) {
    return res.json({ totalDebt: "0", totalCollateralAssets: "0" });
  }
  const chain = chains[chainId];
  if (!chain) {
    return res.json({ totalDebt: "0", totalCollateralAssets: "0" });
  }
  try {
    const client = createPublicClient({
      chain,
      transport: http(getRpc(chainId)),
    });
    const [totalDebt, totalCollateralAssets] = await Promise.all([
      client.readContract({
        address: engineAddress,
        abi: AURA_ENGINE_ABI,
        functionName: "totalDebt",
      }),
      client.readContract({
        address: engineAddress,
        abi: AURA_ENGINE_ABI,
        functionName: "totalCollateralAssets",
      }),
    ]);
    return res.json({
      totalDebt: formatEther(totalDebt),
      totalCollateralAssets: formatEther(totalCollateralAssets),
    });
  } catch (_e) {
    return res.json({ totalDebt: "0", totalCollateralAssets: "0" });
  }
});

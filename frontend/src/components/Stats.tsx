import { useAccount, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { formatEther } from "viem";
import { useContractsConfig } from "../hooks/useConfig";

const STATS_ABI = [
  { inputs: [], name: "totalDebt", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalCollateralAssets", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

async function fetchStats(chainId: number) {
  const res = await fetch(`/api/stats/${chainId}`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json() as Promise<{ totalDebt: string; totalCollateralAssets: string }>;
}

export function Stats() {
  const { chainId } = useAccount();
  const { data: config } = useContractsConfig();
  const engineAddress = config?.engine as `0x${string}` | undefined;

  const { data: apiData, isLoading: apiLoading } = useQuery({
    queryKey: ["stats", chainId],
    queryFn: () => fetchStats(chainId!),
    refetchInterval: 30_000,
    enabled: chainId != null && chainId !== 31337,
  });

  const { data: totalCollateralAssetsRaw } = useReadContract({
    address: engineAddress,
    abi: STATS_ABI,
    functionName: "totalCollateralAssets",
    chainId: chainId ?? undefined,
  });

  const { data: totalDebtRaw } = useReadContract({
    address: engineAddress,
    abi: STATS_ABI,
    functionName: "totalDebt",
    chainId: chainId ?? undefined,
  });

  const fromContract =
    totalCollateralAssetsRaw != null && totalDebtRaw != null && chainId != null;
  const collateralStr = fromContract
    ? formatEther(totalCollateralAssetsRaw)
    : apiData?.totalCollateralAssets ?? "0";
  const debtStr = fromContract
    ? formatEther(totalDebtRaw)
    : apiData?.totalDebt ?? "0";
  const isLoading = !fromContract && apiLoading && chainId != null;
  const noData = !fromContract && !apiData && !engineAddress;
  const showCollateral = noData || isLoading ? "—" : formatCompact(collateralStr);
  const showDebt = noData || isLoading ? "—" : formatCompact(debtStr);

  return (
    <section className="max-w-4xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-1">
          <span className="text-aura-muted text-sm font-medium">Total collateral</span>
          <span className="font-mono text-2xl text-aura-gold">
            {showCollateral}
          </span>
        </div>
        <div className="card flex flex-col gap-1">
          <span className="text-aura-muted text-sm font-medium">Total debt</span>
          <span className="font-mono text-2xl text-white">
            {showDebt}
          </span>
        </div>
      </div>
    </section>
  );
}

function formatCompact(value: string): string {
  const n = parseFloat(value);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (n > 0 && n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

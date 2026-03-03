import { useQuery } from "@tanstack/react-query";

export type ContractsConfig = {
  engine: string;
  vault4626: string;
};

async function fetchContracts(): Promise<ContractsConfig> {
  const res = await fetch("/api/config/contracts");
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export function useContractsConfig() {
  return useQuery({
    queryKey: ["config", "contracts"],
    queryFn: fetchContracts,
  });
}

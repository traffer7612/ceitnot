import { Router } from "express";

export const configRouter = Router();

const DEFAULT_CHAINS = [
  {
    id: 42161,
    name: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
  },
  {
    id: 8453,
    name: "Base",
    rpc: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
  },
];

configRouter.get("/chains", (_req, res) => {
  res.json({
    chains: process.env.CHAINS_JSON ? JSON.parse(process.env.CHAINS_JSON) : DEFAULT_CHAINS,
  });
});

configRouter.get("/contracts", (_req, res) => {
  const engine    = process.env.AURA_ENGINE_ADDRESS   ?? "";
  const registry  = process.env.AURA_REGISTRY_ADDRESS ?? "";
  const vault4626 = process.env.AURA_VAULT_4626_ADDRESS ?? "";
  res.json({ engine, registry, vault4626 });
});

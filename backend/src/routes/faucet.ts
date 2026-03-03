import { Router } from "express";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const faucetRouter = Router();

const FAUCET_AMOUNT = parseEther("0.5");

const anvilRpc = () => process.env.FAUCET_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8545";

faucetRouter.get("/balance", async (req, res) => {
  const address = req.query?.address as string | undefined;
  if (!address || typeof address !== "string" || !address.startsWith("0x")) {
    return res.status(400).json({ error: "Missing or invalid address" });
  }
  try {
    const client = createPublicClient({
      chain: foundry,
      transport: http(anvilRpc()),
    });
    const wei = await client.getBalance({ address: address as `0x${string}` });
    return res.json({ balance: formatEther(wei), wei: wei.toString() });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

faucetRouter.post("/", async (req, res) => {
  const address = req.body?.address as string | undefined;
  if (!address || typeof address !== "string" || !address.startsWith("0x")) {
    return res.status(400).json({ error: "Missing or invalid address" });
  }

  const pk = process.env.FAUCET_PRIVATE_KEY;
  const rpc = anvilRpc();

  if (!pk) {
    return res.status(503).json({
      error: "Faucet not configured. Set FAUCET_PRIVATE_KEY in backend .env (e.g. Anvil test key).",
    });
  }

  try {
    const account = privateKeyToAccount(pk as `0x${string}`);
    const client = createWalletClient({
      account,
      chain: foundry,
      transport: http(rpc),
    });
    const hash = await client.sendTransaction({
      to: address as `0x${string}`,
      value: FAUCET_AMOUNT,
    });
    return res.json({ success: true, hash });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

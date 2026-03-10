import { Router } from "express";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";

export const faucetRouter = Router();

const FAUCET_AMOUNT = parseEther("0.5");
const AURA_FAUCET_AMOUNT = parseEther("1000"); // 1000 test AURA per request

const anvilRpc = () => process.env.FAUCET_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8545";

function getRpc(chainId: number): string {
  if (chainId === 31337) return anvilRpc();
  if (chainId === 11155111) return process.env.RPC_URL ?? "https://ethereum-sepolia.publicnode.com";
  return process.env.RPC_URL ?? "";
}

const AURA_TOKEN_MINT_ABI = [
  { inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], name: "mint", outputs: [], stateMutability: "nonpayable", type: "function" },
] as const;

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

// POST /api/faucet/aura — mint test AURA to address (minter key required; Sepolia or Anvil)
faucetRouter.post("/aura", async (req, res) => {
  const address = req.body?.address as string | undefined;
  const chainId = Number(req.body?.chainId ?? 31337);

  if (!address || typeof address !== "string" || !address.startsWith("0x") || address.length !== 42) {
    return res.status(400).json({ error: "Missing or invalid address" });
  }

  const auraTokenAddress = process.env.AURA_TOKEN_ADDRESS as `0x${string}` | undefined;
  const pk = process.env.FAUCET_PRIVATE_KEY;

  if (!auraTokenAddress) {
    return res.status(503).json({
      error: "AURA faucet not configured. Set AURA_TOKEN_ADDRESS in backend .env.",
    });
  }
  if (!pk) {
    return res.status(503).json({
      error: "Faucet key not configured. Set FAUCET_PRIVATE_KEY (must be AuraToken minter on this chain).",
    });
  }

  const rpc = getRpc(chainId);
  if (!rpc) {
    return res.status(400).json({ error: "Unsupported chainId for AURA faucet (use 31337 or 11155111)" });
  }

  const chain = chainId === 11155111 ? sepolia : foundry;
  if (chainId !== 31337 && chainId !== 11155111) {
    return res.status(400).json({ error: "AURA faucet only available for Anvil (31337) or Sepolia (11155111)" });
  }

  try {
    const account = privateKeyToAccount(pk as `0x${string}`);
    const wallet = createWalletClient({
      account,
      chain,
      transport: http(rpc),
    });
    const publicClient = createPublicClient({ chain, transport: http(rpc) });
    const hash = await wallet.writeContract({
      address: auraTokenAddress,
      abi: AURA_TOKEN_MINT_ABI,
      functionName: "mint",
      args: [address as Address, AURA_FAUCET_AMOUNT],
      gas: 200_000n,
      ...(chainId === 11155111
        ? { maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }
        : {}),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return res.json({ success: true, hash, receipt: receipt.status });
  } catch (e) {
    const msg = (e as Error).message;
    const hint =
      msg.includes("insufficient funds") || msg.includes("balance")
        ? " Убедитесь: 1) В FAUCET_PRIVATE_KEY указан ключ минтера (деплоера), не Anvil. 2) Адрес минтера пополнен Sepolia ETH (фаусет) для оплаты газа."
        : "";
    return res.status(500).json({ error: msg + hint });
  }
});

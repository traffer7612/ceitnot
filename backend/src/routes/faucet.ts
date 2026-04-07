import { Router } from "express";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, defineChain } from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";

const arbitrumSepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
});

export const faucetRouter = Router();

const FAUCET_AMOUNT = parseEther("0.5");
const GOVERNANCE_TOKEN_FAUCET_AMOUNT = parseEther("1000"); // per request (testnet)

const anvilRpc = () => process.env.FAUCET_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8545";

function getRpc(chainId: number): string {
  if (chainId === 31337) return anvilRpc();
  if (chainId === 11155111) return process.env.RPC_URL ?? "https://ethereum-sepolia.publicnode.com";
  if (chainId === 421614)
    return process.env.RPC_URL ?? arbitrumSepolia.rpcUrls.default.http[0];
  return process.env.RPC_URL ?? "";
}

const ERC20_MINT_ABI = [
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

// POST /api/faucet/mint-governance — mint test CEITNOT to address (minter key required; Sepolia or Anvil)
faucetRouter.post("/mint-governance", async (req, res) => {
  const address = req.body?.address as string | undefined;
  const chainId = Number(req.body?.chainId ?? 31337);

  if (!address || typeof address !== "string" || !address.startsWith("0x") || address.length !== 42) {
    return res.status(400).json({ error: "Missing or invalid address" });
  }

  const tokenAddress = process.env.GOVERNANCE_TOKEN_ADDRESS as `0x${string}` | undefined;
  const pk = process.env.FAUCET_PRIVATE_KEY;

  if (!tokenAddress) {
    return res.status(503).json({
      error: "Governance token faucet not configured. Set GOVERNANCE_TOKEN_ADDRESS in backend .env.",
    });
  }
  if (!pk) {
    return res.status(503).json({
      error: "Faucet key not configured. Set FAUCET_PRIVATE_KEY (must be token minter on this chain).",
    });
  }

  const rpc = getRpc(chainId);
  if (!rpc) {
    return res.status(400).json({ error: "Unsupported chainId (use 31337, 11155111, or 421614)" });
  }

  const chain =
    chainId === 11155111 ? sepolia : chainId === 421614 ? arbitrumSepolia : foundry;
  if (chainId !== 31337 && chainId !== 11155111 && chainId !== 421614) {
    return res.status(400).json({
      error:
        "Governance token faucet only available for Anvil (31337), Ethereum Sepolia (11155111), or Arbitrum Sepolia (421614)",
    });
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
      address: tokenAddress,
      abi: ERC20_MINT_ABI,
      functionName: "mint",
      args: [address as Address, GOVERNANCE_TOKEN_FAUCET_AMOUNT],
      gas: 200_000n,
      ...(chainId === 11155111 || chainId === 421614
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

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arbitrum, base, sepolia } from "wagmi/chains";
import { foundry } from "viem/chains";
import { defineChain } from "viem";

// Some MetaMask setups use chainId 1337 for Localhost instead of 31337 (Anvil default)
const localhost1337 = defineChain({
  id: 1337,
  name: "Localhost 1337",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

// Arbitrum RPC через прокси бэкенда, чтобы не было CORS при localhost
const arbitrumRpc =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/rpc/42161`
    : "https://arb1.arbitrum.io/rpc";

export const config = createConfig({
  chains: [foundry, localhost1337, sepolia, arbitrum, base],
  connectors: [injected()],
  transports: {
    [foundry.id]: http("http://127.0.0.1:8545"),
    [localhost1337.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http("https://ethereum-sepolia.publicnode.com"),
    [arbitrum.id]: http(arbitrumRpc),
    [base.id]: http(),
  },
});

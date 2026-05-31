import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendProxyTarget =
    env.VITE_BACKEND_PROXY_TARGET?.trim() || "http://localhost:3001";
  const chainId = Number(env.VITE_CHAIN_ID || "31337");
  const arbitrumRpc =
    env.VITE_ARBITRUM_RPC_URL?.trim() || "https://arbitrum-one.publicnode.com";
  const arbitrumSepoliaRpc =
    env.VITE_ARBITRUM_SEPOLIA_RPC_URL?.trim() ||
    "https://sepolia-rollup.arbitrum.io/rpc";
  const sepoliaRpc =
    env.VITE_SEPOLIA_RPC_URL?.trim() ||
    "https://ethereum-sepolia.publicnode.com";
  const rpcTarget =
    chainId === 42161
      ? arbitrumRpc
      : chainId === 421614
        ? arbitrumSepoliaRpc
        : sepoliaRpc;

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": { target: backendProxyTarget, changeOrigin: true },
        "/rpc": {
          target: rpcTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rpc/, ""),
        },
      },
    },
  };
});

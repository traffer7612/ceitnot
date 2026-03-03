import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";

const LOCAL_CHAIN_ID = 31337;
const useLocalBalance = (chainId: number | undefined) =>
  chainId === LOCAL_CHAIN_ID || chainId === undefined;

async function fetchBalanceFromBackend(address: string): Promise<string> {
  const res = await fetch(`/api/faucet/balance?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error("Failed to fetch balance");
  const data = await res.json();
  return data.balance ?? "0";
}

export function Header() {
  const { address, isConnected, chainId } = useAccount();
  const { data: wagmiBalance } = useBalance({ address, chainId });
  const useBackend = useLocalBalance(chainId);
  const { data: backendBalance } = useQuery({
    queryKey: ["balance", address],
    queryFn: () => fetchBalanceFromBackend(address!),
    enabled: !!address && useBackend,
    refetchInterval: useBackend ? 10_000 : false,
  });
  const balanceStr =
    useBackend && backendBalance != null
      ? backendBalance
      : wagmiBalance != null
        ? wagmiBalance.formatted
        : null;
  const queryClient = useQueryClient();
  const { disconnect } = useDisconnect();
  const [faucetStatus, setFaucetStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [faucetMessage, setFaucetMessage] = useState("");

  async function requestFaucet() {
    if (!address) return;
    setFaucetStatus("loading");
    setFaucetMessage("");
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setFaucetStatus("ok");
        setFaucetMessage("0.5 ETH sent");
        queryClient.invalidateQueries({ queryKey: ["balance", address] });
      } else {
        setFaucetStatus("err");
        setFaucetMessage(data.error ?? "Faucet failed");
      }
    } catch (e) {
      setFaucetStatus("err");
      setFaucetMessage((e as Error).message ?? "Request failed");
    }
    setTimeout(() => setFaucetStatus("idle"), 4000);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-aura-border bg-aura-bg/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <img src="/aura.svg" alt="Aura" className="w-8 h-8" />
          <span className="font-semibold text-lg tracking-tight">Aura</span>
        </a>
        <div className="flex items-center gap-3">
          {isConnected && address ? (
            <>
              <button
                type="button"
                onClick={requestFaucet}
                disabled={faucetStatus === "loading"}
                className="btn-ghost text-sm py-2"
                title="Get 0.5 test ETH (Anvil)"
              >
                {faucetStatus === "loading" ? "…" : "Faucet"}
              </button>
              {faucetMessage && (
                <span className={`text-xs ${faucetStatus === "ok" ? "text-green-500" : "text-red-400"}`}>
                  {faucetMessage}
                </span>
              )}
              <span className="font-mono text-sm text-aura-muted" title="ETH balance">
                {balanceStr != null ? `${Number(balanceStr).toFixed(4)} ETH` : "—"}
              </span>
              <span className="font-mono text-sm text-aura-muted truncate max-w-[140px]">
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
              <button
                type="button"
                onClick={() => disconnect()}
                className="btn-ghost text-sm py-2"
              >
                Disconnect
              </button>
            </>
          ) : (
            <ConnectButton />
          )}
        </div>
      </div>
    </header>
  );
}

function ConnectButton() {
  const { connect, connectors, isPending } = useConnect();

  return (
    <button
      type="button"
      onClick={() => connect({ connector: connectors[0] })}
      disabled={isPending}
      className="btn-primary"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

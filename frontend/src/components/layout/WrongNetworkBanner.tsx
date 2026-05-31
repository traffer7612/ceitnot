import { useState } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { targetChain } from '../../wagmi';
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type ConnectorLike = {
  getProvider?: () => Promise<unknown> | unknown;
};

function providerFromWindow(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum || typeof ethereum.request !== 'function') return null;
  return ethereum;
}
async function providerFromConnector(connector: ConnectorLike | null | undefined): Promise<EthereumProvider | null> {
  if (!connector || typeof connector.getProvider !== 'function') return null;
  try {
    const provider = await connector.getProvider();
    if (
      provider &&
      typeof provider === 'object' &&
      'request' in provider &&
      typeof (provider as { request?: unknown }).request === 'function'
    ) {
      return provider as EthereumProvider;
    }
  } catch {
    return null;
  }
  return null;
}

function errorCode(err: unknown): number | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const raw = (err as { code?: unknown }).code;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function walletSwitchWithFallback(provider: EthereumProvider | null, chainId: number): Promise<boolean> {
  if (!provider) return false;
  const hexChainId = `0x${chainId.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch (switchErr) {
    if (errorCode(switchErr) !== 4902) return false;
  }
  const rpcUrls = targetChain.rpcUrls.default.http;
  if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) return false;
  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: hexChainId,
          chainName: targetChain.name,
          nativeCurrency: targetChain.nativeCurrency,
          rpcUrls,
          blockExplorerUrls: targetChain.blockExplorers?.default?.url
            ? [targetChain.blockExplorers.default.url]
            : [],
        },
      ],
    });
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
    return true;
  } catch {
    return false;
  }
}

export default function WrongNetworkBanner() {
  const { isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [isFallbackPending, setIsFallbackPending] = useState(false);

  const isWrongNetwork = isConnected && chainId !== targetChain.id;
  const switching = isPending || isFallbackPending;

  async function handleSwitchNetwork() {
    if (switching) return;
    setIsFallbackPending(true);
    try {
      try {
        await switchChainAsync({ chainId: targetChain.id });
        return;
      } catch {
        const connectorProvider = await providerFromConnector(connector as ConnectorLike | undefined);
        const switched =
          (await walletSwitchWithFallback(connectorProvider, targetChain.id)) ||
          (await walletSwitchWithFallback(providerFromWindow(), targetChain.id));
        if (!switched) return;
      }
    } finally {
      setIsFallbackPending(false);
    }
  }

  if (!isWrongNetwork) return null;

  return (
    <div className="w-full bg-red-600/90 backdrop-blur-sm border-b border-red-500 px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-sm font-medium text-white z-50 text-center">
      <span className="break-words">
        ⚠️ Wrong network detected — switch to{' '}
        <strong>
          {targetChain.name} (chain {targetChain.id})
        </strong>
        .
      </span>
      <button
        onClick={() => {
          void handleSwitchNetwork();
        }}
        disabled={switching}
        className="shrink-0 px-3 py-1 rounded bg-white text-red-700 font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
      >
        {switching ? 'Switching…' : 'Switch Network'}
      </button>
    </div>
  );
}

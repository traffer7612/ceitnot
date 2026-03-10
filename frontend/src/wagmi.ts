import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { arbitrum, base, sepolia } from 'wagmi/chains';
import { foundry } from 'viem/chains';
import { defineChain } from 'viem';

// MetaMask sometimes uses 1337 instead of 31337 for localhost Anvil
const localhost1337 = defineChain({
  id: 1337,
  name: 'Localhost 1337',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});

export const config = getDefaultConfig({
  appName: 'Lumina Protocol',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'lumina-dev-placeholder',
  chains: [foundry, localhost1337, sepolia, arbitrum, base],
  transports: {
    [foundry.id]:       http('/rpc'),
    [localhost1337.id]: http('/rpc'),
    [sepolia.id]:       http('https://ethereum-sepolia.publicnode.com'),
    [arbitrum.id]:      http(),
    [base.id]:          http(),
  },
  ssr: false,
});

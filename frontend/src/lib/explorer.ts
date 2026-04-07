/** Block explorer URL for a contract address (mainnets / testnets used in the app). */
export function blockExplorerAddressUrl(chainId: number | undefined, address: string): string | null {
  if (!address || chainId === undefined) return null;
  const a = address.trim();
  switch (chainId) {
    case 42161:
      return `https://arbiscan.io/address/${a}`;
    case 421614:
      return `https://sepolia.arbiscan.io/address/${a}`;
    case 8453:
      return `https://basescan.org/address/${a}`;
    case 11155111:
      return `https://sepolia.etherscan.io/address/${a}`;
    default:
      return null;
  }
}

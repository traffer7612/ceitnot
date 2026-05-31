import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { APP_SUPPORTED_CHAIN_IDS, setChainOverride, TARGET_CHAIN_ID } from '../../lib/chainEnv';

type ChainOption = { id: number; label: string };
type NetworkSwitcherProps = {
  className?: string;
  selectClassName?: string;
  showLabel?: boolean;
};

const CHAIN_LABELS: Record<number, string> = {
  42161: 'Arbitrum',
  421614: 'Arb Sepolia',
  11155111: 'Sepolia',
  31337: 'Anvil',
};

function chainOptions(): ChainOption[] {
  const base = APP_SUPPORTED_CHAIN_IDS.filter((id) => (import.meta.env.DEV ? true : id !== 31337));
  return base.map((id) => ({ id, label: CHAIN_LABELS[id] ?? `Chain ${id}` }));
}
export default function NetworkSwitcher({
  className = '',
  selectClassName = '',
  showLabel = true,
}: NetworkSwitcherProps) {
  const options = chainOptions();
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync, isPending } = useSwitchChain();

  const selectedChainId = TARGET_CHAIN_ID;

  async function handleChange(nextChainId: number) {
    if (!Number.isFinite(nextChainId) || nextChainId <= 0) return;
    if (nextChainId === selectedChainId) return;
    if (isConnected) {
      try {
        await switchChainAsync({ chainId: nextChainId });
      } catch {
        // Keep app-level network switch available even when wallet extension switch fails.
      }
    }
    setChainOverride(nextChainId);
    window.location.reload();
  }

  return (
    <label
      className={`flex items-center gap-2 rounded-lg border border-ceitnot-border bg-ceitnot-surface-2/80 px-2 py-1 text-xs text-ceitnot-muted ${className}`.trim()}
    >
      {showLabel && <span className="whitespace-nowrap">Network</span>}
      <select
        value={String(selectedChainId)}
        onChange={(e) => {
          void handleChange(Number(e.target.value));
        }}
        disabled={isPending}
        className={`network-switcher-select w-28 rounded-lg border border-ceitnot-border bg-ceitnot-surface px-2 py-1 text-ceitnot-ink outline-none ${selectClassName}`.trim()}
        title={isConnected ? `Wallet chain: ${walletChainId}` : 'Select app network'}
      >
        {options.map((opt) => (
          <option className="network-switcher-option" key={opt.id} value={String(opt.id)}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

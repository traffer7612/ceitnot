import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { isAddress, type Address, type Hash } from 'viem';
import { ShieldCheck, ShieldAlert, Lock, Unlock, Zap, UserX, Loader2, Copy, CheckCircle } from 'lucide-react';
import { auraEngineAbi } from '../abi/auraEngine';
import { useAdmin } from '../hooks/useAdmin';
import { useContractAddresses, gasFor } from '../lib/contracts';
import { useMarkets } from '../hooks/useMarkets';
import { formatAddress } from '../lib/utils';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="btn-ghost p-1 rounded" title="Copy">
      {copied ? <CheckCircle size={13} className="text-aura-success" /> : <Copy size={13} />}
    </button>
  );
}

function AdminAction({ label, description, buttonLabel, buttonClass, onAction, isPending, disabled }: {
  label: string; description: string; buttonLabel: string; buttonClass: string;
  onAction: () => void; isPending: boolean; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-aura-border last:border-0">
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-aura-muted mt-0.5">{description}</p>
      </div>
      <button
        onClick={onAction}
        disabled={isPending || disabled}
        className={`${buttonClass} text-sm flex items-center gap-1.5 shrink-0`}
      >
        {isPending && <Loader2 size={13} className="animate-spin" />}
        {buttonLabel}
      </button>
    </div>
  );
}

export default function AdminPage() {
  const { chainId } = useAccount();
  const { engine }  = useContractAddresses();
  const { admin, paused, emergencyShutdown, debtToken, marketRegistry, isAdmin, isLoading, refetch } = useAdmin();
  const { markets, count } = useMarkets();
  const [newAdmin, setNewAdmin] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();

  const { writeContractAsync, isPending } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });
  if (confirmed && hash) { refetch(); }

  const gas = gasFor(chainId);

  const exec = async (fn: () => Promise<Hash>) => {
    try { setHash(await fn()); } catch (e) { console.error(e); }
  };

  return (
    <div className="page-container max-w-3xl mx-auto">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-aura-gold to-aura-accent">Admin</span>
        </h1>
        <p className="page-subtitle">Protocol configuration and emergency controls.</p>
      </div>

      {/* Protocol status */}
      <div className="card p-5 mb-5">
        <h2 className="font-semibold mb-4">Protocol Status</h2>
        <div className="grid grid-cols-2 gap-5">
          {/* Paused */}
          <div className="flex items-center gap-3">
            {paused
              ? <Lock size={20} className="text-aura-danger shrink-0" />
              : <Unlock size={20} className="text-aura-success shrink-0" />}
            <div>
              <p className="text-xs stat-label">Paused</p>
              <p className={`font-semibold mt-0.5 ${paused ? 'text-aura-danger' : 'text-aura-success'}`}>
                {isLoading ? '…' : paused ? 'Yes — paused' : 'No — active'}
              </p>
            </div>
          </div>
          {/* Emergency Shutdown */}
          <div className="flex items-center gap-3">
            {emergencyShutdown
              ? <ShieldAlert size={20} className="text-aura-danger shrink-0" />
              : <ShieldCheck size={20} className="text-aura-success shrink-0" />}
            <div>
              <p className="text-xs stat-label">Emergency Shutdown</p>
              <p className={`font-semibold mt-0.5 ${emergencyShutdown ? 'text-aura-danger' : 'text-aura-success'}`}>
                {isLoading ? '…' : emergencyShutdown ? 'ACTIVE' : 'Inactive'}
              </p>
            </div>
          </div>
          {/* Markets */}
          <div>
            <p className="text-xs stat-label">Total Markets</p>
            <p className="font-semibold mt-0.5">{count} ({markets.filter(m => m.config.isActive).length} active)</p>
          </div>
          {/* Role */}
          <div>
            <p className="text-xs stat-label">Your Role</p>
            <p className={`font-semibold mt-0.5 ${isAdmin ? 'text-aura-gold' : 'text-aura-muted-2'}`}>
              {isAdmin ? '⚡ Admin' : 'Read-only'}
            </p>
          </div>
        </div>
      </div>

      {/* Contract addresses */}
      <div className="card p-5 mb-5">
        <h2 className="font-semibold mb-4">Contract Addresses</h2>
        <div className="space-y-3 text-sm font-mono">
          {[
            ['Engine',     engine],
            ['Registry',   marketRegistry],
            ['Debt Token', debtToken],
            ['Admin',      admin],
          ].map(([label, addr]) => addr && (
            <div key={label} className="flex items-center justify-between gap-2 py-2 border-b border-aura-border last:border-0">
              <span className="text-aura-muted text-xs min-w-[80px]">{label}</span>
              <span className="text-white truncate">{addr}</span>
              <CopyButton text={addr} />
            </div>
          ))}
        </div>
      </div>

      {/* Admin actions — only shown if isAdmin */}
      {isAdmin ? (
        <div className="card p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={16} className="text-aura-gold" />
            <h2 className="font-semibold">Admin Controls</h2>
          </div>
          <div>
            <AdminAction
              label="Pause Protocol"
              description="Halts all borrows and deposits."
              buttonLabel="Pause"
              buttonClass="btn-danger"
              isPending={isPending}
              disabled={paused === true}
              onAction={() => exec(() => writeContractAsync({ address: engine!, abi: auraEngineAbi, functionName: 'pause', ...gas }))}
            />
            <AdminAction
              label="Unpause Protocol"
              description="Resume normal operations."
              buttonLabel="Unpause"
              buttonClass="btn-primary"
              isPending={isPending}
              disabled={paused === false}
              onAction={() => exec(() => writeContractAsync({ address: engine!, abi: auraEngineAbi, functionName: 'unpause', ...gas }))}
            />
            <AdminAction
              label="Enable Emergency Shutdown"
              description="Disables all borrows permanently until lifted."
              buttonLabel="Activate"
              buttonClass="btn-danger"
              isPending={isPending}
              disabled={emergencyShutdown === true}
              onAction={() => exec(() => writeContractAsync({ address: engine!, abi: auraEngineAbi, functionName: 'setEmergencyShutdown', args: [true], ...gas }))}
            />
            <AdminAction
              label="Disable Emergency Shutdown"
              description="Re-enables borrowing."
              buttonLabel="Deactivate"
              buttonClass="btn-primary"
              isPending={isPending}
              disabled={emergencyShutdown === false}
              onAction={() => exec(() => writeContractAsync({ address: engine!, abi: auraEngineAbi, functionName: 'setEmergencyShutdown', args: [false], ...gas }))}
            />
          </div>

          {/* Transfer admin */}
          <div className="mt-5 pt-5 border-t border-aura-border">
            <div className="flex items-center gap-2 mb-3 text-aura-danger">
              <UserX size={15} />
              <h3 className="font-semibold text-sm">Transfer Admin</h3>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newAdmin}
                onChange={e => setNewAdmin(e.target.value)}
                placeholder="New admin address (0x…)"
                className="input-field flex-1"
              />
              <button
                onClick={() => exec(() => writeContractAsync({ address: engine!, abi: auraEngineAbi, functionName: 'transferAdmin', args: [newAdmin as Address], ...gas }))}
                disabled={isPending || !isAddress(newAdmin)}
                className="btn-danger shrink-0"
              >
                {isPending ? <Loader2 size={14} className="animate-spin" /> : 'Transfer'}
              </button>
            </div>
            <p className="text-xs text-aura-danger mt-2">⚠ This is irreversible. Verify the address carefully.</p>
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center">
          <ShieldCheck size={32} className="text-aura-muted mx-auto mb-3" />
          <p className="text-aura-muted-2 text-sm">Admin controls are only visible to the protocol admin.</p>
          {admin && (
            <p className="text-xs text-aura-muted mt-2 font-mono">Admin: {formatAddress(admin)}</p>
          )}
        </div>
      )}

      {/* Tx hash */}
      {hash && (
        <p className="text-xs text-center text-aura-muted font-mono mt-4">
          {confirmed ? '✓ Confirmed' : 'Pending'}: {hash.slice(0, 12)}…{hash.slice(-8)}
        </p>
      )}
    </div>
  );
}

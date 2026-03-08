import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { parseUnits, formatUnits, type Hash } from 'viem';
import { X, ArrowRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { auraEngineAbi, erc20Abi } from '../../abi/auraEngine';
import { useContractAddresses, gasFor, TARGET_CHAIN_ID } from '../../lib/contracts';

export type ActionType = 'deposit' | 'withdraw' | 'borrow' | 'repay';

type Props = {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  action:    ActionType;
  marketId:  number;
  /** Address of the vault (for deposit approval) */
  vaultAddress?: `0x${string}`;
  /** Address of the debt token (for repay approval) */
  debtTokenAddress?: `0x${string}`;
  /** User's current shares balance in this market */
  sharesBalance?: bigint;
  /** User's current debt in this market */
  debtBalance?: bigint;
};

const ACTION_LABEL: Record<ActionType, string> = {
  deposit:  'Deposit Collateral',
  withdraw: 'Withdraw Collateral',
  borrow:   'Borrow',
  repay:    'Repay Debt',
};

const ACTION_COLOR: Record<ActionType, string> = {
  deposit:  'btn-primary',
  withdraw: 'btn-secondary',
  borrow:   'btn-primary',
  repay:    'btn-secondary',
};

export default function ActionModal({
  open, onClose, onSuccess, action, marketId,
  vaultAddress, debtTokenAddress, sharesBalance, debtBalance,
}: Props) {
  const { address, chainId } = useAccount();
  const { engine } = useContractAddresses();
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<'input' | 'approving' | 'writing' | 'success' | 'error'>('input');
  const [errMsg, setErrMsg] = useState('');

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  // Build the amount in raw bigint (18 decimals for shares/debt)
  const amountRaw = (() => {
    try { return amount ? parseUnits(amount, 18) : 0n; } catch { return 0n; }
  })();

  // Read wallet balances: vault shares (for deposit) and debt token (for repay/borrow info)
  const { data: walletData } = useReadContracts({
    contracts: address ? [
      ...(vaultAddress ? [{ address: vaultAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: TARGET_CHAIN_ID }] : []),
      ...(debtTokenAddress ? [{ address: debtTokenAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: TARGET_CHAIN_ID }] : []),
    ] : [],
    query: { enabled: !!address && (!!vaultAddress || !!debtTokenAddress) },
  });
  const walletShares    = vaultAddress     ? ((walletData?.[0]?.result as bigint | undefined) ?? 0n) : 0n;
  const walletDebtToken = debtTokenAddress ? ((walletData?.[vaultAddress ? 1 : 0]?.result as bigint | undefined) ?? 0n) : 0n;

  // Read collateral value for borrow max calculation
  const { data: posValueData } = useReadContracts({
    contracts: engine && address ? [
      { address: engine, abi: auraEngineAbi, functionName: 'getPositionCollateralValue' as const, args: [address, BigInt(marketId)] as const, chainId: TARGET_CHAIN_ID },
    ] : [],
    query: { enabled: !!engine && !!address && action === 'borrow' },
  });
  const collateralValue = (posValueData?.[0]?.result as bigint | undefined) ?? 0n;

  // Check allowance for deposit (vault → engine) or repay (debtToken → engine)
  const approvalToken = action === 'deposit' ? vaultAddress : action === 'repay' ? debtTokenAddress : undefined;
  const { data: allowanceData, refetch: refetchAllowance } = useReadContracts({
    contracts: approvalToken && address && engine ? [{
      address: approvalToken,
      abi: erc20Abi,
      functionName: 'allowance' as const,
      args: [address, engine] as const,
    }] : [],
    query: { enabled: !!approvalToken && !!address && !!engine },
  });
  const allowance = (allowanceData?.[0]?.result as bigint | undefined) ?? 0n;
  const needsApproval = (action === 'deposit' || action === 'repay') && amountRaw > 0n && allowance < amountRaw;

  // On confirmed tx
  useEffect(() => {
    if (confirmed && hash) {
      if (step === 'approving') {
        refetchAllowance();
        setStep('input'); // let user proceed to write
      } else if (step === 'writing') {
        setStep('success');
        onSuccess();
      }
    }
  }, [confirmed, hash, step, refetchAllowance, onSuccess]);

  const reset = () => { setAmount(''); setHash(undefined); setStep('input'); setErrMsg(''); };
  const close = () => { reset(); onClose(); };

  const setMax = () => {
    if (action === 'deposit'  && walletShares > 0n) setAmount(formatUnits(walletShares, 18));
    if (action === 'withdraw' && sharesBalance)     setAmount(formatUnits(sharesBalance, 18));
    if (action === 'repay'    && debtBalance)       setAmount(formatUnits(debtBalance, 18));
    if (action === 'borrow'   && collateralValue > 0n) {
      // Max borrow ≈ 80% of collateral value (LTV), minus existing debt
      const maxRaw = (collateralValue * 8000n) / 10000n - (debtBalance ?? 0n);
      if (maxRaw > 0n) setAmount(formatUnits(maxRaw, 18));
    }
  };

  async function submit() {
    if (!address || !engine) return;
    const gas = gasFor(chainId);
    try {
      if (needsApproval && approvalToken) {
        setStep('approving');
        const h = await writeContractAsync({
          address: approvalToken,
          abi: erc20Abi,
          functionName: 'approve',
          args: [engine, 2n ** 256n - 1n],
          ...gas,
        });
        setHash(h);
        return;
      }

      setStep('writing');
      let h: Hash;
      if (action === 'deposit') {
        h = await writeContractAsync({ address: engine, abi: auraEngineAbi, functionName: 'depositCollateral', args: [address, BigInt(marketId), amountRaw], ...gas });
      } else if (action === 'withdraw') {
        h = await writeContractAsync({ address: engine, abi: auraEngineAbi, functionName: 'withdrawCollateral', args: [address, BigInt(marketId), amountRaw], ...gas });
      } else if (action === 'borrow') {
        h = await writeContractAsync({ address: engine, abi: auraEngineAbi, functionName: 'borrow', args: [address, BigInt(marketId), amountRaw], ...gas });
      } else {
        h = await writeContractAsync({ address: engine, abi: auraEngineAbi, functionName: 'repay', args: [address, BigInt(marketId), amountRaw], ...gas });
      }
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg.split('\n')[0].slice(0, 120));
    }
  }

  if (!open) return null;

  const isPending  = step === 'approving' || step === 'writing';
  const buttonLabel = step === 'approving'
    ? 'Approving…'
    : step === 'writing'
    ? 'Confirming…'
    : needsApproval
    ? `Approve ${action === 'deposit' ? 'Vault' : 'Debt Token'}`
    : ACTION_LABEL[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md card bg-aura-surface border border-aura-border-2 shadow-2xl p-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">
            {ACTION_LABEL[action]}
            <span className="ml-2 text-sm text-aura-muted font-normal">Market #{marketId}</span>
          </h2>
          <button onClick={close} className="btn-ghost p-1.5 rounded-lg" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Success state */}
        {step === 'success' && (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-aura-success mx-auto mb-3" />
            <p className="font-semibold text-lg">Transaction confirmed!</p>
            <p className="text-aura-muted text-sm mt-1">Your position has been updated.</p>
            <button className="btn-primary mt-6 w-full" onClick={close}>Close</button>
          </div>
        )}

        {/* Error state */}
        {step === 'error' && (
          <div className="text-center py-4">
            <AlertCircle size={40} className="text-aura-danger mx-auto mb-3" />
            <p className="font-semibold text-aura-danger">Transaction failed</p>
            <p className="text-aura-muted text-xs mt-2 break-words">{errMsg}</p>
            <button className="btn-secondary mt-5 w-full" onClick={() => { setStep('input'); setErrMsg(''); }}>Try again</button>
          </div>
        )}

        {/* Input state */}
        {step !== 'success' && step !== 'error' && (
          <>
            {/* Approve step indicator */}
            {needsApproval && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-aura-warning/10 border border-aura-warning/20 rounded-xl">
                <ArrowRight size={14} className="text-aura-warning shrink-0" />
                <p className="text-xs text-aura-warning">
                  Two steps: first approve the token, then confirm the action.
                </p>
              </div>
            )}

            {/* Amount input */}
            <div className="mb-5">
              <label className="block text-sm text-aura-muted mb-2">
                Amount <span className="text-aura-muted-2">(shares / tokens, 18 dec)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="input-field flex-1"
                  disabled={isPending}
                />
                <button
                  type="button"
                  onClick={setMax}
                  className="px-3 py-2 rounded-xl text-sm font-medium bg-aura-gold/15 text-aura-gold hover:bg-aura-gold/25 transition-colors"
                  disabled={isPending}
                >
                  Max
                </button>
              </div>

              {/* Balance hints */}
              {action === 'deposit' && (
                <p className="text-xs text-aura-muted mt-1">
                  Wallet shares: <span className="text-white font-mono">{formatUnits(walletShares, 18)}</span>
                </p>
              )}
              {action === 'withdraw' && sharesBalance !== undefined && (
                <p className="text-xs text-aura-muted mt-1">
                  Deposited shares: <span className="text-white font-mono">{formatUnits(sharesBalance, 18)}</span>
                </p>
              )}
              {action === 'borrow' && (
                <p className="text-xs text-aura-muted mt-1">
                  Collateral value: <span className="text-white font-mono">{formatUnits(collateralValue, 18)}</span>
                  {' · '}Max borrow (80% LTV): <span className="text-white font-mono">
                    {formatUnits((collateralValue * 8000n / 10000n) - (debtBalance ?? 0n) > 0n ? (collateralValue * 8000n / 10000n) - (debtBalance ?? 0n) : 0n, 18)}
                  </span>
                  {!!debtBalance && debtBalance > 0n && (
                    <>{' · '}Current debt: <span className="text-aura-warning font-mono">{formatUnits(debtBalance, 18)}</span></>
                  )}
                </p>
              )}
              {action === 'repay' && debtBalance !== undefined && debtBalance > 0n && (
                <p className="text-xs text-aura-muted mt-1">
                  Outstanding debt: <span className="text-white font-mono">{formatUnits(debtBalance, 18)}</span>
                  {' · '}Wallet USDC: <span className="text-white font-mono">{formatUnits(walletDebtToken, 18)}</span>
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !amountRaw || amountRaw <= 0n}
              className={`w-full ${ACTION_COLOR[action]} flex items-center justify-center gap-2`}
            >
              {isPending && <Loader2 size={16} className="animate-spin" />}
              {buttonLabel}
            </button>

            {/* Tx hash */}
            {hash && (
              <p className="text-xs text-aura-muted mt-3 text-center font-mono break-all">
                tx: {hash.slice(0, 10)}…{hash.slice(-8)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

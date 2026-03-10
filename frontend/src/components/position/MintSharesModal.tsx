import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { parseUnits, formatUnits, type Hash, type Address } from 'viem';
import { X, ArrowRight, CheckCircle, AlertCircle, Loader2, Coins } from 'lucide-react';
import { erc20Abi, erc4626Abi } from '../../abi/auraEngine';
import { gasFor } from '../../lib/contracts';

type Props = {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  vaultAddress: Address;
  marketId:  number;
};

export default function MintSharesModal({ open, onClose, onSuccess, vaultAddress, marketId }: Props) {
  const { address, chainId } = useAccount();
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<'input' | 'approving' | 'depositing' | 'success' | 'error'>('input');
  const [errMsg, setErrMsg] = useState('');

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  const amountRaw = (() => {
    try { return amount ? parseUnits(amount, 18) : 0n; } catch { return 0n; }
  })();

  // Read vault.asset(), user's asset balance, asset allowance → vault, user's vault share balance
  const { data: readData } = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: erc4626Abi, functionName: 'asset' as const },
      // placeholders — filled below after asset is known
    ],
    query: { enabled: !!vaultAddress },
  });

  const assetAddress = readData?.[0]?.result as Address | undefined;

  // Once we know the asset address, read balance + allowance + share balance
  const { data: tokenData, refetch: refetchTokenData } = useReadContracts({
    contracts: assetAddress && address ? [
      { address: assetAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const },
      { address: assetAddress, abi: erc20Abi, functionName: 'allowance' as const, args: [address, vaultAddress] as const },
      { address: assetAddress, abi: erc20Abi, functionName: 'symbol' as const },
      { address: vaultAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const },
      { address: vaultAddress, abi: erc20Abi, functionName: 'symbol' as const },
    ] : [],
    query: { enabled: !!assetAddress && !!address },
  });

  const assetBalance = (tokenData?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance    = (tokenData?.[1]?.result as bigint | undefined) ?? 0n;
  const assetSymbol  = (tokenData?.[2]?.result as string | undefined) ?? 'ASSET';
  const shareBalance = (tokenData?.[3]?.result as bigint | undefined) ?? 0n;
  const vaultSymbol  = (tokenData?.[4]?.result as string | undefined) ?? 'VAULT';
  const needsApproval = amountRaw > 0n && allowance < amountRaw;

  const isSepolia = chainId === 11155111;
  const [mintTxHash, setMintTxHash] = useState<Hash | undefined>();
  const [mintError, setMintError] = useState('');
  const { isSuccess: mintConfirmed } = useWaitForTransactionReceipt({ hash: mintTxHash });
  useEffect(() => {
    if (mintConfirmed && mintTxHash) {
      refetchTokenData();
      setMintTxHash(undefined);
      setMintError('');
    }
  }, [mintConfirmed, mintTxHash, refetchTokenData]);

  // Handle tx confirmation
  useEffect(() => {
    if (confirmed && hash) {
      if (step === 'approving') {
        refetchTokenData();
        setHash(undefined);
        setStep('input');
      } else if (step === 'depositing') {
        setStep('success');
        refetchTokenData();
        onSuccess();
      }
    }
  }, [confirmed, hash, step, refetchTokenData, onSuccess]);

  const reset = () => { setAmount(''); setHash(undefined); setStep('input'); setErrMsg(''); };
  const close = () => { reset(); onClose(); };

  const setMax = () => {
    if (assetBalance > 0n) setAmount(formatUnits(assetBalance, 18));
  };

  async function submit() {
    if (!address || !assetAddress) return;
    const gas = gasFor(chainId);
    try {
      // Step 1: approve if needed
      if (needsApproval) {
        setStep('approving');
        const h = await writeContractAsync({
          address: assetAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [vaultAddress, 2n ** 256n - 1n],
          ...gas,
        });
        setHash(h);
        return;
      }

      // Step 2: deposit into vault
      setStep('depositing');
      const h = await writeContractAsync({
        address: vaultAddress,
        abi: erc4626Abi,
        functionName: 'deposit',
        args: [amountRaw, address],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg.split('\n')[0].slice(0, 120));
    }
  }

  if (!open) return null;

  const isPending = step === 'approving' || step === 'depositing';
  const buttonLabel = step === 'approving'
    ? 'Approving…'
    : step === 'depositing'
    ? 'Depositing…'
    : needsApproval
    ? `Approve ${assetSymbol}`
    : `Deposit ${assetSymbol} → Get ${vaultSymbol} Shares`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      <div className="relative z-10 w-full max-w-md card bg-aura-surface border border-aura-border-2 shadow-2xl p-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Coins size={20} className="text-aura-gold" />
            Get Vault Shares
            <span className="ml-1 text-sm text-aura-muted font-normal">Market #{marketId}</span>
          </h2>
          <button onClick={close} className="btn-ghost p-1.5 rounded-lg" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Success */}
        {step === 'success' && (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-aura-success mx-auto mb-3" />
            <p className="font-semibold text-lg">Shares received!</p>
            <p className="text-aura-muted text-sm mt-1">
              You now have {vaultSymbol} shares on your wallet. You can deposit them as collateral.
            </p>
            <button className="btn-primary mt-6 w-full" onClick={close}>Close</button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="text-center py-4">
            <AlertCircle size={40} className="text-aura-danger mx-auto mb-3" />
            <p className="font-semibold text-aura-danger">Transaction failed</p>
            <p className="text-aura-muted text-xs mt-2 break-words">{errMsg}</p>
            <button className="btn-secondary mt-5 w-full" onClick={() => { setStep('input'); setErrMsg(''); }}>Try again</button>
          </div>
        )}

        {/* Input */}
        {step !== 'success' && step !== 'error' && (
          <>
            {/* Explanation */}
            <div className="mb-5 p-3 bg-aura-gold/5 border border-aura-gold/10 rounded-xl">
              <p className="text-xs text-aura-muted">
                To deposit collateral, you first need <strong className="text-white">vault shares</strong>.
                Enter the amount of <strong className="text-white">{assetSymbol}</strong> to convert into
                {' '}<strong className="text-white">{vaultSymbol}</strong> shares.
              </p>
            </div>

            {/* Approve indicator */}
            {needsApproval && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-aura-warning/10 border border-aura-warning/20 rounded-xl">
                <ArrowRight size={14} className="text-aura-warning shrink-0" />
                <p className="text-xs text-aura-warning">
                  Step 1: Approve {assetSymbol} for the vault. Step 2: Deposit.
                </p>
              </div>
            )}

            {/* Amount */}
            <div className="mb-4">
              <label className="block text-sm text-aura-muted mb-2">
                Amount of {assetSymbol}
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
                  disabled={isPending || assetBalance === 0n}
                >
                  Max
                </button>
              </div>
            </div>

            {/* Balances */}
            <div className="grid grid-cols-2 gap-3 mb-5 text-xs">
              <div className="p-3 bg-aura-bg rounded-xl">
                <p className="text-aura-muted">{assetSymbol} balance</p>
                <p className="text-white font-mono mt-1">{formatUnits(assetBalance, 18)}</p>
              </div>
              <div className="p-3 bg-aura-bg rounded-xl">
                <p className="text-aura-muted">{vaultSymbol} shares</p>
                <p className="text-white font-mono mt-1">{formatUnits(shareBalance, 18)}</p>
              </div>
            </div>

            {/* Sepolia: mint test tokens (MockERC20 allows anyone to mint) */}
            {isSepolia && assetAddress && address && (
              <div className="mb-5 p-3 bg-aura-gold/10 border border-aura-gold/20 rounded-xl">
                <p className="text-xs text-aura-muted mb-2">
                  На тестнете Sepolia нет реального {assetSymbol}. Нажмите кнопку ниже, чтобы наминтить себе тестовые токены (контракт MockERC20 разрешает это любому адресу).
                </p>
                <button
                  type="button"
                  disabled={isPending || !!mintTxHash}
                  onClick={async () => {
                    if (!address || !assetAddress) return;
                    try {
                      const h = await writeContractAsync({
                        address: assetAddress,
                        abi: erc20Abi,
                        functionName: 'mint',
                        args: [address, parseUnits('100', 18)],
                        ...gasFor(chainId),
                      });
                      setMintTxHash(h);
                    } catch (e) {
                      setMintError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="w-full py-2 rounded-xl text-sm font-medium bg-aura-gold/20 text-aura-gold hover:bg-aura-gold/30 transition-colors flex items-center justify-center gap-2"
                >
                  {(mintTxHash && !mintConfirmed) && <Loader2 size={14} className="animate-spin" />}
                  {mintTxHash && !mintConfirmed ? 'Ожидание подтверждения…' : `Получить 100 ${assetSymbol}`}
                </button>
                {mintError && <p className="text-xs text-aura-danger mt-2">{mintError}</p>}
              </div>
            )}

            {/* Submit */}
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !amountRaw || amountRaw <= 0n || amountRaw > assetBalance}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 size={16} className="animate-spin" />}
              {buttonLabel}
            </button>

            {amountRaw > assetBalance && assetBalance > 0n && (
              <p className="text-xs text-aura-danger mt-2 text-center">
                Amount exceeds your {assetSymbol} balance.
              </p>
            )}

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

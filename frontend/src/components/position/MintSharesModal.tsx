import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts } from 'wagmi';
import { parseUnits, formatUnits, type Hash, type Address } from 'viem';
import { X, ArrowRight, CheckCircle, AlertCircle, Loader2, Coins } from 'lucide-react';
import { erc20Abi, erc4626Abi } from '../../abi/ceitnotEngine';
import { gasFor, TARGET_CHAIN_ID } from '../../lib/contracts';

type Props = {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  vaultAddress: Address;
  marketId:  number;
};

export default function MintSharesModal({ open, onClose, onSuccess, vaultAddress, marketId }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const chainMismatch = isConnected && chainId != null && chainId !== TARGET_CHAIN_ID;
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
      { address: vaultAddress, abi: erc4626Abi, functionName: 'asset' as const, chainId: TARGET_CHAIN_ID },
    ],
    query: { enabled: !!vaultAddress },
  });

  const assetAddress = readData?.[0]?.result as Address | undefined;

  // Once we know the asset address, read balance + allowance + share balance
  const { data: tokenData, refetch: refetchTokenData } = useReadContracts({
    contracts: assetAddress && address ? [
      { address: assetAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: TARGET_CHAIN_ID },
      { address: assetAddress, abi: erc20Abi, functionName: 'allowance' as const, args: [address, vaultAddress] as const, chainId: TARGET_CHAIN_ID },
      { address: assetAddress, abi: erc20Abi, functionName: 'symbol' as const, chainId: TARGET_CHAIN_ID },
      { address: vaultAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: TARGET_CHAIN_ID },
      { address: vaultAddress, abi: erc20Abi, functionName: 'symbol' as const, chainId: TARGET_CHAIN_ID },
    ] : [],
    query: { enabled: !!assetAddress && !!address },
  });

  const assetBalance = (tokenData?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance    = (tokenData?.[1]?.result as bigint | undefined) ?? 0n;
  const assetSymbol  = (tokenData?.[2]?.result as string | undefined) ?? 'ASSET';
  const shareBalance = (tokenData?.[3]?.result as bigint | undefined) ?? 0n;
  const vaultSymbol  = (tokenData?.[4]?.result as string | undefined) ?? 'VAULT';
  const needsApproval = amountRaw > 0n && allowance < amountRaw;

  /**
   * Mint-кнопка только там, где underlying — тестовый MockERC20 (есть публичный mint).
   * Раньше для всего Arbitrum (42161) показывали mock — из‑за этого real Lido wstETH выглядел как тест.
   */
  const showMockMint = (() => {
    if (!assetAddress) return false;
    const assetLc = assetAddress.toLowerCase();
    if (TARGET_CHAIN_ID === 31337 || TARGET_CHAIN_ID === 1337 || TARGET_CHAIN_ID === 11155111 || TARGET_CHAIN_ID === 421614)
      return true;

    if (TARGET_CHAIN_ID === 42161) {
      const canonicalWstEth = '0x5979d7b546e38e414f7e9822514be443a4800529';
      if (assetLc === canonicalWstEth) return false;
      const mockEnv = (
        (import.meta.env.VITE_MOCK_WSTETH_ADDRESS as string | undefined) ||
        (import.meta.env.VITE_MOCK_WSTETH as string | undefined)
      )
        ?.toLowerCase()
        .trim();
      return !!mockEnv && assetLc === mockEnv;
    }
    return false;
  })();
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
    if (chainId !== TARGET_CHAIN_ID) {
      setStep('error');
      setErrMsg(
        chainId == null
          ? 'Подключите кошелёк.'
          : `Неверная сеть: сейчас ${chainId}, нужна ${TARGET_CHAIN_ID}.`,
      );
      return;
    }
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
          chainId: TARGET_CHAIN_ID,
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
        chainId: TARGET_CHAIN_ID,
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

      <div className="relative z-10 w-full max-w-md card bg-ceitnot-surface border border-ceitnot-border-2 shadow-2xl p-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Coins size={20} className="text-ceitnot-gold" />
            Get Vault Shares
            <span className="ml-1 text-sm text-ceitnot-muted font-normal">Market #{marketId}</span>
          </h2>
          <button onClick={close} className="btn-ghost p-1.5 rounded-lg" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Success */}
        {step === 'success' && (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-ceitnot-success mx-auto mb-3" />
            <p className="font-semibold text-lg">Shares received!</p>
            <p className="text-ceitnot-muted text-sm mt-1">
              You now have {vaultSymbol} shares on your wallet. You can deposit them as collateral.
            </p>
            <button className="btn-primary mt-6 w-full" onClick={close}>Close</button>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="text-center py-4">
            <AlertCircle size={40} className="text-ceitnot-danger mx-auto mb-3" />
            <p className="font-semibold text-ceitnot-danger">Transaction failed</p>
            <p className="text-ceitnot-muted text-xs mt-2 break-words">{errMsg}</p>
            <button className="btn-secondary mt-5 w-full" onClick={() => { setStep('input'); setErrMsg(''); }}>Try again</button>
          </div>
        )}

        {/* Input */}
        {step !== 'success' && step !== 'error' && (
          <>
            {chainMismatch && (
              <p className="text-xs text-ceitnot-danger mb-4">
                Сеть кошелька ({chainId}) не совпадает с сетью приложения ({TARGET_CHAIN_ID}). Переключите сеть — иначе балансы и транзакции не совпадут.
              </p>
            )}

            {/* Explanation */}
            <div className="mb-5 p-3 bg-ceitnot-gold/5 border border-ceitnot-gold/10 rounded-xl">
              <p className="text-xs text-ceitnot-muted">
                To deposit collateral, you first need <strong className="text-ceitnot-ink">vault shares</strong>.
                Enter the amount of <strong className="text-ceitnot-ink">{assetSymbol}</strong> to convert into
                {' '}<strong className="text-ceitnot-ink">{vaultSymbol}</strong> shares.
              </p>
            </div>

            {/* Approve indicator */}
            {needsApproval && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-ceitnot-warning/10 border border-ceitnot-warning/20 rounded-xl">
                <ArrowRight size={14} className="text-ceitnot-warning shrink-0" />
                <p className="text-xs text-ceitnot-warning">
                  Step 1: Approve {assetSymbol} for the vault. Step 2: Deposit.
                </p>
              </div>
            )}

            {/* Amount */}
            <div className="mb-4">
              <label className="block text-sm text-ceitnot-muted mb-2">
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
                  className="px-3 py-2 rounded-xl text-sm font-medium bg-ceitnot-gold/15 text-ceitnot-gold hover:bg-ceitnot-gold/25 transition-colors"
                  disabled={isPending || assetBalance === 0n}
                >
                  Max
                </button>
              </div>
            </div>

            {/* Balances */}
            <div className="grid grid-cols-2 gap-3 mb-5 text-xs">
              <div className="p-3 bg-ceitnot-surface-2/80 rounded-xl">
                <p className="text-ceitnot-muted">{assetSymbol} balance</p>
                <p className="text-ceitnot-ink font-mono mt-1">{formatUnits(assetBalance, 18)}</p>
              </div>
              <div className="p-3 bg-ceitnot-surface-2/80 rounded-xl">
                <p className="text-ceitnot-muted">{vaultSymbol} shares</p>
                <p className="text-ceitnot-ink font-mono mt-1">{formatUnits(shareBalance, 18)}</p>
              </div>
            </div>

            {/* MockERC20: mint test tokens (allowed on mock deploys) */}
            {showMockMint && assetAddress && address && (
              <div className="mb-5 p-3 bg-ceitnot-gold/10 border border-ceitnot-gold/20 rounded-xl">
                <p className="text-xs text-ceitnot-muted mb-2">
                  Для этого рынка используется тестовый {assetSymbol} (mock). Нажмите ниже,
                  чтобы наминтить себе токены (контракт MockERC20 разрешает это любому адресу).
                </p>
                <button
                  type="button"
                  disabled={isPending || !!mintTxHash}
                  onClick={async () => {
                    if (!address || !assetAddress) return;
                    try {
                      if (chainId !== TARGET_CHAIN_ID) return;
                      const h = await writeContractAsync({
                        address: assetAddress,
                        abi: erc20Abi,
                        functionName: 'mint',
                        args: [address, parseUnits('100', 18)],
                        chainId: TARGET_CHAIN_ID,
                        ...gasFor(chainId),
                      });
                      setMintTxHash(h);
                    } catch (e) {
                      setMintError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="w-full py-2 rounded-xl text-sm font-medium bg-ceitnot-gold/20 text-ceitnot-gold hover:bg-ceitnot-gold/30 transition-colors flex items-center justify-center gap-2"
                >
                  {(mintTxHash && !mintConfirmed) && <Loader2 size={14} className="animate-spin" />}
                  {mintTxHash && !mintConfirmed ? 'Ожидание подтверждения…' : `Получить 100 ${assetSymbol}`}
                </button>
                {mintError && <p className="text-xs text-ceitnot-danger mt-2">{mintError}</p>}
              </div>
            )}

            {/* Submit */}
            <button
              type="button"
              onClick={submit}
              disabled={
                isPending
                || chainMismatch
                || !amountRaw
                || amountRaw <= 0n
                || amountRaw > assetBalance
              }
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 size={16} className="animate-spin" />}
              {buttonLabel}
            </button>

            {amountRaw > assetBalance && assetBalance > 0n && (
              <p className="text-xs text-ceitnot-danger mt-2 text-center">
                Amount exceeds your {assetSymbol} balance.
              </p>
            )}

            {hash && (
              <p className="text-xs text-ceitnot-muted mt-3 text-center font-mono break-all">
                tx: {hash.slice(0, 10)}…{hash.slice(-8)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

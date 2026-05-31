import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, encodeFunctionData, type Hash, type Address } from 'viem';
import { X, ArrowRight, CheckCircle, AlertCircle, Loader2, Coins } from 'lucide-react';
import { erc20Abi, erc4626Abi } from '../../abi/ceitnotEngine';
import { gasFor, gasForTokenApprove, TARGET_CHAIN_ID } from '../../lib/contracts';
import { contractAddress } from '../../lib/chainEnv';

/** Lido bridged wstETH on Arbitrum One — Rabby/MetaMask «WSTETH» in the wallet. */
const WSTETH_LIDO_ARB = '0x5979D7b546E38E414F7E9822514be443A4800529' as Address;

type Props = {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
  vaultAddress: Address;
  marketId:  number;
};

export default function MintSharesModal({ open, onClose, onSuccess, vaultAddress, marketId }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const chainMismatch = isConnected && chainId != null && chainId !== TARGET_CHAIN_ID;
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<'input' | 'approving' | 'depositing' | 'success' | 'error'>('input');
  const [errMsg, setErrMsg] = useState('');
  const [approvalHint, setApprovalHint] = useState('');

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });


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
      { address: assetAddress, abi: erc20Abi, functionName: 'decimals' as const, chainId: TARGET_CHAIN_ID },
      { address: vaultAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: TARGET_CHAIN_ID },
      { address: vaultAddress, abi: erc20Abi, functionName: 'symbol' as const, chainId: TARGET_CHAIN_ID },
      { address: vaultAddress, abi: erc20Abi, functionName: 'decimals' as const, chainId: TARGET_CHAIN_ID },
    ] : [],
    query: { enabled: !!assetAddress && !!address },
  });

  const assetBalance = (tokenData?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance    = (tokenData?.[1]?.result as bigint | undefined) ?? 0n;
  const assetSymbol  = (tokenData?.[2]?.result as string | undefined) ?? 'ASSET';
  const assetDecimalsRaw = tokenData?.[3]?.result as number | bigint | undefined;
  const assetDecimals = typeof assetDecimalsRaw === 'bigint' ? Number(assetDecimalsRaw) : (assetDecimalsRaw ?? 18);
  const shareBalance = (tokenData?.[4]?.result as bigint | undefined) ?? 0n;
  const vaultSymbol  = (tokenData?.[5]?.result as string | undefined) ?? 'VAULT';
  const vaultDecimalsRaw = tokenData?.[6]?.result as number | bigint | undefined;
  const vaultDecimals = typeof vaultDecimalsRaw === 'bigint' ? Number(vaultDecimalsRaw) : (vaultDecimalsRaw ?? 18);
  const amountRaw = (() => {
    try { return amount ? parseUnits(amount, assetDecimals) : 0n; } catch { return 0n; }
  })();
  const needsApproval = amountRaw > 0n && allowance < amountRaw;

  const [mintCallableByUser, setMintCallableByUser] = useState(false);
  useEffect(() => {
    let cancelled = false;

    async function probeMint() {
      if (!assetAddress || !address || !publicClient) {
        if (!cancelled) setMintCallableByUser(false);
        return;
      }
      try {
        await publicClient.call({
          account: address,
          to: assetAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'mint',
            args: [address, 0n],
          }),
        });
        if (!cancelled) setMintCallableByUser(true);
      } catch {
        if (!cancelled) setMintCallableByUser(false);
      }
    }

    void probeMint();
    return () => { cancelled = true; };
  }, [assetAddress, address, publicClient]);

  /**
   * Показывать «наминть тестовые токены» для:
   * - локальных чейнов (always true для удобства Anvil/mock),
   * - активов, где пользователь реально может вызвать mint(address,uint256),
   * - активов, явно помеченных как mock через env/address-book (MOCK_WSTETH / MOCK_DAI),
   * - но никогда для canonical Lido wstETH на Arbitrum One.
   */
  const showMockMint = (() => {
    if (!assetAddress) return false;
    const assetLc = assetAddress.toLowerCase();
    if (TARGET_CHAIN_ID === 31337 || TARGET_CHAIN_ID === 1337) return true;
    const mockWstEth = contractAddress('MOCK_WSTETH')?.toLowerCase().trim();
    const mockDai = contractAddress('MOCK_DAI')?.toLowerCase().trim();
    const explicitMockAddress =
      (!!mockWstEth && assetLc === mockWstEth) ||
      (!!mockDai && assetLc === mockDai);

    if (TARGET_CHAIN_ID === 42161) {
      const canonicalWstEth = '0x5979d7b546e38e414f7e9822514be443a4800529';
      if (assetLc === canonicalWstEth) return false;
      return mintCallableByUser || explicitMockAddress;
    }

    return mintCallableByUser || explicitMockAddress;
  })();

  const loadedAssetSymbol = (tokenData?.[2]?.result as string | undefined) ?? undefined;
  const vaultUsesOtherWstEthThanWallet =
    open &&
    TARGET_CHAIN_ID === 42161 &&
    !!assetAddress &&
    !!address &&
    loadedAssetSymbol != null &&
    /^wsteth$/i.test(loadedAssetSymbol.trim()) &&
    assetAddress.toLowerCase() !== WSTETH_LIDO_ARB.toLowerCase();

  const { data: lidoBalData } = useReadContracts({
    contracts:
      address && vaultUsesOtherWstEthThanWallet
        ? [
            { address: WSTETH_LIDO_ARB, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: TARGET_CHAIN_ID },
            { address: WSTETH_LIDO_ARB, abi: erc20Abi, functionName: 'decimals' as const, chainId: TARGET_CHAIN_ID },
          ]
        : [],
    query: { enabled: !!address && vaultUsesOtherWstEthThanWallet },
  });
  const lidoWalletBalance = (lidoBalData?.[0]?.result as bigint | undefined) ?? 0n;
  const lidoDecRaw = lidoBalData?.[1]?.result as number | bigint | undefined;
  const lidoDecimals = typeof lidoDecRaw === 'bigint' ? Number(lidoDecRaw) : (lidoDecRaw ?? 18);

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

  const reset = () => { setAmount(''); setHash(undefined); setStep('input'); setErrMsg(''); setApprovalHint(''); };
  const close = () => { reset(); onClose(); };

  const setMax = () => {
    if (assetBalance > 0n) setAmount(formatUnits(assetBalance, assetDecimals));
  };
  const isFeeCapTooLowError = (message: string) => {
    const msg = message.toLowerCase();
    return (
      msg.includes('max fee per gas less than block base fee')
      || (msg.includes('maxfeepergas') && msg.includes('base fee'))
      || (msg.includes('max fee per gas') && msg.includes('base fee'))
    );
  };
  const feeOverridesForBaseFeeRetry = async (baseFeeMultiplier = 2n) => {
    if (!publicClient) return undefined;
    try {
      const pending = await publicClient.getBlock({ blockTag: 'pending' });
      const baseFee = pending.baseFeePerGas;
      if (baseFee == null) return undefined;
      const maxPriorityFeePerGas = baseFee / 10n + 1_000_000n;
      const maxFeePerGas = baseFee * baseFeeMultiplier + maxPriorityFeePerGas;
      return { maxFeePerGas, maxPriorityFeePerGas } as const;
    } catch {
      return undefined;
    }
  };
  const writeWithBaseFeeRetry = async (
    request: Parameters<typeof writeContractAsync>[0],
  ) => {
    const initialFee = await feeOverridesForBaseFeeRetry(2n);
    const firstRequest = (initialFee
      ? { ...request, ...initialFee }
      : request) as Parameters<typeof writeContractAsync>[0];
    try {
      return await writeContractAsync(firstRequest);
    } catch (writeError: unknown) {
      const msg = writeError instanceof Error ? writeError.message : String(writeError);
      if (!isFeeCapTooLowError(msg)) throw writeError;
      const feeRetry = await feeOverridesForBaseFeeRetry(3n);
      if (!feeRetry) throw writeError;
      return await writeContractAsync({ ...request, ...feeRetry } as Parameters<typeof writeContractAsync>[0]);
    }
  };

  async function submit() {
    if (!address || !assetAddress) return;
    if (marketBlockedForDeposit) {
      setStep('error');
      setErrMsg('Этот рынок использует другой контракт wstETH, не Lido 0x5979…; депозит через этот экран отключён.');
      return;
    }
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
        setApprovalHint('');
        const approveGas = gasForTokenApprove(chainId);
        try {
          const h = await writeWithBaseFeeRetry({
            address: assetAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddress, amountRaw],
            chainId: TARGET_CHAIN_ID,
            ...approveGas,
          });
          setHash(h);
          return;
        } catch (primaryApproveError: unknown) {
          const msg = primaryApproveError instanceof Error ? primaryApproveError.message : String(primaryApproveError);
          const looksLikeTokenRevert = /revert|execution reverted|allowance|approve/i.test(msg);
          if (!looksLikeTokenRevert || allowance === 0n) throw primaryApproveError;

          // Fallback for non-standard ERC-20 (e.g. tokens that require allowance reset to 0 first).
          const resetHash = await writeWithBaseFeeRetry({
            address: assetAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddress, 0n],
            chainId: TARGET_CHAIN_ID,
            ...approveGas,
          });
          setApprovalHint('Allowance reset to 0 submitted. After confirmation, press Approve again.');
          setHash(resetHash);
          return;
        }
      }

      // Step 2: deposit into vault
      setStep('depositing');
      const h = await writeWithBaseFeeRetry({
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
      if (isFeeCapTooLowError(msg)) {
        setErrMsg('Wallet/RPC rejected fee params (max fee below base fee). Retry and accept updated fee in wallet.');
      } else {
        setErrMsg(msg.split('\n')[0].slice(0, 120));
      }
    }
  }

  if (!open) return null;
  const marketBlockedForDeposit = vaultUsesOtherWstEthThanWallet;

  const isPending = step === 'approving' || step === 'depositing';
  const assetAddressShort = assetAddress
    ? `${assetAddress.slice(0, 6)}…${assetAddress.slice(-4)}`
    : '';
  const assetDisplaySymbol = vaultUsesOtherWstEthThanWallet && assetAddressShort
    ? `${assetSymbol} (${assetAddressShort})`
    : assetSymbol;
  const assetBalanceLabel = vaultUsesOtherWstEthThanWallet
    ? `${assetSymbol} balance (vault asset)`
    : `${assetSymbol} balance`;
  const buttonLabel = step === 'approving'
    ? 'Approving…'
    : step === 'depositing'
    ? 'Depositing…'
    : marketBlockedForDeposit
    ? 'Disabled: market uses non‑Lido wstETH'
    : needsApproval
    ? `Approve ${assetDisplaySymbol}`
    : `Deposit ${assetDisplaySymbol} → Get ${vaultSymbol} Shares`;

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

            {vaultUsesOtherWstEthThanWallet && assetAddress && (
              <div className="mb-4 p-4 rounded-xl border-2 border-ceitnot-danger/70 bg-ceitnot-danger/10">
                <p className="text-sm font-semibold text-ceitnot-danger mb-2 flex items-center gap-2">
                  <AlertCircle size={18} />
                  Это не тот wstETH, что в вашем кошельке
                </p>
                <p className="text-xs text-ceitnot-muted leading-relaxed mb-3">
                  Рынок <span className="font-mono">#{marketId}</span> принимает underlying{' '}
                  <span className="font-mono break-all text-ceitnot-ink">{assetAddress}</span>.
                  Bridged&nbsp;Lido WSTETH в Rabby живёт по другому контракту:{' '}
                  <span className="font-mono text-[10px] break-all text-ceitnot-ink">{WSTETH_LIDO_ARB}</span>.
                  Баланс в форме — только по активу этого vault; большие суммы здесь почти всегда тестовый mint другого контракта с тем же тикером «wstETH».
                </p>
                <div className="text-xs p-3 rounded-lg bg-ceitnot-surface border border-ceitnot-border">
                  <p className="text-ceitnot-muted">Ваш баланс Lido WSTETH на Arbitrum (тот же токен, что в Rabby)</p>
                  <p className="font-mono text-sm font-semibold text-ceitnot-ink mt-1">
                    {formatUnits(lidoWalletBalance, lidoDecimals)} WSTETH
                  </p>
                </div>
                <p className="text-[11px] text-ceitnot-muted mt-3 leading-relaxed">
                  Чтобы использовать эту wstETH в Ceitnot, в протоколе должен быть зарегистрирован рынок, чей vault считает underlying именно контракт Lido{' '}
                  <span className="font-mono text-[10px] break-all">{WSTETH_LIDO_ARB}</span> (отдельный деплой / governance).
                </p>
              </div>
            )}

            {/* Explanation */}
            <div className="mb-5 p-3 bg-ceitnot-gold/5 border border-ceitnot-gold/10 rounded-xl">
              <p className="text-xs text-ceitnot-muted">
                To deposit collateral, you first need <strong className="text-ceitnot-ink">vault shares</strong>.
                Enter the amount of <strong className="text-ceitnot-ink">{assetDisplaySymbol}</strong> to convert into
                {' '}<strong className="text-ceitnot-ink">{vaultSymbol}</strong> shares.
              </p>
              <p className="text-[11px] text-ceitnot-muted/90 mt-2 pt-2 border-t border-ceitnot-gold/15 leading-relaxed">
                The <span className="font-mono text-ceitnot-ink">{vaultSymbol}</span> ticker is whatever this market’s ERC-4626
                vault returns from <span className="font-mono text-[10px]">ERC20.symbol()</span> on-chain — the UI reads it live; it is
                not CoinGecko “branding”.
              </p>
            </div>

            {/* Approve indicator */}
            {needsApproval && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-ceitnot-warning/10 border border-ceitnot-warning/20 rounded-xl">
                <ArrowRight size={14} className="text-ceitnot-warning shrink-0" />
                <p className="text-xs text-ceitnot-warning">
                  Step 1: Approve {assetDisplaySymbol} for the vault. Step 2: Deposit.
                </p>
              </div>
            )}
            {approvalHint && (
              <p className="text-xs text-ceitnot-warning mb-4">
                {approvalHint}
              </p>
            )}

            {/* Amount */}
            <div className="mb-4">
              <label className="block text-sm text-ceitnot-muted mb-2">
                Amount of {assetDisplaySymbol}
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
                <p className="text-ceitnot-muted">{assetBalanceLabel}</p>
                <p className="text-ceitnot-ink font-mono mt-1">{formatUnits(assetBalance, assetDecimals)}</p>
              </div>
              <div className="p-3 bg-ceitnot-surface-2/80 rounded-xl">
                <p className="text-ceitnot-muted">{vaultSymbol} shares</p>
                <p className="text-ceitnot-ink font-mono mt-1">{formatUnits(shareBalance, vaultDecimals)}</p>
              </div>
            </div>

            {/* MockERC20: mint test tokens (allowed on mock deploys) */}
            {showMockMint && assetAddress && address && (
              <div className="mb-5 p-3 bg-ceitnot-gold/10 border border-ceitnot-gold/20 rounded-xl">
                <p className="text-xs text-ceitnot-muted mb-2">
                  This market uses a test {assetSymbol} (mock). Click below to mint test tokens
                  to your wallet (the MockERC20 contract allows any address to mint).
                </p>
                <button
                  type="button"
                  disabled={isPending || !!mintTxHash}
                  onClick={async () => {
                    if (!address || !assetAddress) return;
                    try {
                      if (chainId !== TARGET_CHAIN_ID) return;
                      const h = await writeWithBaseFeeRetry({
                        address: assetAddress,
                        abi: erc20Abi,
                        functionName: 'mint',
                        args: [address, parseUnits('100', assetDecimals)],
                        chainId: TARGET_CHAIN_ID,
                        ...gasFor(chainId),
                      });
                      setMintTxHash(h);
                      setMintError('');
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      if (isFeeCapTooLowError(msg)) {
                        setMintError('RPC rejected tx fee params (max fee below base fee). Retry and accept updated fee in wallet.');
                      } else {
                        setMintError(msg);
                      }
                    }
                  }}
                  className="w-full py-2 rounded-xl text-sm font-medium bg-ceitnot-gold/20 text-ceitnot-gold hover:bg-ceitnot-gold/30 transition-colors flex items-center justify-center gap-2"
                >
                  {(mintTxHash && !mintConfirmed) && <Loader2 size={14} className="animate-spin" />}
                  {mintTxHash && !mintConfirmed ? 'Waiting for confirmation…' : `Get 100 ${assetSymbol}`}
                </button>
                {mintError && <p className="text-xs text-ceitnot-danger mt-2">{mintError}</p>}
              </div>
            )}

            {/* Submit */}
            {marketBlockedForDeposit && (
              <p className="text-xs text-ceitnot-danger mb-2 text-center">
                Депозит отключён: этот market не совместим с вашим Lido WSTETH в кошельке.
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={
                isPending
                || chainMismatch
                || marketBlockedForDeposit
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
                Amount exceeds your {assetDisplaySymbol} balance.
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

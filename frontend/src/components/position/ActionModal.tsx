import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts, useReadContract, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, type Hash, type Address } from 'viem';
import { X, ArrowRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { ceitnotEngineAbi, erc20Abi, erc4626Abi } from '../../abi/ceitnotEngine';
import { useContractAddresses, gasFor, TARGET_CHAIN_ID } from '../../lib/contracts';
import { useMarkets } from '../../hooks/useMarkets';
import { erc20Decimals, formatToken } from '../../lib/utils';
import OracleRelayRefreshRow from './OracleRelayRefreshRow';
import { oracleRelayPrimaryAbi } from '../../abi/testnetOracle';
import { formatWriteContractError, hintForEngineError } from '../../lib/formatWriteError';

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
  /** Human-readable reason when deposit/borrow is blocked by isolation constraints */
  isolationBlockedReason?: string;
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
function expandScientificToDecimal(raw: string): string {
  const trimmed = raw.trim();
  if (!/[eE]/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) return trimmed;
  const sign = m[1] ?? '';
  const intPart = m[2] ?? '0';
  const fracPart = m[3] ?? '';
  const exp = Number.parseInt(m[4] ?? '0', 10);
  if (!Number.isFinite(exp)) return trimmed;
  const digits = `${intPart}${fracPart}`;
  const point = intPart.length + exp;
  let decimal: string;
  if (point <= 0) {
    decimal = `0.${'0'.repeat(Math.abs(point))}${digits}`;
  } else if (point >= digits.length) {
    decimal = `${digits}${'0'.repeat(point - digits.length)}`;
  } else {
    decimal = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const normalized = decimal
    .replace(/^0+(?=\d)/, '')
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');
  return `${sign}${normalized || '0'}`;
}

function normalizeAmountInput(raw: string): string {
  const commaNormalized = raw.replace(',', '.').trim();
  return expandScientificToDecimal(commaNormalized);
}

export default function ActionModal({
  open, onClose, onSuccess, action, marketId,
  vaultAddress, debtTokenAddress, sharesBalance, debtBalance, isolationBlockedReason,
}: Props) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { engine } = useContractAddresses();
  const { markets } = useMarkets();
  const market = markets.find(m => m.id === marketId);
  const marketOracle = market?.config.oracle;
  /** Env `VITE_*` addresses are only valid on this chain — always read balances/allowance here (not the wallet’s current chain). */
  const readChainId = TARGET_CHAIN_ID;
  const chainMismatch = isConnected && chainId != null && chainId !== TARGET_CHAIN_ID;
  const [amount, setAmount] = useState('');
  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<'input' | 'approving' | 'writing' | 'withdrawn' | 'redeeming' | 'success' | 'error'>('input');
  const [errMsg, setErrMsg] = useState('');
  const [withdrawValidationError, setWithdrawValidationError] = useState('');
  const [isValidatingWithdraw, setIsValidatingWithdraw] = useState(false);
  const [withdrawErrorSticky, setWithdrawErrorSticky] = useState(false);
  const [borrowValidationError, setBorrowValidationError] = useState('');
  const [isValidatingBorrow, setIsValidatingBorrow] = useState(false);
  const [repayValidationError, setRepayValidationError] = useState('');
  const [isValidatingRepay, setIsValidatingRepay] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  // Vault share decimals follow the ERC-4626 vault (OZ: same as underlying, e.g. USDC → 6). Debt uses debt token decimals (ceitUSD → 18).
  const { data: vaultDecimalsRead } = useReadContracts({
    contracts: vaultAddress
      ? [{ address: vaultAddress, abi: erc20Abi, functionName: 'decimals' as const, chainId: readChainId }]
      : [],
    query: { enabled: !!vaultAddress },
  });
  const { data: debtDecimalsRead } = useReadContracts({
    contracts: debtTokenAddress
      ? [{ address: debtTokenAddress, abi: erc20Abi, functionName: 'decimals' as const, chainId: readChainId }]
      : [],
    query: { enabled: !!debtTokenAddress },
  });
  const { data: debtSymbolRead } = useReadContracts({
    contracts: debtTokenAddress
      ? [{ address: debtTokenAddress, abi: erc20Abi, functionName: 'symbol' as const, chainId: readChainId }]
      : [],
    query: { enabled: !!debtTokenAddress },
  });
  const shareDecimalsFromModalRead =
    vaultDecimalsRead?.[0]?.status === 'success'
      ? erc20Decimals(vaultDecimalsRead?.[0]?.result as number | bigint | undefined)
      : undefined;
  const debtDecimalsFromRead =
    debtDecimalsRead?.[0]?.status === 'success'
      ? erc20Decimals(debtDecimalsRead?.[0]?.result as number | bigint | undefined)
      : undefined;
  const shareDecimalsFallback = market?.vaultDecimals ?? shareDecimalsFromModalRead ?? 18;
  const debtDecimals  = debtDecimalsFromRead ?? 18;
  const debtSymbol = (debtSymbolRead?.[0]?.result as string | undefined) ?? 'Debt Token';

  // Read wallet balances: vault shares (for deposit) and debt token (for repay/borrow info)
  const { data: walletData } = useReadContracts({
    contracts: address ? [
      ...(vaultAddress ? [{ address: vaultAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: readChainId }] : []),
      ...(debtTokenAddress ? [{ address: debtTokenAddress, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: readChainId }] : []),
    ] : [],
    query: { enabled: !!address && (!!vaultAddress || !!debtTokenAddress) },
  });
  const walletShares    = vaultAddress     ? ((walletData?.[0]?.result as bigint | undefined) ?? 0n) : 0n;
  const walletDebtToken = debtTokenAddress ? ((walletData?.[vaultAddress ? 1 : 0]?.result as bigint | undefined) ?? 0n) : 0n;

  // Optional: for withdraw, show underlying asset symbol (assets received after redeem).
  const { data: vaultSymbolData } = useReadContracts({
    contracts: vaultAddress ? [{ address: vaultAddress, abi: erc20Abi, functionName: 'symbol' as const, chainId: readChainId }] : [],
    query: { enabled: !!vaultAddress },
  });
  const vaultSymbol =
    (vaultSymbolData?.[0]?.status === 'success'
      ? (vaultSymbolData?.[0]?.result as string | undefined)
      : undefined)
    ?? market?.vaultSymbol
    ?? 'SHARES';

  const { data: vaultAssetData } = useReadContracts({
    contracts: vaultAddress ? [{ address: vaultAddress, abi: erc4626Abi, functionName: 'asset' as const, chainId: readChainId }] : [],
    query: { enabled: !!vaultAddress },
  });
  const assetAddress = (vaultAssetData?.[0]?.status === 'success' ? (vaultAssetData?.[0]?.result as Address | undefined) : undefined) ?? undefined;
  const { data: assetDecimalsForVaultRead } = useReadContracts({
    contracts: assetAddress ? [{ address: assetAddress, abi: erc20Abi, functionName: 'decimals' as const, chainId: readChainId }] : [],
    query: { enabled: !!assetAddress },
  });
  const assetDecimalsForVault =
    assetDecimalsForVaultRead?.[0]?.status === 'success'
      ? erc20Decimals(assetDecimalsForVaultRead?.[0]?.result as number | bigint | undefined)
      : undefined;
  const { data: convertOneAssetToSharesRead } = useReadContracts({
    contracts: vaultAddress ? [{ address: vaultAddress, abi: erc4626Abi, functionName: 'convertToShares' as const, args: [1n] as const, chainId: readChainId }] : [],
    query: { enabled: !!vaultAddress },
  });
  const convertOneAssetToShares =
    convertOneAssetToSharesRead?.[0]?.status === 'success'
      ? (convertOneAssetToSharesRead?.[0]?.result as bigint | undefined)
      : undefined;
  const usesLegacyShareScale =
    shareDecimalsFromModalRead !== undefined
    && assetDecimalsForVault !== undefined
    && shareDecimalsFromModalRead > assetDecimalsForVault
    && convertOneAssetToShares === 1n;
  const shareDecimals = usesLegacyShareScale ? assetDecimalsForVault : shareDecimalsFallback;
  const amountDecimals =
    action === 'deposit' || action === 'withdraw' ? shareDecimals : debtDecimals;
  const normalizedAmount = normalizeAmountInput(amount);
  const amountRaw = (() => {
    try { return normalizedAmount ? parseUnits(normalizedAmount, amountDecimals) : 0n; } catch { return 0n; }
  })();

  const { data: assetSymbolData } = useReadContracts({
    contracts: assetAddress && action === 'withdraw' ? [{ address: assetAddress, abi: erc20Abi, functionName: 'symbol' as const, chainId: readChainId }] : [],
    query: { enabled: !!assetAddress && action === 'withdraw' },
  });
  const assetSymbol = (assetSymbolData?.[0]?.result as string | undefined) ?? 'ASSET';

  /** Stale OracleRelay (mock Chainlink older than 24h) reverts engine views and withdrawals; wallets often show "no ETH for gas" on failed estimate. */
  const oracleProbeEnabled =
    !!marketOracle
    && TARGET_CHAIN_ID === 421614
    && (action === 'borrow' || action === 'withdraw');
  const { isError: oraclePriceFailed, refetch: refetchOraclePrice } = useReadContract({
    address: (marketOracle ?? '0x0000000000000000000000000000000000000000') as Address,
    abi: oracleRelayPrimaryAbi,
    functionName: 'getLatestPrice',
    chainId: readChainId,
    query: { enabled: oracleProbeEnabled },
  });

  // Read collateral value for borrow max calculation
  const { data: posValueData, refetch: refetchCollateralValue } = useReadContracts({
    contracts: engine && address ? [
      { address: engine, abi: ceitnotEngineAbi, functionName: 'getPositionCollateralValue' as const, args: [address, BigInt(marketId)] as const, chainId: readChainId },
    ] : [],
    query: { enabled: !!engine && !!address && action === 'borrow' },
  });
  const posValueRead = posValueData?.[0];
  const collateralValue =
    posValueRead?.status === 'success' ? (posValueRead.result as bigint) : 0n;
  const collateralPriceReadFailed = posValueRead?.status === 'failure';
  const marketLtvBps = market?.config.ltvBps ?? 0n;
  const maxDebtAtLtv = marketLtvBps > 0n
    ? (collateralValue * marketLtvBps) / 10000n
    : 0n;
  const borrowMaxRaw = maxDebtAtLtv > (debtBalance ?? 0n)
    ? maxDebtAtLtv - (debtBalance ?? 0n)
    : 0n;
  const minMeaningfulBorrowRaw = debtDecimals > 6 ? 10n ** BigInt(debtDecimals - 6) : 1n;
  const borrowValueLooksScaledWrong =
    action === 'borrow'
    && collateralValue > 0n
    && borrowMaxRaw > 0n
    && borrowMaxRaw < minMeaningfulBorrowRaw
    && shareDecimals < debtDecimals;
  const borrowDisplayDp = borrowValueLooksScaledWrong ? Math.min(18, debtDecimals) : 6;

  // Check allowance for deposit (vault → engine) or repay (debtToken → engine)
  const approvalToken = action === 'deposit' ? vaultAddress : action === 'repay' ? debtTokenAddress : undefined;
  const { data: allowanceData, refetch: refetchAllowance } = useReadContracts({
    contracts: approvalToken && address && engine ? [{
      address: approvalToken,
      abi: erc20Abi,
      functionName: 'allowance' as const,
      args: [address, engine] as const,
      chainId: readChainId,
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
        if (action === 'withdraw') {
          // After withdrawing shares from the protocol, offer ERC-4626 redeem (shares -> underlying).
          setStep('withdrawn');
        } else {
          setStep('success');
          onSuccess();
        }
      } else if (step === 'redeeming') {
        setStep('success');
        onSuccess();
      }
    }
  }, [confirmed, hash, step, refetchAllowance, onSuccess]);

  const formatEngineErrorWithHint = (e: unknown) => {
    const line = formatWriteContractError(e, ceitnotEngineAbi);
    const hint = hintForEngineError(line);
    return hint ? `${line}\n\n${hint}` : line;
  };
  const formatEngineHint = (e: unknown) => {
    const line = formatWriteContractError(e, ceitnotEngineAbi);
    return hintForEngineError(line) ?? line;
  };
  const isFeeCapTooLowError = (message: string) => {
    const msg = message.toLowerCase();
    return (
      msg.includes('max fee per gas less than block base fee')
      || msg.includes('fee cap less than block base fee')
      || (msg.includes('max fee per gas') && msg.includes('base fee'))
      || (msg.includes('maxfeepergas') && msg.includes('basefee'))
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
      const feeRetry = await feeOverridesForBaseFeeRetry(4n);
      if (!feeRetry) throw writeError;
      return await writeContractAsync({ ...request, ...feeRetry } as Parameters<typeof writeContractAsync>[0]);
    }
  };

  const reset = () => {
    setAmount('');
    setHash(undefined);
    setStep('input');
    setErrMsg('');
    setWithdrawValidationError('');
    setIsValidatingWithdraw(false);
    setWithdrawErrorSticky(false);
    setBorrowValidationError('');
    setIsValidatingBorrow(false);
    setRepayValidationError('');
    setIsValidatingRepay(false);
  };
  const close = () => { reset(); onClose(); };
  useEffect(() => {
    if (action !== 'withdraw') {
      setWithdrawValidationError('');
      setIsValidatingWithdraw(false);
      setWithdrawErrorSticky(false);
      return;
    }
    if (amountRaw <= 0n) {
      if (!withdrawErrorSticky) setWithdrawValidationError('');
      setIsValidatingWithdraw(false);
      return;
    }
    if (!open || !address || !engine || !publicClient || chainMismatch) {
      setWithdrawValidationError('');
      setIsValidatingWithdraw(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsValidatingWithdraw(true);
      try {
        await publicClient.estimateContractGas({
          account: address,
          address: engine,
          abi: ceitnotEngineAbi,
          functionName: 'withdrawCollateral',
          args: [address, BigInt(marketId), amountRaw],
        });
        if (!cancelled) setWithdrawValidationError('');
      } catch (e: unknown) {
        if (!cancelled) setWithdrawValidationError(formatEngineHint(e));
      } finally {
        if (!cancelled) setIsValidatingWithdraw(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [action, open, amountRaw, address, engine, publicClient, chainMismatch, marketId, withdrawErrorSticky]);

  useEffect(() => {
    if (action !== 'borrow') {
      setBorrowValidationError('');
      setIsValidatingBorrow(false);
      return;
    }
    if (amountRaw <= 0n) {
      setBorrowValidationError('');
      setIsValidatingBorrow(false);
      return;
    }
    if (!open || !address || !engine || !publicClient || chainMismatch || isolationBlockedReason) {
      setBorrowValidationError('');
      setIsValidatingBorrow(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsValidatingBorrow(true);
      try {
        await publicClient.estimateContractGas({
          account: address,
          address: engine,
          abi: ceitnotEngineAbi,
          functionName: 'borrow',
          args: [address, BigInt(marketId), amountRaw],
        });
        if (!cancelled) setBorrowValidationError('');
      } catch (e: unknown) {
        if (!cancelled) setBorrowValidationError(formatEngineHint(e));
      } finally {
        if (!cancelled) setIsValidatingBorrow(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [action, open, amountRaw, address, engine, publicClient, chainMismatch, marketId, isolationBlockedReason]);

  useEffect(() => {
    if (action !== 'repay') {
      setRepayValidationError('');
      setIsValidatingRepay(false);
      return;
    }
    if (amountRaw <= 0n) {
      setRepayValidationError('');
      setIsValidatingRepay(false);
      return;
    }
    // Repay is a two-step flow: when allowance is insufficient, user must approve first.
    // In this state, repay gas simulation is expected to fail and must not block the Approve button.
    if (needsApproval) {
      setRepayValidationError('');
      setIsValidatingRepay(false);
      return;
    }
    if (!open || !address || !engine || !publicClient || chainMismatch) {
      setRepayValidationError('');
      setIsValidatingRepay(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsValidatingRepay(true);
      try {
        await publicClient.estimateContractGas({
          account: address,
          address: engine,
          abi: ceitnotEngineAbi,
          functionName: 'repay',
          args: [address, BigInt(marketId), amountRaw],
        });
        if (!cancelled) setRepayValidationError('');
      } catch (e: unknown) {
        if (!cancelled) setRepayValidationError(formatEngineHint(e));
      } finally {
        if (!cancelled) setIsValidatingRepay(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [action, open, amountRaw, needsApproval, address, engine, publicClient, chainMismatch, marketId]);

  const setMax = async () => {
    if (action === 'deposit'  && walletShares > 0n) setAmount(formatUnits(walletShares, shareDecimals));
    if (action === 'withdraw' && sharesBalance !== undefined) {
      setWithdrawErrorSticky(false);
      const maxWithdraw = sharesBalance;
      if (maxWithdraw <= 0n) {
        setAmount('0');
        setWithdrawValidationError('');
        return;
      }
      if (!address || !engine || !publicClient || chainMismatch) {
        setAmount(formatUnits(maxWithdraw, shareDecimals));
        return;
      }

      const canWithdraw = async (shares: bigint): Promise<boolean> => {
        try {
          await publicClient.estimateContractGas({
            account: address,
            address: engine,
            abi: ceitnotEngineAbi,
            functionName: 'withdrawCollateral',
            args: [address, BigInt(marketId), shares],
          });
          return true;
        } catch (e: unknown) {
          const line = formatWriteContractError(e, ceitnotEngineAbi).toLowerCase();
          const looksLikeContractRevert =
            line.includes('revert')
            || line.includes('execution reverted')
            || line.includes('0x9e0636a3')
            || line.includes('healthfactorbelowone');
          if (looksLikeContractRevert) return false;
          throw e;
        }
      };

      setIsValidatingWithdraw(true);
      setWithdrawValidationError('');
      try {
        if (await canWithdraw(maxWithdraw)) {
          setAmount(formatUnits(maxWithdraw, shareDecimals));
          return;
        }

        let lo = 0n;
        let hi = maxWithdraw;
        let i = 0;
        while (lo < hi && i < 22) {
          const mid = lo + ((hi - lo + 1n) / 2n);
          if (await canWithdraw(mid)) lo = mid;
          else hi = mid - 1n;
          i += 1;
        }

        setAmount(formatUnits(lo, shareDecimals));
        if (lo === 0n) {
          setWithdrawErrorSticky(true);
          setWithdrawValidationError(
            'После такого withdraw health factor будет ниже 1.0. Сначала погасите часть долга или выводите меньше collateral.',
          );
        }
      } catch (e: unknown) {
        setWithdrawValidationError(formatEngineHint(e));
      } finally {
        setIsValidatingWithdraw(false);
      }
    }
    if (action === 'repay') {
      const maxRepay = ((debtBalance ?? 0n) < walletDebtToken ? (debtBalance ?? 0n) : walletDebtToken);
      setAmount(formatUnits(maxRepay, debtDecimals));
    }
    if (action === 'borrow'   && collateralValue > 0n) {
      if (borrowValueLooksScaledWrong) {
        setAmount('');
        return;
      }
      if (borrowMaxRaw > 0n) setAmount(formatUnits(borrowMaxRaw, debtDecimals));
    }
  };

  async function submit() {
    if (!address || !engine) return;
    if (chainId !== TARGET_CHAIN_ID) {
      setStep('error');
      setErrMsg(
        chainId == null
          ? 'Подключите кошелёк.'
          : `Неверная сеть: сейчас ${chainId}, нужна ${TARGET_CHAIN_ID} (как в настройках приложения).`,
      );
      return;
    }
    if ((action === 'deposit' || action === 'borrow') && isolationBlockedReason) {
      setStep('error');
      setErrMsg(isolationBlockedReason);
      return;
    }
    if (action === 'repay' && amountRaw > walletDebtToken) {
      setStep('error');
      setErrMsg('Not enough ceitUSD in wallet.');
      return;
    }
    const gas = gasFor(chainId);
    try {
      if (needsApproval && approvalToken) {
        setStep('approving');
        const h = await writeWithBaseFeeRetry({
          address: approvalToken,
          abi: erc20Abi,
          functionName: 'approve',
          args: [engine, 2n ** 256n - 1n],
          chainId: TARGET_CHAIN_ID,
          ...gas,
        });
        setHash(h);
        return;
      }
      let gasLimit: bigint | undefined;
      const actionFunctionName =
        action === 'deposit'
          ? 'depositCollateral'
          : action === 'withdraw'
          ? 'withdrawCollateral'
          : action === 'borrow'
          ? 'borrow'
          : 'repay';

      if (publicClient) {
        try {
          const estimated = await publicClient.estimateContractGas({
            account: address,
            address: engine,
            abi: ceitnotEngineAbi,
            functionName: actionFunctionName,
            args: [address, BigInt(marketId), amountRaw],
          });
          gasLimit = (estimated * 12n) / 10n + 10_000n;
        } catch (e: unknown) {
          setStep('error');
          setErrMsg(formatEngineErrorWithHint(e));
          return;
        }
      }

      setStep('writing');
      const writeBase = { chainId: TARGET_CHAIN_ID, ...gas, ...(gasLimit ? { gas: gasLimit } : {}) } as const;
      const h = await writeWithBaseFeeRetry({
        address: engine,
        abi: ceitnotEngineAbi,
        functionName: actionFunctionName,
        args: [address, BigInt(marketId), amountRaw],
        ...writeBase,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      const msg = e instanceof Error ? e.message : String(e);
      if (isFeeCapTooLowError(msg)) {
        setErrMsg('RPC отклонил tx: max fee ниже base fee. Повторите попытку и подтвердите обновлённую комиссию в кошельке.');
      } else {
        setErrMsg(formatEngineErrorWithHint(e));
      }
    }
  }

  async function redeemUnderlying() {
    if (!address || !vaultAddress) return;
    if (chainId !== TARGET_CHAIN_ID) return;
    const gas = gasFor(chainId);
    try {
      setStep('redeeming');
      const h = await writeWithBaseFeeRetry({
        address: vaultAddress,
        abi: erc4626Abi,
        functionName: 'redeem',
        // shares -> receiver in underlying; owner=msg.sender (no approve needed)
        args: [amountRaw, address, address],
        chainId: TARGET_CHAIN_ID,
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      const line = formatWriteContractError(e, ceitnotEngineAbi);
      const hint = hintForEngineError(line);
      setErrMsg(hint ? `${line}\n\n${hint}` : line);
    }
  }

  if (!open) return null;

  const depositExceedsWallet =
    action === 'deposit' && amountRaw > 0n && amountRaw > walletShares;
  const withdrawExceedsDeposited =
    action === 'withdraw' && sharesBalance !== undefined && amountRaw > sharesBalance;
  const borrowExceedsMax =
    action === 'borrow' && amountRaw > 0n && amountRaw > borrowMaxRaw;
  const repayExceedsDebt =
    action === 'repay' && debtBalance !== undefined && amountRaw > debtBalance;
  const repayExceedsWallet =
    action === 'repay' && amountRaw > 0n && amountRaw > walletDebtToken;

  const isPending  = step === 'approving' || step === 'writing' || step === 'redeeming';
  const buttonLabel = step === 'approving'
    ? 'Approving…'
    : step === 'writing'
    ? 'Confirming…'
    : step === 'redeeming'
    ? 'Redeeming…'
    : needsApproval
    ? `Approve ${action === 'deposit' ? vaultSymbol : debtSymbol}`
    : ACTION_LABEL[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md card bg-ceitnot-surface border border-ceitnot-border-2 shadow-2xl p-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">
            {ACTION_LABEL[action]}
            <span className="ml-2 text-sm text-ceitnot-muted font-normal">Market #{marketId}</span>
          </h2>
          <button onClick={close} className="btn-ghost p-1.5 rounded-lg" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Success state */}
        {step === 'success' && (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-ceitnot-success mx-auto mb-3" />
            <p className="font-semibold text-lg">Transaction confirmed!</p>
            <p className="text-ceitnot-muted text-sm mt-1">Your position has been updated.</p>
            <button className="btn-primary mt-6 w-full" onClick={close}>Close</button>
          </div>
        )}

        {/* Error state */}
        {step === 'error' && (
          <div className="text-center py-4">
            <AlertCircle size={40} className="text-ceitnot-danger mx-auto mb-3" />
            <p className="font-semibold text-ceitnot-danger">Transaction failed</p>
            <p className="text-ceitnot-muted text-xs mt-2 break-words whitespace-pre-wrap text-left max-h-48 overflow-y-auto">{errMsg}</p>
            <button className="btn-secondary mt-5 w-full" onClick={() => { setStep('input'); setErrMsg(''); }}>Try again</button>
          </div>
        )}

        {/* Withdraw confirmed -> redeem shares to underlying */}
        {step === 'withdrawn' && (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-ceitnot-success mx-auto mb-3" />
            <p className="font-semibold text-lg">Withdraw confirmed!</p>
            <p className="text-ceitnot-muted text-sm mt-1">
              Now you have <span className="font-mono">{amount ? amount : '0'}</span> {vaultSymbol} shares.
              Redeem them to get <span className="font-mono">{assetSymbol}</span>.
            </p>
            <button
              className="btn-primary mt-6 w-full"
              onClick={redeemUnderlying}
              disabled={!amountRaw || amountRaw <= 0n || isPending}
            >
              Redeem {vaultSymbol} → {assetSymbol}
            </button>
            <button className="btn-secondary mt-3 w-full" onClick={close} disabled={isPending}>
              Close
            </button>
          </div>
        )}

        {/* Input state */}
        {step !== 'success' && step !== 'error' && step !== 'withdrawn' && (
          <>
            {/* Approve step indicator */}
            {needsApproval && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-ceitnot-warning/10 border border-ceitnot-warning/20 rounded-xl">
                <ArrowRight size={14} className="text-ceitnot-warning shrink-0" />
                <p className="text-xs text-ceitnot-warning">
                  Two steps: first approve the token, then confirm the action.
                </p>
              </div>
            )}

            {/* Amount input */}
            <div className="mb-5">
              <label className="block text-sm text-ceitnot-muted mb-2">
                Amount{' '}
                <span className="text-ceitnot-muted-2">
                  {action === 'deposit' || action === 'withdraw'
                    ? `(vault shares, ${shareDecimals} decimals)`
                    : `(${debtSymbol}, ${debtDecimals} decimals)`}
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={e => {
                    setAmount(e.target.value);
                    if (action === 'withdraw') setWithdrawErrorSticky(false);
                  }}
                  placeholder="0.0"
                  className="input-field flex-1"
                  disabled={isPending}
                />
                <button
                  type="button"
                  onClick={() => { void setMax(); }}
                  className="px-3 py-2 rounded-xl text-sm font-medium bg-ceitnot-gold/15 text-ceitnot-gold hover:bg-ceitnot-gold/25 transition-colors"
                  disabled={isPending || (action === 'withdraw' && isValidatingWithdraw)}
                >
                  Max
                </button>
              </div>

              {/* Balance hints */}
              {chainMismatch && (
                <p className="text-xs text-ceitnot-danger mt-2">
                  Сеть кошелька ({chainId}) не совпадает с сетью приложения ({TARGET_CHAIN_ID}). Переключите сеть — иначе баланс shares и транзакция расходятся.
                </p>
              )}
            {action === 'deposit' && (
                <p className="text-xs text-ceitnot-muted mt-1">
                  Wallet shares: <span className="text-ceitnot-ink font-mono">{formatUnits(walletShares, shareDecimals)}</span>
                  {depositExceedsWallet && (
                    <span className="block text-ceitnot-danger mt-1">
                      Not enough vault shares — use “Get vault shares” first (mint wstETH → deposit into vault).
                    </span>
                  )}
                </p>
              )}
              {(action === 'deposit' || action === 'borrow') && isolationBlockedReason && (
                <p className="text-xs text-ceitnot-warning mt-1 whitespace-pre-wrap">
                  {isolationBlockedReason}
                </p>
              )}
              {action === 'withdraw' && sharesBalance !== undefined && (
                <p className="text-xs text-ceitnot-muted mt-1">
                  Deposited shares: <span className="text-ceitnot-ink font-mono">{formatUnits(sharesBalance, shareDecimals)}</span>
                </p>
              )}
              {action === 'withdraw' && amountRaw > 0n && isValidatingWithdraw && (
                <p className="text-xs text-ceitnot-muted mt-1">
                  Проверяем, пройдёт ли withdraw при текущем health factor…
                </p>
              )}
              {action === 'withdraw' && (amountRaw > 0n || withdrawErrorSticky) && withdrawValidationError && (
                <p className="text-xs text-ceitnot-danger mt-1 whitespace-pre-wrap">
                  {withdrawValidationError}
                </p>
              )}
              {action === 'borrow' && (
                <p className="text-xs text-ceitnot-muted mt-1">
                  Collateral value:{' '}
                  <span className="text-ceitnot-ink font-mono">
                    {formatToken(collateralValue, debtDecimals, borrowDisplayDp, 'en-US')}
                  </span>
                  {' · '}Max borrow ({(Number(marketLtvBps) / 100).toFixed(2)}% LTV):{' '}
                  <span className="text-ceitnot-ink font-mono">
                    {formatToken(borrowMaxRaw, debtDecimals, borrowDisplayDp, 'en-US')}
                  </span>
                  {!!debtBalance && debtBalance > 0n && (
                    <>
                      {' · '}Current debt:{' '}
                      <span className="text-ceitnot-warning font-mono">
                        {formatToken(debtBalance, debtDecimals, 6, 'en-US')}
                      </span>
                    </>
                  )}
                </p>
              )}
              {action === 'borrow' && amountRaw > 0n && isValidatingBorrow && (
                <p className="text-xs text-ceitnot-muted mt-1">
                  Проверяем borrow в симуляции перед отправкой…
                </p>
              )}
              {action === 'borrow' && amountRaw > 0n && borrowValidationError && (
                <p className="text-xs text-ceitnot-danger mt-1 whitespace-pre-wrap">
                  {borrowValidationError}
                </p>
              )}
              {borrowValueLooksScaledWrong && (
                <p className="text-xs text-ceitnot-warning mt-1">
                  Borrow power is effectively dust for this market. Current max: {formatUnits(borrowMaxRaw, debtDecimals)} {debtSymbol}. This usually indicates market collateral value is returned in a lower decimal scale on-chain; engine upgrade is required to unlock normal borrow size.
                </p>
              )}
              {action === 'borrow'
                && TARGET_CHAIN_ID === 421614
                && marketOracle
                && (sharesBalance ?? 0n) > 0n
                && (collateralValue === 0n || collateralPriceReadFailed || oraclePriceFailed) && (
                  <div className="mt-2 p-3 rounded-xl bg-ceitnot-warning/10 border border-ceitnot-warning/25">
                    <p className="text-xs text-ceitnot-muted mb-2">
                      Collateral shares are deposited but the price read failed or returned zero — usual on Sepolia when the mock Chainlink feed is older than 24h.
                    </p>
                    <p className="text-xs text-ceitnot-muted mb-2">
                      If the wallet says there is no ETH for gas, top up Arbitrum Sepolia ETH — or the tx simulation may be reverting for the same oracle reason.
                    </p>
                    <OracleRelayRefreshRow
                      oracleAddress={marketOracle}
                      onRefreshed={() => {
                        void refetchCollateralValue();
                        void refetchOraclePrice();
                      }}
                    />
                  </div>
                )}
              {action === 'withdraw'
                && TARGET_CHAIN_ID === 421614
                && marketOracle
                && (sharesBalance ?? 0n) > 0n
                && oraclePriceFailed && (
                  <div className="mt-2 p-3 rounded-xl bg-ceitnot-warning/10 border border-ceitnot-warning/25">
                    <p className="text-xs text-ceitnot-muted mb-2">
                      Oracle read failed (often stale mock Chainlink). Withdraw runs health checks that need a live price — MetaMask may show “unavailable ETH” when gas estimation hits a revert.
                    </p>
                    <p className="text-xs text-ceitnot-muted mb-2">
                      Refresh the feed below, or ensure you have Arbitrum Sepolia ETH for gas.
                    </p>
                    <OracleRelayRefreshRow
                      oracleAddress={marketOracle}
                      onRefreshed={() => void refetchOraclePrice()}
                    />
                  </div>
                )}
              {borrowExceedsMax && (
                <p className="text-xs text-ceitnot-danger mt-1">
                  Borrow amount exceeds market limit. Reduce amount to at most {formatToken(borrowMaxRaw, debtDecimals, 6, 'en-US')} {debtSymbol}.
                </p>
              )}
              {action === 'repay' && debtBalance !== undefined && debtBalance > 0n && (
                <div className="text-xs text-ceitnot-muted mt-1">
                  <p>
                    Outstanding debt: <span className="text-ceitnot-ink font-mono">{formatUnits(debtBalance, debtDecimals)}</span>
                    {' · '}Wallet {debtSymbol}: <span className="text-ceitnot-ink font-mono">{formatUnits(walletDebtToken, debtDecimals)}</span>
                  </p>
                  {repayExceedsWallet && (
                    <p className="text-ceitnot-danger mt-1">Not enough ceitUSD in wallet.</p>
                  )}
                </div>
              )}
              {action === 'repay' && amountRaw > 0n && !needsApproval && isValidatingRepay && (
                <p className="text-xs text-ceitnot-muted mt-1">
                  Проверяем repay в симуляции перед отправкой…
                </p>
              )}
              {action === 'repay' && amountRaw > 0n && !needsApproval && repayValidationError && (
                <p className="text-xs text-ceitnot-danger mt-1 whitespace-pre-wrap">
                  {repayValidationError}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={submit}
              disabled={
                isPending
                || chainMismatch
                || !amountRaw
                || amountRaw <= 0n
                || depositExceedsWallet
                || withdrawExceedsDeposited
                || (action === 'withdraw' && (isValidatingWithdraw || !!withdrawValidationError))
                || borrowExceedsMax
                || (action === 'borrow' && (isValidatingBorrow || !!borrowValidationError))
                || repayExceedsDebt
                || repayExceedsWallet
                || (action === 'repay' && !needsApproval && (isValidatingRepay || !!repayValidationError))
                || (action === 'borrow' && borrowValueLooksScaledWrong)
                || ((action === 'deposit' || action === 'borrow') && !!isolationBlockedReason)
              }
              className={`w-full ${ACTION_COLOR[action]} flex items-center justify-center gap-2`}
            >
              {isPending && <Loader2 size={16} className="animate-spin" />}
              {buttonLabel}
            </button>

            {/* Tx hash */}
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

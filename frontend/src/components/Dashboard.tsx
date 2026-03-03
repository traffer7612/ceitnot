import { useState, useEffect } from "react";
import { useAccount, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useReadContract } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseEther, formatEther, formatUnits, parseUnits } from "viem";
import { useContractsConfig } from "../hooks/useConfig";
import { auraEngineAbi } from "../abi/auraEngine";

async function fetchWstEthPriceUsd(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=wsteth,ethereum&vs_currencies=usd"
  );
  if (!res.ok) throw new Error("Price fetch failed");
  const data = (await res.json()) as { wsteth?: { usd: number }; ethereum?: { usd: number } };
  return data.wsteth?.usd ?? data.ethereum?.usd ?? 0;
}

const LOCAL_CHAIN_ID = 31337;
const LOCAL_CHAIN_ID_ALT = 1337; // MetaMask sometimes uses 1337 for localhost
const ARBITRUM_ONE = 42161;
const SEPOLIA = 11155111;
// Arbitrum: явный лимит 300k — без него кошелёк иногда показывает $15M комиссию (ошибка расчёта).
const ARBITRUM_GAS_LIMIT = 300_000n;
const SEPOLIA_GAS_LIMIT = 500_000n;

function getGasOverrides(chainId: number) {
  if (chainId === ARBITRUM_ONE) return { gas: ARBITRUM_GAS_LIMIT };
  if (chainId === LOCAL_CHAIN_ID) return { gas: 16_000_000n };
  if (chainId === SEPOLIA) return { gas: SEPOLIA_GAS_LIMIT };
  return {};
}

type Tab = "deposit" | "borrow" | "repay";

type DashboardProps = {
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
};

export function Dashboard({ activeTab, onTabChange }: DashboardProps) {
  const { address, chainId } = useAccount();
  const chain = chainId ?? LOCAL_CHAIN_ID;
  const { data: config } = useContractsConfig();
  const engineAddress = config?.engine as `0x${string}` | undefined;

  const { data: debt, error: debtError } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "getPositionDebt",
    args: address ? [address] : undefined,
    chainId: chain,
  });

  // DEBUG: log to console
  useEffect(() => {
    console.log("[AURA DEBUG]", {
      address,
      chainId,
      chain,
      config,
      engineAddress,
      debt: debt?.toString(),
      debtError: debtError?.message,
    });
  }, [address, chainId, chain, config, engineAddress, debt, debtError]);

  const { data: collateralShares } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "getPositionCollateralShares",
    args: address ? [address] : undefined,
    chainId: chain,
  });

  const { data: healthFactor } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "getHealthFactor",
    args: address ? [address] : undefined,
    chainId: chain,
  });

  const { data: collateralVaultAddress } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "asset",
    chainId: chain,
  });

  const { data: debtTokenAddress } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "debtToken",
    chainId: chain,
  });

  const erc20SymbolAbi = [{ inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" }] as const;
  const erc20DecimalsAbi = [{ inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" }] as const;

  const { data: collateralValue } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "getPositionCollateralValue",
    args: address ? [address] : undefined,
    chainId: chain,
  });

  const { data: ltvBps } = useReadContract({
    address: engineAddress,
    abi: auraEngineAbi,
    functionName: "ltvBps",
    chainId: chain,
  });

  const { data: debtDecimals } = useReadContract({
    address: debtTokenAddress ?? undefined,
    abi: erc20DecimalsAbi,
    functionName: "decimals",
    chainId: chain,
  });

  const decimals = debtDecimals ?? 18;

  const { data: wstEthPriceUsd } = useQuery({
    queryKey: ["wsteth-price-usd"],
    queryFn: fetchWstEthPriceUsd,
    refetchInterval: 60_000,
  });

  const { data: collateralSymbol } = useReadContract({
    address: collateralVaultAddress ?? undefined,
    abi: erc20SymbolAbi,
    functionName: "symbol",
    chainId: chain,
  });

  const { data: debtSymbol } = useReadContract({
    address: debtTokenAddress ?? undefined,
    abi: erc20SymbolAbi,
    functionName: "symbol",
    chainId: chain,
  });

  const erc20BalanceOfAbi = [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
  const { data: engineLiquidity } = useReadContract({
    address: debtTokenAddress ?? undefined,
    abi: erc20BalanceOfAbi,
    functionName: "balanceOf",
    args: engineAddress ? [engineAddress] : undefined,
    chainId: chain,
  });

  const collateralLabel = collateralSymbol ? `Collateral (${collateralSymbol})` : "Collateral (shares)";
  const debtLabel = debtSymbol ? `Debt (${debtSymbol})` : "Debt";

  const tabs: { id: Tab; label: string }[] = [
    { id: "deposit", label: "Deposit" },
    { id: "borrow", label: "Borrow" },
    { id: "repay", label: "Repay" },
  ];

  // Contract returns HF in WAD (1e18 = 1.0); legacy deploy may return raw ratio (e.g. 25)
  const WAD = 10n ** 18n;
  const hf =
    healthFactor == null
      ? null
      : healthFactor >= WAD
        ? Number(formatEther(healthFactor))
        : healthFactor === 2n ** 256n - 1n || healthFactor > 10n ** 50n
          ? Infinity
          : Number(healthFactor);
  const isHealthy = hf === null || hf === Infinity || hf >= 1;
  const hfDisplay = hf != null ? (hf === Infinity || hf > 1e9 ? "∞" : hf.toFixed(2)) : "—";

  const isLocal = chain === LOCAL_CHAIN_ID || chain === LOCAL_CHAIN_ID_ALT;
  const isArbitrum = chain === ARBITRUM_ONE;
  const isSepolia = chain === SEPOLIA;

  const queryClient = useQueryClient();
  const refreshPosition = () => queryClient.invalidateQueries();

  return (
    <section className="max-w-2xl mx-auto px-4 py-12">
      {isLocal && (
        <div className="card mb-4 border-aura-gold/30 bg-aura-gold/5">
          <p className="text-sm text-aura-muted">
            <strong className="text-aura-gold">Localhost (Anvil).</strong> Если Rabby пишет «Моделирование транзакций не поддерживается» — на Localhost лучше использовать <strong>MetaMask</strong> (Rabby не умеет симулировать на кастомном RPC). Если «Nonce пропущен»: в Rabby → меню → <strong>Clear Pending</strong>; или перезапустите Anvil, задеплойте заново.
          </p>
        </div>
      )}
      {isArbitrum && (
        <div className="card mb-4 border-aura-gold/30 bg-aura-gold/5">
          <p className="text-sm text-aura-muted">
            <strong className="text-aura-gold">Arbitrum + MetaMask.</strong> Если вылезает «Транзакция не удастся» или «Дополнительная комиссия» — в окне комиссии вручную поставьте <strong>Плата за приоритет: 0.01</strong> Гвей (или больше), нажмите «Сохранить», затем «Подтвердить». Rabby #1002 — попробуйте ту же операцию в MetaMask.
          </p>
        </div>
      )}
      {isSepolia && (
        <div className="card mb-4 border-aura-gold/30 bg-aura-gold/5">
          <p className="text-sm text-aura-muted">
            <strong className="text-aura-gold">Sepolia Testnet.</strong> Реальный Chainlink ETH/USD оракул. Mock-токены (wstETH, USDC). Для депозита: сначала внесите wstETH в Vault (шаг 1), затем — коллатерал в Engine (шаг 2).
          </p>
        </div>
      )}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold mb-4">Your position</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-aura-muted text-sm">{collateralLabel}</p>
            <p className="font-mono text-aura-gold">
              {config && collateralShares != null
                ? formatEther(collateralShares)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-aura-muted text-sm">{debtLabel}</p>
            <p className="font-mono">
              {config && debt != null ? formatUnits(debt, decimals) : "—"}
            </p>
          </div>
          <div>
            <p className="text-aura-muted text-sm">Health factor</p>
            <p className={`font-mono ${isHealthy ? "text-aura-success" : "text-aura-danger"}`}>
              {hfDisplay}
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex gap-2 border-b border-aura-border pb-4 mb-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-aura-gold/20 text-aura-gold"
                  : "text-aura-muted hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "deposit" && (
          <DepositForm
            engineAddress={engineAddress}
            collateralTokenAddress={collateralVaultAddress}
            userAddress={address}
            collateralSymbol={collateralSymbol}
            chainId={chain}
            onSuccess={refreshPosition}
          />
        )}
        {activeTab === "borrow" && (
          <BorrowForm
            engineAddress={engineAddress}
            userAddress={address}
            collateralShares={collateralShares}
            debt={debt}
            debtDecimals={decimals}
            collateralValue={collateralValue}
            ltvBps={ltvBps}
            debtSymbol={debtSymbol}
            wstEthPriceUsd={wstEthPriceUsd}
            engineLiquidity={engineLiquidity}
            onSuccess={refreshPosition}
          />
        )}
        {activeTab === "repay" && (
          <RepayForm
            engineAddress={engineAddress}
            debtTokenAddress={debtTokenAddress}
            userAddress={address}
            debt={debt}
            debtDecimals={decimals}
            debtSymbol={debtSymbol}
            onSuccess={refreshPosition}
          />
        )}
      </div>

      <div className="card mt-6">
        <FundEngineForm
          engineAddress={engineAddress}
          debtTokenAddress={debtTokenAddress}
          debtSymbol={debtSymbol}
          chainId={chain}
        />
      </div>
    </section>
  );
}

const ERC20_APPROVE_ABI = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

const ERC20_TRANSFER_ABI = [
  { inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], name: "transfer", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
] as const;

const MAX_UINT256 = 2n ** 256n - 1n;

const VAULT_ABI = [
  { inputs: [], name: "asset", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], name: "deposit", outputs: [{ type: "uint256" }], stateMutability: "nonpayable", type: "function" },
] as const;

function DepositForm({
  engineAddress,
  collateralTokenAddress,
  userAddress,
  collateralSymbol,
  chainId,
  onSuccess,
}: {
  engineAddress: `0x${string}` | undefined;
  collateralTokenAddress: `0x${string}` | undefined;
  userAddress: string | undefined;
  collateralSymbol?: string;
  chainId: number;
  onSuccess?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const { chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const targetChainId = walletChainId ?? chainId;
  const { writeContract, isPending, error, data: txHash } = useWriteContract();

  const shares = amount ? parseEther(amount) : 0n;
  const vaultAddress = collateralTokenAddress;

  // Read underlying asset address from vault
  const { data: assetAddress } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "asset",
    chainId: targetChainId,
  });

  // User balances
  const erc20BalAbi = [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
  const { data: assetBalance, refetch: refetchAssetBal } = useReadContract({
    address: assetAddress ?? undefined,
    abi: erc20BalAbi,
    functionName: "balanceOf",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: targetChainId,
  });
  const { data: vaultSharesBalance, refetch: refetchSharesBal } = useReadContract({
    address: vaultAddress,
    abi: erc20BalAbi,
    functionName: "balanceOf",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: targetChainId,
  });

  // Step 1 allowance: asset → vault
  const { data: assetAllowance, refetch: refetchAssetAllow } = useReadContract({
    address: assetAddress ?? undefined,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: userAddress && vaultAddress ? [userAddress as `0x${string}`, vaultAddress] : undefined,
    chainId: targetChainId,
  });

  // Step 2 allowance: vault shares → engine
  const { data: sharesAllowance, refetch: refetchSharesAllow } = useReadContract({
    address: vaultAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: userAddress && engineAddress ? [userAddress as `0x${string}`, engineAddress] : undefined,
    chainId: targetChainId,
  });

  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => {
    if (txSuccess && txHash) {
      refetchAssetAllow();
      refetchSharesAllow();
      refetchAssetBal();
      refetchSharesBal();
      onSuccess?.();
    }
  }, [txSuccess, txHash, refetchAssetAllow, refetchSharesAllow, refetchAssetBal, refetchSharesBal, onSuccess]);

  const gasOverrides = getGasOverrides(targetChainId);

  const ensureChain = async () => {
    if (switchChainAsync && targetChainId !== walletChainId) {
      await switchChainAsync({ chainId: targetChainId });
    }
  };

  // Step 1a: Approve asset → vault
  const approveAssetToVault = async () => {
    if (!assetAddress || !vaultAddress) return;
    try {
      await ensureChain();
      writeContract({
        chainId: targetChainId,
        address: assetAddress,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [vaultAddress, MAX_UINT256],
        ...gasOverrides,
      });
    } catch (e) { console.error(e); }
  };

  // Step 1b: Deposit asset → vault
  const depositToVault = async () => {
    if (!vaultAddress || !userAddress || !amount) return;
    try {
      await ensureChain();
      writeContract({
        chainId: targetChainId,
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "deposit",
        args: [shares, userAddress as `0x${string}`],
        ...gasOverrides,
      });
    } catch (e) { console.error(e); }
  };

  // Step 2a: Approve vault shares → engine
  const approveSharesToEngine = async () => {
    if (!vaultAddress || !engineAddress) return;
    try {
      await ensureChain();
      writeContract({
        chainId: targetChainId,
        address: vaultAddress,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [engineAddress, MAX_UINT256],
        ...gasOverrides,
      });
    } catch (e) { console.error(e); }
  };

  // Step 2b: Deposit collateral → engine
  const depositToEngine = async () => {
    if (!engineAddress || !userAddress) return;
    const depositShares = vaultSharesBalance ?? shares;
    if (depositShares <= 0n) return;
    try {
      await ensureChain();
      writeContract({
        chainId: targetChainId,
        address: engineAddress,
        abi: auraEngineAbi,
        functionName: "depositCollateral",
        args: [userAddress as `0x${string}`, depositShares],
        ...gasOverrides,
      });
    } catch (e) { console.error(e); }
  };

  if (!engineAddress) {
    return (
      <p className="text-aura-muted text-sm">
        Set AURA_ENGINE_ADDRESS in the backend to interact with the contract.
      </p>
    );
  }

  const needsAssetApproval = shares > 0n && (assetAllowance == null || assetAllowance < shares);
  const hasVaultShares = vaultSharesBalance != null && vaultSharesBalance > 0n;
  const needsSharesApproval = hasVaultShares && (sharesAllowance == null || sharesAllowance < vaultSharesBalance!);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm text-aura-muted mb-2">
          {collateralSymbol ? `Сумма (${collateralSymbol})` : "Collateral amount"}
        </label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="input-field"
        />
        {assetBalance != null && (
          <p className="text-aura-muted text-xs mt-1">
            Баланс токена: <strong>{formatEther(assetBalance)}</strong> {collateralSymbol ?? ""}
          </p>
        )}
      </div>

      {/* Step 1: Asset → Vault */}
      <div className="border border-aura-border rounded-lg p-4 space-y-2">
        <h4 className="text-sm font-medium text-aura-muted">Шаг 1: Внести в Vault (получить shares)</h4>
        {needsAssetApproval ? (
          <button type="button" onClick={approveAssetToVault} disabled={isPending || !amount} className="btn-primary w-full">
            {isPending ? "Подтвердите…" : `Разрешить ${collateralSymbol ?? "токен"} для Vault`}
          </button>
        ) : (
          <button type="button" onClick={depositToVault} disabled={isPending || !amount || shares <= 0n} className="btn-primary w-full">
            {isPending ? "Подтвердите…" : `Внести ${amount || "0"} ${collateralSymbol ?? ""} в Vault`}
          </button>
        )}
      </div>

      {/* Step 2: Vault shares → Engine */}
      <div className="border border-aura-border rounded-lg p-4 space-y-2">
        <h4 className="text-sm font-medium text-aura-muted">Шаг 2: Депозит коллатерала в Engine</h4>
        {vaultSharesBalance != null && (
          <p className="text-xs text-aura-muted">
            Vault shares на кошельке: <strong className="text-aura-gold">{formatEther(vaultSharesBalance)}</strong>
          </p>
        )}
        {!hasVaultShares ? (
          <p className="text-xs text-aura-muted">Сначала выполните Шаг 1.</p>
        ) : needsSharesApproval ? (
          <button type="button" onClick={approveSharesToEngine} disabled={isPending} className="btn-primary w-full">
            {isPending ? "Подтвердите…" : "Разрешить Vault shares для Engine"}
          </button>
        ) : (
          <button type="button" onClick={depositToEngine} disabled={isPending || !hasVaultShares} className="btn-primary w-full">
            {isPending ? "Подтвердите…" : `Внести ${formatEther(vaultSharesBalance!)} shares как коллатерал`}
          </button>
        )}
      </div>

      {error && <p className="text-aura-danger text-sm">{error.message}</p>}
    </div>
  );
}

function FundEngineForm({
  engineAddress,
  debtTokenAddress,
  debtSymbol,
  chainId,
}: {
  engineAddress: `0x${string}` | undefined;
  debtTokenAddress: `0x${string}` | undefined;
  debtSymbol?: string;
  chainId: number;
}) {
  const [amount, setAmount] = useState("");
  const { chainId: walletChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const targetChainId = walletChainId ?? chainId;
  const { writeContract, isPending, error } = useWriteContract();

  const erc20DecAbi = [{ inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" }] as const;
  const { data: fundDecimals } = useReadContract({
    address: debtTokenAddress ?? undefined,
    abi: erc20DecAbi,
    functionName: "decimals",
    chainId: targetChainId,
  });
  const decimals = fundDecimals ?? 18;
  const amountRaw = amount ? parseUnits(amount, decimals) : 0n;

  const sendToEngine = async () => {
    if (!debtTokenAddress || !engineAddress || !amount || amountRaw <= 0n) return;
    try {
      if (switchChainAsync && targetChainId !== walletChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }
      writeContract({
        chainId: targetChainId,
        address: debtTokenAddress,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [engineAddress, amountRaw],
        ...getGasOverrides(targetChainId),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const canSend = engineAddress && debtTokenAddress;

  return (
    <div className="rounded-lg border-0 p-0">
      <h3 className="text-sm font-medium text-aura-muted mb-2">Пополнить пул ликвидности</h3>
      <p className="text-xs text-aura-muted mb-3">
        Отправка {debtSymbol ?? "USDC"} на адрес движка — чтобы другие могли занимать. Без PowerShell.
      </p>
      {!canSend ? (
        <p className="text-aura-muted text-sm">Загрузка адресов контрактов… Подключите кошелёк и выберите сеть (Arbitrum).</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs text-aura-muted mb-1">Сумма ({debtSymbol ?? "USDC"})</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="input-field w-full"
              />
            </div>
            <button
              type="button"
              onClick={sendToEngine}
              disabled={isPending || !amount || amountRaw <= 0n}
              className="btn-primary"
            >
              {isPending ? "Подтвердите в кошельке…" : "Отправить в движок"}
            </button>
          </div>
          {error && <p className="text-aura-danger text-sm mt-2">{error.message}</p>}
        </>
      )}
    </div>
  );
}

const LTV_BPS = 8500; // 85% in your deploy

function BorrowForm({
  engineAddress,
  userAddress,
  collateralShares,
  debt,
  debtDecimals,
  collateralValue,
  ltvBps,
  debtSymbol,
  wstEthPriceUsd,
  engineLiquidity,
  onSuccess,
}: {
  engineAddress: `0x${string}` | undefined;
  userAddress: string | undefined;
  collateralShares: bigint | undefined;
  debt: bigint | undefined;
  debtDecimals: number;
  collateralValue: bigint | undefined;
  ltvBps: number | undefined;
  debtSymbol?: string;
  wstEthPriceUsd?: number;
  engineLiquidity?: bigint;
  onSuccess?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, isPending, error, data: txHash } = useWriteContract();

  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => {
    if (txSuccess && txHash) onSuccess?.();
  }, [txSuccess, txHash, onSuccess]);

  const debtRaw = debt ?? 0n;
  const ltv = ltvBps ?? LTV_BPS;
  const hasContractValue = collateralValue != null;
  const maxDebtRaw = hasContractValue
    ? (collateralValue! * BigInt(ltv)) / 10_000n
    : collateralShares != null
      ? (collateralShares * BigInt(ltv)) / 10_000n
      : 0n;
  const sameUnits = hasContractValue || debtDecimals === 18;
  const maxBorrowRaw = sameUnits && maxDebtRaw > debtRaw ? maxDebtRaw - debtRaw : maxDebtRaw;

  const collateralEth = collateralShares != null ? Number(formatEther(collateralShares)) : 0;
  const debtUsd = Number(formatUnits(debtRaw, debtDecimals));
  const priceUsd = wstEthPriceUsd != null && wstEthPriceUsd > 0 ? wstEthPriceUsd : 2500;
  const maxBorrowUsdFromPrice =
    !hasContractValue && collateralEth > 0
      ? Math.max(0, (collateralEth * priceUsd * ltv) / 10_000 - debtUsd)
      : null;

  const maxBorrowDisplay = hasContractValue
    ? maxBorrowRaw > 0n
      ? formatUnits(maxBorrowRaw, debtDecimals)
      : "0"
    : maxBorrowUsdFromPrice != null && maxBorrowUsdFromPrice > 0
      ? maxBorrowUsdFromPrice.toFixed(2)
      : maxBorrowRaw > 0n
        ? formatUnits(maxBorrowRaw, 18)
        : "0";
  const maxBorrowLabel = debtSymbol ?? "";
  const showBorrowHint = collateralShares != null && collateralShares > 0n;

  const targetChainId = chainId ?? LOCAL_CHAIN_ID;
  const borrowDecimals = debtDecimals;
  const submit = async () => {
    if (!engineAddress || !userAddress || !amount) return;
    let amountWei: bigint;
    try {
      amountWei = parseUnits(amount, borrowDecimals);
    } catch {
      return;
    }
    if (engineLiquidity != null && amountWei > engineLiquidity) return;
    try {
      if (switchChainAsync) {
        await switchChainAsync({ chainId: targetChainId });
      }
      writeContract({
        chainId: targetChainId,
        address: engineAddress,
        abi: auraEngineAbi,
        functionName: "borrow",
        args: [userAddress as `0x${string}`, amountWei],
        ...getGasOverrides(targetChainId),
      });
    } catch (e) {
      console.error(e);
    }
  };

  if (!engineAddress) {
    return (
      <p className="text-aura-muted text-sm">
        Set AURA_ENGINE_ADDRESS in the backend to interact with the contract.
      </p>
    );
  }

  const availableInPool = formatUnits(engineLiquidity ?? 0n, debtDecimals);
  let borrowAmountWei = 0n;
  try {
    if (amount) borrowAmountWei = parseUnits(amount, borrowDecimals);
  } catch (_) {}
  const exceedsPool = engineLiquidity != null && borrowAmountWei > engineLiquidity;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {engineLiquidity != null && (
        <p className="text-sm text-aura-muted">
          В пуле доступно: <strong className="text-aura-gold">{availableInPool}</strong> {debtSymbol ?? "USDC"}. Занять можно не больше этой суммы.
        </p>
      )}
      {collateralShares != null && debt != null && showBorrowHint && (
        <p className="text-sm text-aura-muted">
          {(maxBorrowRaw > 0n || (maxBorrowUsdFromPrice != null && maxBorrowUsdFromPrice > 0)) ? (
            <>
              Можно ещё занять примерно: <strong className="text-aura-gold">{maxBorrowDisplay}</strong>{" "}
              {maxBorrowLabel} (лимит {ltv / 100}% от стоимости коллатерала).
            </>
          ) : (
            <>
              Можно занять до {ltv / 100}% от стоимости коллатерала. Точная сумма в {debtSymbol ?? "долге"} — после обновления контракта.
            </>
          )}
        </p>
      )}
      <div>
        <label className="block text-sm text-aura-muted mb-2">{debtSymbol ? `Amount to borrow (${debtSymbol})` : "Amount to borrow"}</label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="input-field"
        />
        {exceedsPool && (
          <p className="text-aura-danger text-sm mt-1">В пуле только {availableInPool} {debtSymbol}. Уменьшите сумму.</p>
        )}
      </div>
      {error && <p className="text-aura-danger text-sm">{error.message}</p>}
      <button type="submit" disabled={isPending || !amount || exceedsPool} className="btn-primary w-full">
        {isPending ? "Confirm in wallet…" : "Borrow"}
      </button>
    </form>
  );
}

function RepayForm({
  engineAddress,
  debtTokenAddress,
  userAddress,
  debt,
  debtDecimals,
  debtSymbol,
  onSuccess,
}: {
  engineAddress: `0x${string}` | undefined;
  debtTokenAddress: `0x${string}` | undefined;
  userAddress: string | undefined;
  debt: bigint | undefined;
  debtDecimals: number;
  debtSymbol?: string;
  onSuccess?: () => void;
}) {
  const [amount, setAmount] = useState("");
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, isPending, error, data: txHash } = useWriteContract();

  const targetChainId = chainId ?? LOCAL_CHAIN_ID;
  const repayDecimals = debtDecimals;
  const repayWei = amount ? parseUnits(amount, repayDecimals) : 0n;

  const erc20BalAbi = [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
  const { data: debtBalance } = useReadContract({
    address: debtTokenAddress,
    abi: erc20BalAbi,
    functionName: "balanceOf",
    args: userAddress ? [userAddress as `0x${string}`] : undefined,
    chainId: targetChainId,
  });

  // Max repay = min(debt, balance)
  const maxRepay = debt != null && debtBalance != null
    ? (debt < debtBalance ? debt : debtBalance)
    : debt ?? debtBalance ?? 0n;
  const setMax = () => setAmount(formatUnits(maxRepay, repayDecimals));

  const { data: debtAllowance, refetch: refetchAllowance } = useReadContract({
    address: debtTokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: userAddress && engineAddress ? [userAddress as `0x${string}`, engineAddress] : undefined,
    chainId: targetChainId,
  });

  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => {
    if (txSuccess && txHash) {
      refetchAllowance();
      onSuccess?.();
    }
  }, [txSuccess, txHash, refetchAllowance, onSuccess]);

  const needsApproval = repayWei > 0n && (debtAllowance == null || debtAllowance < repayWei);
  const gasOverrides = getGasOverrides(targetChainId);

  const runApprove = async () => {
    if (!debtTokenAddress || !engineAddress) return;
    try {
      if (switchChainAsync) await switchChainAsync({ chainId: targetChainId });
      writeContract({
        chainId: targetChainId,
        address: debtTokenAddress,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [engineAddress, MAX_UINT256],
        ...gasOverrides,
      });
    } catch (e) { console.error(e); }
  };

  const submit = async () => {
    if (!engineAddress || !userAddress || !amount) return;
    try {
      if (switchChainAsync) await switchChainAsync({ chainId: targetChainId });
      writeContract({
        chainId: targetChainId,
        address: engineAddress,
        abi: auraEngineAbi,
        functionName: "repay",
        args: [userAddress as `0x${string}`, repayWei],
        ...gasOverrides,
      });
    } catch (e) { console.error(e); }
  };

  const debtDisplay = debt != null ? formatUnits(debt, repayDecimals) : "—";

  if (!engineAddress) {
    return (
      <p className="text-aura-muted text-sm">
        Set AURA_ENGINE_ADDRESS in the backend to interact with the contract.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (needsApproval) runApprove();
        else submit();
      }}
      className="space-y-4"
    >
      {debt != null && debt > 0n && (
        <p className="text-sm text-aura-muted">
          Текущий долг: <strong className="text-aura-gold">{debtDisplay}</strong> {debtSymbol ?? ""}
          {debtBalance != null && (
            <> | Баланс: <strong className="text-aura-gold">{formatUnits(debtBalance, repayDecimals)}</strong> {debtSymbol ?? ""}</>
          )}
        </p>
      )}
      <div>
        <label className="block text-sm text-aura-muted mb-2">{debtSymbol ? `Сумма погашения (${debtSymbol})` : "Amount to repay"}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-field flex-1"
          />
          <button type="button" onClick={setMax} className="px-3 py-2 rounded-lg text-sm font-medium bg-aura-gold/20 text-aura-gold hover:bg-aura-gold/30 transition-colors">
            Max
          </button>
        </div>
      </div>
      {error && <p className="text-aura-danger text-sm">{error.message}</p>}
      <button
        type="button"
        onClick={() => (needsApproval ? runApprove() : submit())}
        disabled={isPending || !amount}
        className="btn-primary w-full"
      >
        {isPending
          ? "Подтвердите в кошельке…"
          : needsApproval
            ? `Разрешить ${debtSymbol ?? "USDC"} для Engine (один раз)`
            : "Погасить долг"}
      </button>
    </form>
  );
}

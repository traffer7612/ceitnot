import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContracts, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits, encodeFunctionData, keccak256, stringToHex, isAddress, parseAbiItem, type Hash, type Address } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  Vote, Lock, Unlock, Plus, Clock, Users, Gift,
  CheckCircle, AlertCircle, Loader2, RefreshCw, ExternalLink,
} from 'lucide-react';
import { erc20Abi, veLockAbi, governorAbi, marketRegistryAbi } from '../abi/ceitnotEngine';
import { gasFor, TARGET_CHAIN_ID, useContractAddresses } from '../lib/contracts';
import { viteAddress, viteAddressLegacy } from '../lib/chainEnv';
import { formatWad, formatAddress } from '../lib/utils';
import { blockExplorerAddressUrl } from '../lib/explorer';

const env = import.meta.env as Record<string, string | undefined>;
const VE_TOKEN = viteAddressLegacy(import.meta.env.VITE_VE_TOKEN_ADDRESS, env.VITE_VE_AURA_ADDRESS);
const GOV_TOKEN = viteAddressLegacy(import.meta.env.VITE_GOVERNANCE_TOKEN_ADDRESS, env.VITE_AURA_TOKEN_ADDRESS);
const GOVERNOR = viteAddress(import.meta.env.VITE_GOVERNOR_ADDRESS);
const TIMELOCK = viteAddress(import.meta.env.VITE_TIMELOCK_ADDRESS);
const AUSD     = viteAddress(import.meta.env.VITE_AUSD_ADDRESS);
const TALLY_URL = import.meta.env.VITE_TALLY_URL as string | undefined;

/** Minimal ABI for governance calldata to CeitnotUSD (aUSD) */
const ausdGovAbi = [
  { type: 'function', name: 'addMinter', stateMutability: 'nonpayable', inputs: [{ name: 'minter', type: 'address' }], outputs: [] },
] as const;

const WEEK = 7 * 24 * 3600;
/** Max age of proposals shown in "Recent" (by block timestamp). */
const FEED_WINDOW_SECONDS = 90 * 24 * 3600; // 90 days — was 10d; short window hid older active votes
const ACTIVITY_INITIAL_COUNT = 5;

/** Percent string (e.g. "90" = 90%) → basis points for registry */
function govPctToBps(v: string): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

/** WAD (18 decimals) caps; empty → 0 */
function govParseWadCap(v: string): bigint {
  const t = v.trim();
  if (!t) return 0n;
  try {
    return parseUnits(t, 18);
  } catch {
    return 0n;
  }
}

/**
 * `getLogs` block span: on Arbitrum/Base blocks are seconds apart, so 300k blocks is only ~1–2 days
 * and ProposalCreated disappears from the feed. Use chain-aware lookback.
 */
function governanceLogsFromBlock(latestBlock: bigint, chainId: number): bigint {
  const spanByChain: Record<number, bigint> = {
    42161: 18_000_000n,   // Arbitrum One — ~weeks of history at typical L2 cadence
    421614: 18_000_000n,  // Arbitrum Sepolia — L2 cadence similar to One
    8453: 6_000_000n,     // Base
    11155111: 400_000n,   // Sepolia ~12s blocks → ~8 weeks
  };
  const span = spanByChain[chainId] ?? 500_000n;
  return latestBlock > span ? latestBlock - span : 0n;
}

function governanceLogsDeepFromBlock(latestBlock: bigint, chainId: number): bigint {
  const spanByChain: Record<number, bigint> = {
    42161: 30_000_000n,
    421614: 30_000_000n,
    8453: 12_000_000n,
    11155111: 800_000n,
  };
  const span = spanByChain[chainId] ?? 1_000_000n;
  return latestBlock > span ? latestBlock - span : 0n;
}

/** Duration presets in weeks */
const DURATIONS = [
  { label: '1 month',  weeks: 4 },
  { label: '3 months', weeks: 13 },
  { label: '6 months', weeks: 26 },
  { label: '1 year',   weeks: 52 },
  { label: '2 years',  weeks: 104 },
  { label: '4 years',  weeks: 208 },
];

type Step = 'idle' | 'approving' | 'writing' | 'success' | 'error';
type ProposalFeedItem = {
  proposalId: bigint;
  proposer: Address;
  description: string;
  voteStart: bigint;
  voteEnd: bigint;
  txHash?: Hash;
  state?: number;
};
type GovernanceActivityItem = {
  kind: 'proposed' | 'voted' | 'queued' | 'executed';
  proposalId: bigint;
  actor?: Address;
  support?: number;
  weight?: bigint;
  txHash?: Hash;
  blockNumber?: bigint;
  logIndex?: number;
};

const proposalCreatedEvent = parseAbiItem(
  'event ProposalCreated(uint256 proposalId,address proposer,address[] targets,uint256[] values,string[] signatures,bytes[] calldatas,uint256 voteStart,uint256 voteEnd,string description)',
);
const voteCastEvent = parseAbiItem(
  'event VoteCast(address indexed voter,uint256 proposalId,uint8 support,uint256 weight,string reason)',
);
const proposalQueuedEvent = parseAbiItem(
  'event ProposalQueued(uint256 proposalId,uint256 etaSeconds)',
);
const proposalExecutedEvent = parseAbiItem(
  'event ProposalExecuted(uint256 proposalId)',
);

export default function GovernancePage() {
  const { address, isConnected, chainId } = useAccount();
  const explorerChainId = chainId ?? TARGET_CHAIN_ID;
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { registry } = useContractAddresses();

  // ── tx tracking ──
  const [hash, setHash] = useState<Hash | undefined>();
  const [step, setStep] = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({ hash });

  // ── lock form ──
  const [lockAmount, setLockAmount] = useState('');
  const [durationWeeks, setDurationWeeks] = useState(52); // default 1 year
  // ── increase form ──
  const [extraAmount, setExtraAmount] = useState('');
  // ── extend form ──
  const [extendWeeks, setExtendWeeks] = useState(52);
  // ── delegate form ──
  const [delegateTo, setDelegateTo] = useState('');
  // ── which action is active ──
  const [activeAction, setActiveAction] = useState<string>('');
  const [proposalIdInput, setProposalIdInput] = useState('');
  const [voteSupport, setVoteSupport] = useState<'0' | '1' | '2'>('1');
  const [govDescription, setGovDescription] = useState('AIP: Update market risk params');
  const [marketId, setMarketId] = useState('2');
  const [newLtv, setNewLtv] = useState('85');
  const [newLiqThreshold, setNewLiqThreshold] = useState('93');
  const [newLiqPenalty, setNewLiqPenalty] = useState('3');
  /** Which single-action template feeds propose / queue / execute (must stay the same for a given proposal). */
  const [govProposalKind, setGovProposalKind] = useState<'marketRisk' | 'addMarket' | 'addPsmMinter'>('marketRisk');
  const [newPsmMinterAddress, setNewPsmMinterAddress] = useState('');
  const [addMarketVault, setAddMarketVault] = useState('');
  const [addMarketOracle, setAddMarketOracle] = useState('');
  const [addMarketLtv, setAddMarketLtv] = useState('90');
  const [addMarketLiqTh, setAddMarketLiqTh] = useState('93');
  const [addMarketLiqPen, setAddMarketLiqPen] = useState('3');
  const [addMarketSupplyCap, setAddMarketSupplyCap] = useState('');
  const [addMarketBorrowCap, setAddMarketBorrowCap] = useState('');
  const [addMarketIsolated, setAddMarketIsolated] = useState(false);
  const [addMarketIsoBorrowCap, setAddMarketIsoBorrowCap] = useState('');
  const [proposalFeed, setProposalFeed] = useState<ProposalFeedItem[]>([]);
  const [activityFeed, setActivityFeed] = useState<GovernanceActivityItem[]>([]);
  const [proposalTitleMap, setProposalTitleMap] = useState<Record<string, string>>({});
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [isFeedLoading, setIsFeedLoading] = useState(false);
  const [feedErr, setFeedErr] = useState('');

  // ── read contract data ──
  const { data: readData, refetch } = useReadContracts({
    contracts: (address && VE_TOKEN && GOV_TOKEN) ? [
      { address: GOV_TOKEN, abi: erc20Abi,  functionName: 'balanceOf',  args: [address], chainId: TARGET_CHAIN_ID },
      { address: GOV_TOKEN, abi: erc20Abi,  functionName: 'allowance',  args: [address, VE_TOKEN], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN,    abi: veLockAbi, functionName: 'locks',      args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN,    abi: veLockAbi, functionName: 'getVotes',   args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN,    abi: veLockAbi, functionName: 'delegates',  args: [address], chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN,    abi: veLockAbi, functionName: 'totalLocked',                 chainId: TARGET_CHAIN_ID },
      { address: VE_TOKEN,    abi: veLockAbi, functionName: 'pendingRevenue', args: [address], chainId: TARGET_CHAIN_ID },
    ] : [],
    query: { enabled: !!address && !!VE_TOKEN && !!GOV_TOKEN },
  });

  const govTokenBalance = (readData?.[0]?.result as bigint | undefined) ?? 0n;
  const allowance     = (readData?.[1]?.result as bigint | undefined) ?? 0n;
  const lockData      = readData?.[2]?.result as [bigint, bigint] | undefined;
  const lockedAmount  = lockData?.[0] ?? 0n;
  const unlockTime    = lockData?.[1] ?? 0n;
  const votingPower   = (readData?.[3]?.result as bigint | undefined) ?? 0n;
  const currentDelegate = (readData?.[4]?.result as Address | undefined);
  const totalLocked   = (readData?.[5]?.result as bigint | undefined) ?? 0n;
  const pendingRev    = (readData?.[6]?.result as bigint | undefined) ?? 0n;
  const displaySymbol = 'CEITNOT';

  const proposalId = proposalIdInput.trim() ? BigInt(proposalIdInput.trim()) : undefined;
  const hasGovConfig = !!GOVERNOR && (!!registry || !!AUSD);
  const marketRiskCalldata =
    GOVERNOR && registry
      ? encodeFunctionData({
        abi: marketRegistryAbi,
        functionName: 'updateMarketRiskParams',
        args: [
          BigInt(marketId || '0'),
          Math.round(Number(newLtv || '0') * 100),
          Math.round(Number(newLiqThreshold || '0') * 100),
          Math.round(Number(newLiqPenalty || '0') * 100),
        ],
      })
      : '0x';
  const trimmedVault = addMarketVault.trim();
  const trimmedOracle = addMarketOracle.trim();
  const addLtvBps = govPctToBps(addMarketLtv);
  const addLiqBps = govPctToBps(addMarketLiqTh);
  const addPenBps = govPctToBps(addMarketLiqPen);
  const addMarketCalldataEncoded =
    GOVERNOR &&
    registry &&
    isAddress(trimmedVault as Address) &&
    isAddress(trimmedOracle as Address) &&
    addLtvBps !== undefined &&
    addLiqBps !== undefined &&
    addPenBps !== undefined &&
    addLiqBps >= addLtvBps
      ? encodeFunctionData({
          abi: marketRegistryAbi,
          functionName: 'addMarket',
          args: [
            trimmedVault as Address,
            trimmedOracle as Address,
            addLtvBps,
            addLiqBps,
            addPenBps,
            govParseWadCap(addMarketSupplyCap),
            govParseWadCap(addMarketBorrowCap),
            addMarketIsolated,
            govParseWadCap(addMarketIsoBorrowCap),
          ],
        })
      : '0x';
  const trimmedPsm = newPsmMinterAddress.trim();
  const addMinterCalldata =
    GOVERNOR && AUSD && trimmedPsm && isAddress(trimmedPsm as Address)
      ? encodeFunctionData({
        abi: ausdGovAbi,
        functionName: 'addMinter',
        args: [trimmedPsm as Address],
      })
      : '0x';

  const govTargets: Address[] =
    (govProposalKind === 'marketRisk' || govProposalKind === 'addMarket') && registry
      ? [registry as Address]
      : govProposalKind === 'addPsmMinter' && AUSD
        ? [AUSD]
        : [];
  const govValues: bigint[] = [0n];
  const govCalldatas: `0x${string}`[] =
    govProposalKind === 'marketRisk' && marketRiskCalldata !== '0x'
      ? [marketRiskCalldata as `0x${string}`]
      : govProposalKind === 'addMarket' && addMarketCalldataEncoded !== '0x'
        ? [addMarketCalldataEncoded as `0x${string}`]
        : govProposalKind === 'addPsmMinter' && addMinterCalldata !== '0x'
          ? [addMinterCalldata as `0x${string}`]
          : [];
  const descriptionHash = keccak256(stringToHex(govDescription || ''));
  const canCreateGovProposal =
    !!GOVERNOR &&
    govCalldatas.length > 0 &&
    govTargets.length > 0 &&
    (govProposalKind === 'marketRisk'
      ? !!registry
      : govProposalKind === 'addMarket'
        ? !!registry &&
          isAddress(trimmedVault as Address) &&
          isAddress(trimmedOracle as Address) &&
          addLtvBps !== undefined &&
          addLiqBps !== undefined &&
          addPenBps !== undefined &&
          addLiqBps >= addLtvBps
        : !!AUSD && isAddress(trimmedPsm as Address));

  const { data: govData, refetch: refetchGov } = useReadContracts({
    contracts: (GOVERNOR ? [
      { address: GOVERNOR, abi: governorAbi, functionName: 'votingDelay', chainId: TARGET_CHAIN_ID },
      { address: GOVERNOR, abi: governorAbi, functionName: 'votingPeriod', chainId: TARGET_CHAIN_ID },
      { address: GOVERNOR, abi: governorAbi, functionName: 'proposalThreshold', chainId: TARGET_CHAIN_ID },
      { address: GOVERNOR, abi: governorAbi, functionName: 'quorum', args: [BigInt(Math.floor(Date.now() / 1000))], chainId: TARGET_CHAIN_ID },
      ...(proposalId !== undefined ? [
        { address: GOVERNOR, abi: governorAbi, functionName: 'state', args: [proposalId], chainId: TARGET_CHAIN_ID },
        { address: GOVERNOR, abi: governorAbi, functionName: 'proposalSnapshot', args: [proposalId], chainId: TARGET_CHAIN_ID },
        { address: GOVERNOR, abi: governorAbi, functionName: 'proposalDeadline', args: [proposalId], chainId: TARGET_CHAIN_ID },
        ...(address ? [{ address: GOVERNOR, abi: governorAbi, functionName: 'hasVoted', args: [proposalId, address], chainId: TARGET_CHAIN_ID }] : []),
      ] : []),
    ] : []),
    query: { enabled: !!GOVERNOR },
  });

  const govVotingDelay = (govData?.[0]?.result as bigint | undefined) ?? 0n;
  const govVotingPeriod = (govData?.[1]?.result as bigint | undefined) ?? 0n;
  const govProposalThreshold = (govData?.[2]?.result as bigint | undefined) ?? 0n;
  const govQuorumNow = (govData?.[3]?.result as bigint | undefined) ?? 0n;
  const proposalState = (govData?.[4]?.result as number | undefined);
  const proposalSnapshot = (govData?.[5]?.result as bigint | undefined);
  const proposalDeadline = (govData?.[6]?.result as bigint | undefined);
  const hasVoted = (govData?.[7]?.result as boolean | undefined);

  const hasLock       = lockedAmount > 0n;
  const lockExpired   = hasLock && BigInt(Math.floor(Date.now() / 1000)) >= unlockTime;
  const nowSec        = Math.floor(Date.now() / 1000);

  // format unlock time
  const unlockDate = hasLock ? new Date(Number(unlockTime) * 1000).toLocaleDateString() : '—';
  const timeLeft   = hasLock && !lockExpired
    ? `${Math.floor((Number(unlockTime) - nowSec) / 86400)} days`
    : lockExpired ? 'Expired' : '—';

  // ── handle tx confirmation ──
  useEffect(() => {
    if (confirmed && hash) {
      if (step === 'approving') {
        refetch();
        setHash(undefined);
        setStep('idle');
      } else if (step === 'writing') {
        setStep('success');
        refetch();
        refetchGov();
      }
    }
  }, [confirmed, hash, step, refetch, refetchGov]);

  const reset = () => { setHash(undefined); setStep('idle'); setErrMsg(''); setActiveAction(''); };

  // ── helpers ──
  const gas = gasFor(chainId);
  const parseAmt = (v: string) => { try { return v ? parseUnits(v, 18) : 0n; } catch { return 0n; } };

  async function approve() {
    if (!GOV_TOKEN || !VE_TOKEN) return;
    setStep('approving');
    const h = await writeContractAsync({
      address: GOV_TOKEN, abi: erc20Abi, functionName: 'approve',
      args: [VE_TOKEN, 2n ** 256n - 1n], ...gas,
    });
    setHash(h);
  }

  // ── LOCK ──
  async function handleLock() {
    if (!VE_TOKEN || !address) return;
    const raw = parseAmt(lockAmount);
    if (raw === 0n) return;
    setActiveAction('lock');
    try {
      if (allowance < raw) { await approve(); return; }
      setStep('writing');
      const unlock = BigInt(Math.floor((nowSec + durationWeeks * WEEK) / WEEK) * WEEK);
      const h = await writeContractAsync({
        address: VE_TOKEN, abi: veLockAbi, functionName: 'lock',
        args: [raw, unlock], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── INCREASE ──
  async function handleIncrease() {
    if (!VE_TOKEN) return;
    const raw = parseAmt(extraAmount);
    if (raw === 0n) return;
    setActiveAction('increase');
    try {
      if (allowance < raw) { await approve(); return; }
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_TOKEN, abi: veLockAbi, functionName: 'increaseAmount',
        args: [raw], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── EXTEND ──
  async function handleExtend() {
    if (!VE_TOKEN) return;
    setActiveAction('extend');
    try {
      setStep('writing');
      const newUnlock = BigInt(Math.floor((nowSec + extendWeeks * WEEK) / WEEK) * WEEK);
      const h = await writeContractAsync({
        address: VE_TOKEN, abi: veLockAbi, functionName: 'extendLock',
        args: [newUnlock], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── WITHDRAW ──
  async function handleWithdraw() {
    if (!VE_TOKEN) return;
    setActiveAction('withdraw');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_TOKEN, abi: veLockAbi, functionName: 'withdraw', ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── CLAIM REVENUE ──
  async function handleClaim() {
    if (!VE_TOKEN) return;
    setActiveAction('claim');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_TOKEN, abi: veLockAbi, functionName: 'claimRevenue', ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  // ── DELEGATE ──
  async function handleDelegate() {
    if (!VE_TOKEN || !delegateTo) return;
    setActiveAction('delegate');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: VE_TOKEN, abi: veLockAbi, functionName: 'delegate',
        args: [delegateTo as Address], ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  const proposalStateLabel = (s?: number) => {
    switch (s) {
      case 0: return 'Pending';
      case 1: return 'Active';
      case 2: return 'Canceled';
      case 3: return 'Defeated';
      case 4: return 'Succeeded';
      case 5: return 'Queued';
      case 6: return 'Expired';
      case 7: return 'Executed';
      default: return 'Unknown';
    }
  };

  const formatUnix = (v?: bigint) => {
    if (v === undefined) return '—';
    return new Date(Number(v) * 1000).toLocaleString();
  };
  const blockExplorerTxUrl = (txHash: string) => {
    switch (explorerChainId) {
      case 42161:
        return `https://arbiscan.io/tx/${txHash}`;
      case 421614:
        return `https://sepolia.arbiscan.io/tx/${txHash}`;
      case 8453:
        return `https://basescan.org/tx/${txHash}`;
      case 11155111:
        return `https://sepolia.etherscan.io/tx/${txHash}`;
      default:
        return null;
    }
  };

  async function refreshProposalFeed() {
    if (!publicClient || !GOVERNOR) return;
    setIsFeedLoading(true);
    setFeedErr('');
    try {
      const latestBlock = await publicClient.getBlockNumber();
      const latest = await publicClient.getBlock({ blockNumber: latestBlock });
      const minTs = BigInt(Math.max(0, Number(latest.timestamp) - FEED_WINDOW_SECONDS));
      const fromBlock = governanceLogsFromBlock(latestBlock, TARGET_CHAIN_ID);
      const [createdLogs, voteLogs, queuedLogs, executedLogs] = await Promise.all([
        publicClient.getLogs({
          address: GOVERNOR,
          event: proposalCreatedEvent,
          fromBlock,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: GOVERNOR,
          event: voteCastEvent,
          fromBlock,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: GOVERNOR,
          event: proposalQueuedEvent,
          fromBlock,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: GOVERNOR,
          event: proposalExecutedEvent,
          fromBlock,
          toBlock: 'latest',
        }),
      ]);

      const stateIds = new Set<bigint>();
      for (const lg of createdLogs) stateIds.add((lg.args as { proposalId: bigint }).proposalId);
      for (const lg of voteLogs) stateIds.add((lg.args as { proposalId: bigint }).proposalId);
      for (const lg of queuedLogs) stateIds.add((lg.args as { proposalId: bigint }).proposalId);
      for (const lg of executedLogs) stateIds.add((lg.args as { proposalId: bigint }).proposalId);

      const stateEntries = await Promise.all(
        [...stateIds].map(async (proposalId) => {
          try {
            const st = await publicClient.readContract({
              address: GOVERNOR,
              abi: governorAbi,
              functionName: 'state',
              args: [proposalId],
            });
            return [proposalId, Number(st)] as const;
          } catch {
            return [proposalId, undefined] as const;
          }
        }),
      );
      const stateMap = new Map<bigint, number | undefined>(stateEntries);

      const rawActivity: GovernanceActivityItem[] = [
        ...createdLogs.map((log) => {
          const args = log.args as { proposalId: bigint; proposer: Address };
          return {
            kind: 'proposed' as const,
            proposalId: args.proposalId,
            actor: args.proposer,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          };
        }),
        ...voteLogs.map((log) => {
          const args = log.args as { proposalId: bigint; voter: Address; support: number; weight: bigint };
          return {
            kind: 'voted' as const,
            proposalId: args.proposalId,
            actor: args.voter,
            support: Number(args.support),
            weight: args.weight,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          };
        }),
        ...queuedLogs.map((log) => {
          const args = log.args as { proposalId: bigint };
          return {
            kind: 'queued' as const,
            proposalId: args.proposalId,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          };
        }),
        ...executedLogs.map((log) => {
          const args = log.args as { proposalId: bigint };
          return {
            kind: 'executed' as const,
            proposalId: args.proposalId,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          };
        }),
      ].sort((a, b) => {
        const aBlock = Number(a.blockNumber ?? 0n);
        const bBlock = Number(b.blockNumber ?? 0n);
        if (aBlock !== bBlock) return bBlock - aBlock;
        return (b.logIndex ?? 0) - (a.logIndex ?? 0);
      });

      const isRecent = async (item: GovernanceActivityItem) => {
        if (!item.blockNumber) return false;
        const b = await publicClient.getBlock({ blockNumber: item.blockNumber });
        return b.timestamp >= minTs;
      };
      const filteredByTime: GovernanceActivityItem[] = [];
      for (const item of rawActivity) {
        // Keep list small without parallel RPC bursts
        // eslint-disable-next-line no-await-in-loop
        if (await isRecent(item)) filteredByTime.push(item);
        if (filteredByTime.length >= 30) break;
      }

      const proposalIdsShown = new Set(recentProposalIdsFromLogs(createdLogs));
      const activity = filteredByTime
        .filter((a) => !(a.kind === 'proposed' && proposalIdsShown.has(a.proposalId.toString())))
        .slice(0, 20);
      setActivityFeed(activity);
      const titles: Record<string, string> = {};
      for (const log of createdLogs) {
        const args = log.args as { proposalId: bigint; description: string };
        titles[args.proposalId.toString()] = humanizeProposalDescription(args.description);
      }
      const missingTitleIds = [...stateIds].filter((id) => !titles[id.toString()]);
      if (missingTitleIds.length > 0) {
        const deepFromBlock = governanceLogsDeepFromBlock(latestBlock, TARGET_CHAIN_ID);
        const deepCreatedLogs = await publicClient.getLogs({
          address: GOVERNOR,
          event: proposalCreatedEvent,
          fromBlock: deepFromBlock,
          toBlock: 'latest',
        });
        for (const log of deepCreatedLogs) {
          const args = log.args as { proposalId: bigint; description: string };
          const id = args.proposalId.toString();
          if (missingTitleIds.some((x) => x.toString() === id)) {
            titles[id] = humanizeProposalDescription(args.description);
          }
        }
      }
      setProposalTitleMap(titles);

      const createdRecent: typeof createdLogs = [];
      for (const log of [...createdLogs].reverse()) {
        if (!log.blockNumber) continue;
        // eslint-disable-next-line no-await-in-loop
        const b = await publicClient.getBlock({ blockNumber: log.blockNumber });
        if (b.timestamp >= minTs) createdRecent.push(log);
        if (createdRecent.length >= 12) break;
      }
      const recent = createdRecent;
      const withState = await Promise.all(recent.map(async (log) => {
        const args = log.args as {
          proposalId: bigint;
          proposer: Address;
          voteStart: bigint;
          voteEnd: bigint;
          description: string;
        };
        const s = stateMap.get(args.proposalId);
        return {
          proposalId: args.proposalId,
          proposer: args.proposer,
          voteStart: args.voteStart,
          voteEnd: args.voteEnd,
          description: args.description,
          txHash: log.transactionHash,
          state: s,
        } satisfies ProposalFeedItem;
      }));

      setProposalFeed(withState);
    } catch (e: unknown) {
      setFeedErr(e instanceof Error ? e.message.split('\n')[0] : String(e));
    } finally {
      setIsFeedLoading(false);
    }
  }

  useEffect(() => {
    void refreshProposalFeed();
  }, [publicClient, GOVERNOR]);

  function recentProposalIdsFromLogs(
    logs: readonly { args: unknown; blockNumber?: bigint }[],
  ): string[] {
    // lightweight fallback: dedupe by order; exact time filtering done above for displayed list
    const out: string[] = [];
    for (const log of [...logs].reverse()) {
      const args = log.args as { proposalId: bigint };
      const id = args.proposalId.toString();
      if (!out.includes(id)) out.push(id);
      if (out.length >= 12) break;
    }
    return out;
  }

  const supportLabel = (s?: number) => {
    if (s === 0) return 'Against';
    if (s === 1) return 'For';
    if (s === 2) return 'Abstain';
    return 'Unknown';
  };
  const humanizeProposalDescription = (description: string) => {
    const d = description.toLowerCase();
    if (d.includes('addminter') || (d.includes('psm') && d.includes('minter'))) {
      if (d.includes('usdc')) return 'Open new USDC PSM market (enable swaps on the new PSM)';
      return 'Open new PSM market (enable swaps on the new PSM)';
    }
    if (d.includes('market') && d.includes('risk')) {
      return 'Update market risk parameters';
    }
    if (d.includes('market') && (d.includes('add') || d.includes('new'))) {
      if (d.includes('usdc')) return 'Open USDC market';
      if (d.includes('usdt')) return 'Open USDT market';
      return 'Open a new market';
    }
    return description || 'Governance proposal';
  };
  const shortProposalId = (id: bigint) => {
    const s = id.toString();
    return s.length > 18 ? `${s.slice(0, 10)}...${s.slice(-6)}` : s;
  };

  async function handleProposeRiskUpdate() {
    if (!GOVERNOR || !hasGovConfig || !canCreateGovProposal) return;
    setActiveAction('propose');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: GOVERNOR,
        abi: governorAbi,
        functionName: 'propose',
        args: [govTargets, govValues, govCalldatas, govDescription],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  async function handleVote() {
    if (!GOVERNOR || proposalId === undefined) return;
    setActiveAction('vote');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: GOVERNOR,
        abi: governorAbi,
        functionName: 'castVote',
        args: [proposalId, Number(voteSupport)],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  async function handleQueue() {
    if (!GOVERNOR || !hasGovConfig || govCalldatas.length === 0) return;
    setActiveAction('queue');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: GOVERNOR,
        abi: governorAbi,
        functionName: 'queue',
        args: [govTargets, govValues, govCalldatas, descriptionHash],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  async function handleExecute() {
    if (!GOVERNOR || !hasGovConfig || govCalldatas.length === 0) return;
    setActiveAction('execute');
    try {
      setStep('writing');
      const h = await writeContractAsync({
        address: GOVERNOR,
        abi: governorAbi,
        functionName: 'execute',
        args: [govTargets, govValues, govCalldatas, descriptionHash],
        ...gas,
      });
      setHash(h);
    } catch (e: unknown) {
      setStep('error');
      setErrMsg(e instanceof Error ? e.message.split('\n')[0].slice(0, 120) : String(e));
    }
  }

  const isPending = step === 'approving' || step === 'writing';

  // ── Not connected (same order as before: wallet first) ──
  if (!isConnected) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm w-full flex flex-col items-center">
          <Vote size={48} className="text-ceitnot-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
          <p className="text-ceitnot-muted text-sm mb-6">Connect to lock CEITNOT and participate in governance.</p>
          <div className="w-full flex justify-center [&>div]:flex [&>div]:justify-center">
            <ConnectButton />
          </div>
        </div>
      </div>
    );
  }

  // ── Not configured (after connect — token / ve addresses invalid or missing in .env) ──
  if (!VE_TOKEN || !GOV_TOKEN) {
    return (
      <div className="page-container">
        <div className="card p-8 text-center max-w-lg mx-auto border-ceitnot-warning/30 bg-ceitnot-warning/5">
          <Vote size={40} className="text-ceitnot-warning mx-auto mb-3" />
          <p className="text-ceitnot-warning font-medium">Governance contracts not configured</p>
          <p className="text-ceitnot-muted text-sm mt-2">
            In <code className="font-mono text-ceitnot-warning/80">frontend/.env</code> set valid checksummed addresses for{' '}
            <code className="font-mono text-ceitnot-warning/80">VITE_GOVERNANCE_TOKEN_ADDRESS</code> (CeitnotToken) and{' '}
            <code className="font-mono text-ceitnot-warning/80">VITE_VE_TOKEN_ADDRESS</code> (VeCeitnot). No spaces or quotes.
            Restart <code className="font-mono text-ceitnot-muted-2">npm run dev</code> after editing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header flex items-end justify-between">
        <div>
          <h1 className="page-title">
            <span className="page-title-accent">Governance</span>
          </h1>
          <p className="page-subtitle">Lock CEITNOT → get veCEITNOT → vote &amp; earn revenue</p>
        </div>
        <div className="flex items-center gap-2">
          {TALLY_URL && (
            <a
              href={TALLY_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost flex items-center gap-2 text-sm"
            >
              <ExternalLink size={14} /> Open on Tally
            </a>
          )}
          <button onClick={() => { refetch(); void refreshProposalFeed(); }} className="btn-ghost flex items-center gap-2 text-sm">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="card p-4 mb-6 text-sm">
        <p className="font-medium text-ceitnot-ink">How Governance Works</p>
        <p className="text-ceitnot-muted mt-1">
          Buy or receive <span className="text-ceitnot-ink">CEITNOT</span>, lock it to receive <span className="text-ceitnot-ink">veCEITNOT</span>,
          then use your voting power to participate in proposals. While locked, you can also claim protocol
          revenue shown in <span className="text-ceitnot-ink">Pending Revenue</span>.
        </p>
        <p className="text-ceitnot-muted mt-2">
          On-chain flow: <span className="text-ceitnot-ink">Create</span> → <span className="text-ceitnot-ink">Vote</span> →{' '}
          <span className="text-ceitnot-ink">Queue</span> → <span className="text-ceitnot-ink">Execute</span>.
        </p>
      </div>

      {/* Success / Error overlay */}
      {step === 'success' && (
        <div className="card p-6 mb-6 border-ceitnot-success/30 bg-ceitnot-success/5">
          <div className="flex items-center gap-3">
            <CheckCircle size={24} className="text-ceitnot-success" />
            <div>
              <p className="font-semibold">Transaction confirmed!</p>
              {hash && <p className="text-xs text-ceitnot-muted font-mono mt-1">tx: {hash.slice(0, 10)}…{hash.slice(-8)}</p>}
            </div>
            <button className="ml-auto btn-secondary text-sm" onClick={reset}>Dismiss</button>
          </div>
        </div>
      )}
      {step === 'error' && (
        <div className="card p-6 mb-6 border-ceitnot-danger/30 bg-ceitnot-danger/5">
          <div className="flex items-center gap-3">
            <AlertCircle size={24} className="text-ceitnot-danger" />
            <div>
              <p className="font-semibold text-ceitnot-danger">Transaction failed</p>
              <p className="text-xs text-ceitnot-muted mt-1">{errMsg}</p>
            </div>
            <button className="ml-auto btn-secondary text-sm" onClick={reset}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="stat-card">
          <span className="stat-label">Your CEITNOT Balance</span>
          <p className="stat-value font-mono">{formatWad(govTokenBalance, 2)}</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Your Locked CEITNOT</span>
          <p className="stat-value font-mono">{formatWad(lockedAmount, 2)}</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Your Voting Power</span>
          <p className="stat-value font-mono">{formatWad(votingPower, 2)}</p>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Locked (Protocol)</span>
          <p className="stat-value font-mono">{formatWad(totalLocked, 2)}</p>
        </div>
      </div>

      {/* Proposal feed */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Recent Proposals</h2>
          {isFeedLoading && <p className="text-xs text-ceitnot-muted">Loading...</p>}
        </div>
        {feedErr && <p className="text-xs text-ceitnot-danger mb-3">{feedErr}</p>}
        {proposalFeed.length === 0 ? (
          <p className="text-sm text-ceitnot-muted">
            No proposals found in the last scan window (chain-specific block range + up to 90 days by time).
            On fast L2s older UIs used a tiny block window — if this persists, confirm <code className="text-ceitnot-muted-2">VITE_GOVERNOR_ADDRESS</code> and check the Governor on the explorer.
          </p>
        ) : (
          <div className="space-y-3">
            {proposalFeed.map((p) => (
              <div key={p.proposalId.toString()} className="rounded-xl border border-ceitnot-border p-3 bg-ceitnot-surface-2/80">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-ceitnot-muted">#{p.proposalId.toString()}</p>
                    <p className="text-sm text-ceitnot-ink mt-1 break-words">{humanizeProposalDescription(p.description)}</p>
                    {p.description && (
                      <p className="text-xs text-ceitnot-muted mt-1 break-words">Raw: {p.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setProposalIdInput(p.proposalId.toString())}
                    className="btn-secondary text-xs shrink-0"
                    disabled={isPending}
                  >
                    Use in Vote
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-xs">
                  <p className="text-ceitnot-muted">State: <span className="text-ceitnot-gold">{proposalStateLabel(p.state)}</span></p>
                  <p className="text-ceitnot-muted">Start: <span className="text-ceitnot-ink">{formatUnix(p.voteStart)}</span></p>
                  <p className="text-ceitnot-muted">End: <span className="text-ceitnot-ink">{formatUnix(p.voteEnd)}</span></p>
                </div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <p className="text-ceitnot-muted">Proposer: <span className="font-mono text-ceitnot-ink">{formatAddress(p.proposer)}</span></p>
                  {p.txHash && blockExplorerTxUrl(p.txHash) && (
                    <a
                      href={blockExplorerTxUrl(p.txHash) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ceitnot-gold hover:underline flex items-center gap-1"
                    >
                      Tx <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Governance activity feed */}
      <div className="card p-5 mb-6">
        <h2 className="font-semibold text-lg mb-3">Recent Governance Activity</h2>
        {activityFeed.length === 0 ? (
          <p className="text-sm text-ceitnot-muted">No recent governance events found.</p>
        ) : (
          <div className="space-y-2">
            {(activityExpanded ? activityFeed : activityFeed.slice(0, ACTIVITY_INITIAL_COUNT)).map((a, idx) => (
              <div key={`${a.kind}-${a.proposalId.toString()}-${a.txHash ?? idx}-${idx}`} className="rounded-xl border border-ceitnot-border p-3 bg-ceitnot-surface-2/80 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-ceitnot-ink">
                    {a.kind === 'proposed' && 'Proposal created'}
                    {a.kind === 'voted' && `Vote cast (${supportLabel(a.support)})`}
                    {a.kind === 'queued' && 'Proposal queued'}
                    {a.kind === 'executed' && 'Proposal executed'}
                    {' '}for <span className="font-mono">#{shortProposalId(a.proposalId)}</span>
                  </p>
                  <button
                    onClick={() => setProposalIdInput(a.proposalId.toString())}
                    className="btn-secondary text-xs shrink-0"
                    disabled={isPending}
                  >
                    Use in Vote
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 text-ceitnot-muted">
                  <p>
                    {a.actor ? <>Actor: <span className="font-mono text-ceitnot-ink">{formatAddress(a.actor)}</span></> : ' '}
                    {a.weight !== undefined ? <> · Weight: <span className="text-ceitnot-ink">{formatWad(a.weight, 2)}</span></> : ' '}
                  </p>
                  {a.txHash && blockExplorerTxUrl(a.txHash) && (
                    <a href={blockExplorerTxUrl(a.txHash) ?? undefined} target="_blank" rel="noreferrer" className="text-ceitnot-gold hover:underline flex items-center gap-1">
                      Tx <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <p className="text-xs text-ceitnot-muted mt-2">
                  {(proposalTitleMap[a.proposalId.toString()] ?? 'Governance proposal action')}
                  {' '}· id: <span className="font-mono text-ceitnot-ink">{a.proposalId.toString()}</span>
                </p>
              </div>
            ))}
            {activityFeed.length > ACTIVITY_INITIAL_COUNT && (
              <button
                onClick={() => setActivityExpanded((v) => !v)}
                className="btn-secondary w-full text-sm"
              >
                {activityExpanded ? 'Show less' : `Show more (${activityFeed.length - ACTIVITY_INITIAL_COUNT})`}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ═══ LEFT: Lock / Lock Info ═══ */}
        <div className="space-y-6">
          {/* Lock info card (if has lock) */}
          {hasLock && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Lock size={18} className="text-ceitnot-gold" /> Your Lock
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-ceitnot-muted">Amount Locked</p>
                  <p className="font-mono text-ceitnot-ink mt-1">{formatWad(lockedAmount, 4)} {displaySymbol}</p>
                </div>
                <div>
                  <p className="text-ceitnot-muted">Unlock Date</p>
                  <p className="font-mono text-ceitnot-ink mt-1">{unlockDate}</p>
                </div>
                <div>
                  <p className="text-ceitnot-muted">Time Remaining</p>
                  <p className={`font-mono mt-1 ${lockExpired ? 'text-ceitnot-success' : 'text-ceitnot-ink'}`}>{timeLeft}</p>
                </div>
                <div>
                  <p className="text-ceitnot-muted">Voting Power</p>
                  <p className="font-mono text-ceitnot-gold mt-1">{formatWad(votingPower, 4)}</p>
                </div>
              </div>

              {/* Withdraw (if expired) */}
              {lockExpired && (
                <button
                  onClick={handleWithdraw}
                  disabled={isPending && activeAction === 'withdraw'}
                  className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
                >
                  {isPending && activeAction === 'withdraw' && <Loader2 size={16} className="animate-spin" />}
                  <Unlock size={16} /> Withdraw {displaySymbol}
                </button>
              )}
            </div>
          )}

          {/* New Lock (only if no active lock) */}
          {!hasLock && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Lock size={18} className="text-ceitnot-gold" /> Lock CEITNOT
              </h2>

              <div className="mb-4">
                <label className="block text-sm text-ceitnot-muted mb-2">Amount</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0" value={lockAmount}
                    onChange={e => setLockAmount(e.target.value)}
                    placeholder="0.0" className="input-field flex-1" disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => govTokenBalance > 0n && setLockAmount(formatUnits(govTokenBalance, 18))}
                    className="px-3 py-2 rounded-xl text-sm font-medium bg-ceitnot-gold/15 text-ceitnot-gold hover:bg-ceitnot-gold/25 transition-colors"
                    disabled={isPending || govTokenBalance === 0n}
                  >Max</button>
                </div>
                <p className="text-xs text-ceitnot-muted mt-1">
                  Balance: <span className="text-ceitnot-ink font-mono">{formatWad(govTokenBalance, 2)} {displaySymbol}</span>
                </p>
              </div>

              <div className="mb-5">
                <label className="block text-sm text-ceitnot-muted mb-2">Lock Duration</label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map(d => (
                    <button
                      key={d.weeks}
                      onClick={() => setDurationWeeks(d.weeks)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        durationWeeks === d.weeks
                          ? 'bg-ceitnot-gold/20 text-ceitnot-gold border border-ceitnot-gold/30'
                          : 'bg-ceitnot-surface-2 text-ceitnot-muted-2 hover:text-ceitnot-ink border border-transparent'
                      }`}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleLock}
                disabled={isPending || parseAmt(lockAmount) === 0n}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'lock' && <Loader2 size={16} className="animate-spin" />}
                {step === 'approving' && activeAction === 'lock' ? 'Approving…' : `Lock ${displaySymbol}`}
              </button>
            </div>
          )}

          {/* Increase Amount (if has active lock) */}
          {hasLock && !lockExpired && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Plus size={18} className="text-ceitnot-gold" /> Increase Lock
              </h2>
              <div className="mb-4">
                <div className="flex gap-2">
                  <input
                    type="number" min="0" value={extraAmount}
                    onChange={e => setExtraAmount(e.target.value)}
                    placeholder="0.0" className="input-field flex-1" disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => govTokenBalance > 0n && setExtraAmount(formatUnits(govTokenBalance, 18))}
                    className="px-3 py-2 rounded-xl text-sm font-medium bg-ceitnot-gold/15 text-ceitnot-gold hover:bg-ceitnot-gold/25 transition-colors"
                    disabled={isPending || govTokenBalance === 0n}
                  >Max</button>
                </div>
              </div>
              <button
                onClick={handleIncrease}
                disabled={isPending || parseAmt(extraAmount) === 0n}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'increase' && <Loader2 size={16} className="animate-spin" />}
                {step === 'approving' && activeAction === 'increase' ? 'Approving…' : 'Add CEITNOT to Lock'}
              </button>
            </div>
          )}

          {/* Extend Lock (if has active lock) */}
          {hasLock && !lockExpired && (
            <div className="card p-5">
              <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <Clock size={18} className="text-ceitnot-gold" /> Extend Lock
              </h2>
              <div className="mb-4">
                <label className="block text-sm text-ceitnot-muted mb-2">New Duration (from now)</label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map(d => (
                    <button
                      key={d.weeks}
                      onClick={() => setExtendWeeks(d.weeks)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                        extendWeeks === d.weeks
                          ? 'bg-ceitnot-gold/20 text-ceitnot-gold border border-ceitnot-gold/30'
                          : 'bg-ceitnot-surface-2 text-ceitnot-muted-2 hover:text-ceitnot-ink border border-transparent'
                      }`}
                    >{d.label}</button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleExtend}
                disabled={isPending}
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'extend' && <Loader2 size={16} className="animate-spin" />}
                Extend Lock
              </button>
            </div>
          )}
        </div>

        {/* ═══ RIGHT: Revenue + Delegate ═══ */}
        <div className="space-y-6">
          {/* Revenue */}
          <div className="card p-5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
              <Gift size={18} className="text-ceitnot-gold" /> Revenue
            </h2>
            <div className="p-4 bg-ceitnot-surface-2/80 rounded-xl mb-4">
              <p className="text-ceitnot-muted text-sm">Pending Revenue</p>
              <p className="text-2xl font-bold font-mono text-ceitnot-ink mt-1">{formatWad(pendingRev, 6)}</p>
              <p className="text-xs text-ceitnot-muted mt-1">Earned from protocol fees, proportional to your locked CEITNOT</p>
            </div>
            <button
              onClick={handleClaim}
              disabled={isPending || pendingRev === 0n}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isPending && activeAction === 'claim' && <Loader2 size={16} className="animate-spin" />}
              Claim Revenue
            </button>
          </div>

          {/* Delegate */}
          <div className="card p-5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
              <Users size={18} className="text-ceitnot-gold" /> Delegate Votes
            </h2>
            {currentDelegate && (
              <div className="p-3 bg-ceitnot-surface-2/80 rounded-xl mb-4">
                <p className="text-ceitnot-muted text-xs">Currently delegated to</p>
                <p className="text-ceitnot-ink font-mono text-sm mt-1">
                  {currentDelegate === address ? 'Yourself' : formatAddress(currentDelegate)}
                </p>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm text-ceitnot-muted mb-2">Delegate to address</label>
              <input
                type="text"
                value={delegateTo}
                onChange={e => setDelegateTo(e.target.value)}
                placeholder="0x..."
                className="input-field w-full"
                disabled={isPending}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => address && setDelegateTo(address)}
                className="btn-ghost text-sm flex-1 border border-ceitnot-border"
                disabled={isPending}
              >Self</button>
              <button
                onClick={handleDelegate}
                disabled={isPending || !delegateTo || !isAddress(delegateTo)}
                className="btn-primary text-sm flex-1 flex items-center justify-center gap-2"
              >
                {isPending && activeAction === 'delegate' && <Loader2 size={16} className="animate-spin" />}
                Delegate
              </button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-lg flex items-center gap-2 mb-4">
              <Vote size={18} className="text-ceitnot-gold" /> Production Governance Actions
            </h2>

            {!GOVERNOR || !hasGovConfig ? (
              <div className="text-sm text-ceitnot-muted">
                Set <code className="font-mono">VITE_GOVERNOR_ADDRESS</code> and at least one of{' '}
                <code className="font-mono">VITE_REGISTRY_ADDRESS</code> (market risk) or{' '}
                <code className="font-mono">VITE_AUSD_ADDRESS</code> (add PSM minter).
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-ceitnot-surface-2/80">
                    <p className="text-ceitnot-muted">Voting Delay</p>
                    <p className="font-mono mt-1 text-ceitnot-ink">{govVotingDelay.toString()}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-ceitnot-surface-2/80">
                    <p className="text-ceitnot-muted">Voting Period</p>
                    <p className="font-mono mt-1 text-ceitnot-ink">{govVotingPeriod.toString()}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-ceitnot-surface-2/80">
                    <p className="text-ceitnot-muted">Proposal Threshold</p>
                    <p className="font-mono mt-1 text-ceitnot-ink">{formatWad(govProposalThreshold, 2)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-ceitnot-surface-2/80">
                    <p className="text-ceitnot-muted">Quorum (current)</p>
                    <p className="font-mono mt-1 text-ceitnot-ink">{formatWad(govQuorumNow, 2)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setGovProposalKind('marketRisk')}
                    className={`btn-secondary text-xs ${govProposalKind === 'marketRisk' ? 'ring-1 ring-ceitnot-gold' : ''}`}
                    disabled={isPending || !registry}
                  >Market risk</button>
                  <button
                    type="button"
                    onClick={() => {
                      setGovProposalKind('addMarket');
                      setGovDescription('AIP: Add USDT market (registry addMarket)');
                    }}
                    className={`btn-secondary text-xs ${govProposalKind === 'addMarket' ? 'ring-1 ring-ceitnot-gold' : ''}`}
                    disabled={isPending || !registry}
                  >Add market</button>
                  <button
                    type="button"
                    onClick={() => setGovProposalKind('addPsmMinter')}
                    className={`btn-secondary text-xs ${govProposalKind === 'addPsmMinter' ? 'ring-1 ring-ceitnot-gold' : ''}`}
                    disabled={isPending || !AUSD}
                  >aUSD add PSM minter</button>
                </div>
                {!registry && (govProposalKind === 'marketRisk' || govProposalKind === 'addMarket') && (
                  <p className="text-xs text-ceitnot-danger">Registry address missing — switch template or set <code className="font-mono">VITE_REGISTRY_ADDRESS</code>.</p>
                )}
                {!AUSD && govProposalKind === 'addPsmMinter' && (
                  <p className="text-xs text-ceitnot-danger">Set <code className="font-mono">VITE_AUSD_ADDRESS</code> in <code className="font-mono">.env</code>.</p>
                )}
                {govProposalKind === 'addMarket' && registry && (
                  <p className="text-xs text-ceitnot-muted leading-relaxed">
                    Deploy <code className="font-mono">SimpleERC4626Vault</code> + <code className="font-mono">OracleRelay</code> first (e.g.{' '}
                    <code className="font-mono">script/DeployMarketVaultOracleArbitrum.s.sol</code> with USDT asset + USDT/USD Chainlink on Arbitrum), then paste{' '}
                    <span className="font-mono">VAULT</span> and <span className="font-mono">ORACLE</span> here. Timelock must be registry admin.
                  </p>
                )}

                <div className="space-y-2">
                  <p className="text-xs text-ceitnot-muted uppercase tracking-wider">
                    1) Create proposal ({govProposalKind === 'marketRisk' ? 'market risk' : govProposalKind === 'addMarket' ? 'registry addMarket' : 'aUSD addMinter'})
                  </p>
                  {govProposalKind === 'marketRisk' ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" value={marketId} onChange={e => setMarketId(e.target.value)} placeholder="marketId" className="input-field" disabled={isPending} />
                        <input type="number" value={newLtv} onChange={e => setNewLtv(e.target.value)} placeholder="LTV %" className="input-field" disabled={isPending} />
                        <input type="number" value={newLiqThreshold} onChange={e => setNewLiqThreshold(e.target.value)} placeholder="Liq threshold %" className="input-field" disabled={isPending} />
                      </div>
                      <input type="number" value={newLiqPenalty} onChange={e => setNewLiqPenalty(e.target.value)} placeholder="Liq penalty %" className="input-field w-full" disabled={isPending} />
                    </>
                  ) : govProposalKind === 'addMarket' ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-ceitnot-muted mb-1">ERC-4626 vault address</label>
                        <input
                          type="text"
                          value={addMarketVault}
                          onChange={e => setAddMarketVault(e.target.value)}
                          placeholder="0x… (vault shares = collateral)"
                          className="input-field w-full font-mono text-xs"
                          disabled={isPending}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-ceitnot-muted mb-1">Oracle address (e.g. OracleRelay)</label>
                        <input
                          type="text"
                          value={addMarketOracle}
                          onChange={e => setAddMarketOracle(e.target.value)}
                          placeholder="0x…"
                          className="input-field w-full font-mono text-xs"
                          disabled={isPending}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="text" value={addMarketLtv} onChange={e => setAddMarketLtv(e.target.value)} placeholder="LTV %" className="input-field" disabled={isPending} />
                        <input type="text" value={addMarketLiqTh} onChange={e => setAddMarketLiqTh(e.target.value)} placeholder="Liq thr %" className="input-field" disabled={isPending} />
                        <input type="text" value={addMarketLiqPen} onChange={e => setAddMarketLiqPen(e.target.value)} placeholder="Liq pen %" className="input-field" disabled={isPending} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" value={addMarketSupplyCap} onChange={e => setAddMarketSupplyCap(e.target.value)} placeholder="Supply cap (WAD, optional)" className="input-field font-mono text-xs" disabled={isPending} />
                        <input type="text" value={addMarketBorrowCap} onChange={e => setAddMarketBorrowCap(e.target.value)} placeholder="Borrow cap (WAD, optional)" className="input-field font-mono text-xs" disabled={isPending} />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-ceitnot-muted cursor-pointer">
                        <input type="checkbox" checked={addMarketIsolated} onChange={e => setAddMarketIsolated(e.target.checked)} disabled={isPending} />
                        Isolated market
                      </label>
                      {addMarketIsolated && (
                        <input type="text" value={addMarketIsoBorrowCap} onChange={e => setAddMarketIsoBorrowCap(e.target.value)} placeholder="Isolated borrow cap (WAD)" className="input-field w-full font-mono text-xs" disabled={isPending} />
                      )}
                      {addLtvBps !== undefined && addLiqBps !== undefined && addLiqBps < addLtvBps && (
                        <p className="text-xs text-ceitnot-danger">Liquidation threshold must be ≥ LTV (registry rule).</p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs text-ceitnot-muted mb-1">New PSM contract address</label>
                      <input
                        type="text"
                        value={newPsmMinterAddress}
                        onChange={e => setNewPsmMinterAddress(e.target.value)}
                        placeholder="0x330c36C9Fe280a7d9328165DB7ca78e59b119e12"
                        className="input-field w-full font-mono text-xs"
                        disabled={isPending}
                      />
                      <p className="text-xs text-ceitnot-muted mt-1">Calls <code className="font-mono">CeitnotUSD.addMinter(psm)</code> via Timelock after vote.</p>
                    </div>
                  )}
                  <input type="text" value={govDescription} onChange={e => setGovDescription(e.target.value)} placeholder="Proposal description" className="input-field w-full" disabled={isPending} />
                  <p className="text-xs text-ceitnot-muted">
                    After creating a proposal, keep the same template, fields, and description text for Queue / Execute.
                  </p>
                  <button onClick={handleProposeRiskUpdate} disabled={isPending || !govDescription.trim() || !canCreateGovProposal} className="btn-primary w-full flex items-center justify-center gap-2">
                    {isPending && activeAction === 'propose' && <Loader2 size={14} className="animate-spin" />}
                    Create Proposal
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-ceitnot-muted uppercase tracking-wider">2) Vote on proposalId</p>
                  <input type="text" value={proposalIdInput} onChange={e => setProposalIdInput(e.target.value)} placeholder="Proposal ID (uint256)" className="input-field w-full" disabled={isPending} />
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setVoteSupport('0')} className={`btn-secondary text-xs ${voteSupport === '0' ? 'ring-1 ring-ceitnot-gold' : ''}`} disabled={isPending}>Against</button>
                    <button onClick={() => setVoteSupport('1')} className={`btn-secondary text-xs ${voteSupport === '1' ? 'ring-1 ring-ceitnot-gold' : ''}`} disabled={isPending}>For</button>
                    <button onClick={() => setVoteSupport('2')} className={`btn-secondary text-xs ${voteSupport === '2' ? 'ring-1 ring-ceitnot-gold' : ''}`} disabled={isPending}>Abstain</button>
                  </div>
                  <button onClick={handleVote} disabled={isPending || proposalId === undefined} className="btn-primary w-full flex items-center justify-center gap-2">
                    {isPending && activeAction === 'vote' && <Loader2 size={14} className="animate-spin" />}
                    Cast Vote
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-ceitnot-muted uppercase tracking-wider">3) Queue and 4) Execute</p>
                  <button onClick={handleQueue} disabled={isPending || !govDescription.trim() || govCalldatas.length === 0} className="btn-secondary w-full flex items-center justify-center gap-2">
                    {isPending && activeAction === 'queue' && <Loader2 size={14} className="animate-spin" />}
                    Queue Proposal
                  </button>
                  <button onClick={handleExecute} disabled={isPending || !govDescription.trim() || govCalldatas.length === 0} className="btn-primary w-full flex items-center justify-center gap-2">
                    {isPending && activeAction === 'execute' && <Loader2 size={14} className="animate-spin" />}
                    Execute Proposal
                  </button>
                </div>

                {proposalId !== undefined && (
                  <div className="p-3 rounded-xl bg-ceitnot-surface-2/80 text-xs font-mono space-y-1 text-ceitnot-ink">
                    <p>
                      <span className="text-ceitnot-muted">State: </span>
                      <span className="text-ceitnot-gold font-semibold">{proposalStateLabel(proposalState)}</span>
                    </p>
                    {proposalSnapshot !== undefined && (
                      <p>
                        <span className="text-ceitnot-muted">Snapshot: </span>
                        {proposalSnapshot.toString()}
                      </p>
                    )}
                    {proposalDeadline !== undefined && (
                      <p>
                        <span className="text-ceitnot-muted">Deadline: </span>
                        {proposalDeadline.toString()}
                      </p>
                    )}
                    {hasVoted !== undefined && address && (
                      <p>
                        <span className="text-ceitnot-muted">Has voted ({formatAddress(address)}): </span>
                        {hasVoted ? 'yes' : 'no'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Investor-facing: admin is the Timelock contract, not an EOA */}
          {TIMELOCK && GOVERNOR && (
            <div className="mb-5 rounded-xl border border-ceitnot-gold/25 bg-ceitnot-gold/5 p-4 text-sm text-ceitnot-muted-2 leading-relaxed">
              <p className="text-xs font-semibold uppercase tracking-wider text-ceitnot-gold/90 mb-2">
                For investors: who &quot;owns&quot; the protocol
              </p>
              <p className="mb-2">
                Core administration (engine, market registry, PSM, aUSD, treasury) sits with the{' '}
                <span className="text-ceitnot-ink/90 font-medium">Timelock</span> smart contract, not a personal wallet (EOA).
                Parameter changes and privileged calls flow through the{' '}
                <span className="text-ceitnot-ink/90 font-medium">Governor</span>: propose → vote → queue on Timelock → delay → execute.
                You can verify the Timelock address and full transaction history in the block explorer.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                {blockExplorerAddressUrl(explorerChainId, TIMELOCK) && (
                  <a
                    href={blockExplorerAddressUrl(explorerChainId, TIMELOCK)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ceitnot-gold hover:underline"
                  >
                    Timelock on explorer
                    <ExternalLink size={12} className="opacity-80" aria-hidden />
                  </a>
                )}
                {blockExplorerAddressUrl(explorerChainId, GOVERNOR) && (
                  <a
                    href={blockExplorerAddressUrl(explorerChainId, GOVERNOR)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ceitnot-gold hover:underline"
                  >
                    Governor on explorer
                    <ExternalLink size={12} className="opacity-80" aria-hidden />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Contract info */}
          <div className="text-xs text-ceitnot-muted space-y-1">
            <p>
              <span className="text-ceitnot-muted-2 uppercase tracking-wider">CEITNOT Token:</span>{' '}
              <span className="font-mono">{formatAddress(GOV_TOKEN)}</span>
            </p>
            <p>
              <span className="text-ceitnot-muted-2 uppercase tracking-wider">veCEITNOT:</span>{' '}
              <span className="font-mono">{formatAddress(VE_TOKEN)}</span>
            </p>
            {GOVERNOR && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ceitnot-muted-2 uppercase tracking-wider">Governor:</span>{' '}
                <span className="font-mono">{formatAddress(GOVERNOR)}</span>
                {blockExplorerAddressUrl(explorerChainId, GOVERNOR) && (
                  <a
                    href={blockExplorerAddressUrl(explorerChainId, GOVERNOR)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-ceitnot-gold hover:underline shrink-0"
                    title="Open in block explorer"
                  >
                    <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </p>
            )}
            {TIMELOCK && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ceitnot-muted-2 uppercase tracking-wider">Timelock (on-chain admin):</span>{' '}
                <span className="font-mono">{formatAddress(TIMELOCK)}</span>
                {blockExplorerAddressUrl(explorerChainId, TIMELOCK) && (
                  <a
                    href={blockExplorerAddressUrl(explorerChainId, TIMELOCK)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-ceitnot-gold hover:underline shrink-0"
                    title="Open in block explorer"
                  >
                    <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </p>
            )}
            {(chainId === 31337 || chainId === 11155111 || chainId === 42161 || chainId === 421614) && (
              <p className="pt-2 text-ceitnot-gold/80">
                Testnet CEITNOT: on a full deploy, 10M tokens are minted to the deployer address (DeployFullSepolia /
                DeployFullArbitrumSepolia / DeployFullArbitrum or local stack).
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tx hash */}
      {hash && step !== 'success' && step !== 'error' && (
        <p className="text-xs text-ceitnot-muted mt-4 text-center font-mono">
          tx: {hash.slice(0, 10)}…{hash.slice(-8)}
        </p>
      )}
    </div>
  );
}

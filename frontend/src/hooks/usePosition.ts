import { useReadContract, useReadContracts } from 'wagmi';
import { useAccount } from 'wagmi';
import { auraEngineAbi } from '../abi/auraEngine';
import { useContractAddresses } from '../lib/contracts';

export type UserPosition = {
  marketId: number;
  debt:     bigint;
  shares:   bigint;
  value:    bigint;
};

export function usePosition() {
  const { address } = useAccount();
  const { engine }  = useContractAddresses();

  // Health factor (global across all markets)
  const { data: healthFactor, refetch: refetchHf } = useReadContract({
    address: engine,
    abi: auraEngineAbi,
    functionName: 'getHealthFactor',
    args: address ? [address] : undefined,
    query: { enabled: !!engine && !!address },
  });

  // Which markets does user have positions in?
  const { data: marketIdsBig, refetch: refetchMids } = useReadContract({
    address: engine,
    abi: auraEngineAbi,
    functionName: 'getUserMarkets',
    args: address ? [address] : undefined,
    query: { enabled: !!engine && !!address },
  });

  const marketIds = (marketIdsBig ?? []) as bigint[];

  // Batch: debt + shares + value for each market
  const { data: posData, refetch: refetchPos } = useReadContracts({
    contracts: marketIds.flatMap(mid => [
      { address: engine!, abi: auraEngineAbi, functionName: 'getPositionDebt'             as const, args: [address!, mid] as const },
      { address: engine!, abi: auraEngineAbi, functionName: 'getPositionCollateralShares' as const, args: [address!, mid] as const },
      { address: engine!, abi: auraEngineAbi, functionName: 'getPositionCollateralValue'  as const, args: [address!, mid] as const },
    ]),
    query: { enabled: !!engine && !!address && marketIds.length > 0 },
  });

  const positions: UserPosition[] = marketIds.map((mid, i) => ({
    marketId: Number(mid),
    debt:     (posData?.[i * 3]?.result     as bigint | undefined) ?? 0n,
    shares:   (posData?.[i * 3 + 1]?.result as bigint | undefined) ?? 0n,
    value:    (posData?.[i * 3 + 2]?.result as bigint | undefined) ?? 0n,
  }));

  const refetch = () => { refetchHf(); refetchMids(); refetchPos(); };

  return { positions, healthFactor, isLoading: !posData && marketIds.length > 0, refetch };
}

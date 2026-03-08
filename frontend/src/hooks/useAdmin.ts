import { useReadContracts } from 'wagmi';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { auraEngineAbi } from '../abi/auraEngine';
import { useContractAddresses, TARGET_CHAIN_ID } from '../lib/contracts';

export function useAdmin() {
  const { address }   = useAccount();
  const { engine }    = useContractAddresses();

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: engine!, abi: auraEngineAbi, functionName: 'admin'              as const, chainId: TARGET_CHAIN_ID },
      { address: engine!, abi: auraEngineAbi, functionName: 'paused'             as const, chainId: TARGET_CHAIN_ID },
      { address: engine!, abi: auraEngineAbi, functionName: 'emergencyShutdown'  as const, chainId: TARGET_CHAIN_ID },
      { address: engine!, abi: auraEngineAbi, functionName: 'debtToken'          as const, chainId: TARGET_CHAIN_ID },
      { address: engine!, abi: auraEngineAbi, functionName: 'marketRegistry'     as const, chainId: TARGET_CHAIN_ID },
    ],
    query: { enabled: !!engine },
  });

  const admin            = data?.[0]?.result as Address | undefined;
  const paused           = data?.[1]?.result as boolean | undefined;
  const emergencyShutdown= data?.[2]?.result as boolean | undefined;
  const debtToken        = data?.[3]?.result as Address | undefined;
  const marketRegistry   = data?.[4]?.result as Address | undefined;

  const isAdmin = !!address && !!admin &&
    address.toLowerCase() === admin.toLowerCase();

  return {
    admin, paused, emergencyShutdown, debtToken, marketRegistry,
    isAdmin, isLoading, refetch,
  };
}

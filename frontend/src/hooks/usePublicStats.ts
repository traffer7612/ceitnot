import { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiOrigin';

export type PublicStatsState = {
  uniqueUsers: number | null;
  loading: boolean;
};

/** Stats from `/api/stats/:chainId` (backend reads chain + optional user count). */
export function usePublicStats(chainId: number): PublicStatsState {
  const [uniqueUsers, setUniqueUsers] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiUrl(`/api/stats/${chainId}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('stats'))))
      .then((j: { uniqueUsers?: number | null }) => {
        if (cancelled) return;
        const u = j.uniqueUsers;
        setUniqueUsers(typeof u === 'number' && Number.isFinite(u) ? u : null);
      })
      .catch(() => {
        if (!cancelled) setUniqueUsers(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  return { uniqueUsers, loading };
}

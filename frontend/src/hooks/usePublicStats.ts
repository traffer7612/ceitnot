import { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiOrigin';
const PUBLIC_STATS_TIMEOUT_MS = 90_000;

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PUBLIC_STATS_TIMEOUT_MS);
    setLoading(true);
    fetch(apiUrl(`/api/stats/${chainId}`), { signal: controller.signal })
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
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [chainId]);

  return { uniqueUsers, loading };
}

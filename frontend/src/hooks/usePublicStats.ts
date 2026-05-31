import { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiOrigin';
const PUBLIC_STATS_TIMEOUT_MS = 90_000;
export type GalxeWalletSample = {
  address: string;
  username: string | null;
  rank: number | null;
  points: number | null;
};

export type GalxeStats = {
  configured: boolean;
  available: boolean;
  spaceId: number | null;
  spaceName: string | null;
  participantsCount: number | null;
  sampleUniqueWallets: number | null;
  samplePointsTotal: number | null;
  wallets: GalxeWalletSample[];
};

export type PublicStatsState = {
  uniqueUsers: number | null;
  galxe: GalxeStats | null;
  loading: boolean;
};
function asFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseGalxeWallet(raw: unknown): GalxeWalletSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const address = typeof row.address === 'string' ? row.address.trim() : '';
  if (!address || !address.startsWith('0x')) return null;
  const usernameRaw = row.username;
  return {
    address,
    username: typeof usernameRaw === 'string' && usernameRaw.trim() !== '' ? usernameRaw : null,
    rank: asFiniteNumber(row.rank),
    points: asFiniteNumber(row.points),
  };
}

function parseGalxeStats(raw: unknown): GalxeStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const walletsRaw = Array.isArray(obj.wallets) ? obj.wallets : [];
  const wallets = walletsRaw.map(parseGalxeWallet).filter((w): w is GalxeWalletSample => w !== null);
  return {
    configured: Boolean(obj.configured),
    available: Boolean(obj.available),
    spaceId: asFiniteNumber(obj.spaceId),
    spaceName: typeof obj.spaceName === 'string' && obj.spaceName.trim() !== '' ? obj.spaceName : null,
    participantsCount: asFiniteNumber(obj.participantsCount),
    sampleUniqueWallets: asFiniteNumber(obj.sampleUniqueWallets),
    samplePointsTotal: asFiniteNumber(obj.samplePointsTotal),
    wallets,
  };
}

/** Stats from `/api/stats/:chainId` (backend reads chain + optional user count). */
export function usePublicStats(chainId: number): PublicStatsState {
  const [uniqueUsers, setUniqueUsers] = useState<number | null>(null);
  const [galxe, setGalxe] = useState<GalxeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PUBLIC_STATS_TIMEOUT_MS);
    setLoading(true);
    fetch(apiUrl(`/api/stats/${chainId}`), { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('stats'))))
      .then((j: { uniqueUsers?: number | null; galxe?: unknown }) => {
        if (cancelled) return;
        const u = j.uniqueUsers;
        setUniqueUsers(typeof u === 'number' && Number.isFinite(u) ? u : null);
        setGalxe(parseGalxeStats(j.galxe));
      })
      .catch(() => {
        if (!cancelled) {
          setUniqueUsers(null);
          setGalxe(null);
        }
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
  return { uniqueUsers, galxe, loading };
}

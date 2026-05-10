/**
 * Optional public URL of the Express backend (no trailing slash).
 * - Dev: leave unset — Vite proxies `/api` to localhost.
 * - Vercel / static hosting: set `VITE_BACKEND_ORIGIN` to your deployed API origin so `/api/*` resolves correctly.
 */
export function backendOrigin(): string {
  const raw = import.meta.env.VITE_BACKEND_ORIGIN as string | undefined;
  return raw?.trim().replace(/\/$/, '') ?? '';
}

/** Absolute or same-origin path for API routes (e.g. `/api/stats/42161`). */
export function apiUrl(path: string): string {
  const base = backendOrigin();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

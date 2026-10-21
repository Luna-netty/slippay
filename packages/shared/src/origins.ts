/**
 * Canonical production origins allowed to access SlipPay API endpoints.
 */
export const PRODUCTION_ORIGINS = [
  "https://app.slippay.cc",
  "https://slippay.cc",
] as const;

/**
 * Local development origins for Vite dev server and automated tests.
 */
export const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

/**
 * Combined allowed origins list for CORS and origin gating.
 */
export const ALLOWED_ORIGINS = [
  ...PRODUCTION_ORIGINS,
  ...LOCAL_DEV_ORIGINS,
] as const;

/**
 * Fast lookup Set of all allowed origins.
 */
export const ALLOWED_ORIGINS_SET = new Set<string>(ALLOWED_ORIGINS);

/**
 * Strict regex matching allowed production origins and local dev origins.
 * Rejects any subdomains other than app., and rejects suffix lookalikes (e.g. slippay.cc.evil.tld).
 */
export const ALLOWED_ORIGINS_RE = /^https:\/\/(app\.)?slippay\.cc$|^http:\/\/(localhost|127\.0\.0\.1):5173$/;

/**
 * Validates whether a candidate origin string is an allowed origin.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS_RE.test(origin);
}

/**
 * Explicitly dev-only tunnel hosts for local development testing (mobile passkeys, webhooks).
 * These hosts are strictly excluded from production paths and only used in Vite dev server.
 */
export const DEV_TUNNEL_HOSTS = [
  ".loca.lt",
  ".ngrok-free.app",
  ".ngrok.app",
  ".trycloudflare.com",
] as const;

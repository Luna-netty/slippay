// Audit-004 · H1 — shared webhook URL validator. Enforces:
//   - https:// only
//   - hostname is not a literal private/reserved IP address
//   - no embedded credentials
//   - no non-standard ports (only 443 implicit, or :443 explicit)
//
// DNS-time / connect-time defense lives in the listener (audit-003 L1).
// This is a write-time defense so obviously bad URLs never land in the DB.

import { z } from "zod";

const PRIVATE_IPV4_RE = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,        // 100.64.0.0/10 CGNAT
  /^127\./,
  /^169\.254\./,                                       // link-local + IMDS
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.0\.\d/,                                       // 192.0.0/24 + TEST-NET-1
  /^192\.168\./,
  /^198\.(1[89])\./,                                   // 198.18/15 benchmarking
  /^198\.51\.100\./,                                   // TEST-NET-2
  /^203\.0\.113\./,                                    // TEST-NET-3
  /^22[4-9]\./, /^23\d\./,                            // 224.0.0/4 multicast
  /^2[4-9]\d\./, /^2[5-9]\d\./,                       // 240.0.0/4 reserved
  /^255\.255\.255\.255$/,
];

const PRIVATE_IPV6_PREFIXES = [
  "::", "::1",
  "fc", "fd",       // fc00::/7 ULA
  "fe80",           // link-local
  "ff",             // multicast
];

function hostnameIsPrivate(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost") return true;
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    return PRIVATE_IPV4_RE.some(re => re.test(lower));
  }
  // IPv6 literal (very permissive — match by prefix only)
  if (lower.includes(":")) {
    return PRIVATE_IPV6_PREFIXES.some(p => lower.startsWith(p + ":") || lower === p);
  }
  return false;
}

export const httpsWebhookUrl = z
  .string()
  .url()
  .refine((v) => {
    try {
      const u = new URL(v);
      if (u.protocol !== "https:") return false;
      if (u.username || u.password) return false;
      if (u.port && u.port !== "443") return false;
      if (hostnameIsPrivate(u.hostname)) return false;
      return true;
    } catch {
      return false;
    }
  }, "webhook_url must be https, public, no credentials, port 443");

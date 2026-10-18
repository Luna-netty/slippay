// Render-error reporting for the error boundaries (issue #333).
//
// When a payment route fails to render, the report has to be diagnosable
// (route + order reference) without leaking anything a session or payment
// depends on. Everything that leaves this module passes through
// sanitizeReportText, which redacts token-shaped values: JWTs, bearer
// headers, key=value pairs whose key names a credential or payment
// address, and on-chain addresses.

export type RenderErrorReport = {
  message: string;
  stack?: string;
  componentStack?: string;
  route?: string;
  orderRef?: string;
  boundary: string;
};

export type RenderErrorSink = (report: RenderErrorReport) => void;

const REDACTIONS: Array<[RegExp, string]> = [
  // JWTs (header.payload.signature), the shape every Supabase/session token has.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"],
  // Authorization: Bearer <token>
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  // key=value / key: value pairs whose key names a credential or a payment address.
  [
    /\b(token|access[_-]?token|refresh[_-]?token|id[_-]?token|session|session[_-]?token|api[_-]?key|apikey|secret|password|authorization|payment[_-]?address|destination|receiver|platform[_-]?address|private[_-]?key)\b(\s*[=:]\s*)("?)[^\s"&,;]+/gi,
    "$1$2$3[redacted]",
  ],
  // Stellar addresses (G + 56 base32 chars).
  [/\bG[A-Z2-7]{55}\b/g, "[redacted-address]"],
  // EVM addresses (payment/fee-collection destinations).
  [/\b0x[a-fA-F0-9]{40}\b/g, "[redacted-address]"],
];

export function sanitizeReportText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

let sink: RenderErrorSink = (report) => {
  console.error("[slippay] render error", report);
};

/** Replace the report destination (tests, future telemetry). */
export function setRenderErrorSink(next: RenderErrorSink): void {
  sink = next;
}

export function reportRenderError(input: {
  error: unknown;
  componentStack?: string | null;
  route?: string;
  orderRef?: string;
  boundary: string;
}): RenderErrorReport {
  const err = input.error instanceof Error ? input.error : new Error(String(input.error));
  const report: RenderErrorReport = {
    message: sanitizeReportText(err.message),
    boundary: input.boundary,
  };
  if (err.stack) report.stack = sanitizeReportText(err.stack);
  if (input.componentStack) report.componentStack = sanitizeReportText(input.componentStack);
  if (input.route) report.route = sanitizeReportText(input.route);
  if (input.orderRef) report.orderRef = sanitizeReportText(input.orderRef);
  sink(report);
  return report;
}

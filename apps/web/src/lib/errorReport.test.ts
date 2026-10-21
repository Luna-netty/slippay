import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeReportText,
  reportRenderError,
  setRenderErrorSink,
  type RenderErrorReport,
} from "./errorReport.ts";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmF6ZSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.abcdefghijklmnopqrstuvwxyz012345";
const STELLAR_ADDRESS = "GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P";
const EVM_ADDRESS = "0xE669C6Fe0493044D085C3cD08fb0289b53fA4449";

describe("sanitizeReportText", () => {
  it("redacts JWTs", () => {
    expect(sanitizeReportText(`session ${JWT} expired`)).not.toContain(JWT);
    expect(sanitizeReportText(`session ${JWT} expired`)).toContain("[redacted-jwt]");
  });

  it("redacts bearer authorization headers", () => {
    const out = sanitizeReportText("Authorization: Bearer abc123.def-456_ghi");
    expect(out).not.toContain("abc123.def-456_ghi");
    expect(out).toContain("[redacted]");
  });

  it("redacts credential-shaped key=value pairs", () => {
    for (const secret of ["sup3r-secret", "sess-999", "pk_live_abc"]) {
      const out = sanitizeReportText(`fetch failed token=${secret} session: ${secret}`);
      expect(out).not.toContain(secret);
    }
  });

  it("redacts payment addresses", () => {
    const out = sanitizeReportText(
      `receiver ${STELLAR_ADDRESS} fee ${EVM_ADDRESS} payment_address=${STELLAR_ADDRESS}`,
    );
    expect(out).not.toContain(STELLAR_ADDRESS);
    expect(out).not.toContain(EVM_ADDRESS);
    expect(out).toContain("[redacted-address]");
  });

  it("keeps ordinary diagnostics intact", () => {
    const msg = "Cannot read properties of undefined (reading 'amount') at Checkout";
    expect(sanitizeReportText(msg)).toBe(msg);
  });
});

describe("reportRenderError", () => {
  let reports: RenderErrorReport[];

  beforeEach(() => {
    reports = [];
    setRenderErrorSink((report) => reports.push(report));
  });

  it("includes route and order context, never the raw token", () => {
    reportRenderError({
      error: new Error(`render failed token=${JWT} address=${STELLAR_ADDRESS}`),
      componentStack: " at Checkout",
      route: "/checkout/ord_42",
      orderRef: "ord_42",
      boundary: "payment",
    });

    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.boundary).toBe("payment");
    expect(report.route).toBe("/checkout/ord_42");
    expect(report.orderRef).toBe("ord_42");
    expect(report.componentStack).toBe(" at Checkout");
    expect(report.message).not.toContain(JWT);
    expect(report.message).not.toContain(STELLAR_ADDRESS);
  });

  it("normalizes non-Error values", () => {
    reportRenderError({ error: "boom", boundary: "root" });
    expect(reports[0].message).toBe("boom");
    expect(reports[0].boundary).toBe("root");
  });
});
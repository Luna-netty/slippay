// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { PaymentRoute } from "./PaymentRoute.tsx";
import {
  setRenderErrorSink,
  type RenderErrorReport,
} from "../lib/errorReport.ts";

const SENSITIVE_ERROR =
  "checkout exploded session=super-secret-session token=pay-token-123 " +
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij " +
  "receiver GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P";

function Bomb({ message = SENSITIVE_ERROR }: { message?: string }): never {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  let reports: RenderErrorReport[];

  beforeEach(() => {
    reports = [];
    setRenderErrorSink((report) => reports.push(report));
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a fallback instead of a blank page when a child route throws", () => {
    render(
      <ErrorBoundary boundary="payment" route="/checkout/ord_1" supportRef="ord_1">
        <Bomb />
      </ErrorBoundary>,
    );

    const fallback = screen.getByRole("alert");
    expect(fallback.textContent).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByText("ord_1")).toBeTruthy();
    expect(document.body.textContent).not.toBe("");
  });

  it("offers a retry that recovers the subtree", () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient");
      return <p>payment screen</p>;
    }

    render(
      <ErrorBoundary boundary="payment">
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.queryByText("payment screen")).toBeNull();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("payment screen")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a sibling payment boundary mounted when a non-payment route fails", () => {
    function NonPayment({ explode }: { explode: boolean }) {
      if (explode) throw new Error("widget broke");
      return <p>landing widget</p>;
    }

    const tree = (explode: boolean) => (
      <div>
        <ErrorBoundary boundary="root" route="/">
          <NonPayment explode={explode} />
        </ErrorBoundary>
        <ErrorBoundary boundary="payment" route="/checkout/ord_9" supportRef="ord_9">
          <p>checkout screen</p>
        </ErrorBoundary>
      </div>
    );

    const { rerender } = render(tree(false));
    expect(screen.getByText("landing widget")).toBeTruthy();

    rerender(tree(true));

    expect(screen.queryByText("landing widget")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("checkout screen")).toBeTruthy();
  });

  it("does not expose session or payment tokens in the fallback or the report", () => {
    render(
      <ErrorBoundary boundary="payment" route="/checkout/ord_77" supportRef="ord_77">
        <Bomb />
      </ErrorBoundary>,
    );

    const fallbackText = document.body.textContent ?? "";
    expect(fallbackText).not.toContain("super-secret-session");
    expect(fallbackText).not.toContain("pay-token-123");
    expect(fallbackText).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(fallbackText).not.toContain("GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P");

    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.route).toBe("/checkout/ord_77");
    expect(report.orderRef).toBe("ord_77");
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("super-secret-session");
    expect(serialized).not.toContain("pay-token-123");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialized).not.toContain("GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P");
  });
});

describe("PaymentRoute", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reports the matched route and order id from the URL", () => {
    const reports: RenderErrorReport[] = [];
    setRenderErrorSink((report) => reports.push(report));

    render(
      <MemoryRouter initialEntries={["/checkout/ord_123"]}>
        <Routes>
          <Route
            path="/checkout/:order_id"
            element={
              <PaymentRoute>
                <Bomb message="render failed" />
              </PaymentRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("ord_123")).toBeTruthy();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.route).toBe("/checkout/ord_123");
    expect(reports[0]!.orderRef).toBe("ord_123");
    expect(reports[0]!.boundary).toBe("payment");
  });

  it("isolates a payment route failure behind the fallback", () => {
    const reports: RenderErrorReport[] = [];
    setRenderErrorSink((report) => reports.push(report));

    render(
      <MemoryRouter initialEntries={["/gate"]}>
        <Routes>
          <Route
            path="/gate"
            element={
              <PaymentRoute>
                <Bomb message="gate render error" />
              </PaymentRoute>
            }
          />
          <Route path="/" element={<p>home screen</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(reports[0]!.boundary).toBe("payment");
    expect(reports[0]!.orderRef).toBeUndefined();
  });
});
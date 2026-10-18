import { type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

// Route params that carry an order/subscription reference. The first one
// present on the matched route is surfaced in the fallback UI and the
// error report so a failed payment is diagnosable and support-actionable.
const ORDER_PARAM_KEYS = ["order_id", "id", "subId"] as const;

/**
 * Isolates a payment route: a render error inside shows the recoverable
 * fallback instead of blanking the whole app, and a failure elsewhere in
 * the tree never reaches across into it (issue #333).
 */
export function PaymentRoute({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const params = useParams();
  const supportRef = ORDER_PARAM_KEYS.map((key) => params[key]).find(Boolean);
  return (
    <ErrorBoundary boundary="payment" route={pathname} supportRef={supportRef}>
      {children}
    </ErrorBoundary>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportRenderError } from "../lib/errorReport.ts";
import { ErrorFallback } from "./ErrorFallback.tsx";

export type ErrorBoundaryFallbackProps = {
  error: Error;
  reset: () => void;
  supportRef?: string;
};

export type ErrorBoundaryProps = {
  children: ReactNode;
  /** Stable label for the report, e.g. "root" or "payment". */
  boundary: string;
  /** Route (pathname) shown in the report so failures are locatable. */
  route?: string;
  /** Order/subscription reference shown in the fallback and the report. */
  supportRef?: string;
  /** Optional hook invoked after the sanitized report is emitted. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Override the default recoverable fallback. */
  fallback?: (props: ErrorBoundaryFallbackProps) => ReactNode;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportRenderError({
      error,
      componentStack: info.componentStack,
      route: this.props.route,
      orderRef: this.props.supportRef,
      boundary: this.props.boundary,
    });
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback({
          error,
          reset: this.reset,
          supportRef: this.props.supportRef,
        });
      }
      return <ErrorFallback reset={this.reset} supportRef={this.props.supportRef} />;
    }
    return this.props.children;
  }
}

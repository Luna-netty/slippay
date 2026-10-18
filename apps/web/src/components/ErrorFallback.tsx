import { useState } from "react";

// Configurable so the maintainers can point at the real support inbox
// without a code change. When unset, the fallback still offers retry,
// a home link and the order reference to give support out-of-band.
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;

export function ErrorFallback({
  reset,
  supportRef,
}: {
  reset: () => void;
  supportRef?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyRef = async () => {
    if (!supportRef) return;
    try {
      await navigator.clipboard.writeText(supportRef);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the
      // reference stays visible on screen either way.
    }
  };

  const supportHref = SUPPORT_EMAIL
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        `SlipPay support — order ${supportRef ?? "unknown"}`,
      )}&body=${encodeURIComponent(
        `Order reference: ${supportRef ?? "unknown"}\n\nWhat happened:\n`,
      )}`
    : undefined;

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] items-center justify-center bg-[#0a0a0a] px-6"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111114] p-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.25em] text-[#FDDA24]">SlipPay</p>
        <h1 className="mt-4 text-xl font-semibold text-white">
          This page couldn&apos;t be displayed
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Something went wrong while loading this screen. Retrying usually fixes it.
          If you already completed a payment, keep the reference below and contact
          support — do not repeat the payment.
        </p>
        {supportRef ? (
          <p className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white/90">
            {supportRef}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-[#FDDA24] px-5 py-2.5 text-sm font-semibold text-[#0a0a0a] hover:opacity-90"
          >
            Try again
          </button>
          <div className="flex justify-center gap-4 text-sm">
            {supportRef ? (
              <button
                type="button"
                onClick={copyRef}
                className="text-white/60 underline underline-offset-4 hover:text-white"
              >
                {copied ? "Reference copied" : "Copy reference"}
              </button>
            ) : null}
            {supportHref ? (
              <a
                href={supportHref}
                className="text-white/60 underline underline-offset-4 hover:text-white"
              >
                Contact support
              </a>
            ) : null}
            <a
              href="/"
              className="text-white/60 underline underline-offset-4 hover:text-white"
            >
              Go home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

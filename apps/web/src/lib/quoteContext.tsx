import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { quoteBRLtoUSDC, type Quote } from "./quote.ts";

interface QuoteCtx {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<QuoteCtx>({ quote: null, loading: true, error: null });

// Page-level FX quote: fetch once, share across every consumer. On top of the
// promise dedup in quote.ts, this guarantees a page with several quote
// consumers performs one upstream fetch instead of one per component.
export function QuoteProvider({ brlIn, spreadBps, children }: {
  brlIn: number;
  spreadBps?: number;
  children: ReactNode;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setLoading(true);
    quoteBRLtoUSDC(brlIn, spreadBps)
      .then((q) => { if (on) { setQuote(q); setError(null); } })
      .catch((e: unknown) => { if (on) setError(e instanceof Error ? e.message : "Erro ao buscar cotacao."); })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [brlIn, spreadBps]);
  return <Ctx.Provider value={{ quote, loading, error }}>{children}</Ctx.Provider>;
}

export const useQuote = () => useContext(Ctx);

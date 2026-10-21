import { useEffect, useState } from "react";

// Landing locale. PT is PRIMARY — the audience is Brazilians who earn in
// dollars (freelancers, IT/dev exporters, creators, gig workers), they read
// Portuguese. We default to PT and only switch to EN when the browser is
// explicitly non-pt (the EN mirror is the secondary). Persisted in localStorage
// so a manual toggle sticks.
// The full contract (supported locales, detection/persistence rules, canonical
// routes) is documented in docs/product/locale-strategy.md.
export type Lang = "pt" | "en";

export const LANG_KEY = "slippay_lang";

export function isLang(v: unknown): v is Lang {
  return v === "pt" || v === "en";
}

export function detectLang(): Lang {
  if (typeof window === "undefined") return "pt";
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(LANG_KEY); } catch { /* storage blocked → browser rule */ }
  if (isLang(stored)) return stored;
  // Default to PT (primary audience). Only EN for an explicitly English browser.
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "pt";
}

// Persist the manual toggle. Unsupported values are never written and storage
// failures (private mode) are ignored — same contract as every other
// localStorage touch in this app.
export function persistLang(l: Lang): void {
  if (!isLang(l)) return;
  try { window.localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
}

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => detectLang());
  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  }, [lang]);
  const setLang = (l: Lang) => {
    persistLang(l);
    setLangState(l);
  };
  return [lang, setLang];
}

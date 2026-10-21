import { useState, useRef, useEffect, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Render Concierge's streamed markdown as sanitized HTML so **bold**, lists,
// code blocks, and `inline code` actually format properly in the widget.
marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "strong", "em", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "br", "a", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}

interface Citation {
  doc_path: string;
  doc_title: string;
  cited_text: string;
  start_char_index?: number;
  end_char_index?: number;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const ASK_URL = `${API_BASE.replace(/\/$/, "")}/v1/ask`;
const GITHUB_DOCS = "https://github.com/Galmanus/slippay/blob/main/docs";

const QUICK_PROMPTS: Array<{ tag: string; prompt: string }> = [
  { tag: "pricing",    prompt: "How much does it cost to use slippay?" },
  { tag: "economia",   prompt: "Quanto eu economizo vs Stripe e MoonPay?" },
  { tag: "começar",    prompt: "Como começo a receber em dólar?" },
  { tag: "minha loja", prompt: "Funciona na minha loja (WooCommerce, Shopify)?" },
  { tag: "segurança",  prompt: "É seguro e legal no Brasil?" },
  { tag: "a taxa",     prompt: "Qual é a taxa? Tem pegadinha?" },
];

// design tokens — on-brand slippay palette
const INK  = "#0a0a0a";
const YELLOW = "#FDDA24";

// glassmorphism — frosted bone glass for the full-width AI dock
const GLASS_BG     = "rgba(247,245,240,0.66)";
const GLASS_BORDER = "rgba(10,10,10,0.10)";
const GLASS_BLUR   = "blur(24px) saturate(180%)";
const glass = {
  background: GLASS_BG,
  backdropFilter: GLASS_BLUR,
  WebkitBackdropFilter: GLASS_BLUR,
} as const;

export function AskSlippay() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  // Lock the page scroll only while the conversation is expanded.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // esc collapses the expanded conversation back to the resting dock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ⌘K / ctrl+K → focus the dock + expand
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(async (qOverride?: string) => {
    const q = (qOverride ?? input).trim();
    if (!q || streaming) return;

    setError(null);
    setStreaming(true);
    setOpen(true);            // rise into the conversation view
    setInput("");

    const newTurns: Turn[] = [
      ...turns,
      { role: "user", content: q },
      { role: "assistant", content: "", citations: [] },
    ];
    setTurns(newTurns);

    const history = turns.map(t => ({ role: t.role, content: t.content }));

    try {
      const resp = await fetch(ASK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.detail ?? body.error ?? `HTTP ${resp.status}`);
        setStreaming(false);
        return;
      }
      if (!resp.body) { setError("No response body"); setStreaming(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const evt = JSON.parse(json);
            if (evt.type === "text") {
              setTurns(prev => {
                const last = prev[prev.length - 1];
                if (last?.role !== "assistant") return prev;
                return [...prev.slice(0, -1), { ...last, content: last.content + evt.text }];
              });
            } else if (evt.type === "citation") {
              setTurns(prev => {
                const last = prev[prev.length - 1];
                if (last?.role !== "assistant") return prev;
                return [...prev.slice(0, -1), { ...last, citations: [...(last.citations ?? []), evt.citation] }];
              });
            } else if (evt.type === "error") {
              setError(evt.error);
            }
          } catch { /* malformed */ }
        }
      }
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, turns]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // strip the markdown ## Sources footer from displayed body (cards show it)
  function parseInlineCitations(text: string): string {
    const sourcesIdx = text.search(/\n##\s+sources?/i);
    return sourcesIdx >= 0 ? text.slice(0, sourcesIdx).trimEnd() : text;
  }

  const hasConvo = turns.length > 0;

  return (
    <>
      {/* Backdrop — dims the page while the conversation is expanded */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ background: `${INK}33`, backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }}
        aria-hidden="true"
      />

      {/* === FULL-WIDTH GLASS AI DOCK — fixed to the bottom, always present === */}
      <section
        role="dialog"
        aria-label="Eve · IA do Slippay"
        className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 sm:px-4 pointer-events-none"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}
      >
        <div
          className="w-full max-w-2xl pointer-events-auto rounded-3xl overflow-hidden"
          style={{
            ...glass,
            border: `1px solid ${GLASS_BORDER}`,
            boxShadow: "0 16px 60px rgba(10,10,10,0.22)",
          }}
        >
          <div className="px-4 sm:px-5">

            {/* ---- expandable conversation area (rises above the bar) ---- */}
            <div
              className="overflow-hidden transition-[height] duration-300 ease-out"
              style={{ height: open ? "min(64vh, 560px)" : "0px" }}
            >
              {/* mini header inside the expanded view */}
              <div className="flex items-center justify-between pt-3 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: YELLOW, animation: "ask-pulse 1.6s ease-in-out infinite" }} />
                  <span
                    className="text-[13px] font-semibold tracking-tight"
                    style={{ color: INK, fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}
                  >
                    Eve · Slippay
                  </span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Minimizar"
                  className="w-7 h-7 flex items-center justify-center rounded-full transition-colors hover:bg-black/5"
                  style={{ color: `${INK}88` }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 6l5 5 5-5" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* messages */}
              <div
                ref={bodyRef}
                className="overflow-y-auto flex flex-col gap-3 pb-3"
                style={{ height: "calc(min(64vh, 560px) - 44px)" }}
              >
                {turns.map((t, i) => (
                  <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                    {t.role === "user" ? (
                      <div
                        className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-[13px] leading-relaxed"
                        style={{ background: INK, color: "#fff", fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}
                      >
                        {t.content}
                      </div>
                    ) : (
                      <div className="max-w-[90%] flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: YELLOW }} />
                          <div className="flex flex-col gap-1 flex-1">
                            {streaming && i === turns.length - 1 && !t.content ? (
                              <ThinkingIndicator />
                            ) : (
                              <>
                                <div
                                  className="ask-md text-[13px] leading-[1.65] px-3.5 py-2.5 rounded-2xl rounded-tl-sm"
                                  style={{
                                    background: "rgba(255,255,255,0.55)",
                                    fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                                    borderLeft: `2px solid ${YELLOW}`,
                                  }}
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(parseInlineCitations(t.content)) }}
                                />
                                {streaming && i === turns.length - 1 && (
                                  <span className="inline-block w-[2px] h-[14px] ml-3 align-middle animate-pulse" style={{ background: INK }} />
                                )}
                              </>
                            )}
                            {t.citations && t.citations.length > 0 && !streaming && (
                              <div className="mt-1 flex flex-col gap-1 pl-1">
                                {dedupeCitations(t.citations).slice(0, 5).map((c, j) => (
                                  <a
                                    key={j}
                                    href={`${GITHUB_DOCS}/${c.doc_path}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-[10px] hover:underline"
                                    style={{ color: `${INK}70`, fontFamily: "'Space Grotesk', monospace" }}
                                  >
                                    <span style={{ color: YELLOW }}>↗</span>
                                    <span className="truncate">{c.doc_path}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {error && (
                  <div
                    className="rounded-xl px-4 py-3 text-[12px]"
                    style={{ background: "rgba(254,242,242,0.8)", border: "1px solid #fca5a5", color: "#7f1d1d", fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}
                  >
                    Serviço temporariamente indisponível. Tente novamente em instantes.
                  </div>
                )}
              </div>
            </div>

            {/* ---- resting dock: greeting + chips (when idle) + input ---- */}
            <div className={open ? "pt-1 pb-3" : "pt-3 pb-3"}>
              {!open && !hasConvo && (
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: YELLOW, animation: "ask-pulse 1.6s ease-in-out infinite" }} />
                  <span
                    className="text-[13px] font-medium"
                    style={{ color: `${INK}CC`, fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}
                  >
                    Olá! Sou a Eve, a IA do Slippay. Você já conhece nossos serviços?
                  </span>
                </div>
              )}

              {!hasConvo && (
                <div className="flex gap-2 mb-2.5 overflow-x-auto eve-noscroll sm:flex-wrap">
                  {QUICK_PROMPTS.map(({ tag, prompt }) => (
                    <button
                      key={prompt}
                      onClick={() => submit(prompt)}
                      className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-150"
                      style={{
                        border: `1px solid ${INK}1F`,
                        background: "rgba(255,255,255,0.4)",
                        color: INK,
                        fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = YELLOW; e.currentTarget.style.borderColor = YELLOW; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.4)"; e.currentTarget.style.borderColor = `${INK}1F`; }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-end gap-2">
                <div
                  className="flex-1 flex items-end rounded-2xl px-3.5 py-2.5"
                  style={{ background: "rgba(255,255,255,0.6)", border: `1px solid ${INK}1A` }}
                >
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      const ta = e.target;
                      ta.style.height = "auto";
                      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={onKey}
                    onFocus={() => { if (hasConvo) setOpen(true); }}
                    disabled={streaming}
                    aria-label="Sua pergunta"
                    placeholder="Pergunte qualquer coisa sobre receber dólar no Pix…"
                    className="flex-1 bg-transparent text-[16px] sm:text-[14px] resize-none focus:outline-none disabled:opacity-50 placeholder:opacity-45"
                    style={{ fontFamily: "'Space Grotesk', 'Inter', sans-serif", minHeight: "24px", color: INK }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!input.trim() || streaming}
                  aria-label="Enviar pergunta"
                  className="shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
                  style={{ background: YELLOW, boxShadow: "0 2px 12px rgba(253,218,36,0.45)" }}
                >
                  {streaming ? (
                    <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: INK }} />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8h12M9 3l5 5-5 5" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </form>

              <div
                className="mt-1.5 text-[10px] text-center"
                style={{ fontFamily: "'Space Grotesk', monospace", color: `${INK}45` }}
              >
                ↵ enviar · ⇧↵ linha{open ? " · esc minimizar" : " · ⌘K abrir"}
              </div>
            </div>
          </div>
        </div>
        <style>{`
          @keyframes ask-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(0.55); opacity: 0.35; }
          }
          .eve-noscroll { scrollbar-width: none; -ms-overflow-style: none; }
          .eve-noscroll::-webkit-scrollbar { display: none; }
        `}</style>
      </section>
    </>
  );
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const c of citations) {
    if (!seen.has(c.doc_path)) seen.set(c.doc_path, c);
  }
  return Array.from(seen.values());
}

// "Thinking…" indicator shown while the Concierge spawn is initializing
// and before the first token streams. Rotates through status phrases.
function ThinkingIndicator() {
  const phrases = [
    "lendo a documentação",
    "buscando a resposta certa",
    "conferindo os detalhes",
    "montando a resposta",
  ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx(i => (i + 1) % phrases.length), 1400);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl rounded-tl-sm"
      style={{ background: "rgba(255,255,255,0.55)", borderLeft: `2px solid ${YELLOW}` }}
    >
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: YELLOW, animation: "ask-pulse 1.2s ease-in-out infinite" }} />
        <span className="w-1.5 h-1.5 rounded-full opacity-60" style={{ background: YELLOW, animation: "ask-pulse 1.2s ease-in-out infinite 0.2s" }} />
        <span className="w-1.5 h-1.5 rounded-full opacity-30" style={{ background: YELLOW, animation: "ask-pulse 1.2s ease-in-out infinite 0.4s" }} />
      </div>
      <span
        className="text-[11px] italic"
        style={{ color: `${INK}66`, fontFamily: "'Space Grotesk', 'Inter', sans-serif" }}
      >
        {phrases[idx]}…
      </span>
    </div>
  );
}

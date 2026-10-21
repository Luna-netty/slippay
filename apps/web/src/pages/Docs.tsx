// Slippay documentation · /docs and /docs/:slug
//
// Renders every markdown file under repo /docs as a single editorial site.
// Same Yeezy register as the landing: BONE/INK + KLEIN punctum, monumental
// type, monospace eyebrows, scroll-driven reveals, sticky sidebar.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Logo } from "../components/Logo.tsx";
import { Reveal } from "../components/Reveal.tsx";
import {
  DOCS, CATEGORY_LABELS, getDoc, getDocsByCategory,
} from "../lib/docs-manifest.ts";

marked.setOptions({ gfm: true, breaks: false });

// Resolve a markdown-relative href against a doc slug into an in-app /docs path,
// an external URL, or a github source link. Returns null if it should be left as-is.
function resolveDocHref(href: string, fromSlug: string): string | null {
  if (!href) return null;
  // Absolute external links, anchors, mailto — leave alone
  if (/^([a-z]+:|\/\/|#|mailto:)/i.test(href)) return null;

  // Strip query/hash for resolution, reattach later
  const hashIdx = href.search(/[#?]/);
  const tail = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const path = hashIdx >= 0 ? href.slice(0, hashIdx) : href;

  // Resolve relative path against /docs/<fromSlug>
  // fromSlug like "README" or "concepts/architecture"
  const baseDir = fromSlug.includes("/") ? fromSlug.replace(/\/[^/]*$/, "") : "";
  const baseParts = baseDir ? baseDir.split("/") : [];
  const pathParts = path.split("/");
  const stack: string[] = [...baseParts];
  for (const p of pathParts) {
    if (p === "" || p === ".") continue;
    if (p === "..") { stack.pop(); continue; }
    stack.push(p);
  }
  const resolved = stack.join("/");

  // If it's a .md file inside the docs tree → /docs/<slug>
  if (/\.md$/i.test(resolved)) {
    const slug = resolved.replace(/\.md$/i, "");
    if (slug === "README" || slug === "") return "/docs";
    // Verify it exists in manifest; if not, fall back to github source
    if (DOCS.find(d => d.slug === slug)) return `/docs/${slug}${tail}`;
    return `https://github.com/Galmanus/slippay/blob/main/docs/${slug}.md${tail}`;
  }

  // Path that escapes docs/ (e.g., "../../contracts/...") → github source
  if (path.startsWith("../") || resolved.startsWith("..")) {
    const cleaned = resolved.replace(/^\.\.\//, "");
    return `https://github.com/Galmanus/slippay/blob/main/${cleaned}${tail}`;
  }

  // Directory link → github tree
  return `https://github.com/Galmanus/slippay/tree/main/docs/${resolved}${tail}`;
}

function rewriteHrefs(html: string, fromSlug: string): string {
  return html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi, (m, pre, href, post) => {
    const resolved = resolveDocHref(href, fromSlug);
    if (!resolved) return m;
    const isExternal = /^https?:\/\//i.test(resolved);
    const extra = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a ${pre}href="${resolved}"${post}${extra}>`;
  });
}

function renderMd(src: string, fromSlug: string): string {
  // Strip the leading H1 — Docs page already renders the title separately.
  const stripped = src.replace(/^#\s+.+\n+/, "");
  const rawHtml = marked.parse(stripped, { async: false }) as string;
  const rewritten = rewriteHrefs(rawHtml, fromSlug);
  return DOMPurify.sanitize(rewritten, {
    ALLOWED_TAGS: ["p","strong","em","code","pre","ul","ol","li","h1","h2","h3","h4","h5","blockquote","br","a","hr","table","thead","tbody","tr","th","td","img","del","sup","sub","span"],
    ALLOWED_ATTR: ["href","target","rel","alt","src","title","id","class"],
  });
}

function useScrolled(threshold = 80) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

export default function Docs() {
  const location = useLocation();
  const nav = useNavigate();
  const scrolled = useScrolled(80);
  const groups = useMemo(() => getDocsByCategory(), []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Auto-close on slug change
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Parse slug from /docs/<everything-after>; tolerate trailing .md from
  // markdown-relative links and decode percent-encoded chars.
  const pathSlug = decodeURIComponent(location.pathname)
    .replace(/^\/docs\/?/, "")
    .replace(/\/$/, "")
    .replace(/\.md$/i, "");
  const slug = pathSlug || (DOCS.find(d => d.filename === "README")?.slug ?? DOCS[0]?.slug ?? "");
  const doc = getDoc(slug);

  // Search · simple fuzzy includes match against title + filename + content
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return DOCS.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.filename.toLowerCase().includes(q) ||
      d.content.toLowerCase().includes(q),
    ).slice(0, 20);
  }, [query]);

  // Scroll to top on slug change
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [slug]);

  const html = useMemo(() => (doc ? renderMd(doc.content, doc.slug) : ""), [doc]);

  // Build TOC from rendered H2s
  const tocRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; text: string }>>([]);
  useEffect(() => {
    if (!tocRef.current) return;
    const headings = Array.from(tocRef.current.querySelectorAll("h2")) as HTMLHeadingElement[];
    const next = headings.map((h, i) => {
      const text = h.textContent ?? "";
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `section-${i}`;
      h.id = id;
      return { id, text };
    });
    setToc(next);
  }, [html]);

  // Previous / next nav across the flat ordered list
  const flatIndex = DOCS.findIndex(d => d.slug === slug);
  const prevDoc = flatIndex > 0 ? DOCS[flatIndex - 1] : undefined;
  const nextDoc = flatIndex >= 0 && flatIndex < DOCS.length - 1 ? DOCS[flatIndex + 1] : undefined;

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain">
      {/* Fixed nav, same pattern as landing */}
      <header
        className={
          "fixed top-0 left-0 right-0 z-30 transition-colors duration-300 " +
          (scrolled ? "bg-[#f1eee7]/85 backdrop-blur-md border-b border-[#0a0a0a]/8" : "bg-[#f1eee7]")
        }
      >
        <div className="max-w-[1600px] mx-auto px-5 md:px-10 py-5 md:py-6 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-7 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]">
            <Link to="/" className="hover:opacity-60 hidden md:inline">Home</Link>
            <Link to="/x402-demo" className="hover:opacity-60 hidden md:inline">x402 demo</Link>
            <a href="https://galmanus.github.io/ssl-spec/" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 hidden md:inline">SSL Spec ↗</a>
            <Link to="/login" className="hover:opacity-60">Log in</Link>
          </nav>
        </div>
      </header>

      {/* Mobile · "Browse docs" toggle button (visible only on mobile, below nav) */}
      <div className="md:hidden fixed top-[60px] left-0 right-0 z-20 bg-[#f1eee7]/85 backdrop-blur-md border-b border-[#0a0a0a]/10">
        <button
          onClick={() => setSidebarOpen(v => !v)}
          className="w-full px-5 py-3 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] font-mono"
        >
          <span>┃ {sidebarOpen ? "Hide" : "Browse"} docs</span>
          <span className={"transition-transform " + (sidebarOpen ? "rotate-180" : "")}>▾</span>
        </button>
      </div>

      <div className="max-w-[1600px] mx-auto px-5 md:px-10 pt-[110px] md:pt-40 pb-24 grid grid-cols-12 gap-6 md:gap-10">
        {/* Sidebar · sticky on desktop, drawer on mobile */}
        <aside className={
          (sidebarOpen ? "block " : "hidden ") +
          "md:block col-span-12 md:col-span-3 md:sticky md:top-32 md:self-start md:max-h-[calc(100vh-9rem)] md:overflow-y-auto pr-2 mb-8 md:mb-0"
        }>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6">
            ┃ Documentation
          </div>
          <div className="mb-8">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search docs…"
              className="w-full bg-transparent border-b border-[#0a0a0a]/25 py-2 text-sm focus:outline-none focus:border-[#0a0a0a] tracking-tight"
            />
          </div>

          {filtered ? (
            <ul className="space-y-1">
              {filtered.length === 0 && (
                <li className="text-xs text-[#0a0a0a]/55">No matches.</li>
              )}
              {filtered.map(d => (
                <li key={d.slug}>
                  <Link
                    to={`/docs/${d.slug}`}
                    onClick={() => setQuery("")}
                    className={
                      "block py-1.5 text-sm tracking-tight " +
                      (d.slug === slug
                        ? "text-[#0a0a0a] border-l-2 border-[#FDDA24] pl-3"
                        : "text-[#0a0a0a]/65 hover:text-[#0a0a0a] pl-3")
                    }
                  >
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-8">
              {groups.map(({ category, entries }) => (
                <div key={category}>
                  <div className="flex items-baseline gap-2 mb-3 font-mono text-[9px] uppercase tracking-[0.28em] text-[#0a0a0a]/55">
                    <span className="tabular-nums opacity-60">{CATEGORY_LABELS[category].eyebrow}</span>
                    <span>{CATEGORY_LABELS[category].label}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {entries.map(d => (
                      <li key={d.slug}>
                        <Link
                          to={`/docs/${d.slug}`}
                          className={
                            "block py-1.5 text-sm leading-snug tracking-tight transition-colors " +
                            (d.slug === slug
                              ? "text-[#0a0a0a] border-l-2 border-[#FDDA24] pl-3 font-medium"
                              : "text-[#0a0a0a]/65 hover:text-[#0a0a0a] pl-3 border-l-2 border-transparent")
                          }
                        >
                          {d.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Content */}
        <main className="col-span-12 md:col-span-7" ref={tocRef}>
          {!doc && (
            <Reveal className="font-mono text-sm text-[#0a0a0a]/55">
              <p>Document not found: <code>{slug}</code></p>
              <button onClick={() => nav("/docs")} className="mt-4 underline">Back to overview →</button>
            </Reveal>
          )}
          {doc && (
            <>
              <Reveal>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6 tabular-nums">
                  {CATEGORY_LABELS[doc.category].eyebrow}.{(doc.order || 0).toString().padStart(2, "0")} · {CATEGORY_LABELS[doc.category].label}
                </div>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="text-[8vw] md:text-[3.6vw] font-medium leading-[1.02] tracking-[-0.035em] max-w-[26ch]">
                  {doc.title}
                  <span className="inline-block align-baseline ml-2 w-2 md:w-2.5 h-2 md:h-2.5 bg-[#FDDA24]" />
                </h1>
              </Reveal>
              <Reveal delay={140}>
                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">
                  docs/{doc.slug}.md
                </div>
              </Reveal>

              <Reveal delay={200} className="docs-md mt-12">
                <div
                  dangerouslySetInnerHTML={{ __html: html }}
                  onClick={(e) => {
                    const target = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
                    if (!target) return;
                    const href = target.getAttribute("href") ?? "";
                    // Intercept only same-origin /docs internal links for SPA nav
                    if (href.startsWith("/docs") && !target.target) {
                      e.preventDefault();
                      nav(href);
                    }
                  }}
                />
              </Reveal>

              {/* Prev / next pager */}
              <div className="mt-24 pt-10 border-t border-[#0a0a0a]/15 grid grid-cols-2 gap-6">
                <div>
                  {prevDoc && (
                    <Link to={`/docs/${prevDoc.slug}`} className="block group">
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-2">← Previous</div>
                      <div className="text-lg md:text-xl tracking-tight font-medium group-hover:text-[#0a0a0a]/70">{prevDoc.title}</div>
                    </Link>
                  )}
                </div>
                <div className="text-right">
                  {nextDoc && (
                    <Link to={`/docs/${nextDoc.slug}`} className="block group">
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-2">Next →</div>
                      <div className="text-lg md:text-xl tracking-tight font-medium group-hover:text-[#0a0a0a]/70">{nextDoc.title}</div>
                    </Link>
                  )}
                </div>
              </div>
            </>
          )}
        </main>

        {/* TOC · right rail · desktop only */}
        <aside className="hidden md:block md:col-span-2 md:sticky md:top-32 md:self-start md:max-h-[calc(100vh-9rem)] md:overflow-y-auto">
          {toc.length > 0 && (
            <>
              <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#0a0a0a]/45 mb-4">
                ┃ On this page
              </div>
              <ul className="space-y-1.5">
                {toc.map(item => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block text-xs leading-snug tracking-tight text-[#0a0a0a]/60 hover:text-[#0a0a0a]"
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      <footer className="border-t border-[#0a0a0a]/15 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1600px] mx-auto px-5 md:px-10 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[10px] uppercase tracking-[0.22em] font-mono">
          <div>SLIPPAY · documentation · live on Stellar PUBLIC</div>
          <a href="https://galmanus.github.io/ssl-spec/" target="_blank" rel="noopener noreferrer" className="text-[#FDDA24] hover:opacity-80">
            SSL Spec ↗
          </a>
        </div>
      </footer>
    </div>
  );
}

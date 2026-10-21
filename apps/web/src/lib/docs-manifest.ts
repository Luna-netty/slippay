// Docs manifest · imports the PUBLIC subset of the repo's /docs directory
// at build time via Vite's `?raw` glob. The /docs route uses this to render
// the public documentation set without server-side fetch.
//
// Categories follow the editorial flow: orient → integrate → understand →
// trust → operate. Each doc is one slug.
//
// SECURITY (audit M1/L2): this glob is FAIL-CLOSED — an explicit allowlist of
// ONLY public dirs/files, never a broad `docs/**`. Internal docs MUST NOT be
// bundled into the browser-served JS: `docs/security/**` (audit reports = attack
// map; key-custody.md held a seed phrase), `docs/ops/**`, `docs/deploy-secrets.md`,
// `docs/research/**`, `docs/outreach/**`, `docs/scf/**`, `docs/superpowers/**`,
// `docs/product/**`, and the operational root md (axl.md, *-x402.md, SUMMARY.md,
// MERCHANT_ONBOARDING.md) are all intentionally excluded by omission below.
//
// To add a public doc: add its path/dir to the literal array below. To verify
// nothing internal leaked after a build:
//   grep -rl 'audit-00\|key-custody\|deploy-secrets\|BEGIN .* PRIVATE' apps/web/dist/assets/*.js
//   (expect NO matches)
//
// NOTE: Vite's `import.meta.glob` requires the patterns to be an INLINE LITERAL
// (it static-analyzes them at build time) — a variable fails with
// "Could only use literals". So the allowlist is written inline here.
const raw = import.meta.glob([
  // root-level public entry docs (explicit files, not a wildcard)
  "../../../../docs/README.md",
  "../../../../docs/quickstart.md",
  "../../../../docs/mainnet-readiness.md",
  "../../../../docs/fees.md",
  // public directories
  "../../../../docs/api-reference/*.md",
  "../../../../docs/concepts/*.md",
  "../../../../docs/guides/*.md",
  "../../../../docs/integrations/*.md",
  "../../../../docs/business/*.md",
], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface DocEntry {
  slug: string;          // url path, e.g. "concepts/architecture"
  title: string;         // pulled from first H1 in the markdown
  category: DocCategory;
  filename: string;      // basename without extension
  content: string;       // raw markdown
  order: number;         // sort order within category
}

export type DocCategory =
  | "orient"
  | "integrate"
  | "concepts"
  | "guides"
  | "integrations"
  | "business"
  | "other";

// Slug-prefix → category, with explicit display order inside.
// Anything that doesn't match falls into "other" at the end.
const CATEGORY_RULES: Array<{ test: RegExp; category: DocCategory; order: number; title?: string }> = [
  { test: /^README$/,                      category: "orient",       order: 0,  title: "Overview" },
  { test: /^quickstart$/,                  category: "orient",       order: 1,  title: "Quickstart" },
  { test: /^mainnet-readiness$/,           category: "orient",       order: 2 },
  // NOTE: deploy-secrets is intentionally NOT bundled (internal/operational);
  // its allowlist entry was removed from PUBLIC_DOC_GLOBS above.

  { test: /^api-reference\/authentication$/, category: "integrate",  order: 0 },
  { test: /^api-reference\/merchants$/,    category: "integrate",    order: 1 },
  { test: /^api-reference\/orders$/,       category: "integrate",    order: 2 },
  { test: /^api-reference\/subscriptions$/, category: "integrate",   order: 3 },
  { test: /^api-reference\/webhooks$/,     category: "integrate",    order: 4 },
  { test: /^api-reference\/errors$/,       category: "integrate",    order: 5 },

  { test: /^concepts\/architecture$/,      category: "concepts",     order: 0 },
  { test: /^concepts\/non-custodial-settlement$/, category: "concepts", order: 1 },
  { test: /^fees$/,                        category: "concepts",     order: 2,  title: "Fee Arithmetic" },
  { test: /^concepts\/regulatory$/,        category: "concepts",     order: 3 },

  { test: /^guides\/drop-in-sdk$/,         category: "guides",       order: 0 },
  { test: /^guides\/recurring-billing$/,   category: "guides",       order: 1 },
  { test: /^guides\/woocommerce$/,         category: "guides",       order: 2 },
  { test: /^guides\/webhooks-handler$/,    category: "guides",       order: 3 },
  { test: /^guides\/br-export-merchants$/, category: "guides",       order: 4 },

  { test: /^integrations\//,               category: "integrations", order: 0 },
  // NOTE: security/* and ops/* rules removed. Those docs (audit reports,
  // key-custody, mainnet-runbook) are internal and intentionally NOT bundled —
  // see PUBLIC_DOC_GLOBS. Keeping rules here would imply they still render.
  { test: /^business\//,                   category: "business",     order: 0 },
];

function deriveTitleFromMarkdown(md: string, fallback: string): string {
  const lines = md.split("\n");
  for (const line of lines.slice(0, 20)) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1]!.trim();
  }
  return fallback;
}

function prettyFromFilename(filename: string): string {
  return filename
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

export const DOCS: DocEntry[] = Object.entries(raw).map(([path, content]) => {
  // path looks like "../../../../docs/concepts/architecture.md"
  const slugWithExt = path.replace(/^.*\/docs\//, "");
  const slug = slugWithExt.replace(/\.md$/, "");
  const filename = slug.split("/").pop()!;
  const pretty = prettyFromFilename(filename);
  const title = deriveTitleFromMarkdown(content, pretty);

  let category: DocCategory = "other";
  let order = 99;
  let titleOverride: string | undefined;
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(slug)) {
      category = rule.category;
      order = rule.order;
      titleOverride = rule.title;
      break;
    }
  }
  return { slug, title: titleOverride ?? title, category, filename, content, order };
}).sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order || a.slug.localeCompare(b.slug));

export const CATEGORY_LABELS: Record<DocCategory, { label: string; eyebrow: string }> = {
  orient:       { label: "Orient",       eyebrow: "001" },
  integrate:    { label: "API",          eyebrow: "002" },
  concepts:     { label: "Concepts",     eyebrow: "003" },
  guides:       { label: "Guides",       eyebrow: "004" },
  integrations: { label: "Integrations", eyebrow: "005" },
  business:     { label: "Business",     eyebrow: "006" },
  other:        { label: "Other",        eyebrow: "999" },
};

export const CATEGORY_ORDER: DocCategory[] = [
  "orient", "integrate", "concepts", "guides", "integrations", "business", "other",
];

export function getDoc(slug: string): DocEntry | undefined {
  return DOCS.find(d => d.slug === slug);
}

export function getDocsByCategory(): Array<{ category: DocCategory; entries: DocEntry[] }> {
  return CATEGORY_ORDER
    .map(c => ({ category: c, entries: DOCS.filter(d => d.category === c) }))
    .filter(g => g.entries.length > 0);
}

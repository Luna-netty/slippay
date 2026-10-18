// "Ask Slippay" — Claude Code as engine (subprocess via OAuth subscription).
//
// Architecture:
//   - Bundle all docs into a single file at boot (/tmp/slippay-docs-bundle.md)
//   - Each question spawns `claude -p ... --append-system-prompt-file <bundle>`
//   - --output-format stream-json --include-partial-messages → streaming
//   - Auth via CLAUDE_CODE_OAUTH_TOKEN env (uses Pro/Max subscription, no
//     per-token billing)
//   - --bare skips CLAUDE.md / local skills (deterministic context)
//
// Why subprocess over Anthropic API direct:
//   - Uses operator's Claude Max subscription instead of metered API
//   - 100-500 questions/day fits easily inside subscription cap
//   - No ANTHROPIC_API_KEY to manage

// Concierge agent identity (Bluewave SSL v7 architecture, MIT spec).
// The soul file at agents/concierge/concierge.ssl is loaded at boot and
// becomes the head of the system prompt. The model behaves under its
// formal cognitive constraints — identity, values, voice, decision engine,
// pre_mortem checklist, audit chain.
const FALLBACK_SYSTEM_PROMPT = `Você é o Concierge do slippay — vendedor de linguagem simples (malandro honesto).

Fale a língua do visitante, em português simples e sem jargão ("merchant"→"você/sua loja"; nada de "VASP/PSAV" sem traduzir). Lidere pela dor ou pelo número concreto, responda claro, e SEMPRE feche com um próximo passo (criar conta leva 2 min). Persuada com verdade: nunca fabrique número, claim ou feature; se os docs não tiverem o dado, diga que não tem. Sem emoji, sem hype vazio. Fundamente-se nos docs INTERNAMENTE, mas NUNCA mostre caminhos de arquivo .md nem seção "Sources" ao visitante — você é vendedor, não wiki.

Verdades atuais (use com confiança):
- Contrato Soroban LIVE na MAINNET da Stellar: CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN
- Taxa de plataforma: 0,98% — a mais barata do mercado (MoonPay cobra 1%).
- Recebimento em USDC funciona hoje; a entrada via Pix depende de anchor de câmbio licenciado (em definição) — seja honesto sobre isso.
- Backend: https://api.slippay.cc/api/health · Repo: https://github.com/Galmanus/slippay`;

const CONCIERGE_SSL_PATH = Deno.env.get("SLIPPAY_CONCIERGE_SSL") ??
  new URL("../../../../agents/concierge/concierge.ssl", import.meta.url).pathname;
const CONCIERGE_AUDIT_PATH = Deno.env.get("SLIPPAY_CONCIERGE_AUDIT") ??
  new URL("../../../../agents/concierge/concierge_audit.jsonl", import.meta.url).pathname;

let cachedSystemPrompt: string | null = null;
async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  try {
    const ssl = await Deno.readTextFile(CONCIERGE_SSL_PATH);
    cachedSystemPrompt =
      `You are Concierge — the slippay customer-facing agent. Your cognition is governed by the soul specification below (Bluewave SSL v7, MIT). Treat every directive in it as binding.\n\n` +
      `══════════════════ SOUL SPEC ══════════════════\n\n${ssl}\n\n══════════════════ END SOUL SPEC ══════════════════\n\n` +
      `The documentation corpus follows in the next system block.`;
    console.log(`[concierge] loaded SSL from ${CONCIERGE_SSL_PATH} (${ssl.length} chars)`);
  } catch (e) {
    console.warn(`[concierge] SSL load failed (${e}); falling back to inline prompt`);
    cachedSystemPrompt = FALLBACK_SYSTEM_PROMPT;
  }
  return cachedSystemPrompt;
}

async function auditFleetRun(record: Record<string, unknown>): Promise<void> {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n";
    await Deno.writeTextFile(CONCIERGE_AUDIT_PATH, line, { append: true });
  } catch (e) {
    console.warn(`[concierge] audit write failed: ${e}`);
  }
}

const DOC_FILES = [
  "README.md",
  "quickstart.md",
  "concepts/architecture.md",
  "concepts/non-custodial-settlement.md",
  "concepts/regulatory.md",
  "api-reference/authentication.md",
  "api-reference/merchants.md",
  "api-reference/orders.md",
  "api-reference/subscriptions.md",
  "api-reference/webhooks.md",
  "api-reference/errors.md",
  "guides/drop-in-sdk.md",
  "guides/recurring-billing.md",
  "guides/woocommerce.md",
  "guides/platforms.md",
  "guides/webhooks-handler.md",
  "guides/br-export-merchants.md",
];

const DOCS_ROOT = Deno.env.get("SLIPPAY_DOCS_ROOT") ??
  new URL("../../../../docs/", import.meta.url).pathname;
const DOCS_BUNDLE = Deno.env.get("SLIPPAY_DOCS_BUNDLE") ?? "/tmp/slippay-docs-bundle.md";
const CLAUDE_BIN = Deno.env.get("CLAUDE_BIN") ?? "claude";
const CLAUDE_CWD = Deno.env.get("CLAUDE_CWD") ?? "/tmp";

let bundlePromise: Promise<string> | null = null;

async function ensureDocsBundle(): Promise<string> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    let bundled = "# SlipPay Documentation\n\n" +
      "The following files compose the slippay documentation set. " +
      "When citing, reference them by their relative path (e.g. " +
      "`docs/api-reference/orders.md`).\n\n---\n";
    for (const rel of DOC_FILES) {
      try {
        const full = `${DOCS_ROOT}${rel}`;
        const content = await Deno.readTextFile(full);
        bundled += `\n\n## docs/${rel}\n\n${content}\n\n---\n`;
      } catch (e) {
        console.warn(`[ask] doc bundle skip ${rel}:`, String(e));
      }
    }
    await Deno.writeTextFile(DOCS_BUNDLE, bundled);
    console.log(`[ask] docs bundle ready at ${DOCS_BUNDLE} (${bundled.length} chars)`);
    return DOCS_BUNDLE;
  })();
  return bundlePromise;
}

export interface AskRequest {
  question: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

// Audit-005 · M2 — hard caps on what we forward to the subprocess. The route
// already validates `question` ≤ 4000 chars, but `lib/ask.ts` is the last line
// of defense and is also reachable from other callers, so re-validate here and
// bound the total forwarded prompt (question + history) explicitly. Oversized
// input is rejected before spawning, never silently truncated into the CLI.
const MAX_QUESTION_CHARS = 4000;
const MAX_HISTORY_TURN_CHARS = 4000;
const MAX_USER_INPUT_CHARS = 24_000; // question + up to 10 history turns

export async function askSlippayStream(req: AskRequest): Promise<ReadableStream<Uint8Array>> {
  const token = Deno.env.get("CLAUDE_CODE_OAUTH_TOKEN");
  if (!token) throw new Error("CLAUDE_CODE_OAUTH_TOKEN not set");

  // Validate/cap the forwarded input BEFORE doing any work or spawning.
  const question = (req.question ?? "").toString();
  if (!question.trim() || question.length > MAX_QUESTION_CHARS) {
    throw new Error(`invalid question length: expected 1-${MAX_QUESTION_CHARS} chars`);
  }

  const t0 = Date.now();
  const systemPrompt = await loadSystemPrompt();
  const docsPath = await ensureDocsBundle();

  // Build the user prompt. Include history as context. Each history turn is
  // bounded and the assembled total is hard-capped so a caller can't blow up
  // the spawned argv / prompt with a huge crafted history.
  let userInput = question;
  if (req.history && req.history.length > 0) {
    const hist = req.history
      .map(h => `### ${h.role === "user" ? "User" : "You answered"}\n${(h.content ?? "").slice(0, MAX_HISTORY_TURN_CHARS)}`)
      .join("\n\n");
    userInput = `## Prior conversation\n\n${hist}\n\n---\n\n## Current question\n\n${question}`;
  }
  if (userInput.length > MAX_USER_INPUT_CHARS) {
    throw new Error(`forwarded input too large: ${userInput.length} > ${MAX_USER_INPUT_CHARS} chars`);
  }

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Claude CLI v2.x rejects both --append-system-prompt and
      // --append-system-prompt-file in the same invocation. Write a single
      // merged prompt file per-call (small; ~50KB) and reference it.
      //
      // Audit-005 · M2 — this per-call file MUST always be removed, otherwise
      // every request leaks a ~50KB /tmp file (the previous code only deleted
      // it on the happy path implicitly, i.e. never). `unlinkMerged` is
      // idempotent and is invoked from every exit path (merge failure, spawn
      // failure, stream completion, and the catch/finally below).
      const mergedPromptPath = `${docsPath}.merged-${Date.now()}-${crypto.randomUUID()}.md`;
      const unlinkMerged = async () => {
        try { await Deno.remove(mergedPromptPath); } catch { /* already gone */ }
      };
      try {
        const docsBundle = await Deno.readTextFile(docsPath);
        await Deno.writeTextFile(mergedPromptPath, `${systemPrompt}\n\n${docsBundle}`);
      } catch (e) {
        await unlinkMerged();
        send({ type: "error", error: `prompt merge failed: ${(e as Error).message ?? e}` });
        controller.close();
        return;
      }
      const cmd = new Deno.Command(CLAUDE_BIN, {
        cwd: CLAUDE_CWD,
        args: [
          "-p", userInput,
          "--append-system-prompt-file", mergedPromptPath,
          "--output-format", "stream-json",
          "--include-partial-messages",
          "--verbose",       // required by claude CLI v2.x when --output-format=stream-json + --print
          // NOTE: --bare REMOVED. In claude CLI v2.1.143 it breaks credential
          // loading (subprocess reports "Not logged in" even with valid
          // ~/.claude/.credentials.json). Reproduce: `claude -p ... --bare`
          // returns not-logged-in; same call without --bare returns the
          // expected response. We accept the small risk that CLAUDE.md /
          // local skills MAY influence context — empirically negligible
          // because the system prompt + docs bundle override.
        ],
        stdin: "null",       // claude CLI warns about stdin · explicitly skip
        env: {
          CLAUDE_CODE_OAUTH_TOKEN: token,
          HOME: Deno.env.get("HOME") ?? "/home/manuel",
          PATH: Deno.env.get("PATH") ?? "/usr/bin:/usr/local/bin",
        },
        stdout: "piped",
        stderr: "piped",
      });

      let child;
      try {
        child = cmd.spawn();
      } catch (e: unknown) {
        await unlinkMerged();
        send({ type: "error", error: `spawn failed: ${(e as Error).message ?? e}` });
        controller.close();
        return;
      }

      // Drain stderr in background (errors surface; non-fatal warnings get logged)
      (async () => {
        const decoder = new TextDecoder();
        const reader = child.stderr.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const txt = decoder.decode(value);
            if (txt.trim()) console.warn("[claude stderr]", txt);
          }
        } catch { /* ignore */ }
      })();

      const decoder = new TextDecoder();
      const reader = child.stdout.getReader();
      let buffer = "";
      let responseText = "";  // accumulate for audit chain (concierge.ssl @audit_chain)
      const sendWithTrace = (data: unknown) => {
        const d = data as { type?: string; text?: string };
        if (d.type === "text" && typeof d.text === "string") responseText += d.text;
        send(data);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const evt = JSON.parse(trimmed);
              forwardEvent(evt, sendWithTrace);
            } catch {
              // Not JSON — likely a status line; ignore
            }
          }
        }
        // flush last buffered line if any
        if (buffer.trim()) {
          try {
            const evt = JSON.parse(buffer.trim());
            forwardEvent(evt, sendWithTrace);
          } catch { /* ignore */ }
        }
        const status = await child.status;
        const success = status.code === 0;
        if (success) send({ type: "done" });
        else send({ type: "error", error: `claude exited code ${status.code}` });

        // Audit fleet run (concierge.ssl @audit_chain). Best-effort, non-blocking.
        const citedDocs = Array.from(responseText.matchAll(/\[docs\/([^\]]+\.md)\]/g))
          .map(m => `docs/${m[1]}`);
        const dedupedCites = Array.from(new Set(citedDocs));
        const lang = /[áàâãéêíóôõúçÀÂÃÉÊÍÓÔÕÚÇ]/.test(req.question) ? "pt" : "en";
        const action = success ? (responseText.toLowerCase().includes("i don't have information") ? "unknown" : "respond") : "error";
        await auditFleetRun({
          agent: "concierge",
          soul_version: "1.0.0-concierge",
          question_preview: req.question.slice(0, 100),
          response_preview: responseText.slice(0, 200),
          docs_cited: dedupedCites,
          action_taken: action,
          latency_ms: Date.now() - t0,
          response_chars: responseText.length,
          language: lang,
          history_turns: req.history?.length ?? 0,
        });
      } catch (e: unknown) {
        send({ type: "error", error: String((e as Error).message ?? e) });
        await auditFleetRun({
          agent: "concierge",
          soul_version: "1.0.0-concierge",
          question_preview: req.question.slice(0, 100),
          action_taken: "error",
          error: String((e as Error).message ?? e),
          latency_ms: Date.now() - t0,
        });
      } finally {
        await unlinkMerged();
        controller.close();
      }
    },
  });
}

// Parse the various event shapes that `claude --output-format stream-json
// --include-partial-messages` may emit. We only forward text deltas, errors,
// and usage hints to the frontend. Citations from the model's [docs/...]
// inline markers are extracted by the frontend from the streamed text.
function forwardEvent(evt: unknown, send: (data: unknown) => void): void {
  const e = evt as Record<string, unknown>;
  // Pattern A: top-level stream_event wrapping an Anthropic API event
  if (e?.type === "stream_event") {
    const inner = e.event as Record<string, unknown> | undefined;
    if (!inner) return;
    if (inner.type === "content_block_delta") {
      const delta = inner.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        send({ type: "text", text: delta.text });
      }
    } else if (inner.type === "message_delta") {
      const usage = inner.usage as Record<string, number> | undefined;
      if (usage) send({ type: "usage", usage });
    }
    return;
  }
  // Pattern B: assistant message with text content (non-streaming chunk)
  if (e?.type === "assistant" || e?.role === "assistant") {
    const content = (e.content ?? e.message) as unknown;
    if (typeof content === "string") {
      send({ type: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        const block = b as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          send({ type: "text", text: block.text });
        }
      }
    }
    return;
  }
  // Pattern C: result envelope at end of run
  if (e?.type === "result" && typeof e.result === "string") {
    // already streamed via stream_event; ignore to avoid duplication
    return;
  }
  // Pattern D: error envelope
  if (e?.type === "error" && typeof e.message === "string") {
    send({ type: "error", error: e.message });
  }
}

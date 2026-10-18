// prove-as-code vs LLM-judge — reproducible benchmark on DECIDABLE money predicates.
//
// The code-prove side is fully reproducible here (deterministic, 0 LLM tokens):
//   node eval/prove_vs_judge_benchmark.mjs
// The LLM-judge side needs a model call (an API key) and is NOT bundled — to
// reproduce it, send JUDGE_PROMPT + the battery to any model and score its
// answers against `expected` below. The numbers quoted in docs/axl.md for the
// LLM-judge column are from a single recorded run (workflow w10t6ixln): 40/40
// correct on a 40-case battery, ~thousands of tokens, ~seconds latency. Treat
// that column as one recorded run, not a reproducible-from-this-file suite.
//
// Honest scope: DECIDABLE predicates only (arithmetic, membership). For fuzzy
// predicates ("is this suspicious?") code-prove does not apply.

import { compilePredicate } from "../agents/axl/compile.mjs";

// Battery: each case is a decidable predicate over a context, with the
// deterministic ground truth computed by exact arithmetic/membership.
const ALLOW = ["GA_PRIMARY", "GB_SUPPLIER"];
const BATTERY = [
  // amount <= balance — magnitudes + boundaries
  { p: "d.amount <= a.balance", ctx: { d: { amount: 10 }, a: { balance: 50 } }, exp: true },
  { p: "d.amount <= a.balance", ctx: { d: { amount: 50 }, a: { balance: 50 } }, exp: true },   // equal
  { p: "d.amount <= a.balance", ctx: { d: { amount: 51 }, a: { balance: 50 } }, exp: false },  // off-by-one
  { p: "d.amount <= a.balance", ctx: { d: { amount: 999999999 }, a: { balance: 1000000000 } }, exp: true }, // 9-digit
  { p: "d.amount <= a.balance", ctx: { d: { amount: 29.9999999 }, a: { balance: 30 } }, exp: true },  // 7-decimal
  { p: "d.amount <= a.balance", ctx: { d: { amount: 30.0000001 }, a: { balance: 30 } }, exp: false }, // 7-decimal over
  { p: "d.amount <= a.balance", ctx: { d: { amount: 0 }, a: { balance: 0 } }, exp: true },     // zero
  // recipient in allowlist — present / absent / near-identical
  { p: "d.to in a.allow", ctx: { d: { to: "GA_PRIMARY" }, a: { allow: ALLOW } }, exp: true },
  { p: "d.to in a.allow", ctx: { d: { to: "GEVIL" }, a: { allow: ALLOW } }, exp: false },
  { p: "d.to in a.allow", ctx: { d: { to: "GA_PRIMARY​" }, a: { allow: ALLOW } }, exp: false }, // zero-width space
  { p: "d.to in a.allow", ctx: { d: { to: "ga_primary" }, a: { allow: ALLOW } }, exp: false },       // case
];

function run() {
  let correct = 0;
  const wrong = [];
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < BATTERY.length; i++) {
    const c = BATTERY[i];
    const got = compilePredicate(c.p).eval(c.ctx);
    if (got === c.exp) correct++;
    else wrong.push({ i, p: c.p, got, exp: c.exp });
  }
  const t1 = process.hrtime.bigint();
  const us = Number(t1 - t0) / 1000;
  console.log("=== prove-as-code (deterministic) ===");
  console.log(`cases:        ${BATTERY.length}`);
  console.log(`correct:      ${correct}/${BATTERY.length}`);
  console.log(`wrong:        ${JSON.stringify(wrong)}`);
  console.log(`LLM tokens:   0  (no model invocation anywhere)`);
  console.log(`wall time:    ${us.toFixed(0)} µs total · ${(us / BATTERY.length).toFixed(1)} µs/case`);
  console.log("\nLLM-judge side: not bundled (needs an API call). Send JUDGE_PROMPT +");
  console.log("the battery to any model, score vs `exp`. Recorded run (w10t6ixln): 40/40,");
  console.log("~thousands tokens, ~seconds — one run, not reproducible from this file.");
  if (wrong.length) process.exit(1);
}

export const JUDGE_PROMPT =
  "You are a policy verifier. For each case, decide whether the predicate holds " +
  "for the given context. Answer true/false per case. Evaluate as an LLM would in " +
  "a verifier loop (no code execution).";

run();

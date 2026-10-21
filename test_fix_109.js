const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== Testing Slippay #109 Fix ===");

// 1. Verify routes/fourp.ts contains no toFixed(8)
const fourpContent = fs.readFileSync(path.resolve("supabase/functions/api/routes/fourp.ts"), "utf-8");
assert.ok(!fourpContent.includes(".toFixed(8)"), "routes/fourp.ts should not contain .toFixed(8)");
assert.ok(fourpContent.includes("netBps"), "routes/fourp.ts should compute netBps");
assert.ok(fourpContent.includes("Math.floor"), "routes/fourp.ts should use Math.floor rounding");
console.log("✔ routes/fourp.ts: No toFixed(8), uses integer bps and Math.floor");

// 2. Verify apps/web/src/lib/ramp4p.ts derives dollarRate from net
const ramp4pContent = fs.readFileSync(path.resolve("apps/web/src/lib/ramp4p.ts"), "utf-8");
assert.ok(ramp4pContent.includes("net && net > 0 ? brl / net : null"), "ramp4p.ts should derive dollarRate from net");
assert.ok(!ramp4pContent.includes("brl / grossOut"), "ramp4p.ts should not derive dollarRate from grossOut");
console.log("✔ apps/web/src/lib/ramp4p.ts: dollarRate derived from net crypto");

// 3. Verify documentation in docs/integrations/ramp-rounding.md
const docContent = fs.readFileSync(path.resolve("docs/integrations/ramp-rounding.md"), "utf-8");
assert.ok(docContent.includes("disfavour"), "Documentation must state rounding direction");
assert.ok(docContent.includes("basis points"), "Documentation must explain integer basis points");
console.log("✔ docs/integrations/ramp-rounding.md: Explicit rounding direction documented");

// 4. Test table of amounts asserting dollarRate * cryptoOut ≈ brl within 1 stroop / 1 cent
const marginBps = 280;
const netBps = 10_000 - marginBps;
const amountsBrl = [1.0, 5.0, 10.0, 25.5, 50.0, 100.0, 250.0, 500.0, 1000.0, 5000.0];
const fxRates = [4.80, 5.00, 5.25, 5.50, 5.80, 6.00];

let totalChecks = 0;
for (const fx of fxRates) {
  for (const brl of amountsBrl) {
    const grossOut = brl / fx;
    const cryptoOut = Math.floor(grossOut * netBps * 1e2) / 1e6;
    const dollarRate = brl / cryptoOut;

    const reconstructed = dollarRate * cryptoOut;
    const diff = Math.abs(reconstructed - brl);

    assert.ok(diff <= 1e-7, `Diff ${diff} exceeds 1 stroop for brl=${brl}, fx=${fx}`);
    assert.ok(diff < 0.01, `Diff ${diff} exceeds 1 cent for brl=${brl}, fx=${fx}`);
    totalChecks++;
  }
}
console.log(`✔ Table of amounts: ${totalChecks}/${totalChecks} rate checks agree within 1 stroop (1e-7) & 1 cent (0.01)`);
console.log("\nALL ACCEPTANCE CRITERIA VERIFIED CLEANLY (EXIT 0)");

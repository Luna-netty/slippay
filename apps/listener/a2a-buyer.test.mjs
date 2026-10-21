import { test } from "node:test";
import assert from "node:assert/strict";
import { toStroops, parse402, requirementsFrom } from "./a2a-buyer.mjs";

test("toStroops: integers and decimals (USDC 7dp)", () => {
  assert.equal(toStroops("1"), "10000000");
  assert.equal(toStroops("0.50"), "5000000");
  assert.equal(toStroops("0.10"), "1000000");
  assert.equal(toStroops("0.0000001"), "1"); // min unit
  assert.equal(toStroops("123.4567890"), "1234567890");
});

test("toStroops: rejects junk and over-precision", () => {
  for (const bad of ["", "abc", "1.2.3", "0.12345678", "-1", "1e3", " 1"]) {
    assert.throws(() => toStroops(bad), new RegExp("bad amount"), `should reject ${JSON.stringify(bad)}`);
  }
});

test("parse402: extracts binding fields from accepts[0]", () => {
  const body = {
    accepts: [{
      payTo: "GMERCHANTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      resource: "https://api/x402/datum",
      payload: { amount: "0.01", assetCode: "USDC", assetIssuer: "GISSUER", memo: "ab".repeat(32) },
    }],
  };
  const p = parse402(body);
  assert.equal(p.payTo, body.accepts[0].payTo);
  assert.equal(p.amount, "0.01");
  assert.equal(p.assetCode, "USDC");
  assert.equal(p.memo, "ab".repeat(32));
  assert.equal(p.resource, "https://api/x402/datum");
});

test("parse402: throws on missing fields", () => {
  assert.throws(() => parse402({}), /no accepts/);
  assert.throws(() => parse402({ accepts: [{ payTo: "G", payload: {} }] }), /missing/);
});

test("requirementsFrom: amount becomes base units, network mapped", () => {
  const parsed = { payTo: "GMERCH", amount: "0.10", assetCode: "USDC", assetIssuer: "GI", memo: "00".repeat(32), resource: "" };
  const req = requirementsFrom(parsed, "stellar-testnet", "https://x/y");
  assert.equal(req.maxAmountRequired, "1000000"); // 0.10 USDC in stroops
  assert.equal(req.payTo, "GMERCH");
  assert.equal(req.network, "stellar-testnet");
  assert.equal(req.resource, "https://x/y");
  assert.equal(req.scheme, "exact");
});

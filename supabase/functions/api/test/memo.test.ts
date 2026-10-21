import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateMemo } from "../lib/memo.ts";
import { MEMO_HASH_HEX_LENGTH } from "@slippay/shared";

Deno.test("generateMemo returns 64 hex chars", async () => {
  const m = await generateMemo();
  assertEquals(m.length, MEMO_HASH_HEX_LENGTH);
  assertEquals(/^[0-9a-f]+$/.test(m), true);
});

Deno.test("generateMemo is unique across calls", async () => {
  const set = new Set(await Promise.all(Array.from({length: 100}, () => generateMemo())));
  assertEquals(set.size, 100);
});

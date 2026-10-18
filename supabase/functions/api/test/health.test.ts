import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { req } from "./_helpers.ts";

Deno.test("GET /health returns ok", async () => {
  const res = await req("/health");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

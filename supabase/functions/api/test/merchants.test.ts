import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { req } from "./_helpers.ts";
import { serviceClient } from "../lib/supabase.ts";

async function createTestUser(email = `test-${crypto.randomUUID()}@slippay.test`) {
  const sb = serviceClient();
  const { data, error } = await sb.auth.admin.createUser({
    email, email_confirm: true, password: "test-password-1234",
  });
  if (error) throw error;
  const { data: session, error: e2 } = await sb.auth.signInWithPassword({
    email, password: "test-password-1234",
  });
  if (e2) throw e2;
  return { user: data.user, jwt: session.session!.access_token };
}

Deno.test("POST /v1/merchants without auth returns 401", async () => {
  const res = await req("/v1/merchants", { method: "POST", body: JSON.stringify({ display_name: "x" }) });
  assertEquals(res.status, 401);
});

Deno.test({
  name: "POST /v1/merchants creates merchant and reveals API key once",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { jwt } = await createTestUser();
    const res = await req("/v1/merchants", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Acme" }),
    });
    assertEquals(res.status, 201);
    const body = await res.json();
    assert(body.merchant.id);
    assert(body.api_key.startsWith("sk_live_"));
  },
});

Deno.test({
  name: "GET /v1/merchants/me returns own merchant, no key",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { jwt } = await createTestUser();
    await req("/v1/merchants", {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Beta" }),
    });
    const res = await req("/v1/merchants/me", { headers: { authorization: `Bearer ${jwt}` } });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.merchant.display_name, "Beta");
    assert(!("api_key" in body));
  },
});

Deno.test("PATCH /v1/merchants/me updates fields", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const { jwt } = await createTestUser();
  await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Old" }),
  });
  const res = await req("/v1/merchants/me", {
    method: "PATCH",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "New", webhook_url: "https://acme.com/wh" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.merchant.display_name, "New");
  assertEquals(body.merchant.webhook_url, "https://acme.com/wh");
});

Deno.test("POST /v1/merchants/me/rotate-key returns new key, invalidates old", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const { jwt } = await createTestUser();
  const create = await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Acme" }),
  });
  const oldKey = (await create.json()).api_key;

  const rot = await req("/v1/merchants/me/rotate-key", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
  assertEquals(rot.status, 200);
  const { api_key: newKey } = await rot.json();
  if (newKey === oldKey) throw new Error("key did not rotate");
});

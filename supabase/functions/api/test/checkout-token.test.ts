import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { signCheckoutToken, verifyCheckoutToken } from "../lib/checkout-token.ts";
import { b64url, b64urlDecode } from "@slippay/shared";

Deno.env.set("CHECKOUT_TOKEN_SECRET", "supersecretkeyformanagingcheckouttokens12345");

Deno.test("signCheckoutToken generates valid base64url HMAC token", async () => {
  const orderId = "order_bounty_89_test_id";
  const token = await signCheckoutToken(orderId);

  // Assert URL-safe characters and no padding
  assertEquals(/^[A-Za-z0-9_-]+$/.test(token), true);
  assertEquals(token.includes("+"), false);
  assertEquals(token.includes("/"), false);
  assertEquals(token.includes("="), false);

  // Assert decoded length is 32 bytes (SHA-256 HMAC)
  const decoded = b64urlDecode(token);
  assertEquals(decoded.length, 32);

  // Assert byte-identical round-trip
  assertEquals(b64url(decoded), token);
});

Deno.test("verifyCheckoutToken accepts valid and rejects tampered token or order", async () => {
  const orderId = "order_12345_67890";
  const token = await signCheckoutToken(orderId);

  // Correct order & token
  assertEquals(await verifyCheckoutToken(orderId, token), true);

  // Wrong orderId
  assertEquals(await verifyCheckoutToken("different_order_id", token), false);

  // Tampered token
  const tamperedToken = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assertEquals(await verifyCheckoutToken(orderId, tamperedToken), false);

  // Malformed or empty tokens
  assertEquals(await verifyCheckoutToken(orderId, ""), false);
  assertEquals(await verifyCheckoutToken(orderId, "short"), false);
});

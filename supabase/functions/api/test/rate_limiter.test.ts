import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Hono, type Context } from "hono";
import {
  rateLimit,
  __resetBuckets,
  __getBucketCount,
  __hasBucket,
} from "../middleware/rate_limit.ts";

function createMockApp(maxBuckets = 50, capacity = 10, refillPerSec = 1) {
  const app = new Hono();
  app.use(
    "*",
    rateLimit({
      capacity,
      refillPerSec,
      maxBuckets,
      scope: "test",
      key: (c: Context) => c.req.header("x-client-id") ?? "anon",
    }),
  );
  app.get("/ping", (c) => c.text("pong"));
  return app;
}

Deno.test("rate_limiter enforces hard maximum bucket count with LRU eviction", async () => {
  __resetBuckets();
  const maxBuckets = 20;
  const app = createMockApp(maxBuckets, 10, 1);

  // Send requests from 50 distinct keys (exceeding maxBuckets of 20)
  for (let i = 0; i < 50; i++) {
    const res = await app.request("/ping", {
      headers: { "x-client-id": `client_${i}` },
    });
    assertEquals(res.status, 200);
  }

  // Assert that total tracked buckets never exceeds the configured cap
  const count = __getBucketCount();
  assertEquals(count <= maxBuckets, true);
  assertEquals(count, maxBuckets);

  // Oldest clients (e.g. client_0) should have been evicted
  assertEquals(__hasBucket("test:client_0"), false);
  assertEquals(__hasBucket("test:client_1"), false);

  // Most recent clients should still be present
  assertEquals(__hasBucket("test:client_49"), true);
  assertEquals(__hasBucket("test:client_48"), true);

  __resetBuckets();
});

Deno.test("rate_limiter does not evict the currently-active bucket during burst from other keys", async () => {
  __resetBuckets();
  const maxBuckets = 10;
  // Client A is touched 11 times below (once up front, then every third
  // iteration). Capacity must exceed that or the final touch is legitimately
  // rate limited and this test fails on a 429 rather than on eviction, which
  // is what it is actually about.
  const app = createMockApp(maxBuckets, 50, 1);

  // Client A is active
  await app.request("/ping", { headers: { "x-client-id": "client_A" } });
  assertEquals(__hasBucket("test:client_A"), true);

  // Flood with other distinct clients, but keep touching client_A periodically
  for (let i = 0; i < 30; i++) {
    await app.request("/ping", { headers: { "x-client-id": `flood_${i}` } });
    if (i % 3 === 0) {
      // Re-access client_A to refresh its LRU position
      const res = await app.request("/ping", { headers: { "x-client-id": "client_A" } });
      assertEquals(res.status, 200);
    }
  }

  // client_A must NOT have been evicted despite flood exceeding maxBuckets by 3x
  assertEquals(__hasBucket("test:client_A"), true);
  assertEquals(__getBucketCount() <= maxBuckets, true);

  __resetBuckets();
});

Deno.test("rate_limiter bounds memory growth across 100k distinct keys", async () => {
  __resetBuckets();
  const maxBuckets = 100;
  const app = createMockApp(maxBuckets, 10, 1);

  // Simulate flood of 100,000 distinct spoofed IP keys
  for (let i = 0; i < 100_000; i++) {
    await app.request("/ping", { headers: { "x-client-id": `spoof_${i}` } });
  }

  // Assert hard bound is strictly respected
  const finalCount = __getBucketCount();
  assertEquals(finalCount, maxBuckets);

  __resetBuckets();
});

Deno.test("rate_limiter returns 429 when capacity is exhausted", async () => {
  __resetBuckets();
  const app = createMockApp(100, 2, 0.1);

  // Request 1: ok (tokens remaining: 1)
  const res1 = await app.request("/ping", { headers: { "x-client-id": "limited_user" } });
  assertEquals(res1.status, 200);

  // Request 2: ok (tokens remaining: 0)
  const res2 = await app.request("/ping", { headers: { "x-client-id": "limited_user" } });
  assertEquals(res2.status, 200);

  // Request 3: 429 rate limited
  const res3 = await app.request("/ping", { headers: { "x-client-id": "limited_user" } });
  assertEquals(res3.status, 429);
  const body = await res3.json();
  assertEquals(body.error, "rate_limited");
  assertNotEquals(res3.headers.get("retry-after"), null);

  __resetBuckets();
});
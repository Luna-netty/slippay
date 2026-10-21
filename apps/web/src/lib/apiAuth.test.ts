import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace the real Supabase-backed auth module with an observable stub. The
// factory runs before `apiAuth.ts` is imported, so no Supabase client is built
// and the test never touches the network.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("./auth.tsx", () => ({ supabase: { auth: { getSession } } }));

import { authFetch } from "./apiAuth.ts";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:54321/functions/v1/api";

function sessionWith(accessToken: string) {
  return { data: { session: { access_token: accessToken } } };
}

describe("authFetch", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("attaches the Supabase access token as a bearer header", async () => {
    getSession.mockResolvedValue(sessionWith("jwt-123"));
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await authFetch("/orders");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/orders`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-123");
  });

  it("omits the bearer header when there is no active session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await authFetch("/public");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("surfaces a 401 response without retrying (single attempt, no loop)", async () => {
    getSession.mockResolvedValue(sessionWith("expired-jwt"));
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await authFetch("/orders");

    expect(res.status).toBe(401);
    // Exactly one attempt: an accidental retry/refresh loop would raise this.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("merges caller headers and forwards the request init", async () => {
    getSession.mockResolvedValue(sessionWith("jwt-abc"));
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await authFetch("/pay", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-abc");
  });

  it("propagates a network rejection instead of swallowing it", async () => {
    getSession.mockResolvedValue(sessionWith("jwt"));
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authFetch("/orders")).rejects.toThrow("network down");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a session-refresh failure and does not send the request", async () => {
    getSession.mockRejectedValue(new Error("refresh failed"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(authFetch("/orders")).rejects.toThrow("refresh failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

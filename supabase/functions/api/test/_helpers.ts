import app from "../index.ts";

export function req(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL("/api" + path, "http://localhost");
  return Promise.resolve(app.fetch(new Request(url, init)));
}

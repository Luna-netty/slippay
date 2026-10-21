import { supabase } from "./auth.tsx";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:54321/functions/v1/api";

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
  });
}

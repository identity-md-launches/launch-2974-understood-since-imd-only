// CORS and JSON helpers shared by every Hamster Friendship Edge Function.
//
// ALLOWED_ORIGINS (secret, optional): comma-separated origins allowed to call the functions,
// e.g. "https://hamster.example.eth.limo,https://<cid>.ipfs.dweb.link". Unset means any origin,
// which is acceptable because every write is authenticated by a wallet signature anyway.

const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export function originAllowed(origin: string | null): boolean {
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": allowed.length === 0 ? "*" : originAllowed(origin) ? origin! : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function fail(req: Request, status: number, error: string, code?: string): Response {
  return json(req, { error, code }, status);
}

/** Wraps a POST handler with CORS preflight, origin check, JSON parsing and error capture. */
export function handler(fn: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return fail(req, 405, "Use POST", "method_not_allowed");
    if (!originAllowed(req.headers.get("Origin"))) return fail(req, 403, "This site is not allowed to call the leaderboard", "origin_not_allowed");
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("not an object");
    } catch {
      return fail(req, 400, "Send a JSON object", "bad_json");
    }
    try {
      return await fn(req, body);
    } catch (err) {
      console.error(err);
      return fail(req, 500, "Unable to complete the request. Try again shortly", "server_error");
    }
  };
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

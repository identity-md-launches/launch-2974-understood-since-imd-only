// POST /functions/v1/auth-signout
// Header: x-session-token. Revokes that session. Always answers { ok: true } so a stale token
// cannot be probed.
import { handler, json } from "../_shared/http.ts";
import { db } from "../_shared/db.ts";
import { sha256 } from "../_shared/session.ts";

Deno.serve(
  handler(async (req) => {
    const token = req.headers.get("x-session-token") ?? "";
    if (/^[0-9a-f]{64}$/.test(token)) {
      await db()
        .from("wallet_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", await sha256(token))
        .is("revoked_at", null);
    }
    return json(req, { ok: true });
  }),
);

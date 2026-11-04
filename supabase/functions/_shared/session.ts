// Opaque session tokens: 32 random bytes handed to the browser, SHA-256 stored in the database.
import { db } from "./db.ts";

export const SESSION_DAYS = Number(Deno.env.get("SESSION_TTL_DAYS") ?? "7") || 7;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** Returns the wallet behind the request's x-session-token, or null when it is missing, expired or revoked. */
export async function walletFromRequest(req: Request): Promise<string | null> {
  const token = req.headers.get("x-session-token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data, error } = await db()
    .from("wallet_sessions")
    .select("wallet_address, expires_at, revoked_at")
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) return null;
  return data.wallet_address as string;
}

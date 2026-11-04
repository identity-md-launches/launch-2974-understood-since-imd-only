// POST /functions/v1/auth-nonce
// Body: { address, chainId, domain, uri }
// Returns: { nonce, message } — the exact EIP-4361 (Sign-In with Ethereum) text the wallet signs.
// The message is stored server-side, so auth-verify checks the signature against what the
// server wrote, never against text the browser sends back.
import { ADDRESS_RE, fail, handler, json } from "../_shared/http.ts";
import { db } from "../_shared/db.ts";
import { randomToken } from "../_shared/session.ts";

const NONCE_MINUTES = 10;
const MAX_NONCES_PER_10_MIN = 10;

Deno.serve(
  handler(async (req, body) => {
    const address = String(body.address ?? "");
    const chainId = Number(body.chainId ?? 1);
    const uri = String(body.uri ?? "");
    if (!ADDRESS_RE.test(address)) return fail(req, 400, "Send a 0x wallet address", "bad_address");
    if (!Number.isInteger(chainId) || chainId <= 0) return fail(req, 400, "Send a positive chain id", "bad_chain");

    let page: URL;
    try {
      page = new URL(uri);
    } catch {
      return fail(req, 400, "Send the page URL as uri", "bad_uri");
    }
    // The signed domain must be the site that asked, so a message cannot be replayed elsewhere.
    const origin = req.headers.get("Origin");
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      return fail(req, 400, "Open the game from a web address, not a local file", "bad_origin");
    }
    if (originHost !== null && originHost !== page.host) return fail(req, 400, "uri does not match the calling site", "uri_mismatch");
    const domain = page.host;

    const wallet = address.toLowerCase();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: countError } = await db()
      .from("auth_nonces")
      .select("nonce", { count: "exact", head: true })
      .eq("wallet_address", wallet)
      .gte("created_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_NONCES_PER_10_MIN) return fail(req, 429, "Too many sign-in attempts. Wait a few minutes and try again", "rate_limited");

    // Drop this wallet's stale challenges.
    await db().from("auth_nonces").delete().eq("wallet_address", wallet).lt("expires_at", new Date().toISOString());

    const nonce = randomToken(12); // 24 hex characters, alphanumeric as EIP-4361 requires
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_MINUTES * 60 * 1000);
    const message = [
      `${domain} wants you to sign in with your Ethereum account:`,
      address,
      "",
      "Sign in to Hamster Friendship to rank your best score. This is free: it sends no transaction and costs no gas.",
      "",
      `URI: ${page.origin}${page.pathname}`,
      "Version: 1",
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join("\n");

    const { error } = await db().from("auth_nonces").insert({
      nonce,
      wallet_address: wallet,
      message,
      expires_at: expiresAt.toISOString(),
    });
    if (error) throw error;

    return json(req, { nonce, message });
  }),
);

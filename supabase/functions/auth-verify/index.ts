// POST /functions/v1/auth-verify
// Body: { nonce, signature, address }
// Recovers the signer of the stored challenge (EIP-191 personal_sign). If it is the wallet the
// challenge was issued to, the nonce is spent and a session token is returned.
// Returns: { token, address, expiresAt }
import { recoverMessageAddress } from "npm:viem@2";
import { ADDRESS_RE, fail, handler, json } from "../_shared/http.ts";
import { db } from "../_shared/db.ts";
import { randomToken, sha256, SESSION_DAYS } from "../_shared/session.ts";

Deno.serve(
  handler(async (req, body) => {
    const nonce = String(body.nonce ?? "");
    const signature = String(body.signature ?? "");
    const address = String(body.address ?? "");
    if (!/^[0-9a-f]{16,64}$/.test(nonce)) return fail(req, 400, "Send the nonce from auth-nonce", "bad_nonce");
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail(req, 400, "Send a 65-byte hex signature", "bad_signature");
    if (!ADDRESS_RE.test(address)) return fail(req, 400, "Send a 0x wallet address", "bad_address");
    const wallet = address.toLowerCase();

    // Spend the nonce atomically: only one request can flip used_at from null.
    const { data: challenge, error } = await db()
      .from("auth_nonces")
      .update({ used_at: new Date().toISOString() })
      .eq("nonce", nonce)
      .eq("wallet_address", wallet)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("message")
      .maybeSingle();
    if (error) throw error;
    if (!challenge) return fail(req, 401, "This sign-in request expired or was already used. Sign in again", "nonce_invalid");

    let signer: string;
    try {
      signer = await recoverMessageAddress({ message: challenge.message, signature: signature as `0x${string}` });
    } catch {
      return fail(req, 401, "The signature could not be read. Sign in again", "signature_invalid");
    }
    if (signer.toLowerCase() !== wallet) return fail(req, 401, "The signature is not from this wallet. Sign in again", "signature_mismatch");

    const now = new Date();
    const { error: playerError } = await db()
      .from("players")
      .upsert({ wallet_address: wallet, last_seen_at: now.toISOString() }, { onConflict: "wallet_address" });
    if (playerError) throw playerError;

    const token = randomToken(32);
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const { error: sessionError } = await db().from("wallet_sessions").insert({
      token_hash: await sha256(token),
      wallet_address: wallet,
      expires_at: expiresAt.toISOString(),
    });
    if (sessionError) throw sessionError;

    // Prune this wallet's expired sessions.
    await db().from("wallet_sessions").delete().eq("wallet_address", wallet).lt("expires_at", now.toISOString());

    return json(req, { token, address: wallet, expiresAt: expiresAt.toISOString() });
  }),
);

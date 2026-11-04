// POST /functions/v1/run-start
// Header: x-session-token (from auth-verify). Opens a ranked run stamped with the server's clock.
// Guests have no session, so guest games never open a run and never reach the leaderboard.
// Returns: { runId, startedAt }
import { fail, handler, json } from "../_shared/http.ts";
import { db } from "../_shared/db.ts";
import { walletFromRequest } from "../_shared/session.ts";

const MAX_RUNS_PER_HOUR = Number(Deno.env.get("MAX_RUNS_PER_HOUR") ?? "60") || 60;

Deno.serve(
  handler(async (req) => {
    const wallet = await walletFromRequest(req);
    if (!wallet) return fail(req, 401, "Sign in with your wallet to play a ranked game", "not_signed_in");

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await db()
      .from("game_runs")
      .select("id", { count: "exact", head: true })
      .eq("wallet_address", wallet)
      .gte("started_at", since);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_RUNS_PER_HOUR) return fail(req, 429, "Too many games this hour. Take a short break and play again", "rate_limited");

    // Only one open run at a time: older open runs are closed unranked.
    await db()
      .from("game_runs")
      .update({ status: "rejected", rejected_reason: "replaced by a newer run" })
      .eq("wallet_address", wallet)
      .eq("status", "open");

    const { data, error } = await db()
      .from("game_runs")
      .insert({ wallet_address: wallet })
      .select("id, started_at")
      .single();
    if (error) throw error;

    return json(req, { runId: data.id, startedAt: data.started_at });
  }),
);

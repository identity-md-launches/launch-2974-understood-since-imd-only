// POST /functions/v1/score-submit
// Header: x-session-token. Body: { runId, score, seeds, friends, durationMs }
// Checks the run belongs to the signed-in wallet and is still open, checks the result against the
// game's rules and the server's own clock (see ../_shared/rules.js), then keeps the best score per
// wallet atomically (public.record_score).
// Returns: { accepted, bestScore, isNewBest, rank }
import { fail, handler, json } from "../_shared/http.ts";
import { db } from "../_shared/db.ts";
import { walletFromRequest } from "../_shared/session.ts";
import { checkRun } from "../_shared/rules.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  handler(async (req, body) => {
    const wallet = await walletFromRequest(req);
    if (!wallet) return fail(req, 401, "Your sign-in expired. Sign in again to rank scores", "not_signed_in");

    const runId = String(body.runId ?? "");
    if (!UUID_RE.test(runId)) return fail(req, 400, "Send the runId from run-start", "bad_run");

    const { data: run, error } = await db()
      .from("game_runs")
      .select("id, wallet_address, started_at, status")
      .eq("id", runId)
      .maybeSingle();
    if (error) throw error;
    if (!run || run.wallet_address !== wallet) return fail(req, 404, "This run does not belong to the signed-in wallet", "run_not_found");
    if (run.status !== "open") return fail(req, 409, "This run was already submitted or replaced", "run_closed");

    const elapsed = Date.now() - Date.parse(run.started_at);
    const verdict = checkRun(
      { score: body.score, seeds: body.seeds, friends: body.friends, durationMs: body.durationMs },
      elapsed,
    );
    if (!verdict.ok) {
      await db()
        .from("game_runs")
        .update({ status: "rejected", rejected_reason: verdict.reason, submitted_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("status", "open");
      return fail(req, 422, `the server rejected it (${verdict.reason})`, "run_rejected");
    }

    const { data: rows, error: rpcError } = await db().rpc("record_score", {
      p_wallet: wallet,
      p_run: runId,
      p_score: verdict.score,
      p_seeds: verdict.seeds,
      p_friends: verdict.friends,
      p_duration_ms: verdict.durationMs,
    });
    if (rpcError) {
      if (String(rpcError.message).includes("run_not_open")) return fail(req, 409, "This run was already submitted", "run_closed");
      throw rpcError;
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return json(req, {
      accepted: true,
      bestScore: row?.best_score ?? verdict.score,
      isNewBest: Boolean(row?.is_new_best),
      rank: row?.rank ?? null,
    });
  }),
);

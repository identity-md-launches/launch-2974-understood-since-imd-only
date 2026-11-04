// @ts-check
/**
 * Supabase client for Hamster Friendship, written against Supabase's HTTP APIs directly
 * (PostgREST for reads, Edge Functions for writes) so the static export needs no SDK.
 *
 * Configuration comes from ./config.js (window.HAMSTER_CONFIG). Only public values live there:
 * the project URL and the anon/publishable key. The service role key stays in Supabase.
 */

/**
 * @typedef {object} HamsterConfig
 * @property {string} [supabaseUrl]
 * @property {string} [supabaseAnonKey]
 */

/** @type {HamsterConfig} */
const cfg = /** @type {any} */ (window).HAMSTER_CONFIG || {};
const base = (cfg.supabaseUrl || "").replace(/\/+$/, "");
const key = cfg.supabaseAnonKey || "";

/** True once the owner has filled config.js; until then the leaderboard stays off. */
export const backendConfigured = Boolean(base && key);

export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {string} [code] */
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function headers(extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/** @param {Response} res */
async function parse(res) {
  const text = await res.text();
  /** @type {any} */
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    throw new ApiError((body && (body.error || body.message)) || `Request failed (${res.status})`, res.status, body && body.code);
  }
  return body;
}

/** @param {string} path */
async function rest(path) {
  if (!backendConfigured) throw new ApiError("Leaderboard service is not configured", 0, "not_configured");
  const res = await fetch(`${base}/rest/v1/${path}`, { headers: headers({ Accept: "application/json" }) });
  return parse(res);
}

/**
 * @param {string} name edge function name
 * @param {unknown} body
 * @param {string} [session] wallet session token
 */
async function fn(name, body, session) {
  if (!backendConfigured) throw new ApiError("Leaderboard service is not configured", 0, "not_configured");
  /** @type {Record<string, string>} */
  const extra = { "Content-Type": "application/json" };
  if (session) extra["x-session-token"] = session;
  const res = await fetch(`${base}/functions/v1/${name}`, {
    method: "POST",
    headers: headers(extra),
    body: JSON.stringify(body ?? {}),
  });
  return parse(res);
}

/**
 * @typedef {{ rank: number, wallet_address: string, best_score: number, achieved_at: string }} BoardRow
 * @returns {Promise<BoardRow[]>}
 */
export function fetchLeaderboard() {
  return rest("leaderboard_top100?select=rank,wallet_address,best_score,achieved_at&order=rank.asc&limit=100");
}

/**
 * @param {string} address lowercase 0x address
 * @returns {Promise<{ best_score: number, achieved_at: string, runs_submitted: number } | null>}
 */
export async function fetchBest(address) {
  const rows = await rest(`best_scores?select=best_score,achieved_at,runs_submitted&wallet_address=eq.${encodeURIComponent(address)}`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Step 1 of sign-in: the server writes the exact message to sign and remembers its nonce.
 * @param {{ address: string, chainId: number, domain: string, uri: string }} p
 * @returns {Promise<{ nonce: string, message: string }>}
 */
export function requestNonce(p) {
  return fn("auth-nonce", p);
}

/**
 * Step 2 of sign-in: send the signature back and receive a session token.
 * @param {{ nonce: string, signature: string, address: string }} p
 * @returns {Promise<{ token: string, address: string, expiresAt: string }>}
 */
export function verifySignature(p) {
  return fn("auth-verify", p);
}

/**
 * Opens a ranked run. The server timestamps it, so a score can be checked against real time.
 * @param {string} session
 * @returns {Promise<{ runId: string, startedAt: string }>}
 */
export function startRun(session) {
  return fn("run-start", {}, session);
}

/**
 * Closes a ranked run with its result.
 * @param {string} session
 * @param {{ runId: string, score: number, seeds: number, friends: number, durationMs: number }} run
 * @returns {Promise<{ accepted: boolean, bestScore: number, isNewBest: boolean, rank: number | null }>}
 */
export function submitScore(session, run) {
  return fn("score-submit", run, session);
}

/** Ends the session on the server. Failure is harmless: the token also expires. @param {string} session */
export function signOut(session) {
  return fn("auth-signout", {}, session).catch(() => null);
}

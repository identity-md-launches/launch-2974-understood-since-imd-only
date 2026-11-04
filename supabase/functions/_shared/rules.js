// @ts-check
/**
 * Server-side plausibility rules for a ranked run. Plain JavaScript so both the Edge Functions
 * (Deno) and the Node tests in tests/ import the same file. Mirrors site/js/game.js:
 *   score = seeds * 1 + friends * 5; items spawn at most about 3 per second at top speed.
 * A browser game cannot prove a score was earned; these checks make forging one expensive:
 * the run must be opened by the server first, the claimed duration must fit inside the server's
 * own clock, and the score must be reachable in that time.
 */

export const SEED_POINTS = 1;
export const FRIEND_POINTS = 5;
/** Highest catch rate the spawner allows (items per second), with headroom. */
export const MAX_ITEMS_PER_SECOND = 3.2;
/** Most points a single item can give. */
export const MAX_POINTS_PER_ITEM = FRIEND_POINTS;
/** Hearts are 10% of spawns; allow generous headroom (35% of the most items the time allows). */
export const MAX_FRIEND_SHARE = 0.35;
export const MIN_DURATION_MS = 3_000;
export const MAX_RUN_AGE_MS = 2 * 60 * 60 * 1000; // a run must be submitted within two hours
export const CLOCK_SLACK_MS = 5_000; // network and frame jitter
export const MAX_SCORE = 1_000_000;

/**
 * @param {{ score: unknown, seeds: unknown, friends: unknown, durationMs: unknown }} claim
 * @param {number} serverElapsedMs time between run-start and score-submit on the server's clock
 * @returns {{ ok: true, score: number, seeds: number, friends: number, durationMs: number } | { ok: false, reason: string }}
 */
export function checkRun(claim, serverElapsedMs) {
  const ints = ["score", "seeds", "friends", "durationMs"];
  for (const k of ints) {
    const v = /** @type {any} */ (claim)[k];
    if (!Number.isInteger(v) || v < 0) return { ok: false, reason: `${k} must be a whole number of 0 or more` };
  }
  const score = /** @type {number} */ (claim.score);
  const seeds = /** @type {number} */ (claim.seeds);
  const friends = /** @type {number} */ (claim.friends);
  const durationMs = /** @type {number} */ (claim.durationMs);

  if (score > MAX_SCORE) return { ok: false, reason: "score is out of range" };
  if (score !== seeds * SEED_POINTS + friends * FRIEND_POINTS) return { ok: false, reason: "score does not match seeds and friends" };
  if (serverElapsedMs > MAX_RUN_AGE_MS) return { ok: false, reason: "run expired; start a new game" };
  if (durationMs < MIN_DURATION_MS && score > 0) return { ok: false, reason: "run is too short" };
  if (durationMs > serverElapsedMs + CLOCK_SLACK_MS) return { ok: false, reason: "run lasted longer than the server saw" };

  const seconds = Math.max(durationMs, 1) / 1000;
  const items = seeds + friends;
  if (items > Math.ceil(seconds * MAX_ITEMS_PER_SECOND) + 2) return { ok: false, reason: "more catches than the game can drop in that time" };
  if (friends > Math.ceil(seconds * MAX_ITEMS_PER_SECOND * MAX_FRIEND_SHARE) + 2) return { ok: false, reason: "more friends than the game can drop in that time" };

  return { ok: true, score, seeds, friends, durationMs };
}

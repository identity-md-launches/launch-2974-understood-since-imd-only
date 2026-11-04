// Unit checks for the server's score plausibility rules and the game's scoring formula.
// Run with `npm test` (node --test). No dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRun, MAX_RUN_AGE_MS } from "../supabase/functions/_shared/rules.js";
import { scoreOf, RULES } from "../site/js/game.js";

test("game score formula matches the server's", () => {
  assert.equal(scoreOf(10, 2), 10 * RULES.seedPoints + 2 * RULES.friendPoints);
  assert.equal(scoreOf(10, 2), 20);
});

test("accepts an ordinary run", () => {
  const r = checkRun({ score: 45, seeds: 30, friends: 3, durationMs: 60_000 }, 61_000);
  assert.equal(r.ok, true);
});

test("accepts a zero-point run of any length", () => {
  assert.equal(checkRun({ score: 0, seeds: 0, friends: 0, durationMs: 800 }, 1_000).ok, true);
});

test("rejects a score that does not match its catches", () => {
  const r = checkRun({ score: 999, seeds: 30, friends: 3, durationMs: 60_000 }, 61_000);
  assert.equal(r.ok, false);
});

test("rejects a run longer than the server saw", () => {
  const r = checkRun({ score: 45, seeds: 30, friends: 3, durationMs: 120_000 }, 30_000);
  assert.equal(r.ok, false);
});

test("rejects more catches than can fall in the time", () => {
  const r = checkRun({ score: 500, seeds: 500, friends: 0, durationMs: 20_000 }, 21_000);
  assert.equal(r.ok, false);
});

test("rejects more friends than hearts can fall in the time", () => {
  const r = checkRun({ score: 200, seeds: 0, friends: 40, durationMs: 20_000 }, 21_000);
  assert.equal(r.ok, false);
});

test("accepts a hearts-only run at a realistic rate", () => {
  const r = checkRun({ score: 30, seeds: 0, friends: 6, durationMs: 60_000 }, 61_000);
  assert.equal(r.ok, true);
});

test("rejects negative, fractional and missing values", () => {
  assert.equal(checkRun({ score: -1, seeds: 0, friends: 0, durationMs: 5_000 }, 6_000).ok, false);
  assert.equal(checkRun({ score: 1.5, seeds: 1, friends: 0, durationMs: 5_000 }, 6_000).ok, false);
  assert.equal(checkRun({ score: 1, seeds: 1, friends: undefined, durationMs: 5_000 }, 6_000).ok, false);
});

test("rejects an expired run", () => {
  const r = checkRun({ score: 10, seeds: 10, friends: 0, durationMs: 30_000 }, MAX_RUN_AGE_MS + 1);
  assert.equal(r.ok, false);
});

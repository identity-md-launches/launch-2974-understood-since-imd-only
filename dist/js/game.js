// @ts-check
/**
 * Hamster Friendship game engine. Plain canvas, no dependencies.
 *
 * Rules (mirrored by the server's plausibility check in
 * supabase/functions/_shared/rules.js):
 *   - a seed is worth 1 point
 *   - a heart makes a friend and is worth 5 points
 *   - a burr costs one of three lives
 *   - score = seeds + 5 * friends
 *   - items fall faster every 15 seconds
 */

export const RULES = Object.freeze({
  width: 480,
  height: 360,
  seedPoints: 1,
  friendPoints: 5,
  lives: 3,
  levelSeconds: 15,
});

/** @typedef {"ready" | "playing" | "paused" | "over"} GameState */
/** @typedef {{ kind: "seed" | "heart" | "burr", x: number, y: number, vy: number, r: number, spin: number }} Item */
/**
 * @typedef {object} RunResult
 * @property {number} score
 * @property {number} seeds
 * @property {number} friends
 * @property {number} durationMs
 */
/**
 * @typedef {object} GameCallbacks
 * @property {(hud: { score: number, friends: number, lives: number }) => void} onHud
 * @property {(state: GameState, result?: RunResult) => void} onState
 */

const FUR = ["#e8a15a", "#c9c2b8", "#f4e3c9", "#b98552", "#9a8f86", "#f0c890"];

/** Score from the counted catches: the one formula the server checks too. */
export function scoreOf(seeds, friends) {
  return seeds * RULES.seedPoints + friends * RULES.friendPoints;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {GameCallbacks} cb
 */
export function createGame(canvas, cb) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const W = RULES.width;
  const H = RULES.height;
  const groundY = H - 34;

  /** @type {GameState} */
  let state = "ready";
  /** @type {Item[]} */
  let items = [];
  let px = W / 2;
  let targetX = /** @type {number | null} */ (null);
  let dir = 0; // -1, 0, 1 from keys or buttons
  let seeds = 0;
  let friends = 0;
  let lives = RULES.lives;
  let elapsed = 0; // seconds of play, pauses excluded
  let spawnIn = 0.6;
  let hurt = 0; // seconds of hurt flash left
  let facing = 1;
  let last = 0;
  let raf = 0;
  /** @type {number[]} */
  let trail = []; // past x positions, friends follow along it
  let rand = Math.random;

  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function hud() {
    cb.onHud({ score: scoreOf(seeds, friends), friends, lives });
  }

  function reset() {
    items = [];
    px = W / 2;
    targetX = null;
    seeds = 0;
    friends = 0;
    lives = RULES.lives;
    elapsed = 0;
    spawnIn = 0.6;
    hurt = 0;
    trail = [];
    hud();
  }

  function level() {
    return 1 + Math.floor(elapsed / RULES.levelSeconds);
  }

  function spawn() {
    const lv = level();
    const roll = rand();
    const burrChance = Math.min(0.16 + lv * 0.03, 0.34);
    /** @type {Item["kind"]} */
    const kind = roll < burrChance ? "burr" : roll < burrChance + 0.1 ? "heart" : "seed";
    const r = kind === "heart" ? 13 : kind === "burr" ? 14 : 10;
    items.push({
      kind,
      x: 24 + rand() * (W - 48),
      y: -r,
      vy: 85 + lv * 14 + rand() * 45,
      r,
      spin: rand() * Math.PI * 2,
    });
    spawnIn = Math.max(0.34, 0.95 - lv * 0.08) * (0.7 + rand() * 0.6);
  }

  /** @param {number} dt */
  function step(dt) {
    elapsed += dt;
    hurt = Math.max(0, hurt - dt);

    // Move the hamster: pointer target wins over keys.
    const speed = 340;
    if (targetX !== null) {
      const d = targetX - px;
      const move = Math.sign(d) * Math.min(Math.abs(d), speed * 1.4 * dt);
      if (Math.abs(move) > 0.2) facing = Math.sign(move);
      px += move;
    } else if (dir !== 0) {
      px += dir * speed * dt;
      facing = dir;
    }
    px = Math.max(26, Math.min(W - 26, px));
    trail.unshift(px);
    if (trail.length > 200) trail.length = 200;

    spawnIn -= dt;
    if (spawnIn <= 0) spawn();

    const catchY = groundY - 30;
    for (const it of items) {
      it.y += it.vy * dt;
      it.spin += dt * 2;
    }
    const kept = [];
    for (const it of items) {
      const reached = it.y + it.r >= catchY && it.y - it.r <= groundY;
      if (reached && Math.abs(it.x - px) < 28 + it.r * 0.6) {
        if (it.kind === "seed") seeds += 1;
        else if (it.kind === "heart") friends += 1;
        else {
          lives -= 1;
          hurt = 0.5;
        }
        hud();
        continue;
      }
      if (it.y - it.r > H) continue;
      kept.push(it);
    }
    items = kept;

    if (lives <= 0) {
      finish();
    }
  }

  /** @param {number} now */
  function frame(now) {
    if (state !== "playing") return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);
    draw();
    if (state === "playing") raf = requestAnimationFrame(frame);
  }

  function finish() {
    state = "over";
    cancelAnimationFrame(raf);
    draw();
    cb.onState("over", {
      score: scoreOf(seeds, friends),
      seeds,
      friends,
      durationMs: Math.round(elapsed * 1000),
    });
  }

  // ---------- drawing ----------

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#fff4df");
    sky.addColorStop(1, "#fde3b8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // sunflowers in the back
    for (let i = 0; i < 4; i++) {
      const x = 60 + i * 120;
      ctx.strokeStyle = "#8cae63";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, groundY - 90 - (i % 2) * 30);
      ctx.stroke();
      const fy = groundY - 90 - (i % 2) * 30;
      ctx.fillStyle = "#f6c544";
      for (let p = 0; p < 10; p++) {
        const a = (p / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * 13, fy + Math.sin(a) * 13, 8, 4, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#7a4a22";
      ctx.beginPath();
      ctx.arc(x, fy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#9cc278";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#86ad62";
    ctx.fillRect(0, groundY, W, 5);
  }

  /**
   * @param {number} x center
   * @param {number} y feet line
   * @param {number} s scale
   * @param {string} fur
   * @param {number} face 1 right, -1 left
   * @param {boolean} [blink]
   */
  function drawHamster(x, y, s, fur, face, blink = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * face, s);
    // shadow
    ctx.fillStyle = "rgba(59,36,18,0.15)";
    ctx.beginPath();
    ctx.ellipse(0, 2, 26, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // ears
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(-12, -38, 8, 0, Math.PI * 2);
    ctx.arc(10, -40, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f2a7a0";
    ctx.beginPath();
    ctx.arc(-12, -38, 4, 0, Math.PI * 2);
    ctx.arc(10, -40, 4, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, -18, 27, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    // belly
    ctx.fillStyle = "#fff6e6";
    ctx.beginPath();
    ctx.ellipse(6, -12, 15, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    // cheek
    ctx.fillStyle = "#f5b3a6";
    ctx.beginPath();
    ctx.arc(17, -20, 5, 0, Math.PI * 2);
    ctx.fill();
    // eye
    ctx.fillStyle = "#2b1a0e";
    if (blink) {
      ctx.fillRect(10, -29, 7, 2);
    } else {
      ctx.beginPath();
      ctx.arc(13, -28, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(14.2, -29.2, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // nose
    ctx.fillStyle = "#d9707a";
    ctx.beginPath();
    ctx.arc(25, -22, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // feet
    ctx.fillStyle = "#f2a7a0";
    ctx.beginPath();
    ctx.ellipse(-10, 0, 6, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(10, 0, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** @param {Item} it */
  function drawItem(it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    if (it.kind === "seed") {
      ctx.rotate(Math.sin(it.spin) * 0.5);
      ctx.fillStyle = "#3f3a36";
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e9e1d4";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-2.5, -7);
      ctx.lineTo(-2.5, 7);
      ctx.moveTo(2.5, -7);
      ctx.lineTo(2.5, 7);
      ctx.stroke();
    } else if (it.kind === "heart") {
      const k = 1 + Math.sin(it.spin * 2) * 0.06;
      ctx.scale(k, k);
      ctx.fillStyle = "#e0577a";
      ctx.beginPath();
      ctx.moveTo(0, 11);
      ctx.bezierCurveTo(-16, 0, -12, -14, 0, -6);
      ctx.bezierCurveTo(12, -14, 16, 0, 0, 11);
      ctx.fill();
    } else {
      ctx.rotate(it.spin);
      ctx.fillStyle = "#6e4b2a";
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? it.r * 0.62 : it.r;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#94683d";
      ctx.beginPath();
      ctx.arc(0, 0, it.r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    for (const it of items) drawItem(it);
    // friends follow the trail, up to six visible
    const shown = Math.min(friends, 6);
    for (let i = shown; i >= 1; i--) {
      const tx = trail[Math.min(i * 14, trail.length - 1)] ?? px;
      const fx = tx - facing * i * 30;
      drawHamster(Math.max(14, Math.min(W - 14, fx)), groundY + 2, 0.55, FUR[i % FUR.length], facing);
    }
    if (hurt === 0 || Math.floor(hurt * 12) % 2 === 0) {
      drawHamster(px, groundY + 2, 1, FUR[0], facing, hurt > 0);
    }
    if (friends > 6) {
      ctx.fillStyle = "#3b2412";
      ctx.font = "700 14px ui-rounded, system-ui, sans-serif";
      ctx.fillText(`+${friends - 6} more friends`, 10, H - 10);
    }
  }

  // ---------- public API ----------

  function start() {
    reset();
    state = "playing";
    last = performance.now();
    cb.onState("playing");
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    cancelAnimationFrame(raf);
    dir = 0;
    targetX = null;
    cb.onState("paused");
  }

  function resume() {
    if (state !== "paused") return;
    state = "playing";
    last = performance.now();
    cb.onState("playing");
    raf = requestAnimationFrame(frame);
  }

  /** @param {number} d -1, 0 or 1 */
  function setDirection(d) {
    dir = d;
    if (d !== 0) targetX = null;
  }

  /** @param {number | null} x field coordinate, or null to release */
  function setTarget(x) {
    targetX = x;
  }

  /** Testing hook: deterministic randomness. @param {() => number} fn */
  function setRandom(fn) {
    rand = fn;
  }

  /** Testing hook: run the simulation without animation frames. @param {number} seconds */
  function simulate(seconds) {
    if (state !== "playing") return;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps && state === "playing"; i++) step(1 / 60);
    if (state === "playing") draw();
  }

  window.addEventListener("resize", fitCanvas);
  fitCanvas();
  hud();

  return {
    start,
    pause,
    resume,
    setDirection,
    setTarget,
    setRandom,
    simulate,
    get state() {
      return state;
    },
    get snapshot() {
      return { seeds, friends, lives, score: scoreOf(seeds, friends), elapsed, px, items: items.length };
    },
  };
}

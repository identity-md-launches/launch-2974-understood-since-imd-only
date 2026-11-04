// @ts-check
import { createGame } from "./game.js";
import * as api from "./api.js";
import * as wallet from "./wallet.js";

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const els = {
  connect: /** @type {HTMLButtonElement} */ ($("connect")),
  canvas: /** @type {HTMLCanvasElement} */ ($("field")),
  overlay: $("overlay"),
  overlayTitle: $("overlay-title"),
  overlayText: $("overlay-text"),
  play: /** @type {HTMLButtonElement} */ ($("play-btn")),
  modeNote: $("mode-note"),
  left: /** @type {HTMLButtonElement} */ ($("left")),
  right: /** @type {HTMLButtonElement} */ ($("right")),
  gameCard: $("play"),
  status: $("game-status"),
  hudScore: $("hud-score"),
  hudBest: $("hud-best"),
  hudFriends: $("hud-friends"),
  hudLives: $("hud-lives"),
  refresh: /** @type {HTMLButtonElement} */ ($("refresh")),
  you: $("you"),
  boardState: $("board-state"),
  boardTable: $("board-table"),
  boardBody: $("board-body"),
  sheet: /** @type {HTMLDialogElement} */ ($("sheet")),
  sheetTitle: $("sheet-title"),
  sheetIntro: $("sheet-intro"),
  sheetBody: $("sheet-body"),
  sheetNote: $("sheet-note"),
  sheetClose: /** @type {HTMLButtonElement} */ ($("sheet-close")),
};

const KEYS = { session: "hf.session", wallet: "hf.wallet", guestBest: "hf.guestBest" };

/**
 * @typedef {{ token: string, address: string, expiresAt: string }} Session
 */
const app = {
  /** @type {wallet.WalletEntry | null} */ entry: null,
  /** @type {string | null} */ address: null,
  chainId: 1,
  /** @type {Session | null} */ session: readSession(),
  guestBest: Number(localStorage.getItem(KEYS.guestBest) || 0) || 0,
  /** @type {number | null} */ walletBest: null,
  /** @type {Promise<string | null> | null} */ runPromise: null,
  /** @type {api.BoardRow[]} */ board: [],
  busy: false,
};

// ---------- storage ----------

/** @returns {Session | null} */
function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEYS.session) || "null");
    if (s && s.token && s.address && Date.parse(s.expiresAt) > Date.now()) return s;
  } catch {
    /* ignore a corrupt entry */
  }
  localStorage.removeItem(KEYS.session);
  return null;
}

/** @param {Session | null} s */
function writeSession(s) {
  app.session = s;
  if (s) localStorage.setItem(KEYS.session, JSON.stringify(s));
  else localStorage.removeItem(KEYS.session);
}

function signedIn() {
  return Boolean(app.session && app.address && app.session.address === app.address);
}

// ---------- game ----------

const game = createGame(els.canvas, {
  onHud({ score, friends, lives }) {
    els.hudScore.textContent = String(score);
    els.hudFriends.textContent = String(friends);
    els.hudLives.textContent = String(lives);
  },
  onState(state, result) {
    if (state === "playing") {
      els.overlay.hidden = true;
      if (document.activeElement === els.play || document.activeElement === document.body) els.gameCard.focus({ preventScroll: true });
      announce("Game started.");
    } else if (state === "paused") {
      showOverlay("Paused", "Press P or select Resume to continue.", "Resume");
      announce("Game paused.");
    } else if (state === "over" && result) {
      onGameOver(result);
    }
  },
});
/** @type {any} */ (window).hamsterGame = game; // test hook, used by the interaction checks

/** @param {string} msg */
function announce(msg) {
  els.status.textContent = msg;
}

/** @param {string} title @param {string} text @param {string} action */
function showOverlay(title, text, action) {
  els.overlayTitle.textContent = title;
  els.overlayText.textContent = text;
  els.play.textContent = action;
  els.overlay.hidden = false;
  updateModeNote();
  els.play.focus({ preventScroll: true });
}

function startGame() {
  if (game.state === "paused") return game.resume();
  app.runPromise = null;
  if (signedIn() && api.backendConfigured && app.session) {
    const token = app.session.token;
    app.runPromise = api
      .startRun(token)
      .then((r) => r.runId)
      .catch((err) => {
        if (err && err.status === 401) expireSession();
        return null;
      });
  }
  game.start();
}

/** @param {import("./game.js").RunResult} result */
async function onGameOver(result) {
  const pts = `${result.score} ${result.score === 1 ? "point" : "points"}`;
  const friends = `${result.friends} ${result.friends === 1 ? "friend" : "friends"}`;
  const title = `Game over: ${pts}`;

  if (!signedIn() || !app.session) {
    const isBest = result.score > app.guestBest;
    if (isBest) {
      app.guestBest = result.score;
      localStorage.setItem(KEYS.guestBest, String(result.score));
    }
    updateBest();
    showOverlay(title, `You made ${friends}. ${isBest ? "New guest best." : `Guest best: ${app.guestBest}.`}`, "Play again");
    announce(`${title}. You made ${friends}.`);
    return;
  }

  const session = app.session;
  showOverlay(title, `You made ${friends}. Saving your score…`, "Play again");
  const runId = app.runPromise ? await app.runPromise : null;
  if (!runId) {
    els.overlayText.textContent = `You made ${friends}. This run was not ranked: unable to reach the leaderboard. Check your connection and play again.`;
    announce(`${title}. Not ranked.`);
    return;
  }
  try {
    const r = await api.submitScore(session.token, { runId, ...result });
    app.walletBest = r.bestScore;
    updateBest();
    const where = r.rank ? ` You are number ${r.rank}.` : "";
    els.overlayText.textContent = r.isNewBest
      ? `You made ${friends}. New best saved to the Top 100.${where}`
      : `You made ${friends}. Saved. Your best is still ${r.bestScore}.${where}`;
    announce(`${title}. Score saved.`);
    loadBoard();
  } catch (err) {
    if (err && /** @type {any} */ (err).status === 401) expireSession();
    els.overlayText.textContent = `You made ${friends}. This score was not ranked: ${errorText(err)}`;
    announce(`${title}. Not ranked.`);
  }
}

/** @param {unknown} err */
function errorText(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.endsWith(".") ? msg : `${msg}.`;
}

function updateBest() {
  const best = signedIn() ? app.walletBest ?? 0 : app.guestBest;
  els.hudBest.textContent = String(best);
}

function updateModeNote() {
  let note;
  if (signedIn() && app.address) note = `Signed in as ${wallet.shortAddress(app.address)}. Your best score counts on the Top 100.`;
  else if (app.address && api.backendConfigured) note = "Wallet connected but not signed in. Open the wallet menu to sign in, or play as guest.";
  else if (api.backendConfigured) note = "Playing as guest. Guest scores stay on this device and are not ranked.";
  else note = "Playing as guest. Guest scores stay on this device.";
  els.modeNote.textContent = note;
}

// Controls: keys, hold buttons, drag on the field.
/** @type {Set<string>} */
const held = new Set();
function applyKeys() {
  const l = held.has("left");
  const r = held.has("right");
  game.setDirection(l === r ? 0 : l ? -1 : 1);
  els.left.classList.toggle("is-held", l);
  els.right.classList.toggle("is-held", r);
}

window.addEventListener("keydown", (e) => {
  if (els.sheet.open) return;
  const k = e.key;
  if (k === "ArrowLeft" || k === "a" || k === "A") {
    held.add("left");
    applyKeys();
    if (game.state === "playing") e.preventDefault();
  } else if (k === "ArrowRight" || k === "d" || k === "D") {
    held.add("right");
    applyKeys();
    if (game.state === "playing") e.preventDefault();
  } else if (k === "p" || k === "P" || (k === "Escape" && game.state === "playing")) {
    if (game.state === "playing") game.pause();
    else if (game.state === "paused") game.resume();
  }
});
window.addEventListener("keyup", (e) => {
  const k = e.key;
  if (k === "ArrowLeft" || k === "a" || k === "A") held.delete("left");
  if (k === "ArrowRight" || k === "d" || k === "D") held.delete("right");
  applyKeys();
});
window.addEventListener("blur", () => {
  held.clear();
  applyKeys();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.pause();
});

/** @param {HTMLButtonElement} btn @param {"left" | "right"} side */
function holdButton(btn, side) {
  const on = (/** @type {PointerEvent} */ e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    held.add(side);
    applyKeys();
  };
  const off = () => {
    held.delete(side);
    applyKeys();
  };
  btn.addEventListener("pointerdown", on);
  btn.addEventListener("pointerup", off);
  btn.addEventListener("pointercancel", off);
  btn.addEventListener("lostpointercapture", off);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}
holdButton(els.left, "left");
holdButton(els.right, "right");

/** @param {PointerEvent} e */
function fieldX(e) {
  const rect = els.canvas.getBoundingClientRect();
  return ((e.clientX - rect.left) / rect.width) * 480;
}
let dragging = false;
els.canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  els.canvas.setPointerCapture(e.pointerId);
  game.setTarget(fieldX(e));
});
els.canvas.addEventListener("pointermove", (e) => {
  if (dragging) game.setTarget(fieldX(e));
});
const endDrag = () => {
  dragging = false;
  game.setTarget(null);
};
els.canvas.addEventListener("pointerup", endDrag);
els.canvas.addEventListener("pointercancel", endDrag);

els.play.addEventListener("click", startGame);

// ---------- leaderboard ----------

async function loadBoard() {
  if (!api.backendConfigured) {
    setBoardState(NOT_CONFIGURED);
    els.refresh.hidden = true;
    return;
  }
  els.refresh.disabled = true;
  if (!app.board.length) setBoardState("Loading the Top 100…");
  try {
    app.board = await api.fetchLeaderboard();
    renderBoard();
  } catch (err) {
    setBoardState("Unable to load the Top 100. Check your connection, then select Refresh.", true);
  } finally {
    els.refresh.disabled = false;
  }
}

/** @param {string} text @param {boolean} [error] */
function setBoardState(text, error = false) {
  els.boardState.textContent = text;
  els.boardState.classList.toggle("is-error", error);
  if (text) els.boardTable.hidden = !app.board.length;
}

const NOT_CONFIGURED = "The Top 100 opens once the leaderboard service is connected. Until then, every score is a guest score.";

function renderBoard() {
  els.boardBody.replaceChildren();
  if (!api.backendConfigured) {
    els.boardTable.hidden = true;
    setBoardState(NOT_CONFIGURED);
    renderYou();
    return;
  }
  if (!app.board.length) {
    els.boardTable.hidden = true;
    setBoardState("No ranked scores yet. Connect a wallet and play to take the first spot.");
    renderYou();
    return;
  }
  setBoardState("");
  els.boardTable.hidden = false;
  const me = signedIn() ? app.address : null;
  for (const row of app.board) {
    const tr = document.createElement("tr");
    const isMe = me !== null && row.wallet_address === me;
    if (isMe) tr.className = "is-you";
    const rank = document.createElement("td");
    rank.textContent = String(row.rank);
    const who = document.createElement("td");
    const addr = document.createElement("span");
    addr.className = "addr";
    addr.textContent = wallet.shortAddress(row.wallet_address);
    addr.title = row.wallet_address;
    who.append(addr);
    if (isMe) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "You";
      who.append(tag);
    }
    const best = document.createElement("td");
    best.className = "num";
    best.textContent = String(row.best_score);
    tr.append(rank, who, best);
    els.boardBody.append(tr);
  }
  renderYou();
}

function renderYou() {
  if (!signedIn() || !app.address) {
    els.you.hidden = true;
    return;
  }
  const mine = app.board.find((r) => r.wallet_address === app.address);
  els.you.hidden = false;
  if (mine) els.you.textContent = `You are number ${mine.rank} with ${mine.best_score} points.`;
  else if (app.walletBest !== null && app.walletBest > 0) els.you.textContent = `Your best is ${app.walletBest} points. Beat the number 100 score to join the table.`;
  else els.you.textContent = "Play a round to post your first ranked score.";
}

async function loadWalletBest() {
  if (!signedIn() || !app.address || !api.backendConfigured) return;
  try {
    const row = await api.fetchBest(app.address);
    app.walletBest = row ? row.best_score : 0;
  } catch {
    /* keep the last known value */
  }
  updateBest();
  renderYou();
}

els.refresh.addEventListener("click", loadBoard);

// ---------- wallet ----------

function updateConnectButton() {
  if (app.address) {
    els.connect.textContent = wallet.shortAddress(app.address);
    els.connect.setAttribute("aria-label", `Wallet ${wallet.shortAddress(app.address)}, open the wallet menu`);
  } else {
    els.connect.textContent = "Connect wallet";
    els.connect.removeAttribute("aria-label");
  }
}

/** @param {string} text @param {boolean} [error] */
function sheetNote(text, error = false) {
  els.sheetNote.textContent = text;
  els.sheetNote.classList.toggle("is-error", error);
}

/** @param {string} svgOrUrl @param {boolean} isSvg */
function iconImg(svgOrUrl, isSvg) {
  const img = document.createElement("img");
  img.width = 28;
  img.height = 28;
  img.alt = "";
  img.src = isSvg ? wallet.svgUrl(svgOrUrl) : svgOrUrl;
  return img;
}

function renderSheet() {
  els.sheetBody.replaceChildren();
  if (app.address) {
    els.sheetTitle.textContent = "Your wallet";
    els.sheetIntro.textContent = signedIn()
      ? "Signed in. Every finished run is checked and your best score is kept on the Top 100."
      : api.backendConfigured
        ? "Connected. Sign one free message to rank your scores. No transaction, no gas."
        : "Connected. Ranking opens once the leaderboard service is connected; until then scores stay on this device.";
    const box = document.createElement("div");
    box.className = "account";
    const addr = document.createElement("p");
    addr.className = "addr";
    addr.textContent = app.address;
    box.append(addr);
    if (!signedIn() && api.backendConfigured) {
      const sign = document.createElement("button");
      sign.type = "button";
      sign.className = "btn btn-primary";
      sign.textContent = app.busy ? "Check your wallet…" : "Sign in to rank scores";
      sign.disabled = app.busy;
      sign.addEventListener("click", () => signIn());
      box.append(sign);
    }
    const out = document.createElement("button");
    out.type = "button";
    out.className = "btn btn-secondary";
    out.textContent = "Disconnect";
    out.addEventListener("click", disconnect);
    box.append(out);
    els.sheetBody.append(box);
    return;
  }

  els.sheetTitle.textContent = "Connect a wallet";
  els.sheetIntro.textContent = "Connecting is optional. You sign one free message so your best score counts on the Top 100.";
  const found = wallet.listWallets();
  const mobile = wallet.isMobileBrowser();

  if (mobile && found.length === 0) {
    for (const w of wallet.OPEN_IN) {
      const a = document.createElement("a");
      a.className = "row";
      a.href = w.href(location.href);
      a.append(iconImg(w.id === "coinbase" ? wallet.ICONS.coinbase : wallet.ICONS.wallet, true));
      const label = document.createElement("span");
      label.textContent = `Open in ${w.name}`;
      a.append(label);
      els.sheetBody.append(a);
    }
    return;
  }

  if (found.length === 0) {
    const p = document.createElement("p");
    p.className = "sheet-intro";
    p.textContent = "No browser wallet found. Install MetaMask, then reload this page. You can keep playing as guest meanwhile.";
    const link = document.createElement("a");
    link.className = "row";
    link.href = "https://metamask.io/download/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(iconImg(wallet.ICONS.wallet, true));
    const label = document.createElement("span");
    label.textContent = "Get MetaMask (opens metamask.io)";
    link.append(label);
    els.sheetBody.append(p, link);
    return;
  }

  for (const w of found) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "row";
    b.dataset.rdns = w.info.rdns;
    b.disabled = app.busy;
    b.append(iconImg(w.info.icon || wallet.ICONS.wallet, !w.info.icon));
    const label = document.createElement("span");
    label.textContent = w.info.name;
    b.append(label);
    b.addEventListener("click", () => connectWith(w, label));
    els.sheetBody.append(b);
  }
}

/** @param {HTMLElement} [focusTarget] */
function openSheet(focusTarget) {
  wallet.discover();
  sheetNote("");
  renderSheet();
  if (!els.sheet.open) {
    if (game.state === "playing") game.pause();
    els.sheet.showModal();
  }
  const first = /** @type {HTMLElement | null} */ (els.sheetBody.querySelector("button, a"));
  (focusTarget || first || els.sheetClose).focus();
}

function closeSheet() {
  if (els.sheet.open) els.sheet.close();
}

els.connect.addEventListener("click", () => openSheet());
els.sheetClose.addEventListener("click", closeSheet);
els.sheet.addEventListener("click", (e) => {
  if (e.target === els.sheet) closeSheet(); // the backdrop
});
els.sheet.addEventListener("close", () => {
  els.connect.focus({ preventScroll: true });
});
wallet.onWalletsChanged(() => {
  if (els.sheet.open && !app.address && !app.busy) renderSheet();
});

/** @param {wallet.WalletEntry} w @param {HTMLElement} label */
async function connectWith(w, label) {
  app.busy = true;
  sheetNote("");
  els.sheetBody.querySelectorAll("button").forEach((b) => (b.disabled = true));
  label.textContent = `${w.info.name}: opening…`;
  try {
    const { address, chainId } = await wallet.connect(w);
    setAccount(w, address, chainId);
    localStorage.setItem(KEYS.wallet, w.info.rdns);
    app.busy = false;
    if (api.backendConfigured && !signedIn()) {
      await signIn();
    } else {
      renderSheet();
      sheetNote(api.backendConfigured ? "Signed in." : "Connected.");
    }
  } catch (err) {
    app.busy = false;
    renderSheet();
    sheetNote(
      wallet.isRejection(err)
        ? "Connection cancelled. Choose a wallet to try again."
        : `Unable to connect: ${errorText(err)} Try again or keep playing as guest.`,
      !wallet.isRejection(err),
    );
  }
}

/** @param {wallet.WalletEntry} w @param {string} address @param {number} chainId */
function setAccount(w, address, chainId) {
  const changed = app.address !== address;
  if (app.entry !== w) {
    app.entry = w;
    w.provider.on?.("accountsChanged", onAccountsChanged);
    w.provider.on?.("chainChanged", (/** @type {string} */ hex) => {
      const n = parseInt(hex, 16);
      if (Number.isFinite(n)) app.chainId = n;
    });
  }
  app.address = address;
  app.chainId = chainId;
  if (changed) {
    if (app.session && app.session.address !== address) writeSession(null);
    app.walletBest = null;
  }
  afterAccountChange();
}

/** @param {string[]} accounts */
function onAccountsChanged(accounts) {
  if (!accounts || !accounts.length) {
    disconnect();
    return;
  }
  if (app.entry) setAccount(app.entry, String(accounts[0]).toLowerCase(), app.chainId);
}

function afterAccountChange() {
  updateConnectButton();
  updateModeNote();
  updateBest();
  renderBoard();
  loadWalletBest();
  if (els.sheet.open && !app.busy) renderSheet();
}

async function signIn() {
  if (!app.entry || !app.address) return;
  app.busy = true;
  renderSheet();
  sheetNote("Check your wallet: sign the message to prove this wallet is yours. It is free and sends nothing.");
  try {
    const { nonce, message } = await api.requestNonce({
      address: app.address,
      chainId: app.chainId,
      domain: location.host,
      uri: location.origin + location.pathname,
    });
    const signature = await wallet.signMessage(app.entry, app.address, message);
    const s = await api.verifySignature({ nonce, signature, address: app.address });
    writeSession({ token: s.token, address: s.address.toLowerCase(), expiresAt: s.expiresAt });
    app.busy = false;
    afterAccountChange();
    closeSheet();
    announce("Signed in. Your scores now count on the Top 100.");
  } catch (err) {
    app.busy = false;
    renderSheet();
    sheetNote(
      wallet.isRejection(err)
        ? "Signature cancelled. Your wallet stays connected; sign in any time from this menu."
        : `Unable to sign in: ${errorText(err)} Check your connection and try again.`,
      !wallet.isRejection(err),
    );
  }
}

function expireSession() {
  writeSession(null);
  afterAccountChange();
}

async function disconnect() {
  const s = app.session;
  writeSession(null);
  if (s) api.signOut(s.token);
  try {
    await app.entry?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* not every wallet supports revoking; forgetting it locally is enough */
  }
  app.entry?.provider.removeListener?.("accountsChanged", onAccountsChanged);
  app.entry = null;
  app.address = null;
  app.walletBest = null;
  localStorage.removeItem(KEYS.wallet);
  afterAccountChange();
  closeSheet();
  announce("Wallet disconnected. Playing as guest.");
}

/** Reconnect silently after a reload when the wallet still trusts this page. */
async function restore() {
  const rdns = localStorage.getItem(KEYS.wallet);
  if (!rdns) return;
  wallet.discover();
  await new Promise((r) => setTimeout(r, 300));
  const w = wallet.findWallet(rdns);
  if (!w) return;
  try {
    const acct = await wallet.reconnect(w);
    if (acct) setAccount(w, acct.address, acct.chainId);
  } catch {
    /* stay a guest */
  }
}

// ---------- boot ----------

updateConnectButton();
updateModeNote();
updateBest();
wallet.discover();
loadBoard();
restore();

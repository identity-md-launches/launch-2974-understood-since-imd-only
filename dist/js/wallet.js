// @ts-check
/**
 * Wallets without a relay or SDK:
 *   - browser extensions by EIP-6963 discovery (MetaMask, Rabby, Brave, Phantom...), each by its own name and icon
 *   - a plain window.ethereum as "Browser wallet" when no extension announced itself
 *   - on a phone with no injected wallet, links that open this page inside a wallet's own browser
 */

/**
 * @typedef {{ request: (args: { method: string, params?: unknown[] }) => Promise<any>, on?: Function, removeListener?: Function, isMetaMask?: boolean }} Eip1193Provider
 * @typedef {{ uuid: string, name: string, icon: string, rdns: string }} WalletInfo
 * @typedef {{ info: WalletInfo, provider: Eip1193Provider }} WalletEntry
 */

/** @type {Map<string, WalletEntry>} */
const announced = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

window.addEventListener("eip6963:announceProvider", (event) => {
  const detail = /** @type {CustomEvent} */ (event).detail;
  if (!detail || !detail.info || !detail.provider) return;
  announced.set(detail.info.rdns || detail.info.uuid, detail);
  listeners.forEach((l) => l());
});

/** Asks every installed extension to announce itself. */
export function discover() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** @param {() => void} fn */
export function onWalletsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Installed wallets, MetaMask first because the game names it. @returns {WalletEntry[]} */
export function listWallets() {
  const list = [...announced.values()];
  if (list.length === 0) {
    const eth = /** @type {any} */ (window).ethereum;
    if (eth && typeof eth.request === "function") {
      list.push({
        info: { uuid: "injected", name: eth.isMetaMask ? "MetaMask" : "Browser wallet", icon: "", rdns: "injected" },
        provider: eth,
      });
    }
  }
  return list.sort((a, b) => rankOf(a) - rankOf(b) || a.info.name.localeCompare(b.info.name));
}

/** @param {WalletEntry} w */
function rankOf(w) {
  return w.info.rdns === "io.metamask" || w.info.name === "MetaMask" ? 0 : 1;
}

/** @param {string} rdns */
export function findWallet(rdns) {
  return listWallets().find((w) => w.info.rdns === rdns) || null;
}

/** A phone or tablet browser with no injected wallet: the case the open-in links exist for. */
export function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(/** @type {any} */ (window).ethereum);
}

/** Each link is the one its vendor documents; none needs a project ID or a server. */
export const OPEN_IN = [
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks
  { id: "metamask", name: "MetaMask", href: (/** @type {string} */ url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}` },
  // https://docs.cdp.coinbase.com/wallet-sdk/docs/deep-link
  { id: "coinbase", name: "Coinbase Wallet", href: (/** @type {string} */ url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  // https://docs.phantom.com/phantom-deeplinks/other-methods/browse
  {
    id: "phantom",
    name: "Phantom",
    href: (/** @type {string} */ url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];

/** Marks for rows that carry no icon of their own. Coinbase's is the official mark. */
export const ICONS = {
  coinbase:
    '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="28" fill="#2C5FF6"/><path fill-rule="evenodd" clip-rule="evenodd" d="M14 23.8C19.4124 23.8 23.8 19.4124 23.8 14C23.8 8.58761 19.4124 4.2 14 4.2C8.58761 4.2 4.2 8.58761 4.2 14C4.2 19.4124 8.58761 23.8 14 23.8ZM11.55 10.8C11.1358 10.8 10.8 11.1358 10.8 11.55V16.45C10.8 16.8642 11.1358 17.2 11.55 17.2H16.45C16.8642 17.2 17.2 16.8642 17.2 16.45V11.55C17.2 11.1358 16.8642 10.8 16.45 10.8H11.55Z" fill="white"/></svg>',
  wallet:
    '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="28" height="28" rx="6" fill="#FCEFD9"/><rect x="5" y="8" width="18" height="13" rx="3" stroke="#3B2412" stroke-width="2"/><path d="M5 11h15" stroke="#3B2412" stroke-width="2"/><circle cx="18.5" cy="15.5" r="1.5" fill="#3B2412"/></svg>',
};

/** @param {string} svg */
export const svgUrl = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** @param {string} a */
export const shortAddress = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Prompts the wallet for an account.
 * @param {WalletEntry} w
 * @returns {Promise<{ address: string, chainId: number }>}
 */
export async function connect(w) {
  const accounts = await w.provider.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts[0]) throw new Error("The wallet returned no account");
  return { address: String(accounts[0]).toLowerCase(), chainId: await chainIdOf(w) };
}

/**
 * Reconnects silently after a reload, if the wallet still trusts this page.
 * @param {WalletEntry} w
 */
export async function reconnect(w) {
  const accounts = await w.provider.request({ method: "eth_accounts" });
  if (!accounts || !accounts[0]) return null;
  return { address: String(accounts[0]).toLowerCase(), chainId: await chainIdOf(w) };
}

/** @param {WalletEntry} w */
async function chainIdOf(w) {
  try {
    const hex = await w.provider.request({ method: "eth_chainId" });
    const n = parseInt(String(hex), 16);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/** @param {string} text */
function utf8Hex(text) {
  return "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Signs a plain-text message (EIP-191 personal_sign). Free: no transaction, no gas.
 * @param {WalletEntry} w
 * @param {string} address
 * @param {string} message
 * @returns {Promise<string>}
 */
export function signMessage(w, address, message) {
  return w.provider.request({ method: "personal_sign", params: [utf8Hex(message), address] });
}

/** True when the wallet's prompt was dismissed by the person, not a failure. @param {any} err */
export function isRejection(err) {
  return Boolean(err && (err.code === 4001 || /reject|denied|cancel/i.test(String(err.message || ""))));
}

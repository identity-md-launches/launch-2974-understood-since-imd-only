// Builds the static export: copies site/ to dist/ unchanged, then writes dist/config.js from
// PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY when both are set. No bundler, no dependencies:
// every URL in the site is relative, so dist/ works at a gateway subpath or an ENS name.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "site");
const out = path.join(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });

const url = (process.env.PUBLIC_SUPABASE_URL || "").trim();
const key = (process.env.PUBLIC_SUPABASE_ANON_KEY || "").trim();
if (url && key) {
  if (!/^https:\/\/[^\s"']+$/.test(url)) throw new Error("PUBLIC_SUPABASE_URL must be an https URL");
  if (/service_role|sb_secret_/.test(key) || /"role"\s*:\s*"service_role"/.test(decodeJwtPayload(key))) {
    throw new Error("PUBLIC_SUPABASE_ANON_KEY looks like a service role / secret key. Use the anon or publishable key.");
  }
  const template = await readFile(path.join(src, "config.js"), "utf8");
  const filled = template
    .replace(/supabaseUrl: "[^"]*"/, `supabaseUrl: ${JSON.stringify(url)}`)
    .replace(/supabaseAnonKey: "[^"]*"/, `supabaseAnonKey: ${JSON.stringify(key)}`);
  await writeFile(path.join(out, "config.js"), filled);
  console.log(`dist/config.js points at ${url}`);
} else {
  console.log("dist/config.js left empty: leaderboard off until PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are set");
}
console.log("Built dist/ from site/");

/** @param {string} jwt */
function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  if (!part) return "";
  try {
    return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

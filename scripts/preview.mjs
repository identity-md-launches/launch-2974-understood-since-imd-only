// Serves dist/ under /preview/ (a subpath, like an IPFS gateway) on http://localhost:4173/preview/.
// Stop it with Ctrl+C. No dependencies.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/preview/")) {
    res.writeHead(302, { Location: "/preview/" });
    return res.end();
  }
  let rel = decodeURIComponent(url.pathname.slice("/preview/".length)) || "index.html";
  const file = path.resolve(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const s = await stat(file);
    const target = s.isDirectory() ? path.join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, () => console.log(`Previewing dist/ at http://localhost:${port}/preview/`));

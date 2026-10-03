// Serves the film's stand-in sites (sites/<host>/…) for the capture instance, which maps *.example here
// (--host-resolver-rules). They are generic pages built for the film: no real brand, logo, headline or photo.
// usage: node sites/serve.mjs <port>
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, host, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!file.startsWith(join(root, host)) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
}).listen(Number(process.argv[2] || 47231), "127.0.0.1");

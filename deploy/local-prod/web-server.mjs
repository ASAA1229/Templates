#!/usr/bin/env node
/**
 * Minimal production web server: serves the built SPA (history fallback) and proxies /api to the API
 * container, so the browser sees one origin (cookies and CSRF origin checks stay same-origin).
 * No dependencies; configured with PORT, API_URL and WEB_DIST_DIR.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";

const port = Number(process.env.PORT ?? 8200);
const api = new URL(process.env.API_URL ?? "http://api:8201");
const root = path.resolve(process.env.WEB_DIST_DIR ?? "/app/apps/web/dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const baseHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    const upstream = httpRequest(
      {
        host: api.hostname,
        port: api.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "" },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" }).end('{"error":{"message":"API unavailable"}}');
    });
    req.pipe(upstream);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) && file !== root) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(root, "index.html");
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    ...baseHeaders,
    "content-type": types[ext] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => console.log(`web listening on ${port}`));

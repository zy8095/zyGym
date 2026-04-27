import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sessionsHandler, plansHandler, progressHandler, equipmentHandler, settingsHandler, meHandler, healthHandler } = require("../api/shared/handlers");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "web");
const dataRoot = path.join(root, "data");
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || "127.0.0.1";

process.env.LOCAL_DB_PATH ||= path.join(dataRoot, "gym-checkin.local.json");
await mkdir(dataRoot, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    send(res, 500, { "content-type": "text/plain; charset=utf-8" }, "internal server error");
  }
});

server.listen(port, host, () => {
  console.log(`Gym Check-in dev server: http://${host}:${port}`);
});

async function handleApi(req, res, url) {
  const fnReq = {
    method: req.method,
    headers: req.headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body: await readJsonBody(req)
  };

  let response;
  if (url.pathname === "/api/sessions") response = await sessionsHandler(fnReq);
  else if (url.pathname === "/api/plans") response = await plansHandler(fnReq);
  else if (url.pathname === "/api/progress") response = await progressHandler(fnReq);
  else if (url.pathname === "/api/equipment") response = await equipmentHandler(fnReq);
  else if (url.pathname === "/api/settings") response = await settingsHandler(fnReq);
  else if (url.pathname === "/api/me") response = await meHandler(fnReq);
  else if (url.pathname === "/api/health") response = await healthHandler(fnReq);
  else response = { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "not found" }) };

  send(res, response.status || 200, response.headers || {}, response.body || "");
}

async function readJsonBody(req) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(webRoot, safePath);
  if (!filePath.startsWith(webRoot)) {
    send(res, 403, { "content-type": "text/plain; charset=utf-8" }, "forbidden");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] || "application/octet-stream";

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    const fallback = path.join(webRoot, "index.html");
    sendStream(res, fallback, "text/html; charset=utf-8");
  });
  stream.on("open", () => {
    res.writeHead(200, { "content-type": contentType });
    stream.pipe(res);
  });
}

function sendStream(res, filePath, contentType) {
  const stream = createReadStream(filePath);
  stream.on("error", () => send(res, 404, { "content-type": "text/plain; charset=utf-8" }, "not found"));
  stream.on("open", () => {
    res.writeHead(200, { "content-type": contentType });
    stream.pipe(res);
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

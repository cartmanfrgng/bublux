const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const THREE_DIR = path.join(__dirname, "node_modules", "three", "build");
const rooms = new Map();
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PLAYERS = 48;
const MAX_CHAT_MESSAGES = 40;
const PLAYER_TTL_MS = 30_000;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function getRoom(name) {
  const key = String(name || "sunny-side").trim().slice(0, 24) || "sunny-side";
  if (!rooms.has(key)) {
    const blocks = new Map();
    const addBlock = (x, y, z, color, owner) => {
      const block = { x, y, z, color, owner };
      blocks.set(`${x},${y},${z}`, block);
    };
    if (key === "sunny-side") {
      for (const z of [0, 1]) addBlock(4, 5, z, "#805333", "Riverstone");
      for (const [x, y] of [[3, 5], [4, 4], [4, 5], [4, 6], [5, 5]]) addBlock(x, y, 2, "#389449", "Riverstone");
      for (const [x, y] of [[14, 4], [14, 5], [15, 4], [15, 5]]) addBlock(x, y, 0, "#e5c36c", "Riverstone");
      for (const [x, y] of [[14, 4], [15, 4], [15, 5]]) addBlock(x, y, 1, "#d44e43", "Riverstone");
      addBlock(14, 5, 1, "#f2d986", "Riverstone");
    } else if (key === "cloud-docks") {
      for (let x = 3; x <= 8; x++) addBlock(x, 14, 0, "#a77c4b", "peachybuilds");
      for (const x of [4, 7]) addBlock(x, 14, 1, "#c49a62", "peachybuilds");
      for (const [x, y] of [[5, 12], [6, 12], [7, 12], [5, 13], [6, 13]]) addBlock(x, y, 0, "#4b82bd", "peachybuilds");
    } else if (key === "mossy-garden") {
      for (const z of [0, 1]) addBlock(4, 4, z, "#805333", "mossybrick");
      for (const [x, y] of [[3, 4], [4, 3], [4, 4], [4, 5], [5, 4]]) addBlock(x, y, 2, "#3d8846", "mossybrick");
      for (const [x, y] of [[14, 14], [15, 14], [14, 15], [15, 15]]) addBlock(x, y, 0, "#c8b589", "mossybrick");
      for (const [x, y] of [[14, 14], [15, 14], [14, 15], [15, 15]]) addBlock(x, y, 1, "#587b51", "mossybrick");
    }
    rooms.set(key, { players: new Map(), blocks, messages: [] });
  }
  return [key, rooms.get(key)];
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maxLength, fallback = "") {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength) || fallback;
}

function snapshot(room) {
  const now = Date.now();
  let online = 0;
  for (const currentRoom of rooms.values()) {
    for (const [id, player] of currentRoom.players) {
      if (now - player.updatedAt > PLAYER_TTL_MS) currentRoom.players.delete(id);
    }
    online += currentRoom.players.size;
  }
  return {
    online,
    players: [...room.players.values()].map(({ updatedAt, ...player }) => player),
    blocks: [...room.blocks.values()],
    messages: room.messages,
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }
  const roomName = url.searchParams.get("room") || "sunny-side";
  const [, room] = getRoom(roomName);

  if (request.method === "GET" && url.pathname === "/api/state") {
    return sendJson(response, 200, snapshot(room));
  }

  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed" });
  const data = await readJson(request);

  if (url.pathname === "/api/join") {
    const id = cleanText(data.id, 48);
    if (!id) return sendJson(response, 400, { error: "A player id is required" });
    if (!room.players.has(id) && room.players.size >= MAX_PLAYERS) {
      return sendJson(response, 429, { error: "This room is full" });
    }
    const previous = room.players.get(id);
    const player = {
      id,
      name: cleanText(data.name, 18, "Builder"),
      color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#ffbd59",
      x: Number.isFinite(data.x) ? Math.max(0, Math.min(19, data.x)) : previous?.x ?? 9,
      y: Number.isFinite(data.y) ? Math.max(0, Math.min(19, data.y)) : previous?.y ?? 9,
      rotation: Number.isFinite(data.rotation) ? data.rotation : previous?.rotation ?? Math.PI,
      updatedAt: Date.now(),
    };
    room.players.set(id, player);
    return sendJson(response, 200, snapshot(room));
  }

  if (url.pathname === "/api/move") {
    const player = room.players.get(cleanText(data.id, 48));
    if (!player) return sendJson(response, 404, { error: "Player not found in this room" });
    if (Number.isFinite(data.x)) player.x = Math.max(0, Math.min(19, data.x));
    if (Number.isFinite(data.y)) player.y = Math.max(0, Math.min(19, data.y));
    if (Number.isFinite(data.rotation)) player.rotation = data.rotation;
    player.updatedAt = Date.now();
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === "/api/block") {
    const x = Number(data.x);
    const y = Number(data.y);
    const z = Number(data.z ?? 0);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
      || x < 0 || x > 19 || y < 0 || y > 19 || z < 0 || z > 20) {
      return sendJson(response, 400, { error: "Block coordinates are outside the world" });
    }
    const key = `${x},${y},${z}`;
    if (data.action === "remove") {
      room.blocks.delete(key);
    } else {
      if (!/^#[0-9a-f]{6}$/i.test(data.color)) return sendJson(response, 400, { error: "A valid block color is required" });
      room.blocks.set(key, { x, y, z, color: data.color, owner: cleanText(data.name, 18, "Builder") });
    }
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === "/api/chat") {
    const message = cleanText(data.message, 180);
    if (!message) return sendJson(response, 400, { error: "Message cannot be empty" });
    room.messages.push({
      id: randomUUID(),
      name: cleanText(data.name, 18, "Builder"),
      color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#ffbd59",
      message,
      at: Date.now(),
    });
    room.messages = room.messages.slice(-MAX_CHAT_MESSAGES);
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "Not found" });
}

function serveStatic(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    return response.end("Invalid path");
  }
  const isThreeModule = pathname === "/vendor/three.module.js" || pathname === "/vendor/three.core.js";
  const root = isThreeModule ? THREE_DIR : PUBLIC_DIR;
  const relativePath = pathname === "/" ? "/index.html" : isThreeModule ? pathname.slice("/vendor/".length) : pathname;
  const filePath = path.resolve(root, isThreeModule ? relativePath : `.${relativePath}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return response.end("Not found");
    }
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": isThreeModule ? "public, max-age=86400" : "no-cache",
    });
    response.end(content);
  });
}

function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
      else if (request.method === "GET") serveStatic(request, response, url);
      else sendJson(response, 405, { error: "Method not allowed" });
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : "Internal server error" });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`Bublux is ready at http://localhost:${PORT}`));
}

module.exports = { createServer, rooms };

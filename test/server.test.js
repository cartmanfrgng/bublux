const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer, rooms } = require("../server");

let server;
let baseUrl;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  rooms.clear();
});

test("serves the game and health endpoint", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Bublux/);
  assert.equal((await fetch(`${baseUrl}/app.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/styles.css`)).status, 200);
  assert.match(await (await fetch(`${baseUrl}/app.js`)).text(), /from "\/vendor\/three\.module\.js"/);
  assert.equal((await fetch(`${baseUrl}/vendor/three.module.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/vendor/three.core.js`)).status, 200);
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.deepEqual(health, { ok: true });
});

test("players, blocks, and chat are synchronized per room", async () => {
  const room = "test-hangout";
  const post = (endpoint, payload) => fetch(`${baseUrl}/api/${endpoint}?room=${room}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const joined = await post("join", { id: "player-one", name: "River", x: 4, y: 5, color: "#77b9a6" });
  assert.equal(joined.status, 200);
  await post("move", { id: "player-one", x: 6.5, y: 7.25 });
  await post("block", { x: 6, y: 7, color: "#f4a261", name: "River" });
  await post("chat", { name: "River", message: "hello, world!" });
  const state = await (await fetch(`${baseUrl}/api/state?room=${room}`)).json();
  assert.equal(state.online, 1);
  assert.deepEqual(state.players.map(({ id, x, y }) => ({ id, x, y })), [{ id: "player-one", x: 6.5, y: 7.25 }]);
  assert.deepEqual(state.blocks, [{ x: 6, y: 7, z: 0, color: "#f4a261", owner: "River" }]);
  await post("block", { x: 6, y: 7, z: 1, color: "#3366cc", name: "River" });
  let stacked = await (await fetch(`${baseUrl}/api/state?room=${room}`)).json();
  assert.equal(stacked.blocks.length, 2);
  assert.equal(stacked.blocks[1].z, 1);
  await post("block", { x: 6, y: 7, z: 1, action: "remove" });
  stacked = await (await fetch(`${baseUrl}/api/state?room=${room}`)).json();
  assert.deepEqual(stacked.blocks, [{ x: 6, y: 7, z: 0, color: "#f4a261", owner: "River" }]);
  assert.equal(state.messages[0].message, "hello, world!");
  const otherRoom = await (await fetch(`${baseUrl}/api/state?room=another-room`)).json();
  assert.equal(otherRoom.players.length, 0);
  assert.equal(otherRoom.blocks.length, 0);
});

test("featured games open with their own block-built starter scenes", async () => {
  for (const room of ["sunny-side", "cloud-docks", "mossy-garden"]) {
    const state = await (await fetch(`${baseUrl}/api/state?room=${room}`)).json();
    assert.ok(state.blocks.length > 0, `${room} should have starter builds`);
    assert.ok(state.blocks.every((block) => Number.isInteger(block.z) && block.color.startsWith("#")));
  }
});

test("rejects invalid block coordinates and empty chat", async () => {
  const badBlock = await fetch(`${baseUrl}/api/block?room=validation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x: 99, y: 2, color: "#f4a261" }),
  });
  assert.equal(badBlock.status, 400);
  const badStack = await fetch(`${baseUrl}/api/block?room=validation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x: 3, y: 2, z: 21, color: "#f4a261" }),
  });
  assert.equal(badStack.status, 400);
  const badChat = await fetch(`${baseUrl}/api/chat?room=validation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(badChat.status, 400);
});

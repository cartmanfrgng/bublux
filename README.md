# Bublux

Bublux is an original, browser-based block-building hangout with a warm, early-internet game feel. It is not affiliated with or a recreation of any existing game.

Its compact portal navigation and player-made game directory take inspiration from archived 2007–08 virtual-world portals; its six-part block avatar, round studs, third-person camera, and simple build tools are an original interpretation of early sandbox conventions.

Historical references: [2007 archived homepage](https://web.archive.org/web/20071231102412/http://www.roblox.com/), [2008 archived homepage](https://web.archive.org/web/20081201095306/http://www.roblox.com/), [2008 archived games directory](https://web.archive.org/web/20080603131708/http://www.roblox.com/Games.aspx). These are inspiration for broad-era patterns only; Bublux uses its own identity and assets.

## Run locally

Requires Node.js 18 or newer.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in one or more browser windows. Players who use the same room name can see one another, chat, and build together in a real-time 3D world. Room state is held in memory by the server and resets when it restarts. Bublux uses original, procedurally drawn block characters and environments; it is not affiliated with or a pixel-for-pixel copy of another game.

## Play

- Use **WASD** or the **arrow keys** to move your 3D block character, and **Space** to jump. Touch players can use the on-screen controls.
- Click the studded baseplate to place a brick; click an existing brick to stack another on top. Right-click a brick (or Alt-click) to remove it. Drag with the right mouse button to orbit the camera.
- Use the color swatches to change your block, and the chat box to talk with other players in your room.
- Change the room name in the top bar to meet up somewhere else.

## Checks

Run the server and API tests with:

```sh
npm test
```

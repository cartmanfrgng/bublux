import * as THREE from "/vendor/three.module.js";

(() => {
  const canvas = document.querySelector("#world-canvas");
  const roomInput = document.querySelector("#room-name");
  const playerId = localStorage.getItem("bublux-player-id") || crypto.randomUUID();
  localStorage.setItem("bublux-player-id", playerId);
  const playerName = localStorage.getItem("bublux-player-name") || `Builder ${Math.floor(10 + Math.random() * 90)}`;
  localStorage.setItem("bublux-player-name", playerName);
  const player = { id: playerId, name: playerName, color: "#3366cc", x: 9, y: 9, rotation: Math.PI };
  const colors = ["#e34b4b", "#3366cc", "#3a9b52", "#f4cf32", "#8d55c5"];
  let selectedColor = colors[0];
  let roomName = "sunny-side";
  let roomData = { players: [], blocks: [], messages: [] };
  let lastMessageIds = new Set();
  let lastMoveSent = 0;
  let tipTimer;
  let cameraYaw = 0;
  let cameraPitch = 0.36;
  let cameraDistance = 13;
  let dragPointer = null;
  let suppressContextMenu = false;
  let selectedTool = "build";
  let selectedBlock = null;
  let soundEnabled = false;
  let audioContext;
  let nextFootstepAt = 0;
  const pressedKeys = new Set();
  let jumpVelocity = 0;
  let jumpHeight = 0;
  const directorySearch = document.querySelector("#game-search");
  const directorySort = document.querySelector("#game-sort");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#83c8ef");
  scene.fog = new THREE.Fog("#83c8ef", 34, 90);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const blockMeshes = new Map();
  const remoteAvatars = new Map();
  const sunDirection = new THREE.Vector3(-12, 22, 10);
  const world = new THREE.Group();
  scene.add(world);

  scene.add(new THREE.HemisphereLight("#eaf8ff", "#586c45", 2.15));
  const sunlight = new THREE.DirectionalLight("#fff4d2", 2.5);
  sunlight.position.copy(sunDirection);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -24;
  sunlight.shadow.camera.right = 24;
  sunlight.shadow.camera.top = 24;
  sunlight.shadow.camera.bottom = -24;
  sunlight.shadow.bias = -0.0002;
  scene.add(sunlight);

  const flatMaterial = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(20, 0.7, 20), flatMaterial("#45a541"));
  ground.position.y = -0.35;
  ground.receiveShadow = true;
  ground.userData.ground = true;
  world.add(ground);
  const groundTop = new THREE.Mesh(new THREE.BoxGeometry(20, 0.04, 20), flatMaterial("#55b748"));
  groundTop.position.y = 0.02;
  groundTop.receiveShadow = true;
  groundTop.userData.ground = true;
  world.add(groundTop);
  const plateEdge = new THREE.Mesh(new THREE.BoxGeometry(20.5, 0.18, 20.5), flatMaterial("#328236"));
  plateEdge.position.y = -0.63;
  plateEdge.receiveShadow = true;
  world.add(plateEdge);

  const studGeometry = new THREE.CylinderGeometry(0.105, 0.105, 0.09, 12);
  const studMaterial = flatMaterial("#78ca55");
  const studRimMaterial = flatMaterial("#388b38");
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 20; z++) {
      const stud = new THREE.Mesh(studGeometry, studMaterial);
      stud.position.set(x - 9.5, 0.085, z - 9.5);
      stud.castShadow = true;
      stud.receiveShadow = true;
      world.add(stud);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.008, 4, 12), studRimMaterial);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x - 9.5, 0.13, z - 9.5);
      world.add(rim);
    }
  }

  function playSound(frequency = 420, duration = 0.08) {
    if (!soundEnabled) return;
    audioContext ||= new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.025, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  function addCloud(x, y, z, width) {
    const cloud = new THREE.Group();
    const material = flatMaterial("#f8fcff");
    for (const [dx, dy, dz, sx, sy, sz] of [
      [0, 0, 0, width, 0.8, 1.4],
      [-width * 0.2, 0.34, 0, width * 0.42, 0.8, 1.4],
      [width * 0.22, 0.25, 0, width * 0.52, 0.8, 1.4],
    ]) {
      const puff = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      puff.position.set(dx, dy, dz);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    scene.add(cloud);
  }

  addCloud(-13, 10, -14, 5);
  addCloud(16, 13, -11, 7);
  addCloud(-15, 14, 12, 6);
  addCloud(13, 9, 17, 4);
  const sun = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.3), flatMaterial("#ffe883"));
  sun.position.set(-24, 21, -33);
  scene.add(sun);

  function makeFace() {
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = 128;
    faceCanvas.height = 128;
    const ctx = faceCanvas.getContext("2d");
    ctx.fillStyle = "#f3cf32";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#51482c";
    ctx.fillRect(35, 43, 10, 14);
    ctx.fillRect(82, 43, 10, 14);
    ctx.fillStyle = "#9b4933";
    ctx.fillRect(52, 84, 25, 7);
    const texture = new THREE.CanvasTexture(faceCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const faceTexture = makeFace();

  function makeNameTag(name) {
    const label = document.createElement("canvas");
    label.width = 256;
    label.height = 48;
    const ctx = label.getContext("2d");
    ctx.font = "bold 24px Arial";
    const text = name.slice(0, 18);
    const textWidth = Math.min(232, ctx.measureText(text).width);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect((256 - textWidth - 22) / 2, 5, textWidth + 22, 36);
    ctx.strokeStyle = "#456781";
    ctx.lineWidth = 3;
    ctx.strokeRect((256 - textWidth - 22) / 2, 5, textWidth + 22, 36);
    ctx.fillStyle = "#264969";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 23, 220);
    const texture = new THREE.CanvasTexture(label);
    texture.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    tag.scale.set(2.2, 0.42, 1);
    tag.position.y = 3.45;
    tag.userData.texture = texture;
    return tag;
  }

  function createAvatar(name, shirtColor) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const yellow = flatMaterial("#f3cf32");
    const shirt = flatMaterial(shirtColor);
    const pants = flatMaterial("#315da6");
    const shoe = flatMaterial("#333940");
    const cuboid = (w, h, d, material, x, y, z, parent = body) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    cuboid(0.92, 1, 0.48, shirt, 0, 1.65, 0);
    cuboid(0.68, 0.68, 0.68, yellow, 0, 2.55, 0);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), new THREE.MeshBasicMaterial({ map: faceTexture }));
    face.position.set(0, 2.55, 0.344);
    body.add(face);
    const armLeft = new THREE.Group();
    armLeft.position.set(-0.64, 2.02, 0);
    body.add(armLeft);
    cuboid(0.3, 0.9, 0.38, yellow, 0, -0.38, 0, armLeft);
    const armRight = new THREE.Group();
    armRight.position.set(0.64, 2.02, 0);
    body.add(armRight);
    cuboid(0.3, 0.9, 0.38, yellow, 0, -0.38, 0, armRight);
    const legLeft = new THREE.Group();
    legLeft.position.set(-0.24, 0.95, 0);
    body.add(legLeft);
    cuboid(0.42, 1, 0.45, pants, 0, -0.35, 0, legLeft);
    cuboid(0.43, 0.23, 0.58, shoe, 0, -0.82, 0.055, legLeft);
    const legRight = new THREE.Group();
    legRight.position.set(0.24, 0.95, 0);
    body.add(legRight);
    cuboid(0.42, 1, 0.45, pants, 0, -0.35, 0, legRight);
    cuboid(0.43, 0.23, 0.58, shoe, 0, -0.82, 0.055, legRight);
    root.add(makeNameTag(name));
    root.userData = { body, armLeft, armRight, legLeft, legRight, name, shirtColor };
    return root;
  }

  function renderHeroPreview() {
    const previewCanvas = document.querySelector("#hero-canvas");
    const preview = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true });
    preview.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    preview.outputColorSpace = THREE.SRGBColorSpace;
    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color("#87c8ed");
    previewScene.fog = new THREE.Fog("#87c8ed", 20, 48);
    previewScene.add(new THREE.HemisphereLight("#e8f8ff", "#5d7148", 2.1));
    const keyLight = new THREE.DirectionalLight("#fff3d3", 2.3);
    keyLight.position.set(-8, 14, 8);
    previewScene.add(keyLight);
    const previewCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
    previewCamera.position.set(9, 7, 10);
    previewCamera.lookAt(0, 1.1, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(12, 0.65, 10), flatMaterial("#48a83f"));
    plate.position.y = -0.34;
    previewScene.add(plate);
    const plateTop = new THREE.Mesh(new THREE.BoxGeometry(12, 0.05, 10), flatMaterial("#5bb94a"));
    plateTop.position.y = 0.01;
    previewScene.add(plateTop);
    const previewStud = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10);
    for (let x = -5; x <= 5; x++) {
      for (let z = -4; z <= 4; z++) {
        const stud = new THREE.Mesh(previewStud, flatMaterial("#79c959"));
        stud.position.set(x, 0.085, z);
        previewScene.add(stud);
      }
    }
    const previewBuilder = createAvatar("Builder", "#df4848");
    previewBuilder.position.set(-1.1, 0, 1.1);
    previewBuilder.rotation.y = 0.55;
    previewScene.add(previewBuilder);
    const block = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), flatMaterial("#356dca"));
    block.position.set(1.4, 0.5, -0.5);
    previewScene.add(block);
    const blockStud = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12), flatMaterial("#5287dc"));
    blockStud.position.set(1.4, 1.07, -0.5);
    previewScene.add(blockStud);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), flatMaterial("#e4c735"));
    tower.position.set(3, 1, 1.4);
    previewScene.add(tower);
    const treeTrunk = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.6, 0.45), flatMaterial("#875a31"));
    treeTrunk.position.set(-3.4, 0.8, -1.2);
    previewScene.add(treeTrunk);
    const treeLeaves = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), flatMaterial("#389449"));
    treeLeaves.position.set(-3.4, 2.25, -1.2);
    previewScene.add(treeLeaves);
    const render = () => {
      const width = previewCanvas.clientWidth;
      const height = previewCanvas.clientHeight;
      if (!width || !height) return;
      preview.setSize(width, height, false);
      previewCamera.aspect = width / height;
      previewCamera.updateProjectionMatrix();
      preview.render(previewScene, previewCamera);
    };
    render();
    window.addEventListener("resize", render);
  }

  function renderWorldThumbnails() {
    for (const element of document.querySelectorAll(".world-thumb")) {
      const kind = element.dataset.scene;
      const thumbRenderer = new THREE.WebGLRenderer({ canvas: element, antialias: false });
      thumbRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
      const thumbScene = new THREE.Scene();
      thumbScene.background = new THREE.Color(kind === "garden" ? "#4c6473" : kind === "docks" ? "#83c6e6" : "#9ad5ef");
      thumbScene.add(new THREE.HemisphereLight("#eaf8ff", "#67764d", 2));
      const light = new THREE.DirectionalLight("#fff2d4", 2.3);
      light.position.set(-8, 14, 9);
      thumbScene.add(light);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
      camera.position.set(8, 6, 9);
      camera.lookAt(0, 0.6, 0);
      const baseColor = kind === "garden" ? "#557a43" : kind === "docks" ? "#7bbab8" : "#51ae46";
      const base = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 8), flatMaterial(baseColor));
      base.position.y = -0.28;
      base.receiveShadow = true;
      thumbScene.add(base);
      const studGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8);
      for (let x = -4; x <= 4; x++) {
        for (let z = -3; z <= 3; z++) {
          const stud = new THREE.Mesh(studGeo, flatMaterial(kind === "docks" ? "#9bd0c7" : "#78c957"));
          stud.position.set(x, 0.015, z);
          thumbScene.add(stud);
        }
      }
      const builder = createAvatar(kind === "docks" ? "Sailor" : kind === "garden" ? "Moss" : "Builder", kind === "garden" ? "#da77ad" : "#dc4949");
      builder.scale.setScalar(0.72);
      builder.position.set(-0.8, 0, 0.8);
      thumbScene.add(builder);
      const makeProp = (x, y, z, sx, sy, sz, color) => {
        const prop = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), flatMaterial(color));
        prop.position.set(x, y, z);
        thumbScene.add(prop);
      };
      if (kind === "meadow") {
        makeProp(-3, 1.1, -2.2, 0.5, 2.2, 0.5, "#805333");
        makeProp(-3, 2.7, -2.2, 2.1, 2.1, 2.1, "#369146");
        makeProp(2.3, 0.9, -1.2, 1.8, 1.8, 1.8, "#e1c136");
        makeProp(2.3, 2, -1.2, 1.8, 0.32, 1.8, "#d34f42");
      } else if (kind === "docks") {
        makeProp(2.3, 0.55, -1.2, 2.4, 1.1, 2.4, "#a77c4b");
        makeProp(2.3, 1.7, -1.2, 1.8, 1.3, 1.8, "#d7c3a0");
        makeProp(2.3, 2.55, -1.2, 2.2, 0.35, 2.2, "#b88955");
        makeProp(-2.9, 0.22, -2.2, 2.3, 0.36, 1.1, "#ddb875");
      } else {
        makeProp(-3, 0.55, -2.2, 0.5, 1.1, 0.5, "#805333");
        makeProp(-3, 1.6, -2.2, 1.9, 1.9, 1.9, "#388341");
        makeProp(2.6, 0.75, -1.5, 0.45, 1.5, 0.45, "#80a94c");
        makeProp(2.6, 1.7, -1.5, 1.3, 1.1, 1.3, "#719a49");
      }
      const width = element.clientWidth;
      const height = element.clientHeight;
      thumbRenderer.setSize(width || 220, height || 120, false);
      camera.aspect = (width || 220) / (height || 120);
      camera.updateProjectionMatrix();
      thumbRenderer.render(thumbScene, camera);
    }
  }

  renderHeroPreview();
  renderWorldThumbnails();

  let localAvatar = createAvatar(player.name, player.color);
  localAvatar.rotation.y = player.rotation;
  world.add(localAvatar);

  function blockMaterial(color) {
    return new THREE.MeshLambertMaterial({ color });
  }

  function blockKey(x, y, z = 0) {
    return `${x},${y},${z}`;
  }

  function buildBlock(block) {
    const group = new THREE.Group();
    const material = blockMaterial(block.color);
    const brick = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1, 0.92), material);
    brick.position.y = block.z + 0.5;
    brick.castShadow = true;
    brick.receiveShadow = true;
    group.add(brick);
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12), new THREE.MeshLambertMaterial({ color: block.color, emissive: block.color, emissiveIntensity: 0.07 }));
    stud.position.y = block.z + 1.07;
    stud.castShadow = true;
    group.add(stud);
    group.position.set(block.x - 9.5, 0, block.y - 9.5);
    group.userData = { blockX: block.x, blockY: block.y, blockZ: block.z, owner: block.owner };
    world.add(group);
    blockMeshes.set(blockKey(block.x, block.y, block.z), group);
  }

  function syncBlocks(blocks) {
    const wanted = new Set(blocks.map((block) => blockKey(block.x, block.y, block.z)));
    for (const [key, mesh] of blockMeshes) {
      if (!wanted.has(key)) {
        world.remove(mesh);
        mesh.traverse((part) => {
          part.geometry?.dispose();
          if (part.material && part.material !== faceTexture) part.material.dispose();
        });
        blockMeshes.delete(key);
      }
    }
    for (const block of blocks) {
      const key = blockKey(block.x, block.y, block.z);
      const existing = blockMeshes.get(key);
      if (existing?.userData.owner === block.owner && existing.children[0].material.color.getHexString() === block.color.slice(1)) continue;
      if (existing) {
        world.remove(existing);
        blockMeshes.delete(key);
      }
      buildBlock(block);
    }
  }

  function updateAvatarPosition(avatar, x, y, delta = 1) {
    const target = new THREE.Vector3(x - 9.5, 0, y - 9.5);
    avatar.position.lerp(target, Math.min(1, delta * 8));
  }

  function syncPlayers(players) {
    const present = new Set(players.map((person) => person.id));
    for (const [id, avatar] of remoteAvatars) {
      if (!present.has(id)) {
        world.remove(avatar);
        remoteAvatars.delete(id);
      }
    }
    for (const person of players) {
      if (person.id === player.id) continue;
      let avatar = remoteAvatars.get(person.id);
      if (!avatar) {
        avatar = createAvatar(person.name, person.color);
        remoteAvatars.set(person.id, avatar);
        world.add(avatar);
      }
      avatar.userData.targetPosition = new THREE.Vector3(person.x - 9.5, 0, person.y - 9.5);
      avatar.userData.targetRotation = person.rotation ?? Math.PI;
    }
  }

  function resizeCanvas() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const nameForRoom = (value) => value.split(/[-_]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ") || "Sunny Side";
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const request = async (path, payload) => {
    const response = await fetch(`${path}?room=${encodeURIComponent(roomName)}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "content-type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Could not reach this world");
    }
    return response.json();
  };

  function renderPlayers() {
    const list = document.querySelector("#player-list");
    document.querySelector("#room-count").textContent = `${roomData.players.length} ${roomData.players.length === 1 ? "builder" : "builders"}`;
    document.querySelector("#people-number").textContent = roomData.players.length;
    list.innerHTML = roomData.players.map((person) => `<div class="player-row"><span class="player-avatar" style="background:${person.color}">${escapeHtml(person.name.slice(0, 1).toUpperCase())}</span><span class="player-name">${escapeHtml(person.name)}${person.id === player.id ? '<span class="you-label">YOU</span>' : ""}</span></div>`).join("");
  }

  function renderMessages() {
    const container = document.querySelector("#chat-messages");
    const fresh = roomData.messages.filter((message) => !lastMessageIds.has(message.id));
    fresh.forEach((message) => lastMessageIds.add(message.id));
    if (fresh.length) {
      container.innerHTML = roomData.messages.map((message) => `<div class="chat-line"><strong style="color:${message.color}">${escapeHtml(message.name)}</strong>${escapeHtml(message.message)}</div>`).join("");
      container.scrollTop = container.scrollHeight;
    }
  }

  function updateUi() {
    syncBlocks(roomData.blocks);
    syncPlayers(roomData.players);
    renderPlayers();
    renderMessages();
    document.querySelector("#online-count").textContent = roomData.online;
    document.querySelector("#online-friends").textContent = `${roomData.online} ${roomData.online === 1 ? "builder" : "builders"}`;
    document.querySelector("#profile-button").textContent = player.name;
    document.querySelector("#coordinate").textContent = `x ${String(Math.round(player.x)).padStart(2, "0")} · y ${String(Math.round(player.y)).padStart(2, "0")}`;
    document.querySelector("#room-title").textContent = nameForRoom(roomName);
    updateDirectoryCounts();
  }

  function sortDirectory() {
    const cards = [...document.querySelectorAll(".world-card")];
    const query = directorySearch.value.trim().toLowerCase();
    for (const card of cards) {
      const matches = card.textContent.toLowerCase().includes(query);
      card.hidden = !matches;
    }
    const visible = cards.filter((card) => !card.hidden);
    visible.sort((a, b) => {
      if (directorySort.value === "name") return a.querySelector("strong").textContent.localeCompare(b.querySelector("strong").textContent);
      if (directorySort.value === "visits") return Number(b.dataset.visits) - Number(a.dataset.visits);
      const count = (card) => Number.parseInt(card.querySelector(".world-count")?.textContent || "0", 10) || 0;
      return count(b) - count(a);
    });
    const grid = document.querySelector(".world-grid");
    visible.forEach((card) => grid.append(card));
    const countLabel = document.querySelector(".listing-count");
    countLabel.textContent = `${visible.length} ${visible.length === 1 ? "world" : "worlds"}`;
  }

  directorySearch.addEventListener("input", sortDirectory);
  directorySort.addEventListener("change", sortDirectory);

  async function updateDirectoryCounts() {
    const cards = [...document.querySelectorAll(".world-card")];
    await Promise.all(cards.map(async (card) => {
      try {
        const response = await fetch(`/api/state?room=${encodeURIComponent(card.dataset.room)}`);
        if (!response.ok) return;
        const state = await response.json();
        const count = card.querySelector(".world-count");
        if (count) count.textContent = `${state.players.length} playing`;
      } catch {}
    }));
    sortDirectory();
  }

  async function refreshState() {
    try {
      roomData = await request("/api/join", { ...player });
      updateUi();
    } catch {
      document.querySelector("#room-count").textContent = "reconnecting…";
    }
  }

  function sendMove() {
    const now = Date.now();
    if (now - lastMoveSent < 100) return;
    lastMoveSent = now;
    request("/api/move", { id: player.id, x: player.x, y: player.y, rotation: player.rotation }).catch(() => {});
    document.querySelector("#coordinate").textContent = `x ${String(Math.round(player.x)).padStart(2, "0")} · y ${String(Math.round(player.y)).padStart(2, "0")}`;
  }

  function getBlockPosition(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(world.children, true);
    const blockHit = hits.find((item) => item.object.parent?.userData?.blockX !== undefined);
    if (blockHit) {
      const { blockX: x, blockY: y, blockZ: z } = blockHit.object.parent.userData;
      return { x, y, z, hitBlock: true };
    }
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, point)) return null;
    const x = Math.round(point.x + 9.5);
    const y = Math.round(point.z + 9.5);
    if (x < 0 || y < 0 || x > 19 || y > 19) return null;
    return { x, y, z: 0, hitBlock: false };
  }

  function setTool(tool) {
    selectedTool = tool;
    selectedBlock = null;
    document.querySelectorAll(".tool-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    const descriptions = {
      build: "Build · right-drag orbit · wheel zoom",
      move: "Click a brick, then where it should go",
      copy: "Click a brick, then where to copy it",
      delete: "Click a brick to delete it",
    };
    document.querySelector("#tool-message").textContent = descriptions[tool];
  }

  async function removeBlock(block) {
    await request("/api/block", { x: block.x, y: block.y, z: block.z, action: "remove" });
  }

  async function placeBlock(coordinates, color = selectedColor, owner = player.name) {
    await request("/api/block", { ...coordinates, color, name: owner });
  }

  async function editBlock(coordinates, action) {
    if (!coordinates) return;
    const { hitBlock, ...position } = coordinates;
    try {
      if (selectedTool === "delete" || action === "remove") {
        if (!hitBlock) return;
        await removeBlock(position);
        playSound(210, 0.1);
      } else if (selectedTool === "move" || selectedTool === "copy") {
        if (hitBlock && !selectedBlock) {
          const source = roomData.blocks.find((block) => block.x === position.x && block.y === position.y && block.z === position.z);
          if (!source) return;
          selectedBlock = { ...position, hitBlock, color: source.color };
          document.querySelector("#tool-message").textContent = "Now click the destination";
          return;
        }
        if (!selectedBlock || hitBlock) return;
        const target = { x: position.x, y: position.y, z: position.z };
        if (target.z > 20) return;
        if (selectedTool === "move"
          && selectedBlock.x === target.x && selectedBlock.y === target.y && selectedBlock.z === target.z) return;
        await placeBlock(target, selectedBlock.color);
        if (selectedTool === "move") await removeBlock(selectedBlock);
        playSound(540, 0.09);
        selectedBlock = null;
        document.querySelector("#tool-message").textContent = selectedTool === "move" ? "Brick moved" : "Brick copied";
      } else {
        if (hitBlock) position.z++;
        if (position.z > 20) return;
        await placeBlock(position);
        playSound(620, 0.08);
      }
      document.querySelector("#game-tip").classList.add("hidden");
      clearTimeout(tipTimer);
      refreshState();
    } catch (error) {
      document.querySelector("#room-count").textContent = error.message;
    }
  }

  canvas.addEventListener("click", (event) => {
    if (dragPointer) return;
    const coordinates = getBlockPosition(event);
    if (event.altKey) editBlock(coordinates && { ...coordinates, hitBlock: true }, "remove");
    else editBlock(coordinates, "place");
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (suppressContextMenu) {
      suppressContextMenu = false;
      return;
    }
    if (selectedTool === "build") editBlock(getBlockPosition(event), "remove");
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 2) return;
    suppressContextMenu = false;
    dragPointer = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragPointer) return;
    const dx = event.clientX - dragPointer.x;
    if (Math.abs(dx) > 2) {
      dragPointer.moved = true;
      suppressContextMenu = true;
    }
    cameraYaw += dx * 0.008;
    cameraPitch = Math.max(0.12, Math.min(0.78, cameraPitch + (event.clientY - dragPointer.y) * 0.006));
    dragPointer.x = event.clientX;
    dragPointer.y = event.clientY;
  });
  canvas.addEventListener("pointerup", () => { if (dragPointer) setTimeout(() => { dragPointer = null; }, 30); });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    cameraDistance = Math.max(7, Math.min(22, cameraDistance + event.deltaY * 0.012));
  }, { passive: false });
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright", " "].includes(key)) {
      event.preventDefault();
      pressedKeys.add(key === " " ? "space" : key);
      if (key === " " && jumpHeight === 0) { jumpVelocity = 8.5; playSound(520, 0.11); }
    }
  });
  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    pressedKeys.delete(key === " " ? "space" : key);
  });
  window.addEventListener("blur", () => pressedKeys.clear());
  document.querySelectorAll(".touch-controls [data-key]").forEach((button) => {
    const key = button.dataset.key;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.setPointerCapture(event.pointerId);
      pressedKeys.add(key);
      if (key === "space" && jumpHeight === 0) { jumpVelocity = 8.5; playSound(520, 0.11); }
    });
    const release = (event) => {
      event.stopPropagation();
      pressedKeys.delete(key);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
  });
  document.querySelectorAll(".swatch").forEach((swatch) => {
    swatch.style.background = swatch.dataset.color;
    swatch.addEventListener("click", () => {
      document.querySelector(".swatch.selected")?.classList.remove("selected");
      swatch.classList.add("selected");
      selectedColor = swatch.dataset.color;
    });
    document.querySelectorAll(".tool-button").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  });
  document.querySelector("#join-room").addEventListener("click", async () => {
    roomName = roomInput.value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "sunny-side";
    roomInput.value = roomName;
    lastMessageIds = new Set();
    roomData = { players: [], blocks: [], messages: [] };
    await refreshState();
    document.querySelector("#play").scrollIntoView({ behavior: "smooth" });
  });
  document.querySelectorAll(".world-card").forEach((card) => card.addEventListener("click", () => {
    roomInput.value = card.dataset.room;
    document.querySelector("#join-room").click();
  }));
  document.querySelector("#play-hero").addEventListener("click", () => document.querySelector("#play").scrollIntoView({ behavior: "smooth" }));
  document.querySelector("#browse-worlds").addEventListener("click", (event) => { event.preventDefault(); document.querySelector("#play").scrollIntoView({ behavior: "smooth" }); });
  document.querySelector("#fullscreen-toggle").addEventListener("click", () => {
    const frame = document.querySelector(".game-frame");
    if (!document.fullscreenElement) frame.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
  document.querySelector("#sound-toggle").addEventListener("click", (event) => {
    soundEnabled = !soundEnabled;
    event.currentTarget.classList.toggle("muted", !soundEnabled);
    event.currentTarget.title = soundEnabled ? "Sound effects on" : "Sound effects off";
    playSound(soundEnabled ? 700 : 280);
  });
  document.querySelector("#profile-button").addEventListener("click", () => {
    const name = window.prompt("Choose your builder name", player.name);
    if (!name?.trim()) return;
    player.name = name.trim().slice(0, 18);
    localStorage.setItem("bublux-player-name", player.name);
    world.remove(localAvatar);
    localAvatar = createAvatar(player.name, player.color);
    localAvatar.rotation.y = player.rotation;
    world.add(localAvatar);
    document.querySelector("#profile-button").textContent = player.name;
    refreshState();
  });
  document.querySelector("#chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#chat-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    try {
      await request("/api/chat", { name: player.name, color: player.color, message });
      refreshState();
    } catch (error) {
      document.querySelector("#room-count").textContent = error.message;
    }
  });

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const forward = Number(pressedKeys.has("w") || pressedKeys.has("arrowup")) - Number(pressedKeys.has("s") || pressedKeys.has("arrowdown"));
    const sideways = Number(pressedKeys.has("d") || pressedKeys.has("arrowright")) - Number(pressedKeys.has("a") || pressedKeys.has("arrowleft"));
    const inputLength = Math.hypot(forward, sideways);
    if (inputLength) {
      const speed = 4.4 * delta / inputLength;
      const moveX = -Math.sin(cameraYaw) * forward + Math.cos(cameraYaw) * sideways;
      const moveZ = -Math.cos(cameraYaw) * forward - Math.sin(cameraYaw) * sideways;
      const nextX = Math.max(0, Math.min(19, player.x + moveX * speed));
      const nextY = Math.max(0, Math.min(19, player.y + moveZ * speed));
      const blocked = (x, y) => jumpHeight < 0.85
        && roomData.blocks.some((block) => block.x === Math.round(x) && block.y === Math.round(y) && block.z === 0);
      if (!blocked(nextX, player.y)) player.x = nextX;
      if (!blocked(player.x, nextY)) player.y = nextY;
      player.rotation = Math.atan2(moveX, moveZ);
      localAvatar.rotation.y = player.rotation;
      sendMove();
    }
    if (pressedKeys.has("space") && jumpHeight === 0) jumpVelocity = 8.5;
    jumpHeight = Math.max(0, jumpHeight + jumpVelocity * delta);
    if (jumpHeight === 0) jumpVelocity = 0;
    else jumpVelocity -= 22 * delta;
    const target = new THREE.Vector3(player.x - 9.5, 0, player.y - 9.5);
    localAvatar.position.lerp(target, Math.min(1, delta * 9));
    localAvatar.position.y = jumpHeight;
    const moving = inputLength > 0;
    const stride = moving ? Math.sin(clock.elapsedTime * 10) * 0.48 : 0;
    if (moving && clock.elapsedTime >= nextFootstepAt) {
      nextFootstepAt = clock.elapsedTime + 0.42;
      playSound(110 + Math.random() * 30, 0.045);
    }
    localAvatar.userData.legLeft.rotation.x = stride;
    localAvatar.userData.legRight.rotation.x = -stride;
    localAvatar.userData.armLeft.rotation.x = -stride * 0.7;
    localAvatar.userData.armRight.rotation.x = stride * 0.7;
    for (const avatar of remoteAvatars.values()) {
      if (avatar.userData.targetPosition) avatar.position.lerp(avatar.userData.targetPosition, Math.min(1, delta * 7));
      if (Number.isFinite(avatar.userData.targetRotation)) {
        const difference = THREE.MathUtils.euclideanModulo(avatar.userData.targetRotation - avatar.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
        avatar.rotation.y += difference * Math.min(1, delta * 7);
      }
    }
    const cameraOffset = new THREE.Vector3(
      Math.sin(cameraYaw) * cameraDistance * Math.cos(cameraPitch),
      cameraDistance * Math.sin(cameraPitch),
      Math.cos(cameraYaw) * cameraDistance * Math.cos(cameraPitch),
    );
    const desired = target.clone().add(cameraOffset);
    desired.y += jumpHeight;
    camera.position.lerp(desired, Math.min(1, delta * 3));
    camera.lookAt(target.x, 1.15 + jumpHeight, target.z);
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  animate();
  refreshState();
  setInterval(refreshState, 1000);
  tipTimer = setTimeout(() => document.querySelector("#game-tip").classList.add("hidden"), 9000);
})();

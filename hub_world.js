(() => {
  "use strict";

  /* ---------------------------
    Utils
  --------------------------- */

  const $ = (sel) => document.querySelector(sel);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function isTouchDevice() {
    return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  }

  function toast(msg, ms = 2200) {
    const box = $("#toast");
    if (!box) return;
    const div = document.createElement("div");
    div.className = "toastLine";
    div.textContent = msg;
    box.appendChild(div);
    setTimeout(() => { div.remove(); }, ms);
  }

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  /* ---------------------------
    Settings / Storage
  --------------------------- */

  const DEFAULT_BINDS = {
    forward: ["KeyZ", "ArrowUp", "KeyW"],
    back: ["KeyS", "ArrowDown"],
    left: ["KeyQ", "ArrowLeft", "KeyA"],
    right: ["KeyD", "ArrowRight"],
    jump: ["Space"],
    crouch: ["ControlLeft", "ControlRight"],
    sprint: ["ShiftLeft", "ShiftRight"],
    dash: ["KeyF"],
    pause: ["Escape", "KeyP"],
    joystickToggle: ["KeyJ"],
  };

  const DEFAULT_SETTINGS = {
    graphics: { quality: "high", shadows: true, fov: 60, pixelRatio: "auto" },
    controls: { sens: 1.2, invertY: false, mouseMode: "lock" }, // drag / lock
    audio: { master: 70, amb: 60, sfx: 80 },
    gameplay: { moveRelativeCamera: true, sprintMode: "hold", dash: true, autoJoy: true },
    skin: { selected: "humanoid", scale: 1.0, color: "#7c5cff" }
  };

  function loadSettings() {
    const raw = localStorage.getItem("lg_hub_settings");
    const s = raw ? safeJsonParse(raw, null) : null;
    const merged = structuredClone(DEFAULT_SETTINGS);
    if (s) {
      // merge shallow
      Object.assign(merged.graphics, s.graphics || {});
      Object.assign(merged.controls, s.controls || {});
      Object.assign(merged.audio, s.audio || {});
      Object.assign(merged.gameplay, s.gameplay || {});
      Object.assign(merged.skin, s.skin || {});
    }
    return merged;
  }

  function saveSettings() {
    localStorage.setItem("lg_hub_settings", JSON.stringify(SETTINGS));
  }

  function loadBinds() {
    const raw = localStorage.getItem("lg_hub_binds");
    const b = raw ? safeJsonParse(raw, null) : null;
    const merged = structuredClone(DEFAULT_BINDS);
    if (b) {
      for (const k of Object.keys(merged)) {
        if (Array.isArray(b[k]) && b[k].length) merged[k] = b[k];
      }
    }
    return merged;
  }

  function saveBinds() {
    localStorage.setItem("lg_hub_binds", JSON.stringify(BINDS));
  }

  const SETTINGS = loadSettings();
  const BINDS = loadBinds();

  /* ---------------------------
    Three.js setup
  --------------------------- */

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(innerWidth, innerHeight);

  // PixelRatio
  function applyPixelRatio() {
    const pr = SETTINGS.graphics.pixelRatio;
    if (pr === "auto") renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    else renderer.setPixelRatio(parseFloat(pr) || 1);
  }
  applyPixelRatio();

  renderer.shadowMap.enabled = !!SETTINGS.graphics.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 25, 160);

  const camera = new THREE.PerspectiveCamera(SETTINGS.graphics.fov, innerWidth / innerHeight, 0.05, 600);

  // Lights (simple mais joli)
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x1a2030, 0.75);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(35, 55, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  // Ground (propre)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Quelques repères (POI minimal)
  const poiMat = new THREE.MeshStandardMaterial({ color: 0x222a35, roughness: 0.9 });
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, 3 + Math.random() * 3, 2), poiMat);
    b.position.set(-18 + i * 5, b.geometry.parameters.height / 2, -10 - (i % 2) * 7);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
  }

  /* ---------------------------
    Input (keyboard + mouse + touch)
  --------------------------- */

  const Input = {
    keysDown: new Set(),
    mouseDown: false,
    pointerLocked: false,
    lookDX: 0,
    lookDY: 0,
    moveX: 0, // -1..1
    moveY: 0, // -1..1
    lookX: 0, // -1..1 (touch stick)
    lookY: 0, // -1..1
    jumpPressed: false,
    dashPressed: false,
  };
  const _requestPointerLock = () => {
    try {
      if (PAUSED) return;
      if (SETTINGS.controls.mouseMode !== "lock") return;
      renderer.domElement.requestPointerLock?.();
    } catch (_) {}
  };


  function actionDown(action) {
    const codes = BINDS[action] || [];
    for (const c of codes) if (Input.keysDown.has(c)) return true;
    return false;
  }

  function actionPressedOnce(action, latchKey) {
    if (!Input[latchKey]) {
      if (actionDown(action)) {
        Input[latchKey] = true;
        return true;
      }
      return false;
    } else {
      if (!actionDown(action)) Input[latchKey] = false;
      return false;
    }
  }

  window.addEventListener("keydown", (e) => {
    Input.keysDown.add(e.code);

    // éviter scroll
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();

    // In Pointer Lock mode, allow locking via keyboard (no need to click first)
    if (!Input.pointerLocked && SETTINGS.controls.mouseMode === "lock") {
      const isMoveKey = (BINDS.forward?.includes(e.code) || BINDS.back?.includes(e.code) || BINDS.left?.includes(e.code) || BINDS.right?.includes(e.code));
      if (isMoveKey) _requestPointerLock();
    }

    // Toggle joystick
    if (BINDS.joystickToggle.includes(e.code)) toggleTouchUI();
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    Input.keysDown.delete(e.code);
  });

  // Mouse look
  window.addEventListener("mousedown", (e) => { Input.mouseDown = true; });
  window.addEventListener("mouseup", (e) => { Input.mouseDown = false; });

  window.addEventListener("mousemove", (e) => {
    const mode = SETTINGS.controls.mouseMode;
    const canLook = (mode === "lock" && Input.pointerLocked) || (mode === "drag" && Input.mouseDown && !PAUSED);
    if (!canLook) return;
    Input.lookDX += e.movementX || 0;
    Input.lookDY += e.movementY || 0;
  });

  renderer.domElement.addEventListener("click", () => {
    if (PAUSED) return;
    if (SETTINGS.controls.mouseMode !== "lock") return;
    renderer.domElement.requestPointerLock?.();
  });

  // Auto pointer-lock on first meaningful keyboard input (still requires a user gesture; keydown qualifies).
  // This removes the need to click to enable mouse-look in most browsers.
  document.addEventListener("keydown", (e) => {
    if (PAUSED) return;
    if (SETTINGS.controls.mouseMode !== "lock") return;
    if (Input.pointerLocked) return;

    // Only react to gameplay-ish keys to avoid locking when typing in the URL bar etc.
    const gameplayKeys = new Set([
      "KeyZ", "KeyQ", "KeyS", "KeyD",
      "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight",
      "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
      "KeyA", "KeyW" // allow QWERTY fallback
    ]);
    if (!gameplayKeys.has(e.code)) return;

    renderer.domElement.requestPointerLock?.();
  });

    document.addEventListener("pointerlockchange", () => {
      const locked = (document.pointerLockElement === renderer.domElement);
      const wasLocked = Input.pointerLocked;
      Input.pointerLocked = locked;

      // If we just lost pointer lock (ESC typically does this), open pause reliably.
      if (wasLocked && !locked && !PAUSED) {
        setPaused(true);
      }
    });

  // Touch joysticks
  const touchUI = $("#touchUI");
  const stickMove = $("#stickMove");
  const stickLook = $("#stickLook");
  const btnJump = $("#btnJump");

  let touchEnabled = false;

  function setStickKnob(stickEl, nx, ny) {
    const knob = stickEl.querySelector(".knob");
    const r = 40; // radius px for knob movement
    knob.style.left = (50 + nx * r / 75 * 50) + "%";
    knob.style.top  = (50 + ny * r / 75 * 50) + "%";
    // simple alternative: pixel translate, but % is ok here
    knob.style.transform = "translate(-50%,-50%)";
  }

  function makeStick(stickEl, onMove) {
    let activeId = null;
    let cx = 0, cy = 0;

    stickEl.addEventListener("pointerdown", (e) => {
      if (PAUSED) return;
      stickEl.setPointerCapture(e.pointerId);
      activeId = e.pointerId;
      const r = stickEl.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      onMove(0, 0);
      setStickKnob(stickEl, 0, 0);
      e.preventDefault();
    });

    stickEl.addEventListener("pointermove", (e) => {
      if (activeId !== e.pointerId) return;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const max = 50;
      const nx = clamp(dx / max, -1, 1);
      const ny = clamp(dy / max, -1, 1);
      onMove(nx, ny);
      setStickKnob(stickEl, nx * 40, ny * 40);
      e.preventDefault();
    });

    stickEl.addEventListener("pointerup", (e) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      onMove(0, 0);
      setStickKnob(stickEl, 0, 0);
      e.preventDefault();
    });
  }

  makeStick(stickMove, (x, y) => {
    Input.moveX = x;
    Input.moveY = y;
  });

  makeStick(stickLook, (x, y) => {
    Input.lookX = x;
    Input.lookY = y;
  });

  btnJump.addEventListener("pointerdown", (e) => {
    if (PAUSED) return;
    Input.jumpPressed = true;
    e.preventDefault();
  });

  function applyAutoTouchUI() {
    const should = isTouchDevice() && SETTINGS.gameplay.autoJoy;
    touchEnabled = should;
    if (should) touchUI.classList.remove("hidden");
    else touchUI.classList.add("hidden");
  }

  function toggleTouchUI() {
    if (!isTouchDevice()) {
      // sur PC on peut le montrer aussi si tu veux, mais par défaut on le cache
      touchEnabled = !touchEnabled;
    } else {
      touchEnabled = !touchEnabled;
    }
    touchUI.classList.toggle("hidden", !touchEnabled);
    toast(touchEnabled ? "Joysticks: ON" : "Joysticks: OFF");
  }

  applyAutoTouchUI();

  /* ---------------------------
    Player + Camera Rig
  --------------------------- */

  const player = {
    root: new THREE.Group(),
    model: null,
    velocity: new THREE.Vector3(0, 0, 0),
    onGround: true,
    yaw: 0,          // direction du joueur
    moveYaw: 0,      // direction de déplacement souhaitée
    crouching: false,
    sprinting: false,
    dashCooldown: 0,
    dashTime: 0,
    baseSpeed: 5.2,
    sprintMul: 1.85, // sprint significatif
    crouchMul: 0.55,
    gravity: 18,
    jumpV: 7.2,
    height: 1.7,

    // Dynamic camera profile (per skin)
    baseScale: 1.0,
    baseSkinHeight: 1.65,
    baseEyeHeight: 1.45,
    baseCamDist: 4.2,
  };
  player.root.position.set(0, 0, 0);
  scene.add(player.root);

  // Placeholder humanoïde “complet” (tête/bras/jambes)
  function buildHumanoid(colorHex) {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.7 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 0.9 });
    const matSkin = new THREE.MeshStandardMaterial({ color: 0xf1d0b5, roughness: 0.85 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.78, 6, 12), matBody);
    body.castShadow = true; body.receiveShadow = true;
    body.position.y = 1.05;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), matSkin);
    head.castShadow = true;
    head.position.y = 1.62;

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), matDark);
    hair.castShadow = true;
    hair.scale.set(1, 0.72, 1);
    hair.position.y = 1.73;

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.10, 10), matSkin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.60, 0.22);

    const eyeW = 0.045;
    const eye = (x) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(eyeW, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
      const p = new THREE.Mesh(new THREE.SphereGeometry(eyeW * 0.45, 10, 10), new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: 0.7 }));
      e.position.set(x, 1.66, 0.20);
      p.position.set(x, 1.66, 0.235);
      e.castShadow = true; p.castShadow = true;
      g.add(e, p);
    };
    eye(-0.07); eye(0.07);

    const armGeo = new THREE.CapsuleGeometry(0.08, 0.38, 4, 10);
    const armL = new THREE.Mesh(armGeo, matBody);
    const armR = new THREE.Mesh(armGeo, matBody);
    armL.castShadow = armR.castShadow = true;
    armL.position.set(-0.38, 1.15, 0);
    armR.position.set( 0.38, 1.15, 0);
    armL.rotation.z = 0.15;
    armR.rotation.z = -0.15;

    const handGeo = new THREE.SphereGeometry(0.07, 10, 10);
    const handL = new THREE.Mesh(handGeo, matSkin);
    const handR = new THREE.Mesh(handGeo, matSkin);
    handL.castShadow = handR.castShadow = true;
    handL.position.set(-0.46, 0.92, 0.02);
    handR.position.set( 0.46, 0.92, 0.02);

    const legGeo = new THREE.CapsuleGeometry(0.10, 0.46, 4, 10);
    const legL = new THREE.Mesh(legGeo, matBody);
    const legR = new THREE.Mesh(legGeo, matBody);
    legL.castShadow = legR.castShadow = true;
    legL.position.set(-0.14, 0.48, 0);
    legR.position.set( 0.14, 0.48, 0);

    const footGeo = new THREE.BoxGeometry(0.14, 0.08, 0.25);
    const footL = new THREE.Mesh(footGeo, matDark);
    const footR = new THREE.Mesh(footGeo, matDark);
    footL.castShadow = footR.castShadow = true;
    footL.position.set(-0.14, 0.08, 0.08);
    footR.position.set( 0.14, 0.08, 0.08);

    g.add(body, head, hair, nose, armL, armR, handL, handR, legL, legR, footL, footR);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    return g;
  }

  // Camera rig 3e personne (suivi + rotation)
  const camRig = {
    yaw: 0,
    pitch: -0.2,
    dist: 4.2,
    height: 1.55,
    smoothPos: new THREE.Vector3(),
    smoothTarget: new THREE.Vector3(),
  };

  function updateCamera(dt) {
    // Input look
    const sens = SETTINGS.controls.sens;
    const invert = SETTINGS.controls.invertY ? -1 : 1;

    // Mouse
    if (!PAUSED) {
      camRig.yaw   += (Input.lookDX * 0.0022) * sens;
      camRig.pitch -= (Input.lookDY * 0.0018) * sens * invert;
    }
    Input.lookDX = 0;
    Input.lookDY = 0;

    // Touch look
    if (!PAUSED && touchEnabled) {
      camRig.yaw   += (Input.lookX * 1.35) * dt * sens;
      camRig.pitch -= (Input.lookY * 1.10) * dt * sens * invert;
    }

    camRig.pitch = clamp(camRig.pitch, -1.25, 1.05);

    // Adapt camera rig to current skin scale / crouch
    const camK = 1 - Math.pow(0.001, dt);
    const desiredHeight = (player.baseEyeHeight || camRig.height) * player.root.scale.y;
    const desiredDist = (player.baseCamDist || camRig.dist) * player.root.scale.x;
    camRig.height = lerp(camRig.height, desiredHeight, camK);
    camRig.dist = lerp(camRig.dist, desiredDist, camK);

    // Target = player head
    const target = new THREE.Vector3(
      player.root.position.x,
      player.root.position.y + camRig.height,
      player.root.position.z
    );

    // Camera offset (rotated by yaw/pitch)
    const offset = new THREE.Vector3(0, 0, camRig.dist);
    const rot = new THREE.Euler(camRig.pitch, camRig.yaw, 0, "YXZ");
    offset.applyEuler(rot);

    const desiredPos = target.clone().add(offset);

    // Prevent camera going below ground
    desiredPos.y = Math.max(desiredPos.y, 0.25);

    // Smooth
    const k = 1 - Math.pow(0.00005, dt);
    camRig.smoothTarget.lerp(target, k);
    camRig.smoothPos.lerp(desiredPos, k);

    camera.position.copy(camRig.smoothPos);
    camera.lookAt(camRig.smoothTarget);
  }

  /* ---------------------------
    Skins (Humanoid + Fox)
  --------------------------- */

  const loader = new THREE.GLTFLoader();

  const SKINS = [
    { id: "humanoid", name: "Humanoïde", type: "builtin" },
    { id: "fox", name: "Fox (GLB)", type: "gltf", url: "assets/models/test/Fox.glb" },
  ];

  function clearPlayerModel() {
    if (player.model) {
      player.root.remove(player.model);
      player.model.traverse?.((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
            else o.material.dispose?.();
          }
        }
      });
      player.model = null;
    }
  }

  function fitModelToPlayer(m) {
    // Scale first, then recenter & put feet on ground (important for camera anchoring)
    const targetH = 1.55;

    // Scale to target height
    const b0 = new THREE.Box3().setFromObject(m);
    const s0 = new THREE.Vector3();
    b0.getSize(s0);
    const h0 = Math.max(0.01, s0.y);
    const s = targetH / h0;
    m.scale.multiplyScalar(s);

    // Recompute after scaling
    m.updateMatrixWorld(true);

    // Recentre pivot
    const b1 = new THREE.Box3().setFromObject(m);
    const c1 = new THREE.Vector3();
    b1.getCenter(c1);
    m.position.sub(c1);

    // Put feet on ground
    m.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(m);
    m.position.y -= b2.min.y;

    m.updateMatrixWorld(true);
  }

  function applyPlayerAppearance() {
    const scale = clamp(parseFloat(SETTINGS.skin.scale) || 1.0, 0.8, 1.2);
    player.baseScale = scale;

    // Keep X/Z scale consistent; Y can be reduced when crouching
    const crouchY = player.crouching ? 0.85 : 1.0;
    player.root.scale.set(scale, scale * crouchY, scale);

    refreshPlayerMetrics();

    // Color for humanoid only
    if (SETTINGS.skin.selected === "humanoid" && player.model) {
      const color = new THREE.Color(SETTINGS.skin.color || "#7c5cff");
      player.model.traverse((o) => {
        if (o.isMesh && o.material && !Array.isArray(o.material)) {
          // Heuristic: recolor only body-ish meshes (not skin/eyes)
          // Our builtin uses different materials; easiest is rebuild if color changes.
        }
      });
      // rebuild builtin with new color:
      clearPlayerModel();
      const h = buildHumanoid(SETTINGS.skin.color || "#7c5cff");
      player.model = h;
      player.root.add(h);
    }
  }

  
  function refreshPlayerMetrics() {
    // Compute a stable "base" profile independent of current root scale
    if (!player.model) return;

    const prevScale = player.root.scale.clone();

    // normalize temporarily (standing)
    player.root.scale.set(1, 1, 1);
    player.root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(player.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = Math.max(0.01, size.y);

    player.baseSkinHeight = h;

    // Different eye height / distance heuristics per rig
    if (SETTINGS.skin.selected === "fox") {
      player.baseEyeHeight = h * 0.58;                 // quadrupède: point de visée plus bas
      player.baseCamDist  = clamp(h * 2.35, 2.9, 5.4); // plus proche pour éviter l'effet "décollé"
    } else {
      player.baseEyeHeight = h * 0.88;                 // humanoïde: proche de la tête
      player.baseCamDist  = clamp(h * 2.70, 3.4, 6.4);
    }

    // restore
    player.root.scale.copy(prevScale);
    player.root.updateMatrixWorld(true);

    // snap camera rig targets gently (no sudden jumps)
    camRig.height = player.baseEyeHeight * player.root.scale.y;
    camRig.dist = player.baseCamDist * player.root.scale.x;
  }

function loadSkinById(id) {
    const def = SKINS.find(s => s.id === id) || SKINS[0];
    SETTINGS.skin.selected = def.id;
    saveSettings();

    clearPlayerModel();

    if (def.type === "builtin") {
      const h = buildHumanoid(SETTINGS.skin.color || "#7c5cff");
      player.model = h;
      player.root.add(h);
      applyPlayerAppearance();
      netSendSkin();
      toast("Skin: Humanoïde");
      return;
    }

    if (def.type === "gltf") {
      const url = def.url;
      loader.load(url, (gltf) => {
        const m = gltf.scene || gltf.scenes?.[0];
        if (!m) { toast("Skin: modèle vide"); return; }

        m.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material && !Array.isArray(o.material)) {
              o.material.metalness = o.material.metalness ?? 0.0;
            }
          }
        });

        fitModelToPlayer(m);

        player.model = m;
        player.root.add(m);

        applyPlayerAppearance();
        netSendSkin();
        toast("Skin: Fox");
      }, undefined, () => {
        toast("Erreur: impossible de charger le modèle (chemin ?).");
        // fallback humanoid
        const h = buildHumanoid(SETTINGS.skin.color || "#7c5cff");
        player.model = h;
        player.root.add(h);
      });
    }
  }


  /* ---------------------------
    Networking (Hub presence)
  --------------------------- */

  const NET = {
    ws: null,
    url: null,
    id: null,
    connected: false,
    reconnectMs: 1200,
    players: new Map(), // id -> remote
    lastSend: 0,
    sendHz: 12,
    name: null,
  };

  function netHud() {
    const el = $("#hudNet");
    if (!el) return;
    const n = NET.players.size + 1; // + self
    const st = NET.connected ? "connecté" : "hors-ligne";
    el.textContent = `WS: ${st} | Joueurs: ${n}`;
  }

  function pickWsUrl() {
    const url = new URL(location.href);
    const qp = (url.searchParams.get("ws") || "").trim();
    if (qp) return qp;
    // même URL que le lobby (plus simple / stable)
    return "wss://loup-garou-ws.onrender.com/ws";
  }

  function pickName() {
    const url = new URL(location.href);
    const qp = (url.searchParams.get("name") || "").trim();
    if (qp) { localStorage.setItem("lg_name", qp); return qp.slice(0, 32); }
    const saved = (localStorage.getItem("lg_name") || "").trim();
    if (saved) return saved.slice(0, 32);
    const rnd = Math.random().toString(16).slice(2, 6).toUpperCase();
    const gen = `Joueur-${rnd}`;
    localStorage.setItem("lg_name", gen);
    return gen;
  }

  function wsSend(obj) {
    try {
      if (NET.ws && NET.ws.readyState === WebSocket.OPEN) {
        NET.ws.send(JSON.stringify(obj));
      }
    } catch {}
  }

  function makeNameSprite(name) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const pad = 18;
    const font = "bold 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(name).width) + pad * 2;
    const h = 56;
    canvas.width = w;
    canvas.height = h;

    // redraw
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    const r = 16;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = font;
    ctx.fillStyle = "rgba(234,240,255,0.95)";
    ctx.textBaseline = "middle";
    ctx.fillText(name, pad, h / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set((w / 56) * 1.45, 1.45, 1);
    spr.renderOrder = 999;
    return spr;
  }

  function buildRemoteAvatar(colorHex = "#4fe3c1") {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.75, metalness: 0.0 });
    const mat2 = new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 0.92 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 1.18, 12), mat);
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = 1.02;
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mat);
    head.castShadow = true;
    head.position.y = 1.72;
    g.add(head);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.50, 0.16, 12), mat2);
    base.receiveShadow = true;
    base.position.y = 0.08;
    g.add(base);

    return g;
  }

  function addRemotePlayer(p) {
    if (!p || !p.id) return;
    const id = String(p.id);
    if (NET.id && id === String(NET.id)) return;
    if (NET.players.has(id)) return;

    const skin = (p.skin && typeof p.skin === "object") ? p.skin : {};
    const color = skin.color || "#4fe3c1";

    const root = new THREE.Group();
    const avatar = buildRemoteAvatar(color);
    root.add(avatar);

    const label = makeNameSprite((p.name || "Joueur").slice(0, 32));
    label.position.set(0, 2.35, 0);
    root.add(label);

    root.position.set(0, 0, 0);
    scene.add(root);

    const st = (p.st && typeof p.st === "object") ? p.st : {};
    const rx = parseFloat(st.x || 0);
    const ry = parseFloat(st.y || 0);
    const rz = parseFloat(st.z || 0);
    const yaw = parseFloat(st.yaw || 0);

    const remote = {
      id,
      name: p.name || "Joueur",
      root,
      avatar,
      label,
      pos: new THREE.Vector3(rx, ry, rz),
      targetPos: new THREE.Vector3(rx, ry, rz),
      yaw,
      targetYaw: yaw,
      lastUpdate: performance.now(),
      skin,
    };

    root.position.copy(remote.pos);
    root.rotation.y = remote.yaw;

    NET.players.set(id, remote);
    netHud();
  }

  function removeRemotePlayer(id) {
    const key = String(id);
    const r = NET.players.get(key);
    if (!r) return;
    scene.remove(r.root);
    r.root.traverse((o) => {
      if (o.material && o.material.map && o.material.map.isTexture) {
        o.material.map.dispose?.();
      }
      if (o.material) o.material.dispose?.();
      if (o.geometry) o.geometry.dispose?.();
    });
    NET.players.delete(key);
    netHud();
  }

  function applyRemoteSkin(id, skin) {
    const r = NET.players.get(String(id));
    if (!r) return;
    r.skin = (skin && typeof skin === "object") ? skin : {};
    const color = r.skin.color || "#4fe3c1";
    // recolor by rebuilding avatar (simple, robuste)
    r.root.remove(r.avatar);
    r.avatar = buildRemoteAvatar(color);
    r.root.add(r.avatar);
  }

  function netConnect() {
    NET.name = pickName();
    NET.url = pickWsUrl();

    try {
      NET.ws = new WebSocket(NET.url);
    } catch {
      NET.connected = false;
      netHud();
      return;
    }

    NET.ws.addEventListener("open", () => {
      NET.connected = true;
      NET.reconnectMs = 1200;
      netHud();

      // spawn initial proche du centre (évite overlap total)
      const sx = (Math.random() - 0.5) * 4.0;
      const sz = (Math.random() - 0.5) * 4.0;
      if (player && player.root) player.root.position.set(sx, 0, sz);

      wsSend({
        t: "join",
        room: "hub",
        name: NET.name,
        skin: SETTINGS.skin,
        st: { x: player.root.position.x, y: player.root.position.y, z: player.root.position.z, yaw: player.yaw }
      });

      // push skin to be safe
      wsSend({ t: "hub_skin", skin: SETTINGS.skin });

      toast("Hub: connecté");
    });

    NET.ws.addEventListener("message", (ev) => {
      let data = null;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (!data || typeof data !== "object") return;

      const t = String(data.t || "");
      if (t === "hello" || t === "welcome" || t === "hub_welcome") {
        if (data.id != null) NET.id = String(data.id);
        netHud();
        return;
      }

      if (t === "hub_snapshot") {
        const arr = Array.isArray(data.players) ? data.players : [];
        for (const p of arr) addRemotePlayer(p);
        netHud();
        return;
      }

      if (t === "hub_join") {
        addRemotePlayer(data.p);
        return;
      }

      if (t === "hub_leave") {
        removeRemotePlayer(data.id);
        return;
      }

      if (t === "hub_state") {
        const id = String(data.id);
        if (NET.id && id === String(NET.id)) return;
        const r = NET.players.get(id);
        if (!r) return;
        const st = (data.st && typeof data.st === "object") ? data.st : {};
        r.targetPos.set(parseFloat(st.x || 0), parseFloat(st.y || 0), parseFloat(st.z || 0));
        r.targetYaw = parseFloat(st.yaw || 0);
        r.lastUpdate = performance.now();
        return;
      }

      if (t === "hub_skin") {
        const p = data.p;
        if (!p || p.id == null) return;
        const id = String(p.id);
        if (NET.id && id === String(NET.id)) return;
        if (!NET.players.has(id)) addRemotePlayer(p);
        applyRemoteSkin(id, p.skin);
        return;
      }
    });

    NET.ws.addEventListener("close", () => {
      NET.connected = false;
      NET.id = NET.id; // keep
      netHud();
      toast("WS: déconnecté");

      // cleanup remotes (on les garde pas en cas de reconnection)
      for (const k of [...NET.players.keys()]) removeRemotePlayer(k);

      const wait = NET.reconnectMs;
      NET.reconnectMs = Math.min(10000, Math.floor(NET.reconnectMs * 1.5));
      setTimeout(netConnect, wait);
    });

    NET.ws.addEventListener("error", () => {
      // close triggers reconnection
      try { NET.ws.close(); } catch {}
    });

    netHud();
  }

  function netSendSkin() {
    if (!NET.connected) return;
    wsSend({ t: "hub_skin", skin: SETTINGS.skin });
    netHud();
  }

  function netTick(now, dt) {
    // Update remote smoothing + label facing
    for (const r of NET.players.values()) {
      const a = 1 - Math.pow(0.001, dt); // framerate independent
      r.pos.lerp(r.targetPos, a);
      r.yaw = lerp(r.yaw, r.targetYaw, a);

      r.root.position.copy(r.pos);
      r.root.rotation.y = r.yaw;

      if (r.label) r.label.quaternion.copy(camera.quaternion);
    }

    // Send own state (rate-limited)
    if (!NET.connected || !NET.ws || NET.ws.readyState !== WebSocket.OPEN) return;
    const interval = 1000 / NET.sendHz;
    if ((now - NET.lastSend) < interval) return;
    NET.lastSend = now;

    wsSend({
      t: "hub_state",
      st: {
        x: player.root.position.x,
        y: player.root.position.y,
        z: player.root.position.z,
        yaw: player.yaw
      }
    });
  }

  loadSkinById(SETTINGS.skin.selected);

  /* ---------------------------
    Movement / Physics
  --------------------------- */

  let PAUSED = false;
  let sprintToggled = false;

  function setPaused(v) {
    PAUSED = v;

    const overlay = $("#pauseOverlay");
    overlay.classList.toggle("active", v);

    // Release pointer lock in pause
    if (v && document.pointerLockElement) document.exitPointerLock?.();

    // Show/hide touch UI depending
    applyAutoTouchUI();

    $("#hudHint").textContent = v ? "Pause (menu ouvert)" : "Appuie sur Z/Q/S/D ou clique pour contrôler la caméra";
  }

  function teleportSpawn() {
    player.root.position.set(0, 0, 0);
    player.velocity.set(0, 0, 0);
    toast("Téléporté au spawn");
  }

  function updatePlayer(dt) {
    // Pause: no movement
    if (PAUSED) return;

    // Compute input vector
    let ix = 0, iz = 0;

    // Keyboard (ZQSD + flèches)
    if (actionDown("left")) ix -= 1;
    if (actionDown("right")) ix += 1;
    if (actionDown("forward")) iz -= 1;
    if (actionDown("back")) iz += 1;

    // Touch move stick (y is forward)
    if (touchEnabled) {
      ix += Input.moveX;
      iz += Input.moveY;
    }

    const len = Math.hypot(ix, iz);
    if (len > 1e-3) { ix /= len; iz /= len; }

    // Sprint logic
    let sprintWanted = actionDown("sprint");
    if (SETTINGS.gameplay.sprintMode === "toggle") {
      if (actionPressedOnce("sprint", "_sprintLatch")) sprintToggled = !sprintToggled;
      sprintWanted = sprintToggled;
    } else {
      sprintToggled = false;
    }
    player.sprinting = sprintWanted;

    // Crouch
    player.crouching = actionDown("crouch");

    // Dash
    if (SETTINGS.gameplay.dash) {
      if (actionPressedOnce("dash", "_dashLatch") && player.dashCooldown <= 0 && (len > 0.2)) {
        player.dashTime = 0.18;
        player.dashCooldown = 0.9;
        toast("Dash!");
      }
    }

    // Direction relative camera or world
    let desiredDir = new THREE.Vector3(ix, 0, iz);
    if (SETTINGS.gameplay.moveRelativeCamera) {
      // rotate by camera yaw only
      const yaw = camRig.yaw;
      desiredDir.applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    }

    // Speed
    let speed = player.baseSpeed;
    if (player.sprinting) speed *= player.sprintMul;
    if (player.crouching) speed *= player.crouchMul;
    if (player.dashTime > 0) speed *= 3.2;

    // Apply movement (simple accel)
    const accel = 22;
    const targetVel = desiredDir.multiplyScalar(speed);
    player.velocity.x = lerp(player.velocity.x, targetVel.x, 1 - Math.exp(-accel * dt));
    player.velocity.z = lerp(player.velocity.z, targetVel.z, 1 - Math.exp(-accel * dt));

    // Gravity
    player.velocity.y -= player.gravity * dt;

    // Jump
    const jumpNow = actionPressedOnce("jump", "_jumpLatch") || (Input.jumpPressed === true);
    Input.jumpPressed = false;

    if (jumpNow && player.onGround) {
      player.velocity.y = player.jumpV;
      player.onGround = false;
    }

    // Integrate
    player.root.position.x += player.velocity.x * dt;
    player.root.position.y += player.velocity.y * dt;
    player.root.position.z += player.velocity.z * dt;

    // Ground collision (y=0)
    if (player.root.position.y <= 0) {
      player.root.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }

    // Dash timers
    if (player.dashCooldown > 0) player.dashCooldown -= dt;
    if (player.dashTime > 0) player.dashTime -= dt;

    // Face direction (only if moving)
    const mv = Math.hypot(player.velocity.x, player.velocity.z);
    if (mv > 0.25) {
      const ang = Math.atan2(player.velocity.x, player.velocity.z);
      player.yaw = lerpAngle(player.yaw, ang, 1 - Math.pow(0.0008, dt));
      player.root.rotation.y = player.yaw;
    }

    // Crouch visual
    const targetScaleY = player.crouching ? 0.85 : 1.0;
    const base = player.baseScale ?? clamp(SETTINGS.skin.scale || 1.0, 0.8, 1.2);
    player.baseScale = base;
    const kScale = 1 - Math.pow(0.001, dt);
    const targetY = targetScaleY * base;
    const newY = lerp(player.root.scale.y, targetY, kScale);
    player.root.scale.set(base, newY, base);
}

  function lerpAngle(a, b, t) {
    const d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    return a + d * t;
  }

  /* ---------------------------
    UI Wiring (Pause / Tabs / Options / Skins / Rebind)
  --------------------------- */

  // Pause toggles
  $("#btnPause").addEventListener("click", () => setPaused(!PAUSED));
  $("#btnClosePause").addEventListener("click", () => setPaused(false));
  $("#btnResume").addEventListener("click", () => setPaused(false));
  $("#btnStay").addEventListener("click", () => setPaused(false));
  $("#btnGoHome").addEventListener("click", () => { location.href = "index.html"; });
  $("#btnResetPos").addEventListener("click", () => teleportSpawn());
  $("#btnJoystick").addEventListener("click", () => toggleTouchUI());

  // Escape
  window.addEventListener("keydown", (e) => {
    if (BINDS.pause.includes(e.code)) {
      e.preventDefault();
      setPaused(!PAUSED);
    }
  }, { passive: false });

  // Main tabs
  const tabButtons = Array.from(document.querySelectorAll(".tabBtn[data-tab]"));
  const tabPages = {
    resume: $("#tab_resume"),
    options: $("#tab_options"),
    skins: $("#tab_skins"),
    home: $("#tab_home"),
  };

  function showTab(name) {
    for (const k of Object.keys(tabPages)) tabPages[k].classList.toggle("hidden", k !== name);
    tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  }

  tabButtons.forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // Options subtabs
  const subBtns = Array.from(document.querySelectorAll(".tabBtn[data-subtab]"));
  const subPages = {
    graphics: $("#sub_graphics"),
    controls: $("#sub_controls"),
    audio: $("#sub_audio"),
    gameplay: $("#sub_gameplay"),
  };

  function showSub(name) {
    for (const k of Object.keys(subPages)) subPages[k].classList.toggle("hidden", k !== name);
    subBtns.forEach(b => b.classList.toggle("active", b.dataset.subtab === name));
  }
  subBtns.forEach(b => b.addEventListener("click", () => showSub(b.dataset.subtab)));

  // Apply settings to UI
  function refreshOptionsUI() {
    $("#optQuality").value = SETTINGS.graphics.quality;
    $("#optShadows").textContent = SETTINGS.graphics.shadows ? "ON" : "OFF";
    $("#optFov").value = String(SETTINGS.graphics.fov);
    $("#optPixelRatio").value = SETTINGS.graphics.pixelRatio;

    $("#optSens").value = String(SETTINGS.controls.sens);
    $("#optInvertY").textContent = SETTINGS.controls.invertY ? "ON" : "OFF";
    $("#optMouseMode").value = SETTINGS.controls.mouseMode;

    $("#optVolMaster").value = String(SETTINGS.audio.master);
    $("#optVolAmb").value = String(SETTINGS.audio.amb);
    $("#optVolSfx").value = String(SETTINGS.audio.sfx);

    $("#optMoveRel").textContent = SETTINGS.gameplay.moveRelativeCamera ? "ON" : "OFF";
    $("#optSprintMode").value = SETTINGS.gameplay.sprintMode;
    $("#optDash").textContent = SETTINGS.gameplay.dash ? "ON" : "OFF";
    $("#optAutoJoy").textContent = SETTINGS.gameplay.autoJoy ? "ON" : "OFF";

    $("#optScale").value = String(SETTINGS.skin.scale);
    $("#optColor").value = SETTINGS.skin.color;
  }

  refreshOptionsUI();

  // Graphics handlers
  $("#optQuality").addEventListener("change", (e) => {
    SETTINGS.graphics.quality = e.target.value;
    // quality affects shadow map size & fog density lightly
    if (SETTINGS.graphics.quality === "low") {
      sun.shadow.mapSize.set(512, 512);
      scene.fog.near = 18; scene.fog.far = 110;
    } else if (SETTINGS.graphics.quality === "med") {
      sun.shadow.mapSize.set(1024, 1024);
      scene.fog.near = 25; scene.fog.far = 140;
    } else {
      sun.shadow.mapSize.set(2048, 2048);
      scene.fog.near = 25; scene.fog.far = 160;
    }
    saveSettings();
    toast("Graphiques: " + SETTINGS.graphics.quality);
  });

  $("#optShadows").addEventListener("click", () => {
    SETTINGS.graphics.shadows = !SETTINGS.graphics.shadows;
    renderer.shadowMap.enabled = SETTINGS.graphics.shadows;
    $("#optShadows").textContent = SETTINGS.graphics.shadows ? "ON" : "OFF";
    saveSettings();
  });

  $("#optFov").addEventListener("change", (e) => {
    SETTINGS.graphics.fov = clamp(parseInt(e.target.value || "60", 10), 45, 85);
    camera.fov = SETTINGS.graphics.fov;
    camera.updateProjectionMatrix();
    saveSettings();
  });

  $("#optPixelRatio").addEventListener("change", (e) => {
    SETTINGS.graphics.pixelRatio = e.target.value;
    applyPixelRatio();
    saveSettings();
  });

  // Controls handlers
  $("#optSens").addEventListener("change", (e) => {
    SETTINGS.controls.sens = clamp(parseFloat(e.target.value || "1.2"), 0.3, 3);
    saveSettings();
  });

  $("#optInvertY").addEventListener("click", () => {
    SETTINGS.controls.invertY = !SETTINGS.controls.invertY;
    $("#optInvertY").textContent = SETTINGS.controls.invertY ? "ON" : "OFF";
    saveSettings();
  });

  $("#optMouseMode").addEventListener("change", (e) => {
    SETTINGS.controls.mouseMode = e.target.value;
    saveSettings();
    toast("Souris: " + (SETTINGS.controls.mouseMode === "lock" ? "Pointer Lock" : "Drag"));
  });

  // Gameplay handlers
  $("#optMoveRel").addEventListener("click", () => {
    SETTINGS.gameplay.moveRelativeCamera = !SETTINGS.gameplay.moveRelativeCamera;
    $("#optMoveRel").textContent = SETTINGS.gameplay.moveRelativeCamera ? "ON" : "OFF";
    saveSettings();
  });

  $("#optSprintMode").addEventListener("change", (e) => {
    SETTINGS.gameplay.sprintMode = e.target.value;
    sprintToggled = false;
    saveSettings();
  });

  $("#optDash").addEventListener("click", () => {
    SETTINGS.gameplay.dash = !SETTINGS.gameplay.dash;
    $("#optDash").textContent = SETTINGS.gameplay.dash ? "ON" : "OFF";
    saveSettings();
  });

  $("#optAutoJoy").addEventListener("click", () => {
    SETTINGS.gameplay.autoJoy = !SETTINGS.gameplay.autoJoy;
    $("#optAutoJoy").textContent = SETTINGS.gameplay.autoJoy ? "ON" : "OFF";
    applyAutoTouchUI();
    saveSettings();
  });

  // Skins UI
  const skinsGrid = $("#skinsGrid");
  function renderSkinsGrid() {
    skinsGrid.innerHTML = "";
    for (const s of SKINS) {
      const row = document.createElement("div");
      row.className = "kv";
      row.innerHTML = `
        <div class="k">${s.name}</div>
        <div class="v">
          <button class="btn ${SETTINGS.skin.selected === s.id ? "btn--primary" : ""}" data-skin="${s.id}">
            ${SETTINGS.skin.selected === s.id ? "Sélectionné" : "Choisir"}
          </button>
        </div>
      `;
      skinsGrid.appendChild(row);
    }
    skinsGrid.querySelectorAll("button[data-skin]").forEach(b => {
      b.addEventListener("click", () => {
        loadSkinById(b.dataset.skin);
        renderSkinsGrid();
      });
    });
  }
  renderSkinsGrid();

  $("#optScale").addEventListener("change", (e) => {
    SETTINGS.skin.scale = clamp(parseFloat(e.target.value || "1.0"), 0.8, 1.2);
    saveSettings();
    applyPlayerAppearance();
    netSendSkin();
  });

  $("#optColor").addEventListener("change", (e) => {
    SETTINGS.skin.color = e.target.value;
    saveSettings();
    applyPlayerAppearance();
    netSendSkin();
  });

  // Rebind UI
  const btnRebind = $("#btnRebind");
  const rebindPanel = $("#rebindPanel");
  const rebindList = $("#rebindList");
  const btnCloseRebind = $("#btnCloseRebind");
  const btnResetBinds = $("#btnResetBinds");
  const btnClose = $("#btnCloseRebind");

  let waitingAction = null;

  function niceKey(code) {
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code === "Space") return "Espace";
    if (code.startsWith("Arrow")) return code.replace("Arrow", "Flèche ");
    if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
    if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
    return code;
  }

  function renderRebindList() {
    rebindList.innerHTML = "";
    const actions = [
      ["forward","Avancer"], ["back","Reculer"], ["left","Gauche"], ["right","Droite"],
      ["jump","Saut"], ["crouch","Accroupi"], ["sprint","Sprint"], ["dash","Dash"],
      ["joystickToggle","Joysticks (toggle)"]
    ];

    for (const [key, label] of actions) {
      const row = document.createElement("div");
      row.className = "kv";
      const current = (BINDS[key] || []).map(niceKey).join(" / ");
      row.innerHTML = `
        <div class="k">${label}</div>
        <div class="v">
          <button class="btn" data-action="${key}">${waitingAction === key ? "Appuie sur une touche..." : "Changer"}</button>
          <span class="smallNote">${current}</span>
        </div>
      `;
      rebindList.appendChild(row);
    }

    rebindList.querySelectorAll("button[data-action]").forEach(b => {
      b.addEventListener("click", () => {
        waitingAction = b.dataset.action;
        renderRebindList();
        toast("Remap: appuie sur une touche");
      });
    });
  }

  btnRebind.addEventListener("click", () => {
    rebindPanel.classList.remove("hidden");
    renderRebindList();
  });

  btnCloseRebind.addEventListener("click", () => {
    waitingAction = null;
    rebindPanel.classList.add("hidden");
    saveBinds();
    toast("Touches sauvegardées");
  });

  btnResetBinds.addEventListener("click", () => {
    for (const k of Object.keys(DEFAULT_BINDS)) BINDS[k] = structuredClone(DEFAULT_BINDS[k]);
    saveBinds();
    waitingAction = null;
    renderRebindList();
    toast("Touches réinitialisées");
  });

  window.addEventListener("keydown", (e) => {
    if (!waitingAction) return;
    e.preventDefault();

    // On évite Escape (sinon tu te bloques)
    if (e.code === "Escape") { toast("Escape réservé au menu pause"); return; }

    BINDS[waitingAction] = [e.code];
    waitingAction = null;
    saveBinds();
    renderRebindList();
    toast("Touche assignée");
  }, { passive: false });

  /* ---------------------------
    Resize
  --------------------------- */

  window.addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applyPixelRatio();
  });

  /* ---------------------------
    Main Loop
  --------------------------- */

  let last = performance.now();

  function tick(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;

    updatePlayer(dt);
    updateCamera(dt);

    netTick(now, dt);

    renderer.render(scene, camera);

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  /* ---------------------------
    Start state / URL name
  --------------------------- */

  (function initName() {
    const url = new URL(location.href);
    const name = (url.searchParams.get("name") || "").trim();
    if (name) localStorage.setItem("lg_name", name);
    netConnect();
  })();

  // Start not paused
  setPaused(false);
})();

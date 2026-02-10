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
    pause: ["Escape"],
    joystickToggle: ["KeyJ"],
  };

  const DEFAULT_SETTINGS = {
    graphics: { quality: "high", shadows: true, fov: 60, pixelRatio: "auto" },
    controls: { sens: 1.2, invertY: false, mouseMode: "drag" }, // drag / lock
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

    try {
      renderer.domElement.requestPointerLock?.();
    } catch (e) {
      toast("Impossible de capturer la souris (Pointer Lock). Essaie de cliquer dans la scène puis réessaie.");
    }
  });

  document.addEventListener("pointerlockchange", () => {
    Input.pointerLocked = (document.pointerLockElement === renderer.domElement);
  });

  // Touch joysticks
  const touchUI = $("#touchUI");
  const stickMove = $("#stickMove");
  const stickLook = $("#stickLook");
  const btnJump = $("#btnJump");

  let touchEnabled = false;

  function setStickKnob(stickEl, nx, ny) {
    const knob = stickEl.querySelector(".knob");
    if (!knob) return;
    const r = 42; // px radius
    const x = clamp(nx, -1, 1) * r;
    const y = clamp(ny, -1, 1) * r;
    knob.style.transform = `translate(-50%,-50%) translate(${x}px, ${y}px)`;
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
      setStickKnob(stickEl, nx, ny);
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
      camRig.yaw   -= (Input.lookDX * 0.0022) * sens;
      camRig.pitch -= (Input.lookDY * 0.0018) * sens * invert;
    }
    Input.lookDX = 0;
    Input.lookDY = 0;

    // Touch look
    if (!PAUSED && touchEnabled) {
      camRig.yaw   -= (Input.lookX * 1.35) * dt * sens;
      camRig.pitch -= (Input.lookY * 1.10) * dt * sens * invert;
    }

    camRig.pitch = clamp(camRig.pitch, -1.35, 0.55);

    // Target = player head
    const target = new THREE.Vector3(
      player.root.position.x,
      player.root.position.y + camRig.height,
      player.root.position.z
    );

    // Camera offset (rotated by yaw/pitch)
    const offset = new THREE.Vector3(0, 0, -camRig.dist);
    const rot = new THREE.Euler(camRig.pitch, camRig.yaw, 0, "YXZ");
    offset.applyEuler(rot);

    const desiredPos = target.clone().add(offset);

    // Smooth
    const k = 1 - Math.pow(0.001, dt);
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

  function computeVisibleBounds(root) {
    // More robust than Box3.setFromObject for skinned meshes / weird hierarchies.
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let has = false;

    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox?.();
      if (!g.boundingBox) return;

      tmp.copy(g.boundingBox);
      tmp.applyMatrix4(o.matrixWorld);

      if (!has) { box.copy(tmp); has = true; }
      else box.union(tmp);
    });

    return has ? box : null;
  }

  function fitModelToPlayer(m) {
    // recentre + scale raisonnable, stable même avec des GLB "capricieux"
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    m.updateWorldMatrix(true, true);

    const box = computeVisibleBounds(m) || new THREE.Box3().setFromObject(m);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Move pivot to center, then drop to ground
    m.position.sub(center);

    m.updateWorldMatrix(true, true);
    const box2 = computeVisibleBounds(m) || new THREE.Box3().setFromObject(m);
    m.position.y -= box2.min.y;

    // scale to ~1.55m
    const h = Math.max(0.01, size.y);
    const targetH = 1.55;
    const s = targetH / h;
    m.scale.multiplyScalar(s);
  }

  function applyPlayerAppearance() {
    const scale = clamp(parseFloat(SETTINGS.skin.scale) || 1.0, 0.8, 1.2);
    player.root.scale.setScalar(scale);

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

  loadSkinById(SETTINGS.skin.selected);

  /* ---------------------------
    Movement / Physics
  --------------------------- */

  let PAUSED = false;
  let sprintToggled = false;

  function setPaused(v) {
    PAUSED = v;

    const overlay = $("#pauseOverlay");
    overlay?.classList.toggle("active", v);

    // Release pointer lock in pause
    if (v && document.pointerLockElement) document.exitPointerLock?.();

    // Show/hide touch UI depending
    applyAutoTouchUI();

    const hint = $("#hudHint");
    if (hint) hint.textContent = v ? "Pause (menu ouvert)" : "Clique / touche l’écran pour contrôler la caméra";
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
      const yaw = camRig.yaw + Math.PI;
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
    player.root.scale.y = lerp(player.root.scale.y, targetScaleY * clamp(SETTINGS.skin.scale || 1.0, 0.8, 1.2), 1 - Math.pow(0.001, dt));
  }

  function lerpAngle(a, b, t) {
    const d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    return a + d * t;
  }

  /* ---------------------------
    UI Wiring (Pause / Tabs / Options / Skins / Rebind)
  --------------------------- */

  // Pause toggles
  $("#btnPause")?.addEventListener("click", () => setPaused(!PAUSED));
  $("#btnClosePause")?.addEventListener("click", () => setPaused(false));
  $("#btnResume")?.addEventListener("click", () => setPaused(false));
  $("#btnStay")?.addEventListener("click", () => setPaused(false));
  $("#btnGoHome")?.addEventListener("click", () => { location.href = "index.html"; });
  $("#btnResetPos")?.addEventListener("click", () => teleportSpawn());
  $("#btnJoystick")?.addEventListener("click", () => toggleTouchUI());

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
  $("#optQuality")?.addEventListener("change", (e) => {
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

  $("#optShadows")?.addEventListener("click", () => {
    SETTINGS.graphics.shadows = !SETTINGS.graphics.shadows;
    renderer.shadowMap.enabled = SETTINGS.graphics.shadows;
    $("#optShadows").textContent = SETTINGS.graphics.shadows ? "ON" : "OFF";
    saveSettings();
  });

  $("#optFov")?.addEventListener("change", (e) => {
    SETTINGS.graphics.fov = clamp(parseInt(e.target.value || "60", 10), 45, 85);
    camera.fov = SETTINGS.graphics.fov;
    camera.updateProjectionMatrix();
    saveSettings();
  });

  $("#optPixelRatio")?.addEventListener("change", (e) => {
    SETTINGS.graphics.pixelRatio = e.target.value;
    applyPixelRatio();
    saveSettings();
  });

  // Controls handlers
  $("#optSens")?.addEventListener("change", (e) => {
    SETTINGS.controls.sens = clamp(parseFloat(e.target.value || "1.2"), 0.3, 3);
    saveSettings();
  });

  $("#optInvertY")?.addEventListener("click", () => {
    SETTINGS.controls.invertY = !SETTINGS.controls.invertY;
    $("#optInvertY").textContent = SETTINGS.controls.invertY ? "ON" : "OFF";
    saveSettings();
  });

  $("#optMouseMode")?.addEventListener("change", (e) => {
    SETTINGS.controls.mouseMode = e.target.value;
    saveSettings();
    toast("Souris: " + (SETTINGS.controls.mouseMode === "lock" ? "Pointer Lock" : "Drag"));
  });

  // Gameplay handlers
  $("#optMoveRel")?.addEventListener("click", () => {
    SETTINGS.gameplay.moveRelativeCamera = !SETTINGS.gameplay.moveRelativeCamera;
    $("#optMoveRel").textContent = SETTINGS.gameplay.moveRelativeCamera ? "ON" : "OFF";
    saveSettings();
  });

  $("#optSprintMode")?.addEventListener("change", (e) => {
    SETTINGS.gameplay.sprintMode = e.target.value;
    sprintToggled = false;
    saveSettings();
  });

  $("#optDash")?.addEventListener("click", () => {
    SETTINGS.gameplay.dash = !SETTINGS.gameplay.dash;
    $("#optDash").textContent = SETTINGS.gameplay.dash ? "ON" : "OFF";
    saveSettings();
  });

  $("#optAutoJoy")?.addEventListener("click", () => {
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

  $("#optScale")?.addEventListener("change", (e) => {
    SETTINGS.skin.scale = clamp(parseFloat(e.target.value || "1.0"), 0.8, 1.2);
    saveSettings();
    applyPlayerAppearance();
  });

  $("#optColor")?.addEventListener("change", (e) => {
    SETTINGS.skin.color = e.target.value;
    saveSettings();
    applyPlayerAppearance();
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
    // e.code is a PHYSICAL key. We display a friendlier label for AZERTY FR users.
    const lang = (navigator.language || "").toLowerCase();
    const isFR = lang.startsWith("fr");
    const azerty = {
      KeyW: "Z",
      KeyA: "Q",
      KeyQ: "A",
      KeyZ: "W",
    };

    if (isFR && azerty[code]) return azerty[code];

    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code === "Space") return "Espace";
    if (code.startsWith("Arrow")) return code.replace("Arrow", "Flèche ");
    if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
    if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
    if (code === "AltLeft" || code === "AltRight") return "Alt";
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
  })();

  // Start not paused
  setPaused(false);
})();

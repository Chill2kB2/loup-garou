(() => {
  "use strict";

  // Signal that hub_world.js is executing (for the HTML watchdog)
  window.__HUB_OK = true;


  const bootBadge = document.getElementById("bootBadge");
  function setBoot(t){ if (bootBadge) bootBadge.textContent = t; }


  // Fatal error helper (only shows if something breaks)
  function fatal(msg, err) {
    try {
      const el = document.createElement("div");
      el.style.position = "fixed";
      el.style.inset = "12px";
      el.style.zIndex = "9999";
      el.style.padding = "12px 14px";
      el.style.borderRadius = "14px";
      el.style.border = "1px solid rgba(255,255,255,.14)";
      el.style.background = "rgba(10,12,18,.92)";
      el.style.color = "rgba(234,240,255,.92)";
      el.style.font = "13px system-ui, -apple-system, Segoe UI, Arial";
      el.style.whiteSpace = "pre-wrap";
      el.textContent = "Hub error:\n" + msg + (err ? "\n\n" + (err.stack || err.message || String(err)) : "");
      document.body.appendChild(el);
    } catch {}
    console.error(msg, err);
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const LS_KEY = "hubSettingsV5";

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function normalizeBindFromEvent(e) {
    // We want AZERTY-friendly bindings: use e.key for characters.
    // Space is special.
    if (e.code === "Space") return "Space";
    if (e.key && e.key.length === 1) return e.key.toLowerCase();
    if (e.key) return e.key; // Escape, Shift, ArrowUp, etc.
    return e.code || "";
  }

  function prettyBind(k) {
    if (!k) return "—";
    if (k === "Space") return "Espace";
    if (k === "Escape") return "Échap";
    if (k === "Shift") return "Shift";
    if (k.startsWith("Arrow")) {
      const m = { ArrowUp:"↑", ArrowDown:"↓", ArrowLeft:"←", ArrowRight:"→" };
      return m[k] || k;
    }
    return k.length === 1 ? k.toUpperCase() : k;
  }

  function hasAnyBindPressed(actionBinds, pressed) {
    for (const b of actionBinds) if (pressed[b]) return true;
    return false;
  }

  function mergeDeep(base, patch) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    if (!patch || typeof patch !== "object") return out;

    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
        out[k] = mergeDeep(base[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  // ------------------------------------------------------------
  // Defaults (player-friendly)
  // ------------------------------------------------------------
  const DEFAULTS = {
    mouseSens: 0.45,
    invertY: false,
    invertX: false,
    quality: "high",      // low | med | high
    shadows: true,
    camDist: 3.3,
    binds: {
      forward: ["z", "ArrowUp"],
      back:    ["s", "ArrowDown"],
      left:    ["q", "ArrowLeft"],
      right:   ["d", "ArrowRight"],
      jump:    ["Space"],
      sprint:  ["Shift"],
      pause:   ["Escape", "p"],
    },
    skin: { id: "fox_brown", color: "#b97a56" },
  };

  let settings = DEFAULTS;
  {
    const saved = safeJsonParse(localStorage.getItem(LS_KEY) || "");
    if (saved) settings = mergeDeep(DEFAULTS, saved);
  }
  function saveSettings() {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }



  // ------------------------------------------------------------
  // UI / Pause pages
  // ------------------------------------------------------------
  const pauseOverlay = $("pauseOverlay");
  const bindOverlay = $("bindOverlay");

  const pages = {
    main: $("pageMain"),
    options: $("pageOptions"),
    skins: $("pageSkins"),
    home: $("pageHome"),
  };

  function showPage(name) {
    for (const p of Object.values(pages)) p.classList.remove("active");
    pages[name].classList.add("active");
  }

  let paused = false;
  function setPaused(v) {
    paused = !!v;
    if (paused) {
      pauseOverlay.classList.add("active");
      pauseOverlay.setAttribute("aria-hidden", "false");
      showPage("main");
      // Release pointer lock so player can use UI.
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      pauseOverlay.classList.remove("active");
      pauseOverlay.setAttribute("aria-hidden", "true");
    }
  }

  $("btnMenu").addEventListener("click", () => setPaused(true));
  $("btnClosePause").addEventListener("click", () => setPaused(false));

  $("btnResume").addEventListener("click", () => setPaused(false));
  $("btnOptions").addEventListener("click", () => showPage("options"));
  $("btnSkins").addEventListener("click", () => showPage("skins"));
  $("btnHome").addEventListener("click", () => showPage("home"));

  $("btnBackFromOptions").addEventListener("click", () => showPage("main"));
  $("btnBackFromSkins").addEventListener("click", () => showPage("main"));
  $("btnBackFromHome").addEventListener("click", () => showPage("main"));
  $("btnCancelHome").addEventListener("click", () => showPage("main"));
  $("btnConfirmHome").addEventListener("click", () => (location.href = "index.html"));

  // Bind UI (simple + visible)
  const bindList = $("bindList");
  const bindPrompt = $("bindPrompt");
  let waitingAction = null;

  const ACTIONS = [
    { key: "forward", label: "Avancer" },
    { key: "back", label: "Reculer" },
    { key: "left", label: "Gauche" },
    { key: "right", label: "Droite" },
    { key: "jump", label: "Saut" },
    { key: "sprint", label: "Courir" },
    { key: "pause", label: "Menu pause" },
  ];

  function renderBindList() {
    bindList.innerHTML = "";
    for (const a of ACTIONS) {
      const binds = settings.binds[a.key] || [];
      const main = binds[0] || "";
      const alt = binds[1] || "";
      const row = document.createElement("div");
      row.className = "bindRow";
      row.innerHTML = `
        <div>
          <div class="a">${a.label}</div>
          <div class="k">${prettyBind(main)}${alt ? " / " + prettyBind(alt) : ""}</div>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn" data-act="${a.key}">Changer</button>
          ${a.key !== "pause" ? `<button class="btn" data-act-alt="${a.key}">Alt</button>` : ``}
        </div>
      `;
      bindList.appendChild(row);
    }

    // Main bind change
    bindList.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act");
        waitingAction = { act, slot: 0 };
        bindPrompt.textContent = `Appuie sur une touche pour: ${ACTIONS.find(x=>x.key===act).label}`;
      });
    });

    // Alt bind change
    bindList.querySelectorAll("button[data-act-alt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act-alt");
        waitingAction = { act, slot: 1 };
        bindPrompt.textContent = `Appuie sur une touche (ALT) pour: ${ACTIONS.find(x=>x.key===act).label}`;
      });
    });
  }

  function openBinds() {
    renderBindList();
    bindOverlay.classList.add("active");
    bindOverlay.setAttribute("aria-hidden", "false");
    waitingAction = null;
    bindPrompt.textContent = "Aucune touche en attente.";
  }
  function closeBinds() {
    bindOverlay.classList.remove("active");
    bindOverlay.setAttribute("aria-hidden", "true");
    waitingAction = null;
    bindPrompt.textContent = "Aucune touche en attente.";
  }
  $("btnOpenBinds").addEventListener("click", openBinds);
  $("btnCloseBinds").addEventListener("click", closeBinds);

  // Options controls
  const sensRange = $("optSens");
  const sensLabel = $("sensLabel");
  const invertBtn = $("optInvertY");
  const invertXBtn = $("optInvertX");
  const qualitySel = $("optQuality");
  const shadowsBtn = $("optShadows");
  const camDistRange = $("optCamDist");
  const camDistLabel = $("camDistLabel");

  function applyOptionsToUI() {
    sensRange.value = String(settings.mouseSens);
    sensLabel.textContent = settings.mouseSens.toFixed(2);

    invertBtn.textContent = settings.invertY ? "ON" : "OFF";
    if (invertXBtn) invertXBtn.textContent = settings.invertX ? "ON" : "OFF";
    qualitySel.value = settings.quality || "high";
    shadowsBtn.textContent = settings.shadows ? "ON" : "OFF";

    camDistRange.value = String(settings.camDist);
    camDistLabel.textContent = settings.camDist.toFixed(1);
  }

  sensRange.addEventListener("input", () => {
    settings.mouseSens = parseFloat(sensRange.value);
    sensLabel.textContent = settings.mouseSens.toFixed(2);
    saveSettings();
  });

  invertBtn.addEventListener("click", () => {

    settings.invertY = !settings.invertY;
    invertBtn.textContent = settings.invertY ? "ON" : "OFF";
    saveSettings();
  });

  qualitySel.addEventListener("change", () => {
    settings.quality = qualitySel.value;
    applyQuality();
    saveSettings();
  });

  shadowsBtn.addEventListener("click", () => {
    settings.shadows = !settings.shadows;
    shadowsBtn.textContent = settings.shadows ? "ON" : "OFF";
    applyShadows();
    saveSettings();
  });

  camDistRange.addEventListener("input", () => {
    settings.camDist = parseFloat(camDistRange.value);
    camDistLabel.textContent = settings.camDist.toFixed(1);
    saveSettings();
  });

  applyOptionsToUI();

  // ------------------------------------------------------------
  // Touch detection (mobile)
  // ------------------------------------------------------------
  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);

  // ------------------------------------------------------------
  // Scene / Three.js
  // ------------------------------------------------------------
  setBoot("Chargement… (Three.js)");
  if (typeof THREE === "undefined") {
    fatal("Three.js (THREE) est introuvable. Vérifie que three.min.js est bien servi à la racine.");
    return;
  }

  // GLTFLoader availability
  if (!THREE.GLTFLoader) {
    fatal("GLTFLoader est introuvable. Vérifie le chargement du script GLTFLoader (CDN ou local).");
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1a);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 250);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  // Color space compatibility (old/new three)
  if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ("outputEncoding" in renderer && THREE.sRGBEncoding) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  document.body.appendChild(renderer.domElement);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.85);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(6, 12, 4);
  dir.castShadow = true;
  scene.add(dir);

  // Ground (simple + visible)
  const groundGeo = new THREE.PlaneGeometry(140, 140, 1, 1);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a344a, roughness: 0.92, metalness: 0.0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Player root
  const player = {
    id: null,
    root: new THREE.Object3D(),
    model: null,
    velY: 0,
    onGround: true,
    camTargetY: 1.0,   // computed after model load
    modelYaw: 0,
  };
  scene.add(player.root);
  player.root.position.set(0, 0, 0);

  // Simple fallback player mesh (capsule)
  
function makeFallbackBody(colorHex = settings.skin.color) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: 0.65,
    metalness: 0.05,
  });

  let body = null;

  // CapsuleGeometry may not exist in older Three builds
  if (THREE.CapsuleGeometry) {
    body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 6, 12), mat);
    body.position.y = 0.8;
  } else {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.15, 12), mat);
    cyl.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mat);
    head.position.y = 1.55;
    grp.add(cyl, head);
  }

  if (body) grp.add(body);

  grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return grp;
}

  function applyColorToModel(obj3d, colorHex) {
    if (!obj3d) return;
    const c = new THREE.Color(colorHex);
    obj3d.traverse((o) => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => m.clone());
        for (const m of o.material) {
          if (m && m.color) m.color.copy(c);
        }
      } else if (o.material) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.copy(c);
      }
      o.castShadow = true;
      o.receiveShadow = false;
    });
  }

  function fitModelToGround(obj3d) {
    // Important: scale first (if needed), then recenter, then put on ground (y=0).
    const box = new THREE.Box3().setFromObject(obj3d);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = Math.max(0.001, size.y);

    // Normalize to a usable in-game height (fox ~1.1)
    const targetHeight = 1.1;
    const s = targetHeight / height;
    obj3d.scale.setScalar(s);

    const box2 = new THREE.Box3().setFromObject(obj3d);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    obj3d.position.sub(center);

    const box3 = new THREE.Box3().setFromObject(obj3d);
    const min = box3.min.y;
    obj3d.position.y -= min;

    const box4 = new THREE.Box3().setFromObject(obj3d);
    const size2 = new THREE.Vector3();
    box4.getSize(size2);

    // Camera target height: slightly above "head line".
    player.camTargetY = clamp(size2.y * 0.70, 0.8, 1.6);
  }

  async function loadFox() {
    const loader = new THREE.GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.load(
        "assets/models/test/Fox.glb",
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => reject(err)
      );
    });
  }

  async function initPlayerModel() {
    setBoot("Chargement… (modèle)");
    // clear previous
    if (player.model) {
      player.root.remove(player.model);
      player.model = null;
    }

    try {
      const fox = await loadFox();
      fitModelToGround(fox);

      // A subtle scale bump so the fox feels readable at distance
      fox.scale.multiplyScalar(1.05);

      applyColorToModel(fox, settings.skin.color);
      player.model = fox;
      player.root.add(fox);
    } catch {
      const fallback = makeFallbackBody(settings.skin.color);
      player.camTargetY = 1.15;
      player.model = fallback;
      player.root.add(fallback);
    }
  }

  // ------------------------------------------------------------
  // Camera (third-person, "gamer")
  // ------------------------------------------------------------
  const cam = {
    yaw: 0,
    pitch: 0.20,
    dist: settings.camDist,
    yawVel: 0,
    pitchVel: 0,
  };

  function updateCamera(dt) {
    cam.dist = settings.camDist;

    const target = new THREE.Vector3(
      player.root.position.x,
      player.root.position.y + player.camTargetY,
      player.root.position.z
    );

    // Clamp pitch to avoid flipping.
    cam.pitch = clamp(cam.pitch, -0.55, 1.05);

    const horiz = cam.dist * Math.cos(cam.pitch);
    const yOff = cam.dist * Math.sin(cam.pitch);

    // Behind-the-player orbit
    const cx = target.x + (Math.sin(cam.yaw) * horiz);
    const cz = target.z - (Math.cos(cam.yaw) * horiz);
    const cy = target.y + yOff;

    camera.position.set(cx, cy, cz);
    camera.lookAt(target);
  }

  // ------------------------------------------------------------
  // Input
  // ------------------------------------------------------------
  const pressed = Object.create(null);
  let pointerLocked = false;

  // Touch UI (two sticks + jump)
  const touchUI = $("touchUI");
  const stickMoveEl = $("stickMove");
  const stickLookEl = $("stickLook");
  const btnJump = $("btnJump");

  const touchMove = { id: null, sx: 0, sy: 0, x: 0, y: 0, knob: stickMoveEl ? stickMoveEl.querySelector(".knob") : null };
  const touchLook = { id: null, sx: 0, sy: 0, x: 0, y: 0, knob: stickLookEl ? stickLookEl.querySelector(".knob") : null };
  const STICK_R = 60;

  let touchJumpQueued = false;

  function stickSet(st, dx, dy){
    const mag = Math.hypot(dx, dy);
    if (mag > STICK_R) {
      dx = dx / mag * STICK_R;
      dy = dy / mag * STICK_R;
    }
    st.x = dx / STICK_R;
    st.y = dy / STICK_R;
    if (st.knob) st.knob.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
  }

  function stickReset(st){
    st.id = null;
    st.x = 0; st.y = 0;
    if (st.knob) st.knob.style.transform = `translate(0px, 0px) translate(-50%, -50%)`;
  }

  function handleStickStart(el, st, e){
    if (!el || st.id !== null) return;
    const t = e.changedTouches[0];
    st.id = t.identifier;
    st.sx = t.clientX;
    st.sy = t.clientY;
    stickSet(st, 0, 0);
    e.preventDefault();
  }

  function handleStickMove(st, e){
    if (st.id === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== st.id) continue;
      stickSet(st, t.clientX - st.sx, t.clientY - st.sy);
      e.preventDefault();
      return;
    }
  }

  function handleStickEnd(st, e){
    if (st.id === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== st.id) continue;
      stickReset(st);
      e.preventDefault();
      return;
    }
  }

  function setupTouchUI(){
    if (!isTouch || !touchUI || !stickMoveEl || !stickLookEl || !btnJump) return;

    touchUI.classList.remove("hidden");
    touchUI.setAttribute("aria-hidden", "false");

    // Better hint on mobile
    const hint = $("hudHint");
    if (hint) hint.textContent = "Joysticks pour bouger/regarder • Menu pour options";

    stickMoveEl.addEventListener("touchstart", (e) => handleStickStart(stickMoveEl, touchMove, e), { passive: false });
    stickLookEl.addEventListener("touchstart", (e) => handleStickStart(stickLookEl, touchLook, e), { passive: false });

    document.addEventListener("touchmove", (e) => { handleStickMove(touchMove, e); handleStickMove(touchLook, e); }, { passive: false });
    document.addEventListener("touchend", (e) => { handleStickEnd(touchMove, e); handleStickEnd(touchLook, e); }, { passive: false });
    document.addEventListener("touchcancel", (e) => { handleStickEnd(touchMove, e); handleStickEnd(touchLook, e); }, { passive: false });

    btnJump.addEventListener("touchstart", (e) => {
      if (paused) return;
      touchJumpQueued = true;
      // brief pulse
      setTimeout(() => { touchJumpQueued = false; }, 180);
      e.preventDefault();
    }, { passive: false });
  }

  // Request pointer lock with an activation: click OR movement key press.
  function tryLockPointer() {
    if (isTouch) return;
    if (paused) return;
    if (document.pointerLockElement === renderer.domElement) return;
    renderer.domElement.requestPointerLock?.();
  }

  renderer.domElement.addEventListener("click", () => tryLockPointer());

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = (document.pointerLockElement === renderer.domElement);
    // If the player exits pointer lock (often via ESC), open pause reliably.
    if (!pointerLocked && !paused) setPaused(true);
  });

  document.addEventListener("mousemove", (e) => {
    if (!pointerLocked || paused) return;

    // movementX > 0 => mouse right => look right (gamer expectation)
    const k = settings.mouseSens * 0.0026;
    const multX = settings.invertX ? -1 : 1;
    cam.yaw += e.movementX * k * multX;

    // movementY < 0 (mouse up) => look up. Default: pitch -= movementY*k
    const mult = settings.invertY ? -1 : 1;
    cam.pitch -= e.movementY * k * mult;
  });

  document.addEventListener("keydown", (e) => {
    const b = normalizeBindFromEvent(e);
    if (b) pressed[b] = true;

    // Keybind capture modal
    if (bindOverlay.classList.contains("active") && waitingAction) {
      e.preventDefault();
      const act = waitingAction.act;
      const slot = waitingAction.slot;

      // Avoid binding "Escape" on movement by mistake; allow for pause only.
      const newBind = b;

      const arr = settings.binds[act] ? [...settings.binds[act]] : [];
      arr[slot] = newBind;

      // Ensure binds are unique inside same action slots (avoid duplicates like "z/z")
      if (arr[0] && arr[1] && arr[0] === arr[1]) arr[1] = "";

      // For "pause", keep Escape as a safe fallback (player-friendly)
      if (act === "pause" && !arr.includes("Escape")) arr[0] = "Escape";

      settings.binds[act] = arr.filter(Boolean);
      saveSettings();

      waitingAction = null;
      bindPrompt.textContent = "Aucune touche en attente.";
      renderBindList();
      return;
    }

    // Open pause with dedicated bind (P by default)
    if (hasAnyBindPressed(settings.binds.pause, pressed) && !paused) {
      // If pointer locked, we rely on pointerlockchange for Escape,
      // but this still allows P to work immediately.
      setPaused(true);
      return;
    }

    // Auto-lock pointer on first movement key (no need to click)
    const moveKeys = [...settings.binds.forward, ...settings.binds.back, ...settings.binds.left, ...settings.binds.right];
    if (!paused && moveKeys.includes(b)) {
      tryLockPointer();
    }
  });

  document.addEventListener("keyup", (e) => {
    const b = normalizeBindFromEvent(e);
    if (b) pressed[b] = false;
  });

  // ------------------------------------------------------------
  // Movement (ZQSD, simple, solid feel)
  // ------------------------------------------------------------
  const GRAV = 18.0;
  const JUMP = 6.8;
  const SPEED = 4.4;
  const SPRINT = 6.8;

  function updatePlayer(dt) {
    // Basic grounded check (flat ground at y=0)
    if (player.root.position.y <= 0) {
      player.root.position.y = 0;
      player.velY = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    // Jump
    if (player.onGround && (hasAnyBindPressed(settings.binds.jump, pressed) || (isTouch && touchJumpQueued))) {
      player.velY = JUMP;
      player.onGround = false;
    }

    // Gravity
    player.velY -= GRAV * dt;
    player.root.position.y += player.velY * dt;

    // Movement direction relative to camera yaw
    let f = (hasAnyBindPressed(settings.binds.forward, pressed) ? 1 : 0) - (hasAnyBindPressed(settings.binds.back, pressed) ? 1 : 0);
    let r = (hasAnyBindPressed(settings.binds.right, pressed) ? 1 : 0) - (hasAnyBindPressed(settings.binds.left, pressed) ? 1 : 0);
    if (isTouch) {
      // Left stick: up = forward (negative y), right = strafe right
      f += -touchMove.y;
      r += touchMove.x;
      // Clamp to keep consistent speed
      f = clamp(f, -1, 1);
      r = clamp(r, -1, 1);
    }

    const moving = (f !== 0 || r !== 0);
    const sp = hasAnyBindPressed(settings.binds.sprint, pressed) ? SPRINT : SPEED;

    if (moving) {
      const forward = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
      const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
      const v = new THREE.Vector3();
      v.addScaledVector(forward, f);
      v.addScaledVector(right, r);
      v.normalize().multiplyScalar(sp * dt);

      player.root.position.add(v);

      // Face movement direction
      const desiredYaw = Math.atan2(v.x, v.z);
      player.modelYaw = lerp(player.modelYaw, desiredYaw, clamp(dt * 10.5, 0, 1));
      player.root.rotation.y = player.modelYaw;
    }
  }

  // ------------------------------------------------------------
  // WebSocket hub presence + skins sync (server protocol verified)
  // ------------------------------------------------------------
  const wsBadge = $("wsBadge");
  const urlParams = new URLSearchParams(location.search);
  const WS_URL = urlParams.get("ws") || "wss://loup-garou-ws.onrender.com/ws";
  const NAME = (urlParams.get("name") || "").slice(0, 32) || ("Player" + Math.floor(Math.random() * 999));

  let ws = null;
  let wsConnected = false;
  let reconnectTimer = null;

  const remotes = new Map(); // id -> {root, mesh, label, st, lastSt}

  function makeNameSprite(text) {
    const cvs = document.createElement("canvas");
    const ctx = cvs.getContext("2d");
    const pad = 10;
    ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Arial";
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = 34;
    cvs.width = w;
    cvs.height = h;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, h / 2);

    const tex = new THREE.CanvasTexture(cvs);
    if ("colorSpace" in tex && THREE.SRGBColorSpace) {
      tex.colorSpace = THREE.SRGBColorSpace;
    } else if ("encoding" in tex && THREE.sRGBEncoding) {
      tex.encoding = THREE.sRGBEncoding;
    }
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(w / 140, h / 140, 1);
    return spr;
  }

  function ensureRemote(p) {
    if (!p || typeof p.id !== "number") return;
    if (remotes.has(p.id)) return;

    const root = new THREE.Object3D();
    const col = (p.skin && p.skin.color) ? p.skin.color : "#77aaff";
    const mesh = makeFallbackBody(col);
    root.add(mesh);

    const label = makeNameSprite(p.name || ("P" + p.id));
    label.position.set(0, 1.9, 0);
    root.add(label);

    scene.add(root);
    remotes.set(p.id, {
      root, mesh, label,
      st: { x: 0, y: 0, z: 0, yaw: 0 },
      lastSt: { x: 0, y: 0, z: 0, yaw: 0 },
      skin: { color: col },
    });
  }

  function removeRemote(id) {
    const r = remotes.get(id);
    if (!r) return;
    scene.remove(r.root);
    remotes.delete(id);
  }

  function applyRemoteSkin(id, skin) {
    const r = remotes.get(id);
    if (!r) return;
    const col = (skin && skin.color) ? skin.color : "#77aaff";
    r.skin = { ...skin, color: col };
    // recolor capsule fallback
    r.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) {
        o.material.color.set(col);
      }
    });
  }

  function wsSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function updateWsBadge() {
    const n = remotes.size + 1; // + self
    wsBadge.textContent = wsConnected ? `WS: connecté • Joueurs: ${n}` : "WS: hors-ligne";
  }

  function connectWS() {
    try { if (ws) ws.close(); } catch {}
    ws = null;
    wsConnected = false;
    updateWsBadge();

    ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      wsConnected = true;
      updateWsBadge();
      wsSend({
        t: "join",
        room: "hub",
        name: NAME,
        skin: settings.skin,
        st: { x: player.root.position.x, y: player.root.position.y, z: player.root.position.z, yaw: cam.yaw },
      });
    });

    ws.addEventListener("message", (ev) => {
      const msg = safeJsonParse(ev.data);
      if (!msg || !msg.t) return;

      if (msg.t === "welcome" || msg.t === "hub_welcome") {
        if (typeof msg.id === "number") player.id = msg.id;
        updateWsBadge();
        return;
      }

      if (msg.t === "hub_snapshot" && Array.isArray(msg.players)) {
        for (const p of msg.players) {
          if (p.id === player.id) continue;
          ensureRemote(p);
          if (p.skin) applyRemoteSkin(p.id, p.skin);
          if (p.st) {
            const r = remotes.get(p.id);
            if (r) {
              r.st = { ...r.st, ...p.st };
              r.lastSt = { ...r.lastSt, ...p.st };
              r.root.position.set(r.st.x || 0, r.st.y || 0, r.st.z || 0);
              r.root.rotation.y = r.st.yaw || 0;
            }
          }
        }
        updateWsBadge();
        return;
      }

      if (msg.t === "hub_join" && msg.p) {
        if (msg.p.id === player.id) return;
        ensureRemote(msg.p);
        if (msg.p.skin) applyRemoteSkin(msg.p.id, msg.p.skin);
        if (msg.p.st) {
          const r = remotes.get(msg.p.id);
          if (r) {
            r.st = { ...r.st, ...msg.p.st };
            r.lastSt = { ...r.lastSt, ...msg.p.st };
            r.root.position.set(r.st.x || 0, r.st.y || 0, r.st.z || 0);
            r.root.rotation.y = r.st.yaw || 0;
          }
        }
        updateWsBadge();
        return;
      }

      if (msg.t === "hub_state" && typeof msg.id === "number" && msg.st) {
        if (msg.id === player.id) return;
        ensureRemote({ id: msg.id, name: "Player" + msg.id });
        const r = remotes.get(msg.id);
        if (r) {
          r.lastSt = { ...r.st };
          r.st = { ...r.st, ...msg.st };
          if (msg.skin) applyRemoteSkin(msg.id, msg.skin);
        }
        return;
      }

      if (msg.t === "hub_skin" && msg.p && typeof msg.p.id === "number") {
        if (msg.p.id === player.id) return;
        ensureRemote(msg.p);
        applyRemoteSkin(msg.p.id, msg.p.skin || {});
        updateWsBadge();
        return;
      }

      if (msg.t === "hub_leave") {
        if (typeof msg.id === "number") removeRemote(msg.id);
        updateWsBadge();
        return;
      }
    });

    ws.addEventListener("close", () => {
      wsConnected = false;
      updateWsBadge();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWS, 1500);
    });

    ws.addEventListener("error", () => {
      // handled by close / reconnect
    });
  }

  // Send state 12 Hz
  let netAcc = 0;
  function netTick(dt) {
    if (!wsConnected || player.id == null) return;
    netAcc += dt;
    const period = 1 / 12;
    if (netAcc < period) return;
    netAcc = 0;

    wsSend({
      t: "hub_state",
      st: {
        x: +player.root.position.x.toFixed(3),
        y: +player.root.position.y.toFixed(3),
        z: +player.root.position.z.toFixed(3),
        yaw: +player.root.rotation.y.toFixed(3),
      },
    });
  }

  // ------------------------------------------------------------
  // Skins UI (simple + synced)
  // ------------------------------------------------------------
  const SKINS = [
    { id: "fox_brown", label: "Renard brun", color: "#b97a56" },
    { id: "fox_grey",  label: "Renard gris", color: "#8f98a6" },
    { id: "fox_black", label: "Renard noir", color: "#2d2f36" },
    { id: "fox_white", label: "Renard blanc", color: "#d6dbe6" },
  ];

  function renderSkins() {
    const grid = $("skinsGrid");
    grid.innerHTML = "";
    for (const s of SKINS) {
      const btn = document.createElement("button");
      btn.className = "skinBtn";
      btn.innerHTML = `<span class="swatch" style="background:${s.color}"></span>${s.label}`;
      btn.addEventListener("click", () => {
        settings.skin = { id: s.id, color: s.color };
        saveSettings();
        applyColorToModel(player.model, settings.skin.color);
        // Sync to others
        wsSend({ t: "hub_skin", skin: settings.skin });
      });
      grid.appendChild(btn);
    }
  }
  renderSkins();

  // ------------------------------------------------------------
  // Quality / shadows (simple)
  // ------------------------------------------------------------
  function applyQuality() {
    const q = settings.quality || "high";
    if (q === "low") {
      renderer.setPixelRatio(1);
      dir.intensity = 0.9;
    } else if (q === "med") {
      renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
      dir.intensity = 1.0;
    } else {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      dir.intensity = 1.1;
    }
    applyShadows();
  }

  function applyShadows() {
    renderer.shadowMap.enabled = !!settings.shadows;
    if (renderer.shadowMap.enabled) {
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      dir.shadow.camera.near = 1;
      dir.shadow.camera.far = 45;
      dir.shadow.camera.left = -18;
      dir.shadow.camera.right = 18;
      dir.shadow.camera.top = 18;
      dir.shadow.camera.bottom = -18;
    } else {
      dir.castShadow = false;
    }
  }

  applyQuality();
  applyShadows();

  // ------------------------------------------------------------
  // Resize
  // ------------------------------------------------------------
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyQuality();
  });

  // Close binds overlay if clicked outside card
  bindOverlay.addEventListener("click", (e) => {
    if (e.target === bindOverlay) closeBinds();
  });

  // Prevent clicking behind overlays
  pauseOverlay.addEventListener("click", (e) => {
    // click outside card: do nothing (avoid accidental close)
  });

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  let last = performance.now();
  async function boot() {
    try {
    await initPlayerModel();
    setupTouchUI();
    connectWS();
    updateWsBadge();
    if (bootBadge) bootBadge.remove();

    function frame(now) {
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;

      if (isTouch && !paused) {
        // Right stick look
        const lookRate = 2.4 * (0.6 + settings.mouseSens); // rad/s
        const multX = settings.invertX ? -1 : 1;
        const multY = settings.invertY ? -1 : 1;
        cam.yaw += touchLook.x * lookRate * dt * multX;
        cam.pitch -= touchLook.y * lookRate * dt * multY;
      }

      if (!paused) updatePlayer(dt);
      updateCamera(dt);

      // Remote smoothing
      for (const [id, r] of remotes) {
        // simple lerp smoothing
        const t = clamp(dt * 10.0, 0, 1);
        const x = lerp(r.lastSt.x || 0, r.st.x || 0, t);
        const y = lerp(r.lastSt.y || 0, r.st.y || 0, t);
        const z = lerp(r.lastSt.z || 0, r.st.z || 0, t);
        const yaw = lerp(r.lastSt.yaw || 0, r.st.yaw || 0, t);
        r.root.position.set(x, y, z);
        r.root.rotation.y = yaw;
        r.lastSt = { x, y, z, yaw };
      }

      netTick(dt);

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    } catch (e) {
      fatal("Erreur au démarrage du Hub (voir détails).", e);
    }
  }

  boot();
})();

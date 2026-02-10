/* hub_world.js — Hub 3D (V4)
   - HUD + menu pause cohérent
   - Options précises (appliquées instantanément + sauvegarde)
   - Pointer lock: mouvement souris = rotation caméra dans le même sens (gamer)
   - Présence multi via WS (room "hub") + skins synchro temps réel
*/

(() => {
  "use strict";

  /* ----------------------------- Config ----------------------------- */

  const VERSION = "hub_v4";
  const LS_SETTINGS_KEY = "lg_hub_settings_v4";
  const LS_NAME_KEY = "lg_name";

  const DEFAULT_WS = "wss://loup-garou-ws.onrender.com/ws";

  const SKINS = [
    {
      id: "humanoid",
      name: "Humanoïde",
      desc: "Capsule simple (léger).",
    },
    {
      id: "fox",
      name: "Fox",
      desc: "Modèle GLB (assets/models/test/Fox.glb).",
    },
  ];

  const SETTINGS_DEFAULT = {
    // Controls
    sens: 0.25,
    invertX: false,
    invertY: false,
    pointerLock: true,
    camSmooth: 0.14, // 0..0.35

    // Camera
    camDist: 6.5,
    camHeight: 1.15,
    fov: 70,
    lookH: 1.25,

    // Graphics
    quality: "med", // low/med/high
    shadows: true,
    pixelRatio: "auto", // auto/1/1.5/2

    // Gameplay
    speed: 3.6,
    sprintMul: 1.55,
    sprintToggle: false, // false=hold, true=toggle

    // Network
    sendHz: 12,
    netLerp: 0.18,
  };

  /* ----------------------------- Utils ------------------------------ */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now();

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function toast(msg, ms = 1800) {
    const host = document.getElementById("toast");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "toastLine";
    el.textContent = String(msg);
    host.appendChild(el);
    window.setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 220ms ease";
      window.setTimeout(() => el.remove(), 260);
    }, ms);
  }

  function getQuery() {
    const u = new URL(window.location.href);
    const q = {};
    u.searchParams.forEach((v, k) => (q[k] = v));
    return q;
  }

  function isMobileLike() {
    return matchMedia("(pointer:coarse)").matches || /Mobi/i.test(navigator.userAgent);
  }

  /* ----------------------------- Settings --------------------------- */

  let settings = loadSettings();

  function loadSettings() {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    const parsed = raw ? safeJsonParse(raw, null) : null;
    const s = { ...SETTINGS_DEFAULT, ...(parsed && typeof parsed === "object" ? parsed : {}) };

    // sanitize
    s.sens = clamp(Number(s.sens) || SETTINGS_DEFAULT.sens, 0.05, 5);
    s.camSmooth = clamp(Number(s.camSmooth) || SETTINGS_DEFAULT.camSmooth, 0, 0.35);
    s.camDist = clamp(Number(s.camDist) || SETTINGS_DEFAULT.camDist, 2, 12);
    s.camHeight = clamp(Number(s.camHeight) || SETTINGS_DEFAULT.camHeight, 0, 4);
    s.fov = clamp(Number(s.fov) || SETTINGS_DEFAULT.fov, 40, 110);
    s.lookH = clamp(Number(s.lookH) || SETTINGS_DEFAULT.lookH, 0.5, 2.2);
    s.speed = clamp(Number(s.speed) || SETTINGS_DEFAULT.speed, 1, 10);
    s.sprintMul = clamp(Number(s.sprintMul) || SETTINGS_DEFAULT.sprintMul, 1, 2.5);
    s.sendHz = clamp(Math.round(Number(s.sendHz) || SETTINGS_DEFAULT.sendHz), 5, 30);
    s.netLerp = clamp(Number(s.netLerp) || SETTINGS_DEFAULT.netLerp, 0.05, 0.5);

    s.quality = ["low", "med", "high"].includes(s.quality) ? s.quality : SETTINGS_DEFAULT.quality;
    s.pixelRatio = ["auto", "1", "1.5", "2"].includes(String(s.pixelRatio)) ? String(s.pixelRatio) : "auto";
    s.shadows = Boolean(s.shadows);
    s.pointerLock = Boolean(s.pointerLock);
    s.invertX = Boolean(s.invertX);
    s.invertY = Boolean(s.invertY);
    s.sprintToggle = Boolean(s.sprintToggle);

    return s;
  }

  function commitSettings(rewireNet = false) {
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  settings = loadSettings(); // sanitize + clamp
  applySettingsToUI();
  applySettingsRuntime(rewireNet);
}

function saveSettings() {
  commitSettings(true);
  toast("Réglages sauvegardés.");
}

function resetSettings() {
  settings = { ...SETTINGS_DEFAULT };
  commitSettings(true);
  toast("Réglages reset.");
}

  /* ----------------------------- DOM/UI ----------------------------- */

  const $ = (id) => document.getElementById(id);

  const dom = {
    btnPause: $("btnPause"),
    btnClosePause: $("btnClosePause"),
    btnResume: $("btnResume"),
    btnResetPos: $("btnResetPos"),
    btnGoHome: $("btnGoHome"),
    btnStay: $("btnStay"),
    overlay: $("pauseOverlay"),

    pillWs: $("pillWs"),
    pillPlayers: $("pillPlayers"),
    pillSkin: $("pillSkin"),

    // nav
    navBtns: Array.from(document.querySelectorAll(".navBtn")),
    views: {
      resume: $("view_resume"),
      options: $("view_options"),
      skins: $("view_skins"),
      home: $("view_home"),
    },

    // options inputs
    optSens: $("optSens"),
    optCamSmooth: $("optCamSmooth"),
    optInvertX: $("optInvertX"),
    optInvertY: $("optInvertY"),
    optPointerLock: $("optPointerLock"),

    optCamDist: $("optCamDist"),
    optCamHeight: $("optCamHeight"),
    optFov: $("optFov"),
    optLookH: $("optLookH"),

    optQuality: $("optQuality"),
    optPixelRatio: $("optPixelRatio"),
    optShadows: $("optShadows"),

    optSpeed: $("optSpeed"),
    optSprintMul: $("optSprintMul"),
    optSprintToggle: $("optSprintToggle"),

    optSendHz: $("optSendHz"),
    optNetLerp: $("optNetLerp"),

    btnSaveSettings: $("btnSaveSettings"),
    btnResetSettings: $("btnResetSettings"),

    skinsGrid: $("skinsGrid"),
  };

  function setPill(el, text) {
    if (!el) return;
    const strong = el.querySelector("strong");
    if (strong) strong.textContent = text;
  }

  function showView(name) {
    dom.navBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    Object.entries(dom.views).forEach(([k, v]) => {
      if (!v) return;
      v.classList.toggle("hidden", k !== name);
    });
  }

  function setPaused(paused) {
    PAUSED = !!paused;

    if (PAUSED) {
      dom.overlay?.classList.add("active");
      dom.overlay?.setAttribute("aria-hidden", "false");
      showView("resume");
      // exit pointer lock if any
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      dom.overlay?.classList.remove("active");
      dom.overlay?.setAttribute("aria-hidden", "true");

      if (!isMobileLike() && settings.pointerLock) {
        requestPointerLockSafe();
      }
    }
  }

  // Bind pause buttons
  dom.btnPause?.addEventListener("click", () => setPaused(true));
  dom.btnClosePause?.addEventListener("click", () => setPaused(false));
  dom.btnResume?.addEventListener("click", () => setPaused(false));
  dom.btnStay?.addEventListener("click", () => showView("resume"));
  dom.btnGoHome?.addEventListener("click", () => {
    // Inform server politely
    wsSend({ t: "leave" });
    window.location.href = "./index.html";
  });

  dom.navBtns.forEach((b) => b.addEventListener("click", () => showView(b.dataset.view || "resume")));

  // Options wiring
  function applySettingsToUI() {
    if (dom.optSens) dom.optSens.value = String(settings.sens);
    if (dom.optCamSmooth) dom.optCamSmooth.value = String(settings.camSmooth);
    if (dom.optCamDist) dom.optCamDist.value = String(settings.camDist);
    if (dom.optCamHeight) dom.optCamHeight.value = String(settings.camHeight);
    if (dom.optFov) dom.optFov.value = String(settings.fov);
    if (dom.optLookH) dom.optLookH.value = String(settings.lookH);

    if (dom.optQuality) dom.optQuality.value = settings.quality;
    if (dom.optPixelRatio) dom.optPixelRatio.value = String(settings.pixelRatio);
    if (dom.optShadows) dom.optShadows.textContent = `Ombres: ${settings.shadows ? "ON" : "OFF"}`;

    if (dom.optInvertX) dom.optInvertX.textContent = `Invert X: ${settings.invertX ? "ON" : "OFF"}`;
    if (dom.optInvertY) dom.optInvertY.textContent = `Invert Y: ${settings.invertY ? "ON" : "OFF"}`;
    if (dom.optPointerLock) dom.optPointerLock.textContent = `Pointer lock: ${settings.pointerLock ? "ON" : "OFF"}`;

    if (dom.optSpeed) dom.optSpeed.value = String(settings.speed);
    if (dom.optSprintMul) dom.optSprintMul.value = String(settings.sprintMul);
    if (dom.optSprintToggle) dom.optSprintToggle.textContent = `Sprint: ${settings.sprintToggle ? "TOGGLE" : "HOLD"}`;

    if (dom.optSendHz) dom.optSendHz.value = String(settings.sendHz);
    if (dom.optNetLerp) dom.optNetLerp.value = String(settings.netLerp);
  }

  function hookNumberInput(el, key) {
  if (!el) return;
  el.addEventListener("change", () => {
    settings[key] = Number(el.value);
    commitSettings(key === "sendHz");
  });
}

  function hookToggle(btn, key) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    settings[key] = !settings[key];
    commitSettings(key === "sendHz");
  });
}

  // Wire inputs
  applySettingsToUI();

  // Numbers
  hookNumberInput(dom.optSens, "sens");
  hookNumberInput(dom.optCamSmooth, "camSmooth");
  hookNumberInput(dom.optCamDist, "camDist");
  hookNumberInput(dom.optCamHeight, "camHeight");
  hookNumberInput(dom.optFov, "fov");
  hookNumberInput(dom.optLookH, "lookH");
  hookNumberInput(dom.optSpeed, "speed");
  hookNumberInput(dom.optSprintMul, "sprintMul");
  hookNumberInput(dom.optSendHz, "sendHz");
  hookNumberInput(dom.optNetLerp, "netLerp");

  // Selects
  dom.optQuality?.addEventListener("change", () => {
    settings.quality = dom.optQuality.value;
    commitSettings(false);
  });
  dom.optPixelRatio?.addEventListener("change", () => {
    settings.pixelRatio = dom.optPixelRatio.value;
    commitSettings(false);
  });

  // Toggles
  hookToggle(dom.optInvertX, "invertX");
  hookToggle(dom.optInvertY, "invertY");
  hookToggle(dom.optPointerLock, "pointerLock");
  dom.optShadows?.addEventListener("click", () => {
    settings.shadows = !settings.shadows;
    commitSettings(false);
  });
  dom.optSprintToggle?.addEventListener("click", () => {
    settings.sprintToggle = !settings.sprintToggle;
    commitSettings(false);
  });

  // Save/reset
  dom.btnSaveSettings?.addEventListener("click", () => saveSettings());
  dom.btnResetSettings?.addEventListener("click", () => resetSettings());

  /* ----------------------------- Three.js --------------------------- */

  let renderer, scene, camera;
  const loader = new THREE.GLTFLoader();

  const clock = new THREE.Clock();

  // world
  const world = {
    ground: null,
    dirLight: null,
    hemi: null,
  };

  // Player root + avatar
  const player = {
    root: new THREE.Group(),
    avatar: null,
    skinId: "humanoid",
    yaw: 0,
    pitch: -0.25, // look slightly up
    velY: 0,
    onGround: true,
  };

  // Camera smoothing
  const cam = {
    pos: new THREE.Vector3(0, 2, 6),
    targetPos: new THREE.Vector3(0, 2, 6),
    lookAt: new THREE.Vector3(0, 1.2, 0),
  };

  // Remotes
  const remotes = new Map(); // id -> entity
  // entity: { id, name, root, avatar, skinId, st, stTarget }

  function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090d);
    scene.fog = new THREE.Fog(0x07090d, 20, 120);

    camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 220);
    camera.position.copy(cam.pos);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(getPixelRatio());
    renderer.shadowMap.enabled = !!settings.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(renderer.domElement);

    // lights
    world.hemi = new THREE.HemisphereLight(0xb7c7ff, 0x1c2333, 0.9);
    scene.add(world.hemi);

    world.dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    world.dirLight.position.set(10, 18, 12);
    world.dirLight.castShadow = true;
    world.dirLight.shadow.mapSize.set(1024, 1024);
    world.dirLight.shadow.camera.near = 1;
    world.dirLight.shadow.camera.far = 60;
    world.dirLight.shadow.camera.left = -18;
    world.dirLight.shadow.camera.right = 18;
    world.dirLight.shadow.camera.top = 18;
    world.dirLight.shadow.camera.bottom = -18;
    scene.add(world.dirLight);

    // ground
    const tex = new THREE.TextureLoader().load("./assets/textures/ground/albedo.jpg");
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    tex.anisotropy = 4;

    const groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0 });
    const groundGeo = new THREE.PlaneGeometry(240, 240, 1, 1);
    world.ground = new THREE.Mesh(groundGeo, groundMat);
    world.ground.rotation.x = -Math.PI / 2;
    world.ground.receiveShadow = true;
    scene.add(world.ground);

    // player
    player.root.position.set(0, 0, 0);
    scene.add(player.root);

    // pick initial skin
    const q = getQuery();
    const wantedSkin = String(q.skin || "") || localStorage.getItem("lg_skin") || "humanoid";
    setSkin(wantedSkin);

    // initial camera target
    updateCamera(0, true);

    // events
    window.addEventListener("resize", onResize);

    // pointer lock / input
    initInput();

    // Start loop
    requestAnimationFrame(tick);
  }

  function getPixelRatio() {
    if (String(settings.pixelRatio) === "auto") return Math.min(window.devicePixelRatio || 1, 2);
    return Number(settings.pixelRatio) || 1;
  }

  function applySettingsRuntime(forceRewireNet = false) {
    // camera
    if (camera) {
      camera.fov = settings.fov;
      camera.updateProjectionMatrix();
    }
    if (renderer) {
      renderer.setPixelRatio(getPixelRatio());
      renderer.shadowMap.enabled = !!settings.shadows;
    }

    // quality presets (simple + safe)
    if (world.dirLight) {
      if (settings.quality === "low") {
        world.dirLight.shadow.mapSize.set(512, 512);
        scene.fog.far = 90;
      } else if (settings.quality === "high") {
        world.dirLight.shadow.mapSize.set(2048, 2048);
        scene.fog.far = 150;
      } else {
        world.dirLight.shadow.mapSize.set(1024, 1024);
        scene.fog.far = 120;
      }
      world.dirLight.shadow.needsUpdate = true;
    }

    // pointer lock
    if (isMobileLike()) settings.pointerLock = false;
    applySettingsToUI();

    // network (send rate can change)
    if (forceRewireNet) {
      restartSendLoop();
    } else {
      // if sendHz changed by UI, restart
      restartSendLoop();
    }
  }

  function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ----------------------------- Avatars / Skins -------------------- */

  const skinCache = new Map(); // skinId -> Promise<Object3D>
  skinCache.set("humanoid", Promise.resolve(createHumanoidPrototype()));

  function createHumanoidPrototype() {
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfd7ff, roughness: 0.95, metalness: 0.0 });

    const cyl = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.72, 6, 12), bodyMat);
    cyl.castShadow = true;
    cyl.receiveShadow = false;

    // Ensure feet on ground (CapsuleGeometry is centered)
    cyl.position.y = 0.33 + 0.72 / 2;

    g.add(cyl);
    return g;
  }

  function loadFoxPrototype() {
    if (skinCache.has("fox")) return skinCache.get("fox");

    const p = new Promise((resolve) => {
      loader.load(
        "./assets/models/test/Fox.glb",
        (gltf) => {
          const obj = gltf.scene || gltf.scenes?.[0];
          if (!obj) {
            resolve(createHumanoidPrototype());
            return;
          }
          obj.traverse((n) => {
            if (n.isMesh) {
              n.castShadow = true;
              n.receiveShadow = false;
            }
          });

          // normalize to a target height
          const targetH = 0.85;
          const box = new THREE.Box3().setFromObject(obj);
          const size = new THREE.Vector3();
          box.getSize(size);
          const h = Math.max(0.0001, size.y);
          const s = targetH / h;
          obj.scale.setScalar(s);

          // recompute after scale and put feet on ground
          const box2 = new THREE.Box3().setFromObject(obj);
          const min = box2.min.clone();
          obj.position.y += -min.y;

          resolve(obj);
        },
        undefined,
        () => resolve(createHumanoidPrototype())
      );
    });

    skinCache.set("fox", p);
    return p;
  }

  function getSkinPrototype(skinId) {
    if (skinId === "fox") return loadFoxPrototype();
    if (skinCache.has("humanoid")) return skinCache.get("humanoid");
    const p = Promise.resolve(createHumanoidPrototype());
    skinCache.set("humanoid", p);
    return p;
  }

  function cloneDeep(obj) {
    // For simple scenes: clone(true) is enough.
    return obj.clone(true);
  }

  async function attachAvatar(entityRoot, skinId) {
    const proto = await getSkinPrototype(skinId);
    const clone = cloneDeep(proto);

    // Clean previous
    const old = entityRoot.userData.avatar;
    if (old) entityRoot.remove(old);

    entityRoot.add(clone);
    entityRoot.userData.avatar = clone;
    entityRoot.userData.skinId = skinId;

    // slight scale differences
    if (skinId === "fox") {
      clone.scale.multiplyScalar(1.0);
    }

    return clone;
  }

  async function setSkin(skinId) {
    if (!SKINS.some((s) => s.id === skinId)) skinId = "humanoid";
    player.skinId = skinId;
    localStorage.setItem("lg_skin", skinId);

    await attachAvatar(player.root, skinId);
    setPill(dom.pillSkin, skinId);

    // push to server for realtime sync
    wsSend({ t: "hub_skin", skin: { id: skinId } });

    // refresh skins UI highlight
    renderSkinsUI();
  }

  function renderSkinsUI() {
    if (!dom.skinsGrid) return;
    dom.skinsGrid.innerHTML = "";

    for (const s of SKINS) {
      const tile = document.createElement("div");
      tile.className = "skinTile" + (s.id === player.skinId ? " active" : "");
      tile.innerHTML = `
        <div class="skinName">${s.name}</div>
        <div class="skinMeta">${s.desc}</div>
        <div class="skinMeta"><strong>ID:</strong> ${s.id}</div>
      `;
      tile.addEventListener("click", () => setSkin(s.id));
      dom.skinsGrid.appendChild(tile);
    }
  }

  /* ----------------------------- Input ------------------------------ */

  const keys = new Set();

  let POINTER_LOCK_EL = null;
  let pointerLocked = false;
  let PAUSED = false;

  // sprint toggle state
  let sprintOn = false;

  function requestPointerLockSafe() {
    if (!settings.pointerLock) return;
    if (!POINTER_LOCK_EL) return;
    if (PAUSED) return;
    if (pointerLocked) return;

    try { POINTER_LOCK_EL.requestPointerLock(); } catch {}
  }

  function initInput() {
    POINTER_LOCK_EL = renderer.domElement;

    // pointer lock gate: allow click OR first keydown
    POINTER_LOCK_EL.addEventListener("pointerdown", () => {
      if (!PAUSED && settings.pointerLock) requestPointerLockSafe();
    });

    window.addEventListener("keydown", (e) => {
      // Always store key
      keys.add(e.code);

      // open pause
      if (e.code === "KeyP") {
        e.preventDefault();
        setPaused(!PAUSED);
        return;
      }

      // movement key should enable pointer lock (no need to click)
      const movementKeys = new Set(["KeyZ", "KeyQ", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
      if (!PAUSED && settings.pointerLock && movementKeys.has(e.code)) {
        requestPointerLockSafe();
      }

      // sprint toggle
      if (!PAUSED && settings.sprintToggle) {
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
          sprintOn = !sprintOn;
        }
      }

      // prevent scroll with arrows/space
      if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener("keyup", (e) => {
      keys.delete(e.code);
    });

    document.addEventListener("pointerlockchange", () => {
      const locked = (document.pointerLockElement === POINTER_LOCK_EL);
      // if we lost lock while in game, open menu reliably
      const was = pointerLocked;
      pointerLocked = locked;
      if (was && !locked && !PAUSED) {
        setPaused(true);
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (PAUSED) return;
      if (!settings.pointerLock) return;
      if (!pointerLocked) return;

      let dx = e.movementX || 0;
      let dy = e.movementY || 0;

      if (settings.invertX) dx = -dx;
      if (settings.invertY) dy = -dy;

      // Gamer mapping:
      // - mouse right (dx>0) => camera turns right  => yaw decreases
      // - mouse left  (dx<0) => camera turns left   => yaw increases
      const sens = settings.sens * 0.01; // scale down
      player.yaw -= dx * sens;

      // mouse up (dy<0) => look up => pitch decreases
      // mouse down (dy>0) => look down => pitch increases
      player.pitch += dy * sens;

      player.pitch = clamp(player.pitch, -1.10, 0.70);
    });

    // Pause click outside card closes
    dom.overlay?.addEventListener("click", (e) => {
      if (e.target === dom.overlay) setPaused(false);
    });

    // Reset pos
    dom.btnResetPos?.addEventListener("click", () => {
      player.root.position.set(0, 0, 0);
      player.velY = 0;
      wsSendState(true);
      toast("Position reset.");
    });

    // disable pointer lock on mobile-like
    if (isMobileLike()) {
      settings.pointerLock = false;
      applySettingsToUI();
    }

    // skins UI
    renderSkinsUI();
  }

  /* ----------------------------- Movement / Physics ----------------- */

  function getMoveVector() {
    // AZERTY ZQSD + arrows
    const fwd = (keys.has("KeyZ") || keys.has("ArrowUp")) ? 1 : 0;
    const back = (keys.has("KeyS") || keys.has("ArrowDown")) ? 1 : 0;
    const left = (keys.has("KeyQ") || keys.has("ArrowLeft")) ? 1 : 0;
    const right = (keys.has("KeyD") || keys.has("ArrowRight")) ? 1 : 0;

    const x = (right - left);
    const z = (fwd - back);
    if (x === 0 && z === 0) return null;

    // camera-relative movement using yaw
    const yaw = player.yaw;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const v = new THREE.Vector3();
    v.addScaledVector(side, x);
    v.addScaledVector(forward, z);
    v.normalize();
    return v;
  }

  function isSprinting() {
    if (PAUSED) return false;
    if (settings.sprintToggle) return sprintOn;
    return keys.has("ShiftLeft") || keys.has("ShiftRight");
  }

  function stepPlayer(dt) {
    // gravity & ground
    const g = -16.0;
    const jump = keys.has("Space");

    if (player.onGround) {
      player.velY = 0;
      if (jump) {
        player.velY = 6.0;
        player.onGround = false;
      }
    } else {
      player.velY += g * dt;
    }

    const mv = getMoveVector();
    let speed = settings.speed;
    if (isSprinting()) speed *= settings.sprintMul;

    if (mv) {
      player.root.position.addScaledVector(mv, speed * dt);

      // orient player to movement direction (optional)
      const ang = Math.atan2(-mv.x, -mv.z);
      player.root.rotation.y = lerpAngle(player.root.rotation.y, ang, clamp(dt * 10, 0, 1));
    }

    // integrate vertical
    player.root.position.y += player.velY * dt;

    // simple ground at y=0
    if (player.root.position.y <= 0) {
      player.root.position.y = 0;
      player.onGround = true;
    }
  }

  function lerpAngle(a, b, t) {
    // shortest path
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  /* ----------------------------- Camera ----------------------------- */

  function updateCamera(dt, snap = false) {
    // skin profile adjustment
    let dist = settings.camDist;
    let height = settings.camHeight;
    let lookH = settings.lookH;

    if (player.skinId === "fox") {
      dist *= 0.90;
      height *= 0.85;
      lookH *= 0.75;
    }

    const yaw = player.yaw;
    const pitch = player.pitch;

    // spherical offset around player
    const horiz = Math.cos(pitch) * dist;
    const offX = Math.sin(yaw) * horiz;
    const offZ = Math.cos(yaw) * horiz;
    const offY = height + Math.sin(pitch) * dist;

    cam.targetPos.set(
      player.root.position.x + offX,
      player.root.position.y + offY,
      player.root.position.z + offZ
    );

    cam.lookAt.set(
      player.root.position.x,
      player.root.position.y + lookH,
      player.root.position.z
    );

    if (snap || settings.camSmooth <= 0.0001) {
      cam.pos.copy(cam.targetPos);
    } else {
      // convert "camSmooth" to a time constant
      const tau = settings.camSmooth * 0.35 + 0.02;
      const alpha = 1 - Math.exp(-dt / tau);
      cam.pos.lerp(cam.targetPos, alpha);
    }

    camera.position.copy(cam.pos);
    camera.lookAt(cam.lookAt);
  }

  /* ----------------------------- Network (WS hub) ------------------- */

  const q = getQuery();
  const WS_URL = String(q.ws || DEFAULT_WS);

  let ws = null;
  let wsReady = false;
  let myId = null;

  const nameFromParam = String(q.name || "").trim();
  let myName = nameFromParam || localStorage.getItem(LS_NAME_KEY) || `Player${Math.floor(Math.random() * 900 + 100)}`;
  myName = myName.slice(0, 32);
  localStorage.setItem(LS_NAME_KEY, myName);

  let sendTimer = null;

  function wsSend(obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  function setWsPill(state) {
    setPill(dom.pillWs, state);
  }

  function connectWS() {
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      setWsPill("erreur");
      return;
    }

    setWsPill("connexion…");
    wsReady = false;

    ws.addEventListener("open", () => {
      wsReady = true;
      setWsPill("connecté");
      // join hub
      wsSend({
        t: "join",
        room: "hub",
        name: myName,
        skin: { id: player.skinId },
        st: { x: player.root.position.x, y: player.root.position.y, z: player.root.position.z, yaw: player.yaw }
      });
      toast("WS connecté.");
      restartSendLoop();
    });

    ws.addEventListener("close", () => {
      setWsPill("hors-ligne");
      wsReady = false;
      stopSendLoop();
      // mark remotes as gone
      // we keep them for a moment? simplest: clear
      clearRemotes();
      setPill(dom.pillPlayers, "1");
      window.setTimeout(connectWS, 1100);
    });

    ws.addEventListener("error", () => {
      setWsPill("erreur");
    });

    ws.addEventListener("message", (ev) => {
      const data = safeJsonParse(ev.data, null);
      if (!data || typeof data !== "object") return;

      const t = String(data.t || "");
      if (!t) return;

      if (t === "hello") {
        myId = data.id ?? myId;
      }

      if (t === "hub_snapshot") {
        const players = Array.isArray(data.players) ? data.players : [];
        for (const p of players) {
          if (!p || typeof p !== "object") continue;
          const id = Number(p.id);
          if (!id || id === myId) continue;
          const ent = ensureRemote(id, String(p.name || `Player${id}`));
          // state
          if (p.st && typeof p.st === "object") {
            ent.stTarget.x = Number(p.st.x) || 0;
            ent.stTarget.y = Number(p.st.y) || 0;
            ent.stTarget.z = Number(p.st.z) || 0;
            ent.stTarget.yaw = Number(p.st.yaw) || 0;
            ent.root.position.set(ent.stTarget.x, ent.stTarget.y, ent.stTarget.z);
            ent.root.rotation.y = ent.stTarget.yaw;
          }
          // skin
          const skinId = (p.skin && typeof p.skin === "object" && p.skin.id) ? String(p.skin.id) : "humanoid";
          applyRemoteSkin(ent, skinId);
        }
        updatePlayersPill();
      }

      if (t === "hub_join") {
        const p = data.p || {};
        const id = Number(p.id);
        if (!id || id === myId) return;
        const ent = ensureRemote(id, String(p.name || `Player${id}`));
        if (p.st && typeof p.st === "object") {
          ent.stTarget.x = Number(p.st.x) || 0;
          ent.stTarget.y = Number(p.st.y) || 0;
          ent.stTarget.z = Number(p.st.z) || 0;
          ent.stTarget.yaw = Number(p.st.yaw) || 0;
          ent.root.position.set(ent.stTarget.x, ent.stTarget.y, ent.stTarget.z);
          ent.root.rotation.y = ent.stTarget.yaw;
        }
        const skinId = (p.skin && typeof p.skin === "object" && p.skin.id) ? String(p.skin.id) : "humanoid";
        applyRemoteSkin(ent, skinId);
        toast(`${ent.name} a rejoint le hub.`);
        updatePlayersPill();
      }

      if (t === "hub_leave") {
        const id = Number(data.id);
        if (!id) return;
        const ent = remotes.get(id);
        if (ent) toast(`${ent.name} a quitté.`);
        removeRemote(id);
        updatePlayersPill();
      }

      if (t === "hub_state") {
        const id = Number(data.id);
        if (!id || id === myId) return;
        const ent = remotes.get(id);
        if (!ent) return;
        const st = data.st;
        if (!st || typeof st !== "object") return;
        ent.stTarget.x = Number(st.x) || ent.stTarget.x;
        ent.stTarget.y = Number(st.y) || ent.stTarget.y;
        ent.stTarget.z = Number(st.z) || ent.stTarget.z;
        ent.stTarget.yaw = Number(st.yaw) || ent.stTarget.yaw;
      }

      if (t === "hub_skin") {
        const p = data.p || {};
        const id = Number(p.id);
        if (!id || id === myId) return;
        const ent = ensureRemote(id, String(p.name || `Player${id}`));
        const skinId = (p.skin && typeof p.skin === "object" && p.skin.id) ? String(p.skin.id) : "humanoid";
        applyRemoteSkin(ent, skinId);
        updatePlayersPill();
      }
    });
  }

  function updatePlayersPill() {
    // +1 for me
    setPill(dom.pillPlayers, String(remotes.size + 1));
  }

  function stopSendLoop() {
    if (sendTimer) {
      clearInterval(sendTimer);
      sendTimer = null;
    }
  }

  function restartSendLoop() {
    stopSendLoop();
    if (!wsReady) return;
    sendTimer = setInterval(() => wsSendState(false), Math.round(1000 / settings.sendHz));
  }

  function wsSendState(force) {
    if (!wsReady) return;
    if (PAUSED && !force) return;

    wsSend({
      t: "hub_state",
      st: {
        x: +player.root.position.x.toFixed(3),
        y: +player.root.position.y.toFixed(3),
        z: +player.root.position.z.toFixed(3),
        yaw: +player.root.rotation.y.toFixed(4),
      },
    });
  }

  /* ----------------------------- Remotes ---------------------------- */

  function makeNameSprite(text) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, 8, 10, 240, 44, 12, true, false);
    ctx.fillStyle = "rgba(234,240,255,0.96)";
    ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 16), 128, 33);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(2.2, 0.55, 1);
    sp.position.y = 1.9;
    sp.renderOrder = 999;

    sp.userData._canvas = canvas;
    sp.userData._ctx = ctx;
    sp.userData._tex = tex;

    return sp;
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function ensureRemote(id, name) {
    if (remotes.has(id)) {
      const ent = remotes.get(id);
      if (name && ent.name !== name) {
        ent.name = name;
        // (simple) not updating sprite text live here
      }
      return ent;
    }

    const root = new THREE.Group();
    root.position.set(0, 0, 0);
    scene.add(root);

    const nameSprite = makeNameSprite(name);
    root.add(nameSprite);

    // placeholder avatar
    const placeholder = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.6, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.9 })
    );
    placeholder.castShadow = true;
    placeholder.position.y = 0.6;
    root.add(placeholder);

    const ent = {
      id,
      name,
      root,
      avatar: placeholder,
      skinId: "humanoid",
      stTarget: { x: 0, y: 0, z: 0, yaw: 0 },
    };

    remotes.set(id, ent);
    return ent;
  }

  async function applyRemoteSkin(ent, skinId) {
    if (!ent) return;
    if (!SKINS.some((s) => s.id === skinId)) skinId = "humanoid";
    if (ent.skinId === skinId) return;

    ent.skinId = skinId;

    // Remove old avatar mesh/object (not name sprite)
    if (ent.avatar) ent.root.remove(ent.avatar);

    // Attach new avatar
    const proto = await getSkinPrototype(skinId);
    const clone = cloneDeep(proto);

    ent.root.add(clone);
    ent.avatar = clone;

    if (skinId === "fox") {
      // place a bit closer to ground / correct pivot already normalized
      clone.position.y = 0;
    }
  }

  function removeRemote(id) {
    const ent = remotes.get(id);
    if (!ent) return;
    scene.remove(ent.root);
    // dispose textures for sprite
    ent.root.traverse((n) => {
      if (n.isSprite && n.material && n.material.map) n.material.map.dispose();
      if (n.material) n.material.dispose?.();
      if (n.geometry) n.geometry.dispose?.();
    });
    remotes.delete(id);
  }

  function clearRemotes() {
    for (const id of Array.from(remotes.keys())) removeRemote(id);
  }

  function stepRemotes(dt) {
    const t = clamp(settings.netLerp, 0.05, 0.5);
    const alpha = 1 - Math.exp(-dt / t);
    for (const ent of remotes.values()) {
      ent.root.position.x = lerp(ent.root.position.x, ent.stTarget.x, alpha);
      ent.root.position.y = lerp(ent.root.position.y, ent.stTarget.y, alpha);
      ent.root.position.z = lerp(ent.root.position.z, ent.stTarget.z, alpha);
      ent.root.rotation.y = lerpAngle(ent.root.rotation.y, ent.stTarget.yaw, alpha);
    }
  }

  /* ----------------------------- Main loop -------------------------- */

  let lastSendAt = 0;

  function tick() {
    const dt = Math.min(0.05, clock.getDelta());

    if (!PAUSED) {
      stepPlayer(dt);
      stepRemotes(dt);

      // send state opportunistically even if interval misses
      const t = now();
      if (wsReady && t - lastSendAt > (1000 / settings.sendHz) * 1.5) {
        wsSendState(false);
        lastSendAt = t;
      }
    }

    updateCamera(dt, false);

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  /* ----------------------------- Boot ------------------------------- */

  // Apply settings runtime once, then init.
  applySettingsRuntime(true);
  setPill(dom.pillWs, "…");
  setPill(dom.pillPlayers, "1");
  setPill(dom.pillSkin, "…");

  // Delay init until DOM is ready (safe on fast loads)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initThree();
      connectWS();
      updatePlayersPill();
    });
  } else {
    initThree();
    connectWS();
    updatePlayersPill();
  }
})();

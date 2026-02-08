(() => {
  "use strict";

  // --------- Helpers (compat Three versions) ----------
  function setRendererSRGB(renderer) {
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ("outputEncoding" in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
  }
  function setTextureSRGB(tex) {
    if (!tex) return;
    if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
    else if ("encoding" in tex) tex.encoding = THREE.sRGBEncoding;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // --------- DOM ----------
  const app = document.getElementById("app");
  const btnHome = document.getElementById("btnHome");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const btnToggleJoy = document.getElementById("btnToggleJoy");

  const tabs = Array.from(document.querySelectorAll(".tab"));
  const tabGame = document.getElementById("tab_game");
  const tabControls = document.getElementById("tab_controls");
  const tabAvatar = document.getElementById("tab_avatar");

  const sensEl = document.getElementById("sens");
  const invertYEl = document.getElementById("invertY");

  const kbSprintEl = document.getElementById("kbSprint");
  const kbCrouchEl = document.getElementById("kbCrouch");
  const kbDashEl = document.getElementById("kbDash");
  const btnSaveKeys = document.getElementById("btnSaveKeys");

  const hairStyleEl = document.getElementById("hairStyle");
  const hairColorEl = document.getElementById("hairColor");
  const eyeColorEl = document.getElementById("eyeColor");
  const sizeScaleEl = document.getElementById("sizeScale");
  const btnSaveAvatar = document.getElementById("btnSaveAvatar");

  const mobileLayer = document.getElementById("mobileLayer");
  const joyMove = document.getElementById("joyMove");
  const joyLook = document.getElementById("joyLook");
  const knobMove = document.getElementById("knobMove");
  const knobLook = document.getElementById("knobLook");
  const mobileBtns = document.getElementById("mobileBtns");
  const btnJump = document.getElementById("btnJump");
  const btnCrouch = document.getElementById("btnCrouch");
  const btnSprint = document.getElementById("btnSprint");
  const btnDash = document.getElementById("btnDash");

  // --------- Storage ----------
  const LS_KEYS = {
    avatar: "hub_avatar_v1",
    keys: "hub_keybinds_v1",
    cam: "hub_cam_v1",
    joy: "hub_joy_visible_v1"
  };

  function loadJSON(key, fallback) {
    try {
      const s = localStorage.getItem(key);
      if (!s) return fallback;
      const o = JSON.parse(s);
      return o && typeof o === "object" ? o : fallback;
    } catch (_) { return fallback; }
  }
  function saveJSON(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) {}
  }

  // --------- Settings ----------
  const camSettings = loadJSON(LS_KEYS.cam, { sens: 1.0, invertY: false });
  sensEl.value = String(camSettings.sens);
  invertYEl.checked = !!camSettings.invertY;

  const keybinds = loadJSON(LS_KEYS.keys, {
    sprint: "ShiftLeft",
    crouch: "KeyC",
    dash: "AltLeft"
  });
  kbSprintEl.value = keybinds.sprint;
  kbCrouchEl.value = keybinds.crouch;
  kbDashEl.value = keybinds.dash;

  const avatar = loadJSON(LS_KEYS.avatar, {
    hairStyle: "short",
    hairColor: "#2a1b14",
    eyeColor: "#4dd6ff",
    size: 1.0
  });
  hairStyleEl.value = avatar.hairStyle;
  hairColorEl.value = avatar.hairColor;
  eyeColorEl.value = avatar.eyeColor;
  sizeScaleEl.value = String(avatar.size);

  // --------- Three setup ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  setRendererSRGB(renderer);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 25, 140);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.position.set(0, 3, 8);

  // Lights
  const hemi = new THREE.HemisphereLight(0x9bb9ff, 0x0a0f14, 0.65);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(20, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  scene.add(sun);

  // Ground (PBR si dispo)
  const texLoader = new THREE.TextureLoader();
  function tryLoad(url) {
    try { return texLoader.load(url); } catch (_) { return null; }
  }

  const albedo = tryLoad("assets/textures/ground/albedo.jpg");
  const normal = tryLoad("assets/textures/ground/normal.jpg");
  const rough = tryLoad("assets/textures/ground/roughness.jpg");
  const ao = tryLoad("assets/textures/ground/ao.jpg");
  const height = tryLoad("assets/textures/ground/height.jpg");

  setTextureSRGB(albedo);

  const groundSize = 260;
  const seg = 180; // assez fin pour un léger relief visuel
  const gGeo = new THREE.PlaneGeometry(groundSize, groundSize, seg, seg);
  gGeo.rotateX(-Math.PI / 2);
  // aoMap needs uv2
  if (gGeo.attributes.uv) {
    gGeo.setAttribute("uv2", new THREE.BufferAttribute(gGeo.attributes.uv.array, 2));
  }

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x808080,
    map: albedo || null,
    normalMap: normal || null,
    roughnessMap: rough || null,
    aoMap: ao || null,
    roughness: rough ? 1.0 : 0.95,
    metalness: 0.0
  });

  if (height) {
    groundMat.displacementMap = height;
    groundMat.displacementScale = 0.22; // léger (collision reste plane)
    groundMat.displacementBias = -0.10;
  }

  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  [albedo, normal, rough, ao, height].forEach(t => {
    if (!t) return;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(18, 18);
    t.anisotropy = maxAniso;
  });

  const ground = new THREE.Mesh(gGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // Simple props (POI minimal)
  const props = new THREE.Group();
  scene.add(props);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.85, metalness: 0.0 });
  for (let i = 0; i < 28; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6 + Math.random() * 3.2, 2.2), boxMat);
    b.position.set((Math.random() - 0.5) * 70, b.geometry.parameters.height / 2, (Math.random() - 0.5) * 70);
    b.castShadow = true;
    b.receiveShadow = true;
    props.add(b);
  }

  // --------- Character (procedural, full body) ----------
  function makeCharacter() {
    const group = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd7b49a, roughness: 0.85, metalness: 0.0 });
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x2e3a4a, roughness: 0.92, metalness: 0.0 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c1118, roughness: 0.90, metalness: 0.0 });

    // Torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.60, 6, 14), clothMat);
    torso.position.y = 1.10;
    torso.castShadow = true;
    group.add(torso);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), skinMat);
    head.position.y = 1.74;
    head.castShadow = true;
    group.add(head);

    // Nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 12), skinMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.70, 0.34);
    nose.castShadow = true;
    group.add(nose);

    // Eyes (2)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x4dd6ff, roughness: 0.35, metalness: 0.0, emissive: 0x000000 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), eyeMat);
    const eyeR = eyeL.clone();
    eyeL.position.set(-0.12, 1.76, 0.30);
    eyeR.position.set( 0.12, 1.76, 0.30);
    group.add(eyeL, eyeR);

    // Hair group (replaceable)
    const hairGroup = new THREE.Group();
    hairGroup.position.y = 1.92;
    group.add(hairGroup);

    function rebuildHair(style, colorHex) {
      while (hairGroup.children.length) hairGroup.remove(hairGroup.children[0]);
      const hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.85, metalness: 0.0 });

      if (style === "short") {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
        cap.position.y = -0.02;
        cap.castShadow = true;
        hairGroup.add(cap);
      } else if (style === "spiky") {
        const base = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 12), hairMat);
        base.scale.y = 0.75;
        base.position.y = -0.06;
        base.castShadow = true;
        hairGroup.add(base);

        for (let i = 0; i < 7; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 10), hairMat);
          const a = (i / 7) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.16, 0.12 + (i % 2) * 0.03, Math.sin(a) * 0.16);
          spike.rotation.x = -0.35;
          spike.castShadow = true;
          hairGroup.add(spike);
        }
      } else { // pony
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
        cap.position.y = -0.02;
        cap.castShadow = true;
        hairGroup.add(cap);

        const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 6, 10), hairMat);
        pony.position.set(0, -0.06, -0.26);
        pony.rotation.x = 0.35;
        pony.castShadow = true;
        hairGroup.add(pony);
      }
    }

    // Arms (upper/lower/hands)
    function makeArm(side) {
      const s = side; // -1 left, +1 right
      const arm = new THREE.Group();
      arm.position.set(0.52 * s, 1.42, 0);

      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.28, 6, 10), clothMat);
      upper.rotation.z = 0.15 * s;
      upper.castShadow = true;
      arm.add(upper);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.26, 6, 10), clothMat);
      lower.position.y = -0.40;
      lower.rotation.z = 0.10 * s;
      lower.castShadow = true;
      arm.add(lower);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skinMat);
      hand.position.y = -0.62;
      hand.castShadow = true;
      arm.add(hand);

      // small shoulder pad
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), darkMat);
      shoulder.position.y = 0.10;
      shoulder.position.x = -0.02 * s;
      shoulder.castShadow = true;
      arm.add(shoulder);

      return arm;
    }

    const armL = makeArm(-1);
    const armR = makeArm( 1);
    group.add(armL, armR);

    // Legs (thigh/shin/feet)
    function makeLeg(side) {
      const s = side;
      const leg = new THREE.Group();
      leg.position.set(0.20 * s, 0.88, 0);

      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.35, 6, 10), clothMat);
      thigh.castShadow = true;
      leg.add(thigh);

      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.32, 6, 10), clothMat);
      shin.position.y = -0.48;
      shin.castShadow = true;
      leg.add(shin);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.12, 0.34), darkMat);
      foot.position.set(0, -0.73, 0.10);
      foot.castShadow = true;
      leg.add(foot);

      return leg;
    }

    const legL = makeLeg(-1);
    const legR = makeLeg( 1);
    group.add(legL, legR);

    // Public API (apply customization)
    group.userData = {
      parts: { eyeMat, hairGroup, armL, armR, legL, legR, torso, head },
      rebuildHair,
      setEyes(colorHex) { eyeMat.color.set(colorHex); },
      setScale(s) { group.scale.set(s, s, s); },
      setCrouchAmount(t) {
        // t=0 stand, t=1 crouch
        const yScale = lerp(1.0, 0.78, t);
        group.scale.y = yScale * group.userData.baseScale;
      },
      baseScale: 1.0
    };

    // init from saved avatar
    group.userData.baseScale = avatar.size;
    group.userData.setScale(avatar.size);
    group.userData.rebuildHair(avatar.hairStyle, avatar.hairColor);
    group.userData.setEyes(avatar.eyeColor);

    return group;
  }

  const player = makeCharacter();
  player.position.set(0, 0.92, 0);
  scene.add(player);

  // --------- Camera control (3rd person) ----------
  let yaw = 0;
  let pitch = -0.25;
  let targetYaw = 0;
  let targetPitch = -0.25;

  // --------- Input ----------
  const keysDown = new Set();
  let paused = false;

  const input = {
    moveX: 0,
    moveZ: 0,
    lookX: 0,
    lookY: 0,
    jumpPressed: false,
    sprintHeld: false,
    crouchToggle: false,
    dashPressed: false
  };

  function isMobile() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }

  let joyVisible = loadJSON(LS_KEYS.joy, { show: true }).show !== false;
  function applyMobileUI() {
    const mobile = isMobile();
    const show = mobile && joyVisible && !paused;
    joyMove.style.display = show ? "block" : "none";
    joyLook.style.display = show ? "block" : "none";
    mobileBtns.style.display = show ? "flex" : "none";
  }

  // Pointer lock for desktop look
  function requestPL() {
    if (paused) return;
    const c = renderer.domElement;
    if (c.requestPointerLock) c.requestPointerLock();
  }
  function exitPL() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  renderer.domElement.addEventListener("click", () => {
    if (!isMobile() && !paused) requestPL();
  });

  window.addEventListener("mousemove", (e) => {
    if (paused) return;
    if (isMobile()) return;
    if (document.pointerLockElement !== renderer.domElement) return;

    const s = camSettings.sens;
    const inv = camSettings.invertY ? -1 : 1;
    targetYaw -= e.movementX * 0.0022 * s;
    targetPitch -= e.movementY * 0.0022 * s * inv;
    targetPitch = clamp(targetPitch, -1.12, 0.34);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      togglePause();
      return;
    }
    if (paused) return;

    if (e.code === "KeyJ") {
      joyVisible = !joyVisible;
      saveJSON(LS_KEYS.joy, { show: joyVisible });
      applyMobileUI();
      return;
    }

    keysDown.add(e.code);

    if (e.code === "Space") input.jumpPressed = true;
    if (e.code === keybinds.sprint) input.sprintHeld = true;
    if (e.code === keybinds.dash) input.dashPressed = true;

    if (e.code === keybinds.crouch) {
      // toggle crouch
      input.crouchToggle = !input.crouchToggle;
    }
  });

  window.addEventListener("keyup", (e) => {
    keysDown.delete(e.code);
    if (e.code === keybinds.sprint) input.sprintHeld = false;
  });

  // --------- Mobile joystick ----------
  function makeJoystick(elJoy, elKnob, onMove) {
    let activeId = null;
    let baseX = 0, baseY = 0;
    let curX = 0, curY = 0;

    function setKnob(dx, dy) {
      elKnob.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
    }

    function end() {
      activeId = null;
      setKnob(0, 0);
      onMove(0, 0);
    }

    function startPointer(e) {
      if (paused) return;
      activeId = e.pointerId;
      elJoy.setPointerCapture(activeId);
      const r = elJoy.getBoundingClientRect();
      baseX = r.left + r.width / 2;
      baseY = r.top + r.height / 2;
      curX = e.clientX;
      curY = e.clientY;
    }

    function movePointer(e) {
      if (activeId !== e.pointerId) return;
      curX = e.clientX;
      curY = e.clientY;

      const dx = curX - baseX;
      const dy = curY - baseY;
      const maxR = 46;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (dx / len) * Math.min(len, maxR);
      const ny = (dy / len) * Math.min(len, maxR);
      setKnob(nx, ny);

      const outX = clamp(nx / maxR, -1, 1);
      const outY = clamp(ny / maxR, -1, 1);
      onMove(outX, outY);
    }

    elJoy.addEventListener("pointerdown", startPointer);
    elJoy.addEventListener("pointermove", movePointer);
    elJoy.addEventListener("pointerup", end);
    elJoy.addEventListener("pointercancel", end);
  }

  makeJoystick(joyMove, knobMove, (x, y) => {
    input.moveX = x;
    input.moveZ = -y;
  });

  makeJoystick(joyLook, knobLook, (x, y) => {
    // camera look
    const s = camSettings.sens;
    const inv = camSettings.invertY ? -1 : 1;
    targetYaw -= x * 0.06 * s;
    targetPitch -= y * 0.05 * s * inv;
    targetPitch = clamp(targetPitch, -1.12, 0.34);
  });

  // Mobile buttons (hold for sprint)
  let mobileSprint = false;
  btnSprint.addEventListener("pointerdown", (e) => { e.preventDefault(); mobileSprint = true; input.sprintHeld = true; });
  btnSprint.addEventListener("pointerup",   (e) => { e.preventDefault(); mobileSprint = false; input.sprintHeld = false; });
  btnSprint.addEventListener("pointercancel",(e)=> { e.preventDefault(); mobileSprint = false; input.sprintHeld = false; });

  btnJump.addEventListener("pointerdown", (e) => { e.preventDefault(); if (!paused) input.jumpPressed = true; });
  btnDash.addEventListener("pointerdown", (e) => { e.preventDefault(); if (!paused) input.dashPressed = true; });
  btnCrouch.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!paused) input.crouchToggle = !input.crouchToggle;
  });

  // --------- UI actions ----------
  btnHome.addEventListener("click", () => { window.location.href = "./"; });

  btnToggleJoy.addEventListener("click", () => {
    joyVisible = !joyVisible;
    saveJSON(LS_KEYS.joy, { show: joyVisible });
    applyMobileUI();
  });

  btnPause.addEventListener("click", () => togglePause());
  btnResume.addEventListener("click", () => togglePause(false));

  function setOverlay(show) {
    pauseOverlay.style.display = show ? "flex" : "none";
    pauseOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function togglePause(force) {
    const next = (typeof force === "boolean") ? force : !paused;
    paused = next;

    if (paused) {
      exitPL();
      setOverlay(true);
    } else {
      setOverlay(false);
    }
    applyMobileUI();
  }

  tabs.forEach(t => {
    t.addEventListener("click", () => {
      tabs.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const id = t.getAttribute("data-tab");
      tabGame.style.display = id === "game" ? "grid" : "none";
      tabControls.style.display = id === "controls" ? "grid" : "none";
      tabAvatar.style.display = id === "avatar" ? "grid" : "none";
    });
  });

  sensEl.addEventListener("input", () => {
    camSettings.sens = parseFloat(sensEl.value);
    saveJSON(LS_KEYS.cam, camSettings);
  });
  invertYEl.addEventListener("change", () => {
    camSettings.invertY = !!invertYEl.checked;
    saveJSON(LS_KEYS.cam, camSettings);
  });

  btnSaveKeys.addEventListener("click", () => {
    keybinds.sprint = kbSprintEl.value;
    keybinds.crouch = kbCrouchEl.value;
    keybinds.dash = kbDashEl.value;
    saveJSON(LS_KEYS.keys, keybinds);
  });

  btnSaveAvatar.addEventListener("click", () => {
    avatar.hairStyle = hairStyleEl.value;
    avatar.hairColor = hairColorEl.value;
    avatar.eyeColor = eyeColorEl.value;
    avatar.size = parseFloat(sizeScaleEl.value);
    saveJSON(LS_KEYS.avatar, avatar);

    player.userData.baseScale = avatar.size;
    player.userData.setScale(avatar.size);
    player.userData.rebuildHair(avatar.hairStyle, avatar.hairColor);
    player.userData.setEyes(avatar.eyeColor);
  });

  // Apply initial mobile UI
  applyMobileUI();

  // --------- Movement / physics ----------
  const state = {
    velY: 0,
    onGround: true,
    crouchAmount: 0,
    dashCD: 0,
    dashTime: 0
  };

  const speeds = {
    walk: 4.1,
    sprint: 7.8,     // vraiment significatif
    crouch: 2.6,
    dash: 12.5
  };

  const gravity = -18.5;
  const jumpVel = 7.2;

  // Camera follow
  const cam = {
    dist: 5.6,
    height: 2.15,
    smooth: 0.12
  };

  // --------- Loop ----------
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (!paused) update(dt);
    render(dt);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function update(dt) {
    // keyboard movement input (if no joystick)
    let mx = input.moveX;
    let mz = input.moveZ;

    const up = keysDown.has("ArrowUp") || keysDown.has("KeyW") || keysDown.has("KeyZ");
    const dn = keysDown.has("ArrowDown") || keysDown.has("KeyS");
    const lf = keysDown.has("ArrowLeft") || keysDown.has("KeyA") || keysDown.has("KeyQ");
    const rt = keysDown.has("ArrowRight") || keysDown.has("KeyD");

    if (Math.abs(mx) < 0.001 && Math.abs(mz) < 0.001) {
      mx = (rt ? 1 : 0) + (lf ? -1 : 0);
      mz = (up ? 1 : 0) + (dn ? -1 : 0);
    }

    // normalize
    let len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const wantCrouch = input.crouchToggle;
    const targetC = wantCrouch ? 1 : 0;
    state.crouchAmount = lerp(state.crouchAmount, targetC, 1 - Math.pow(0.001, dt));
    player.userData.setCrouchAmount(state.crouchAmount);

    // speed selection
    const sprinting = input.sprintHeld && !wantCrouch && len > 0.1;
    const baseSpeed = wantCrouch ? speeds.crouch : (sprinting ? speeds.sprint : speeds.walk);

    // dash (sympa)
    if (state.dashCD > 0) state.dashCD -= dt;
    if (state.dashTime > 0) state.dashTime -= dt;

    if (input.dashPressed && state.dashCD <= 0 && len > 0.1) {
      state.dashCD = 1.2;
      state.dashTime = 0.16;
    }
    input.dashPressed = false;

    let speed = baseSpeed;
    if (state.dashTime > 0) speed = speeds.dash;

    // movement direction relative to camera yaw
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const dirX = (mx * cosY + mz * sinY);
    const dirZ = (mz * cosY - mx * sinY);

    player.position.x += dirX * speed * dt;
    player.position.z += dirZ * speed * dt;

    // rotate character toward movement direction (if moving)
    if (len > 0.12) {
      const targetRot = Math.atan2(dirX, dirZ);
      player.rotation.y = lerp(player.rotation.y, targetRot, 1 - Math.pow(0.001, dt));
    }

    // Jump
    if (input.jumpPressed && state.onGround && !wantCrouch) {
      state.velY = jumpVel;
      state.onGround = false;
    }
    input.jumpPressed = false;

    // Gravity
    state.velY += gravity * dt;
    player.position.y += state.velY * dt;

    // ground collision (plane) - stable
    const baseH = 0.92 * player.userData.baseScale;
    const minY = lerp(baseH, baseH * 0.78, state.crouchAmount);

    if (player.position.y <= minY) {
      player.position.y = minY;
      state.velY = 0;
      state.onGround = true;
    } else {
      state.onGround = false;
    }

    // camera smoothing update
    yaw = lerp(yaw, targetYaw, 1 - Math.pow(0.0005, dt));
    pitch = lerp(pitch, targetPitch, 1 - Math.pow(0.0005, dt));

    // slight sprint FOV effect (significatif)
    const targetFov = sprinting ? 72 : 60;
    camera.fov = lerp(camera.fov, targetFov, 1 - Math.pow(0.002, dt));
    camera.updateProjectionMatrix();
  }

  function render(dt) {
    // third-person camera position
    const p = player.position;
    const backX = Math.sin(yaw) * cam.dist;
    const backZ = Math.cos(yaw) * cam.dist;

    const camTarget = new THREE.Vector3(p.x, p.y + cam.height, p.z);
    const camPos = new THREE.Vector3(p.x - backX, p.y + cam.height + Math.sin(-pitch) * 1.2, p.z - backZ);

    // smooth camera position
    camera.position.x = lerp(camera.position.x, camPos.x, 1 - Math.pow(0.0008, dt));
    camera.position.y = lerp(camera.position.y, camPos.y, 1 - Math.pow(0.0008, dt));
    camera.position.z = lerp(camera.position.z, camPos.z, 1 - Math.pow(0.0008, dt));
    camera.lookAt(camTarget);

    renderer.render(scene, camera);
  }

  // --------- Resize ----------
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyMobileUI();
  });

  // Pause overlay click outside closes? (simple: ESC/Resume only)
  pauseOverlay.addEventListener("click", (e) => {
    if (e.target === pauseOverlay) togglePause(false);
  });
})();

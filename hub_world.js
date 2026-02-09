(() => {
  // ---------- DOM ----------
  const pauseOverlay = document.getElementById("pauseOverlay");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnToHome = document.getElementById("btnToHome");

  const skinSelect = document.getElementById("skinSelect");

  const btnJoy = document.getElementById("btnJoy");
  const joyWrap = document.getElementById("joyWrap");
  const joyKnob = document.getElementById("joyKnob");

  const actWrap = document.getElementById("actWrap");
  const btnJump = document.getElementById("btnJump");
  const btnSprint = document.getElementById("btnSprint");
  const btnCrouch = document.getElementById("btnCrouch");

  // ---------- Helpers ----------
  const isMobile = matchMedia("(pointer:coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- THREE ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 25, 160);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 800);
  camera.position.set(0, 3.2, 8.5);

  // OrbitControls (caméra utilisable souris/tactile)
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 3.0;
  controls.maxDistance = 18.0;
  controls.maxPolarAngle = Math.PI * 0.49; // pas trop en dessous du sol
  controls.target.set(0, 1.2, 0);

  // Lights
  scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x0b0d12, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(18, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Repères (loin, pour éviter de “cacher” le joueur)
  const mkBox = (x, z, h, c) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(2, h, 2),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })
    );
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  mkBox(18, 10, 3.2, 0x2b3240);
  mkBox(-22, -12, 4.6, 0x252b36);
  mkBox(10, -24, 5.5, 0x1f2430);

  // ---------- Player ----------
  const player = {
    root: new THREE.Group(),
    velY: 0,
    onGround: true,
    yaw: 0,
    speedWalk: 3.8,
    speedSprint: 7.2,   // sprint nettement plus rapide
    speedCrouch: 2.3,
    isSprinting: false,
    isCrouching: false
  };
  scene.add(player.root);

  // Humanoïde placeholder (tête / bras / jambes)
  const humanoid = new THREE.Group();
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.85, 6, 12), mat);
    body.castShadow = true; body.receiveShadow = true;
    body.position.y = 1.05;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), mat);
    head.castShadow = true; head.receiveShadow = true;
    head.position.y = 1.62;

    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.55, 5, 10), mat);
    armL.castShadow = true; armL.receiveShadow = true;
    armL.position.set(-0.42, 1.15, 0);
    armL.rotation.z = 0.25;

    const armR = armL.clone();
    armR.position.x = +0.42;
    armR.rotation.z = -0.25;

    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 5, 10), mat);
    legL.castShadow = true; legL.receiveShadow = true;
    legL.position.set(-0.18, 0.45, 0);

    const legR = legL.clone();
    legR.position.x = +0.18;

    humanoid.add(body, head, armL, armR, legL, legR);
  }

  // Fox GLB container
  const foxContainer = new THREE.Group();

  // Default skin = fox
  let currentSkin = "fox";
  player.root.add(foxContainer);
  player.root.add(humanoid);
  humanoid.visible = false;

  // GLB loader
  let mixer = null;
  const loader = new THREE.GLTFLoader();

  function clearFox() {
    while (foxContainer.children.length) foxContainer.remove(foxContainer.children[0]);
    mixer = null;
  }

  function loadFox() {
    clearFox();

    loader.load(
      "assets/models/test/Fox.glb",
      (gltf) => {
        const model = gltf.scene;

        model.traverse((o) => {
          if (o && o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });

        // Center + scale
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        model.position.sub(center);

        const target = 1.0; // taille “hub” standard
        const base = Math.max(size.x, size.y, size.z) || 1;
        const s = target / base;
        model.scale.setScalar(s);

        // Put on ground
        const box2 = new THREE.Box3().setFromObject(model);
        model.position.y -= box2.min.y;

        // Face forward-ish
        model.rotation.y = Math.PI;

        foxContainer.add(model);

        if (gltf.animations && gltf.animations.length) {
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(gltf.animations[0]).play();
        }

        // si on est sur fox => afficher fox
        if (currentSkin === "fox") {
          humanoid.visible = false;
          foxContainer.visible = true;
        }
      },
      undefined,
      () => {
        // si Fox ne charge pas: on force humanoïde
        if (currentSkin === "fox") {
          currentSkin = "humanoid";
          skinSelect.value = "humanoid";
          foxContainer.visible = false;
          humanoid.visible = true;
        }
      }
    );
  }

  // initial load
  loadFox();

  // Skin select
  skinSelect.addEventListener("change", () => {
    currentSkin = skinSelect.value;
    if (currentSkin === "fox") {
      foxContainer.visible = true;
      humanoid.visible = false;
      if (foxContainer.children.length === 0) loadFox();
    } else {
      foxContainer.visible = false;
      humanoid.visible = true;
    }
  });

  // ---------- Input (AZERTY + QWERTY) ----------
  const keys = {
    forward: false, back: false, left: false, right: false,
    sprint: false, crouch: false, jump: false
  };

  function setKey(e, isDown) {
    const k = e.key.toLowerCase();

    // Forward: Z (AZERTY) ou W (QWERTY) ou ArrowUp
    if (k === "z" || k === "w" || e.key === "ArrowUp") keys.forward = isDown;

    // Back: S ou ArrowDown
    if (k === "s" || e.key === "ArrowDown") keys.back = isDown;

    // Left: Q (AZERTY) ou A (QWERTY) ou ArrowLeft
    if (k === "q" || k === "a" || e.key === "ArrowLeft") keys.left = isDown;

    // Right: D ou ArrowRight
    if (k === "d" || e.key === "ArrowRight") keys.right = isDown;

    if (k === "shift") keys.sprint = isDown;
    if (k === "control") keys.crouch = isDown;
    if (k === " ") keys.jump = isDown;

    if (k === "escape" && isDown) togglePause();
  }

  addEventListener("keydown", (e) => setKey(e, true));
  addEventListener("keyup", (e) => setKey(e, false));

  // ---------- Pause ----------
  let paused = false;
  function setPaused(v) {
    paused = v;
    pauseOverlay.style.display = paused ? "flex" : "none";
  }
  function togglePause() { setPaused(!paused); }

  btnPause.addEventListener("click", () => togglePause());
  btnResume.addEventListener("click", () => setPaused(false));
  btnToHome.addEventListener("click", () => { location.href = "index.html"; });

  // ---------- Mobile joystick ----------
  let joyVisible = false;
  let joyActiveId = null;
  let joyCenter = { x: 0, y: 0 };
  let joyVec = { x: 0, y: 0 }; // -1..1 (x droite, y bas)
  const joyRadius = 55;

  function setJoyVisible(v) {
    joyVisible = v;
    joyWrap.style.display = joyVisible ? "block" : "none";
    actWrap.style.display = isMobile ? "flex" : "none";
    btnJoy.textContent = joyVisible ? "Joystick: ON" : "Joystick";
  }
  if (isMobile) setJoyVisible(true);

  btnJoy.addEventListener("click", () => setJoyVisible(!joyVisible));

  function updateJoyKnob() {
    joyKnob.style.transform = `translate(${joyVec.x * joyRadius}px, ${joyVec.y * joyRadius}px)`;
  }

  function joyStart(ev) {
    if (!joyVisible) return;
    const t = ev.changedTouches[0];
    joyActiveId = t.identifier;

    const rect = joyWrap.getBoundingClientRect();
    joyCenter.x = rect.left + rect.width / 2;
    joyCenter.y = rect.top + rect.height / 2;

    joyMove(ev);
  }

  function joyMove(ev) {
    if (joyActiveId === null) return;

    let touch = null;
    for (const t of ev.changedTouches) if (t.identifier === joyActiveId) touch = t;
    if (!touch) return;

    const dx = touch.clientX - joyCenter.x;
    const dy = touch.clientY - joyCenter.y;

    const len = Math.hypot(dx, dy);
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    const mag = clamp(len / joyRadius, 0, 1);

    joyVec.x = nx * mag;
    joyVec.y = ny * mag;
    updateJoyKnob();
  }

  function joyEnd(ev) {
    if (joyActiveId === null) return;
    let ended = false;
    for (const t of ev.changedTouches) if (t.identifier === joyActiveId) ended = true;
    if (!ended) return;

    joyActiveId = null;
    joyVec.x = 0; joyVec.y = 0;
    updateJoyKnob();
  }

  joyWrap.addEventListener("touchstart", (ev) => { ev.preventDefault(); joyStart(ev); }, { passive: false });
  joyWrap.addEventListener("touchmove", (ev) => { ev.preventDefault(); joyMove(ev); }, { passive: false });
  joyWrap.addEventListener("touchend", (ev) => { ev.preventDefault(); joyEnd(ev); }, { passive: false });
  joyWrap.addEventListener("touchcancel", (ev) => { ev.preventDefault(); joyEnd(ev); }, { passive: false });

  // action buttons
  const touchHold = { sprint: false, crouch: false, jump: false };
  const bindHoldBtn = (el, key) => {
    el.addEventListener("touchstart", (e) => { e.preventDefault(); touchHold[key] = true; }, { passive:false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); touchHold[key] = false; }, { passive:false });
    el.addEventListener("touchcancel", (e) => { e.preventDefault(); touchHold[key] = false; }, { passive:false });
    el.addEventListener("mousedown", () => { touchHold[key] = true; });
    el.addEventListener("mouseup", () => { touchHold[key] = false; });
    el.addEventListener("mouseleave", () => { touchHold[key] = false; });
  };
  bindHoldBtn(btnSprint, "sprint");
  bindHoldBtn(btnCrouch, "crouch");

  btnJump.addEventListener("touchstart", (e) => { e.preventDefault(); touchHold.jump = true; }, { passive:false });
  btnJump.addEventListener("touchend", (e) => { e.preventDefault(); touchHold.jump = false; }, { passive:false });
  btnJump.addEventListener("mousedown", () => { touchHold.jump = true; });
  btnJump.addEventListener("mouseup", () => { touchHold.jump = false; });

  if (isMobile) actWrap.style.display = "flex";

  // ---------- Movement relative to camera (fix inversions + feel better) ----------
  const tmpForward = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpMove = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function getMoveAxes() {
    let x = 0, y = 0;
    if (keys.left) x -= 1;
    if (keys.right) x += 1;
    if (keys.forward) y += 1;
    if (keys.back) y -= 1;

    if (joyVisible) {
      x += joyVec.x;
      y += (-joyVec.y); // IMPORTANT: joystick down = reculer, donc on inverse
    }

    const len = Math.hypot(x, y);
    if (len > 1e-6) { x /= len; y /= len; }
    return { x, y };
  }

  function updatePlayer(dt) {
    player.isCrouching = (keys.crouch || touchHold.crouch);
    player.isSprinting = (keys.sprint || touchHold.sprint) && !player.isCrouching;

    const { x, y } = getMoveAxes();

    let speed = player.speedWalk;
    if (player.isCrouching) speed = player.speedCrouch;
    else if (player.isSprinting) speed = player.speedSprint;

    // forward vector from camera (flatten Y)
    camera.getWorldDirection(tmpForward);
    tmpForward.y = 0;
    tmpForward.normalize();

    // right vector
    tmpRight.crossVectors(tmpForward, up).normalize();

    // movement in world space
    tmpMove.set(0, 0, 0);
    tmpMove.addScaledVector(tmpForward, y);
    tmpMove.addScaledVector(tmpRight, x);

    if (tmpMove.lengthSq() > 1e-6) {
      tmpMove.normalize();

      player.root.position.addScaledVector(tmpMove, speed * dt);

      // face movement direction
      const targetYaw = Math.atan2(tmpMove.x, tmpMove.z);
      player.yaw = lerp(player.yaw, targetYaw, 1 - Math.pow(0.001, dt));
      player.root.rotation.y = player.yaw;
    }

    // crouch effect (simple)
    const targetScaleY = player.isCrouching ? 0.78 : 1.0;
    player.root.scale.y = lerp(player.root.scale.y, targetScaleY, 1 - Math.pow(0.001, dt));

    // jump + gravity
    const wantJump = keys.jump || touchHold.jump;
    if (wantJump && player.onGround) {
      player.velY = 6.4;
      player.onGround = false;
    }
    touchHold.jump = false;

    player.velY += -18.0 * dt;
    player.root.position.y += player.velY * dt;

    if (player.root.position.y <= 0) {
      player.root.position.y = 0;
      player.velY = 0;
      player.onGround = true;
    }
  }

  // ---------- Loop ----------
  let last = performance.now();

  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (!paused) {
      if (mixer) mixer.update(dt);

      updatePlayer(dt);

      // follow target for orbit controls
      controls.target.set(player.root.position.x, player.root.position.y + 1.2, player.root.position.z);
      controls.update();
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
})();

// Hub 3D minimal : avatar (Fox.glb) + déplacements PC + joystick mobile + pause menu
(() => {
  // ---------- DOM ----------
  const pauseOverlay = document.getElementById("pauseOverlay");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnToHome = document.getElementById("btnToHome");

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

  if ("outputEncoding" in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 20, 120);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 600);
  camera.position.set(0, 2.2, 6.5);

  // lights
  scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x0b0d12, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(18, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // simple landmarks
  const mkBox = (x, z, h, c) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(2, h, 2),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
    );
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  mkBox(6, 2, 2.5, 0x2b3240);
  mkBox(-7, -4, 3.5, 0x252b36);
  mkBox(10, -10, 5.0, 0x1f2430);

  // ---------- Player ----------
  const player = {
    root: new THREE.Group(),
    velY: 0,
    onGround: true,
    yaw: 0,
    speedWalk: 3.6,
    speedSprint: 6.8,   // sprint SIGNIFICATIF
    speedCrouch: 2.2,
    height: 1.6,
    crouchHeight: 1.1,
    isSprinting: false,
    isCrouching: false
  };
  scene.add(player.root);

  // Placeholder capsule (au cas où le GLB rate)
  const placeholder = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25, 1.0, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.6 })
  );
  placeholder.castShadow = true;
  placeholder.receiveShadow = true;
  placeholder.position.y = 0.9;
  player.root.add(placeholder);

  // Load Fox.glb
  let mixer = null;
  const loader = new THREE.GLTFLoader();
  loader.load(
    "assets/models/test/Fox.glb",
    (gltf) => {
      // remove placeholder
      player.root.remove(placeholder);

      const model = gltf.scene;
      model.traverse((o) => {
        if (o && o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      // auto-scale to ~1.0m long (fox is small)
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      model.position.sub(center);

      // scale based on bbox height/length
      const target = 1.0; // meters-ish
      const base = Math.max(size.x, size.y, size.z) || 1;
      const s = target / base;
      model.scale.setScalar(s);

      // place on ground
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      // rotate to face forward (-Z)
      model.rotation.y = Math.PI;

      player.root.add(model);

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).play();
      }
    },
    undefined,
    () => {
      // keep placeholder silently
    }
  );

  // ---------- Input ----------
  const keys = {
    up: false, down: false, left: false, right: false,
    sprint: false, crouch: false, jump: false
  };

  function setKey(e, isDown) {
    const k = e.key.toLowerCase();
    if (k === "z" || e.key === "ArrowUp") keys.up = isDown;
    if (k === "s" || e.key === "ArrowDown") keys.down = isDown;
    if (k === "q" || e.key === "ArrowLeft") keys.left = isDown;
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
  let joyVec = { x: 0, y: 0 }; // -1..1
  const joyRadius = 55;

  function setJoyVisible(v) {
    joyVisible = v;
    joyWrap.style.display = joyVisible ? "block" : "none";
    actWrap.style.display = joyVisible ? "flex" : (isMobile ? "flex" : "none");
    btnJoy.textContent = joyVisible ? "Joystick: ON" : "Joystick";
  }

  // default on mobile
  if (isMobile) setJoyVisible(true);

  btnJoy.addEventListener("click", () => setJoyVisible(!joyVisible));

  function updateJoyKnob() {
    const dx = joyVec.x * joyRadius;
    const dy = joyVec.y * joyRadius;
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
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

    // joyVec : x = droite/gauche, y = haut/bas (on inversera pour avancer)
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

  // action buttons (mobile)
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
  // jump as tap
  btnJump.addEventListener("touchstart", (e) => { e.preventDefault(); touchHold.jump = true; }, { passive:false });
  btnJump.addEventListener("touchend", (e) => { e.preventDefault(); touchHold.jump = false; }, { passive:false });
  btnJump.addEventListener("mousedown", () => { touchHold.jump = true; });
  btnJump.addEventListener("mouseup", () => { touchHold.jump = false; });

  // show action buttons on mobile
  if (isMobile) actWrap.style.display = "flex";

  // ---------- Update loop ----------
  const tmpVec = new THREE.Vector3();
  let last = performance.now();

  function getMoveInput() {
    // keyboard
    let x = 0, z = 0;
    if (keys.left) x -= 1;
    if (keys.right) x += 1;
    if (keys.up) z -= 1;
    if (keys.down) z += 1;

    // joystick adds (mobile)
    if (joyVisible) {
      x += joyVec.x;
      z += joyVec.y; // note: joy y positive is down
    }

    // normalize
    const len = Math.hypot(x, z);
    if (len > 1e-6) { x /= len; z /= len; }
    return { x, z };
  }

  function updatePlayer(dt) {
    // state
    player.isSprinting = (keys.sprint || touchHold.sprint) && !player.isCrouching;
    player.isCrouching = (keys.crouch || touchHold.crouch);

    const { x, z } = getMoveInput();

    // movement speed
    let speed = player.speedWalk;
    if (player.isCrouching) speed = player.speedCrouch;
    else if (player.isSprinting) speed = player.speedSprint;

    // move on XZ
    player.root.position.x += x * speed * dt;
    player.root.position.z += z * speed * dt;

    // face movement direction
    if (Math.abs(x) + Math.abs(z) > 0.001) {
      const targetYaw = Math.atan2(x, z); // forward -Z is z negative, but we use z as input; feels ok
      player.yaw = lerp(player.yaw, targetYaw, 1 - Math.pow(0.001, dt));
      player.root.rotation.y = player.yaw;
    }

    // crouch "height" by scaling Y a bit (simple)
    const targetScaleY = player.isCrouching ? 0.78 : 1.0;
    player.root.scale.y = lerp(player.root.scale.y, targetScaleY, 1 - Math.pow(0.001, dt));

    // gravity + jump
    const wantJump = keys.jump || touchHold.jump;
    if (wantJump && player.onGround) {
      player.velY = 6.2;
      player.onGround = false;
    }
    touchHold.jump = false; // consume tap

    player.velY += -18.0 * dt;
    player.root.position.y += player.velY * dt;

    // ground collision at y=0
    if (player.root.position.y <= 0) {
      player.root.position.y = 0;
      player.velY = 0;
      player.onGround = true;
    }
  }

  function updateCamera(dt) {
    // third-person follow
    const target = player.root.position.clone();
    target.y += 1.2;

    // camera behind player
    const behind = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0,1,0), player.root.rotation.y);
    const camPos = target.clone().add(behind.multiplyScalar(6.5));
    camPos.y += 2.2;

    camera.position.lerp(camPos, 1 - Math.pow(0.0005, dt));
    camera.lookAt(target);
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (!paused) {
      if (mixer) mixer.update(dt);
      updatePlayer(dt);
      updateCamera(dt);
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

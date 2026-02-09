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

  const isMobile =
    matchMedia("(pointer:coarse)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

  // ---------- THREE ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 30, 220);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 1000);

  // lights
  scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x0b0d12, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(18, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(350, 350),
    new THREE.MeshStandardMaterial({ color: 0x3a4452, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // quelques blocs de déco
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

  // ---------- PLAYER ROOT (pivot unique) ----------
  const player = {
    root: new THREE.Group(),       // position du joueur
    avatar: new THREE.Group(),     // modèle accroché ici (toujours enfant)
    mixer: null,

    velY: 0,
    onGround: true,
    yaw: 0,

    speedWalk: 4.0,
    speedSprint: 7.8,
    speedCrouch: 2.4,
    isSprinting: false,
    isCrouching: false
  };

  player.root.position.set(0, 0, 0);
  player.root.add(player.avatar);
  scene.add(player.root);

  // IMPORTANT : on “lève” l’avatar un tout petit peu si besoin
  // (mais normalement on met les pieds au sol via bbox)
  player.avatar.position.set(0, 0, 0);

  // ---------- AVATARS ----------
  const humanoid = new THREE.Group();
  const foxContainer = new THREE.Group();
  humanoid.visible = false;
  foxContainer.visible = true;

  player.avatar.add(foxContainer);
  player.avatar.add(humanoid);

  function buildHumanoid() {
    humanoid.clear();

    // proportions + parties (tête/torse/bassin/bras/avant-bras/mains/jambes/pieds)
    const matSkin = new THREE.MeshStandardMaterial({ color: 0xd7c2a8, roughness: 0.6 });
    const matCloth = new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: 0.7 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.9 });

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.95;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.70, 6, 12), matCloth);
    torso.castShadow = torso.receiveShadow = true;
    torso.position.y = 0.50;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 18), matSkin);
    head.castShadow = head.receiveShadow = true;
    head.position.y = 1.20;

    // petit nez + yeux (simple, mais présents)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.10, 10), matSkin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.18, 0.22);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.4 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), eyeMat);
    const eyeR = eyeL.clone();
    eyeL.position.set(-0.07, 1.22, 0.19);
    eyeR.position.set(+0.07, 1.22, 0.19);

    // “cheveux” simple
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.235, 18, 18), matDark);
    hair.scale.y = 0.7;
    hair.position.set(0, 1.29, -0.02);
    hair.castShadow = hair.receiveShadow = true;

    // bras
    const upperArmGeo = new THREE.CapsuleGeometry(0.085, 0.28, 6, 10);
    const foreArmGeo = new THREE.CapsuleGeometry(0.075, 0.26, 6, 10);
    const handGeo = new THREE.SphereGeometry(0.07, 14, 14);

    function makeArm(side) {
      const s = side; // -1 gauche, +1 droite
      const g = new THREE.Group();
      g.position.set(0.34 * s, 0.92, 0);

      const upper = new THREE.Mesh(upperArmGeo, matCloth);
      upper.castShadow = upper.receiveShadow = true;
      upper.rotation.z = 0.25 * -s;
      upper.position.y = -0.05;

      const fore = new THREE.Mesh(foreArmGeo, matCloth);
      fore.castShadow = fore.receiveShadow = true;
      fore.position.set(0.10 * s, -0.33, 0);
      fore.rotation.z = 0.18 * -s;

      const hand = new THREE.Mesh(handGeo, matSkin);
      hand.castShadow = hand.receiveShadow = true;
      hand.position.set(0.18 * s, -0.55, 0);

      g.add(upper, fore, hand);
      return g;
    }

    // jambes + pieds
    const thighGeo = new THREE.CapsuleGeometry(0.10, 0.38, 6, 10);
    const shinGeo = new THREE.CapsuleGeometry(0.095, 0.36, 6, 10);
    const footGeo = new THREE.BoxGeometry(0.16, 0.07, 0.28);

    function makeLeg(side) {
      const s = side;
      const g = new THREE.Group();
      g.position.set(0.16 * s, 0.12, 0);

      const thigh = new THREE.Mesh(thighGeo, matCloth);
      thigh.castShadow = thigh.receiveShadow = true;
      thigh.position.y = -0.25;

      const shin = new THREE.Mesh(shinGeo, matCloth);
      shin.castShadow = shin.receiveShadow = true;
      shin.position.y = -0.70;

      const foot = new THREE.Mesh(footGeo, matDark);
      foot.castShadow = foot.receiveShadow = true;
      foot.position.set(0, -0.95, 0.06);

      g.add(thigh, shin, foot);
      return g;
    }

    pelvis.add(torso, head, nose, eyeL, eyeR, hair);
    pelvis.add(makeArm(-1), makeArm(+1));
    pelvis.add(makeLeg(-1), makeLeg(+1));

    humanoid.add(pelvis);

    // poser le humanoïde au sol (pieds)
    const box = new THREE.Box3().setFromObject(humanoid);
    humanoid.position.y -= box.min.y;
  }

  buildHumanoid();

  // Fox loader (vraiment accroché au pivot avatar)
  const loader = new THREE.GLTFLoader();
  let currentSkin = "fox";

  function clearFox() {
    foxContainer.clear();
    player.mixer = null;
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

        // scale à une hauteur “joueur” ~1.0 (fox plus petit)
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // recentrer sur (0,0,0)
        model.position.sub(center);

        const desiredHeight = 0.9; // renard plus bas que humanoïde
        const h = Math.max(size.y, 0.001);
        const s = desiredHeight / h;
        model.scale.setScalar(s);

        // remettre au sol
        const box2 = new THREE.Box3().setFromObject(model);
        model.position.y -= box2.min.y;

        // orientation
        model.rotation.y = Math.PI; // ajuste si ton fox regarde “de travers”

        foxContainer.add(model);

        if (gltf.animations && gltf.animations.length) {
          player.mixer = new THREE.AnimationMixer(model);
          player.mixer.clipAction(gltf.animations[0]).play();
        }

        foxContainer.visible = (currentSkin === "fox");
        humanoid.visible = (currentSkin !== "fox");
      },
      undefined,
      () => {
        // fallback
        currentSkin = "humanoid";
        skinSelect.value = "humanoid";
        foxContainer.visible = false;
        humanoid.visible = true;
      }
    );
  }

  loadFox();

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

  // ---------- INPUT ----------
  const keys = {
    forward: false, back: false, left: false, right: false,
    sprint: false, crouch: false, jump: false
  };

  function setKey(e, isDown) {
    const k = e.key.toLowerCase();

    if (k === "z" || k === "w" || e.key === "ArrowUp") keys.forward = isDown;
    if (k === "s" || e.key === "ArrowDown") keys.back = isDown;
    if (k === "q" || k === "a" || e.key === "ArrowLeft") keys.left = isDown;
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

  // ---------- Camera rig (attachée au joueur) ----------
  let camYaw = 0;                 // rotation horizontale
  let camPitch = -0.22;           // verticale (légère plongée)
  let camDist = 7.2;              // distance
  let camHeight = 1.55;           // hauteur cible (au-dessus du sol / tête)

  const camPos = new THREE.Vector3();     // position lissée
  const camTarget = new THREE.Vector3();  // cible (joueur)

  // look input: drag souris / doigt
  let looking = false;
  let lastX = 0, lastY = 0;

  function startLook(x, y) { looking = true; lastX = x; lastY = y; }
  function endLook() { looking = false; }
  function moveLook(x, y) {
    if (!looking || paused) return;
    const dx = x - lastX;
    const dy = y - lastY;
    lastX = x; lastY = y;

    const sens = isMobile ? 0.0042 : 0.0032;
    camYaw -= dx * sens;
    camPitch -= dy * sens;
    camPitch = clamp(camPitch, -0.85, 0.25);
  }

  renderer.domElement.addEventListener("mousedown", (e) => {
    // drag caméra avec clic gauche
    if (e.button !== 0) return;
    startLook(e.clientX, e.clientY);
  });
  addEventListener("mouseup", () => endLook());
  addEventListener("mousemove", (e) => moveLook(e.clientX, e.clientY));

  renderer.domElement.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startLook(t.clientX, t.clientY);
  }, { passive:true });

  renderer.domElement.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    moveLook(t.clientX, t.clientY);
  }, { passive:true });

  renderer.domElement.addEventListener("touchend", () => endLook(), { passive:true });

  // zoom molette
  renderer.domElement.addEventListener("wheel", (e) => {
    camDist += Math.sign(e.deltaY) * 0.6;
    camDist = clamp(camDist, 3.5, 14.0);
  }, { passive:true });

  // ---------- Mobile joystick ----------
  let joyVisible = false;
  let joyActiveId = null;
  let joyCenter = { x: 0, y: 0 };
  let joyVec = { x: 0, y: 0 };
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

  // ---------- Movement (relatif à la caméra yaw) ----------
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
      y += (-joyVec.y); // bas = reculer, donc on inverse
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

    // forward/right basés sur yaw caméra (pas pitch)
    tmpForward.set(Math.sin(camYaw), 0, Math.cos(camYaw)).normalize();
    tmpRight.crossVectors(tmpForward, up).normalize();

    tmpMove.set(0, 0, 0);
    tmpMove.addScaledVector(tmpForward, y);
    tmpMove.addScaledVector(tmpRight, x);

    if (tmpMove.lengthSq() > 1e-6) {
      tmpMove.normalize();
      player.root.position.addScaledVector(tmpMove, speed * dt);

      const targetYaw = Math.atan2(tmpMove.x, tmpMove.z);
      player.yaw = damp(player.yaw, targetYaw, 16, dt);
      player.root.rotation.y = player.yaw;
    }

    // crouch visuel
    const targetScaleY = player.isCrouching ? 0.80 : 1.0;
    player.root.scale.y = damp(player.root.scale.y, targetScaleY, 18, dt);

    // jump + gravity
    const wantJump = keys.jump || touchHold.jump;
    if (wantJump && player.onGround) {
      player.velY = 6.5;
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

  // ---------- Camera follow (attachée au perso) ----------
  const desiredCamPos = new THREE.Vector3();

  function updateCamera(dt) {
    // cible = joueur + hauteur
    camTarget.set(
      player.root.position.x,
      player.root.position.y + camHeight,
      player.root.position.z
    );

    // offset sphérique derrière le joueur selon yaw/pitch
    const cx = Math.sin(camYaw) * Math.cos(camPitch);
    const cy = Math.sin(camPitch);
    const cz = Math.cos(camYaw) * Math.cos(camPitch);

    desiredCamPos.set(
      camTarget.x + cx * camDist,
      camTarget.y + cy * camDist,
      camTarget.z + cz * camDist
    );

    // lissage pour que ça “colle” sans trembler
    camPos.x = damp(camPos.x, desiredCamPos.x, 14, dt);
    camPos.y = damp(camPos.y, desiredCamPos.y, 14, dt);
    camPos.z = damp(camPos.z, desiredCamPos.z, 14, dt);

    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  // init caméra pos
  camPos.set(0, 4.5, 9);

  // ---------- Loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (!paused) {
      if (player.mixer) player.mixer.update(dt);
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

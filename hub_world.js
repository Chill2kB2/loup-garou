(() => {
  // Zéro console.log (jeu propre)

  const ASSETS = {
    albedo: "assets/textures/ground/albedo.jpg",
    normal: "assets/textures/ground/normal.jpg",
    rough:  "assets/textures/ground/roughness.jpg",
    ao:     "assets/textures/ground/ao.jpg",
    height: "assets/textures/ground/height.jpg"
  };

  const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);

  // UI refs
  const loading = document.getElementById("loading");
  const loadLabel = document.getElementById("loadLabel");
  const loadBar = document.getElementById("loadBar");
  const loadErr = document.getElementById("loadErr");

  const btnJoy = document.getElementById("btnJoy");
  const joyWrap = document.getElementById("joyWrap");

  const panel = document.getElementById("panel");
  const btnPanel = document.getElementById("btnPanel");
  const btnClosePanel = document.getElementById("btnClosePanel");

  const assetDot = document.getElementById("assetDot");
  const assetText = document.getElementById("assetText");

  const skinGrid = document.getElementById("skinGrid");
  const scaleRange = document.getElementById("scaleRange");
  const scaleLabel = document.getElementById("scaleLabel");
  const togHat = document.getElementById("togHat");
  const togBag = document.getElementById("togBag");

  // ---------- Helpers compat Three versions ----------
  function setRendererSRGB(renderer) {
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ("outputEncoding" in renderer && THREE.sRGBEncoding) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
  }

  function setTextureColor(tex, isColor) {
    if (!tex) return;
    if ("colorSpace" in tex && THREE.SRGBColorSpace) {
      tex.colorSpace = isColor ? THREE.SRGBColorSpace : (THREE.NoColorSpace || THREE.LinearSRGBColorSpace || THREE.SRGBColorSpace);
    } else if ("encoding" in tex && THREE.sRGBEncoding) {
      tex.encoding = isColor ? THREE.sRGBEncoding : THREE.LinearEncoding;
    }
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function smooth01(t){ t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function setLoading(pct, text) {
    loadBar.style.width = `${Math.round(pct)}%`;
    loadLabel.textContent = text || "Chargement…";
  }

  function showError(msg) {
    loadErr.style.display = "block";
    loadErr.textContent = msg;
  }

  function setAssetStatus(ok, msg) {
    assetDot.classList.remove("good","bad");
    assetDot.classList.add(ok ? "good" : "bad");
    assetText.textContent = msg;
  }

  // ---------- Joysticks toggle ----------
  const LS_JOY = "hubJoyPref";
  function getJoyPref() {
    const v = localStorage.getItem(LS_JOY);
    if (v === "on") return true;
    if (v === "off") return false;
    return isTouch;
  }
  function setJoyPref(show) { localStorage.setItem(LS_JOY, show ? "on" : "off"); }

  let showJoysticks = getJoyPref();
  function applyJoyVisibility() {
    joyWrap.classList.toggle("hidden", !showJoysticks);
    btnJoy.textContent = showJoysticks ? "👁" : "👁 OFF";
  }
  function toggleJoysticks() {
    showJoysticks = !showJoysticks;
    setJoyPref(showJoysticks);
    applyJoyVisibility();
  }
  btnJoy.addEventListener("click", (e) => { e.preventDefault(); toggleJoysticks(); });
  window.addEventListener("keydown", (e) => {
    if (e.key && e.key.toLowerCase() === "j") toggleJoysticks();
  });
  applyJoyVisibility();

  // ---------- Panel toggle ----------
  function setPanel(open) {
    panel.classList.toggle("hidden", !open);
  }
  setPanel(true);
  btnPanel.addEventListener("click", () => setPanel(panel.classList.contains("hidden")));
  btnClosePanel.addEventListener("click", () => setPanel(false));

  // ---------- Avatar config (skins/accessoires) ----------
  const LS_AVATAR = "hubAvatarV1";
  const SKINS = [
    "#7c5cff", "#4dd6ff", "#43d17a", "#ffb020", "#ff5c5c",
    "#d66bff", "#b6ff5c", "#5c9bff", "#ffd1a8", "#c0c7d6"
  ];

  const avatar = {
    skinIndex: 0,
    scale: 1.0,
    hat: false,
    bag: false
  };

  function loadAvatarPref() {
    try {
      const raw = localStorage.getItem(LS_AVATAR);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (typeof obj.skinIndex === "number") avatar.skinIndex = clamp(obj.skinIndex, 0, SKINS.length - 1);
      if (typeof obj.scale === "number") avatar.scale = clamp(obj.scale, 0.85, 1.15);
      if (typeof obj.hat === "boolean") avatar.hat = obj.hat;
      if (typeof obj.bag === "boolean") avatar.bag = obj.bag;
    } catch(_) {}
  }

  function saveAvatarPref() {
    localStorage.setItem(LS_AVATAR, JSON.stringify(avatar));
  }

  function renderAvatarUI() {
    skinGrid.innerHTML = "";
    SKINS.forEach((hex, i) => {
      const d = document.createElement("div");
      d.className = "swatch" + (i === avatar.skinIndex ? " sel" : "");
      d.style.background = hex;
      d.title = `Skin ${i+1}`;
      d.addEventListener("click", () => {
        avatar.skinIndex = i;
        saveAvatarPref();
        applyAvatarToModel();
        renderAvatarUI();
      });
      skinGrid.appendChild(d);
    });

    scaleRange.value = String(avatar.scale.toFixed(2));
    scaleLabel.textContent = avatar.scale.toFixed(2);

    togHat.textContent = `🎩 Chapeau: ${avatar.hat ? "ON" : "OFF"}`;
    togBag.textContent = `🎒 Sac: ${avatar.bag ? "ON" : "OFF"}`;
  }

  scaleRange.addEventListener("input", () => {
    avatar.scale = clamp(parseFloat(scaleRange.value), 0.85, 1.15);
    scaleLabel.textContent = avatar.scale.toFixed(2);
    saveAvatarPref();
    applyAvatarToModel();
  });

  togHat.addEventListener("click", () => {
    avatar.hat = !avatar.hat;
    saveAvatarPref();
    applyAvatarToModel();
    renderAvatarUI();
  });
  togBag.addEventListener("click", () => {
    avatar.bag = !avatar.bag;
    saveAvatarPref();
    applyAvatarToModel();
    renderAvatarUI();
  });

  loadAvatarPref();
  renderAvatarUI();

  // ---------- Asset loading (textures + height image data) ----------
  const texLoader = new THREE.TextureLoader();
  const loaded = { count: 0, total: 5, ok: true, errors: [] };

  function incLoaded(label) {
    loaded.count++;
    setLoading((loaded.count / loaded.total) * 100, label);
  }

  function loadTexture(url, isColor, label) {
    return new Promise((resolve) => {
      texLoader.load(url, (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = false;
        setTextureColor(tex, isColor);
        incLoaded(label);
        resolve(tex);
      }, undefined, () => {
        loaded.ok = false;
        loaded.errors.push(`Texture introuvable: ${url}`);
        incLoaded(label);
        resolve(null);
      });
    });
  }

  function loadHeightImage(url, label) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => { incLoaded(label); resolve(img); };
      img.onerror = () => {
        loaded.ok = false;
        loaded.errors.push(`Height introuvable: ${url}`);
        incLoaded(label);
        resolve(null);
      };
      img.src = url;
    });
  }

  let maps = {
    albedo:null, normal:null, rough:null, ao:null, heightImg:null,
    heightData:null, hw:0, hh:0
  };

  // Convert image -> ImageData for sampling
  function imageToHeightData(img) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    maps.heightData = id.data;
    maps.hw = c.width;
    maps.hh = c.height;
  }

  function frac(x) { return x - Math.floor(x); }

  function sampleHeightFromMap(u, v) {
    if (!maps.heightData) return 0;
    // u,v can be any number -> repeat
    u = frac(u);
    v = frac(v);
    const x = u * (maps.hw - 1);
    const y = (1 - v) * (maps.hh - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, maps.hw - 1);
    const y1 = Math.min(y0 + 1, maps.hh - 1);
    const tx = x - x0, ty = y - y0;

    function px(ix, iy) {
      const idx = (iy * maps.hw + ix) * 4;
      return maps.heightData[idx] / 255; // grayscale from R
    }

    const a = px(x0,y0), b = px(x1,y0), c = px(x0,y1), d = px(x1,y1);
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * ty; // 0..1
  }

  // Fallback noise (si height missing)
  function hash2(x, z) {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function valueNoise2D(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const x1 = x0 + 1, z1 = z0 + 1;
    const tx = smooth01(x - x0);
    const tz = smooth01(z - z0);
    const a = hash2(x0, z0), b = hash2(x1, z0), c = hash2(x0, z1), d = hash2(x1, z1);
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * tz;
  }
  function fbm(x, z) {
    let amp = 1.0, freq = 0.035, sum = 0.0, norm = 0.0;
    for (let i=0;i<5;i++){
      sum += (valueNoise2D(x*freq, z*freq)*2-1)*amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.0;
    }
    return sum / norm;
  }

  // ---------- Scene ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.Fog(0x07090d, 22, 110);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ("toneMapping" in renderer) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if ("toneMappingExposure" in renderer) renderer.toneMappingExposure = 1.05;
  if ("physicallyCorrectLights" in renderer) renderer.physicallyCorrectLights = true;
  setRendererSRGB(renderer);
  document.body.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0x9bb7ff, 0x161a22, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sun.position.set(35, 45, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  scene.add(sun);

  // ---------- Ground / Open-world chunks ----------
  const CHUNK_SIZE = 70;
  const CHUNK_SEG = 90;           // densité relief
  const CHUNK_RADIUS = 1;         // 3x3
  const TEX_SCALE = 7.5;          // plus petit = texture plus “dense”
  const HEIGHT_AMPL = 3.2;        // relief global

  let groundMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a,
    roughness: 0.95,
    metalness: 0.0
  });

  function applyTextureParams(tex) {
    if (!tex) return;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  }

  function rebuildGroundMaterial() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      map: maps.albedo || null,
      normalMap: maps.normal || null,
      roughnessMap: maps.rough || null,
      aoMap: maps.ao || null
    });
    m.aoMapIntensity = 1.0;
    m.normalScale = new THREE.Vector2(1.1, 1.1);
    m.roughness = 1.0;
    groundMat = m;
  }

  function sampleHeightWorld(wx, wz) {
    // zone centrale (place) un peu aplatie
    const d = Math.sqrt(wx*wx + wz*wz);
    const plaza = clamp(1 - d / 16, 0, 1);
    const flatten = 1 - 0.72 * smooth01(plaza);

    if (maps.heightData) {
      const u = wx / TEX_SCALE;
      const v = wz / TEX_SCALE;
      const h01 = sampleHeightFromMap(u, v);       // 0..1
      const h = (h01 * 2 - 1) * HEIGHT_AMPL;      // -ampl..+ampl
      return h * flatten;
    }

    // fallback si height manquante
    return fbm(wx, wz) * (HEIGHT_AMPL * 0.9) * flatten;
  }

  function buildChunk() {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG);
    geo.rotateX(-Math.PI / 2);

    // uv2 (AO)
    const uv = geo.attributes.uv.array;
    geo.setAttribute("uv2", new THREE.BufferAttribute(new Float32Array(uv), 2));

    const mesh = new THREE.Mesh(geo, groundMat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.cx = 0;
    mesh.userData.cz = 0;
    return mesh;
  }

  function updateChunk(chunk, cx, cz) {
    chunk.userData.cx = cx;
    chunk.userData.cz = cz;
    chunk.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    const geo = chunk.geometry;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const uv2 = geo.attributes.uv2;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const wx = x + chunk.position.x;
      const wz = z + chunk.position.z;

      const y = sampleHeightWorld(wx, wz);
      pos.setY(i, y);

      const u = wx / TEX_SCALE;
      const v = wz / TEX_SCALE;
      uv.setXY(i, u, v);
      uv2.setXY(i, u, v);
    }

    pos.needsUpdate = true;
    uv.needsUpdate = true;
    uv2.needsUpdate = true;
    geo.computeVertexNormals();
  }

  const chunks = [];
  for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      const c = buildChunk();
      chunks.push(c);
      scene.add(c);
      updateChunk(c, dx, dz);
    }
  }

  let lastChunkCX = 999999, lastChunkCZ = 999999;
  function updateChunksAround(px, pz) {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    if (cx === lastChunkCX && cz === lastChunkCZ) return;
    lastChunkCX = cx; lastChunkCZ = cz;

    let idx = 0;
    for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
      for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
        updateChunk(chunks[idx++], cx + dx, cz + dz);
      }
    }
  }

  // ---------- POI / village (simple mais propre) ----------
  const poiGroup = new THREE.Group();
  scene.add(poiGroup);

  function addPlaza() {
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(12.5, 64),
      new THREE.MeshStandardMaterial({ color: 0x3a4353, roughness: 0.92 })
    );
    plaza.rotation.x = -Math.PI/2;
    plaza.position.set(0, 0.08, 0);
    plaza.receiveShadow = true;
    poiGroup.add(plaza);

    // puits / fontaine simple
    const stone = new THREE.MeshStandardMaterial({ color: 0x6f7a8a, roughness: 0.78 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.75, 30), stone);
    base.position.set(0, 0.45, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    poiGroup.add(base);

    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 1.9, 0.14, 30),
      new THREE.MeshStandardMaterial({ color: 0x2aa9ff, roughness: 0.25, transparent: true, opacity: 0.60 })
    );
    water.position.set(0, 0.72, 0);
    poiGroup.add(water);
  }

  function addRoad(x, z, w, d, rotY) {
    const m = new THREE.MeshStandardMaterial({ color: 0x2b313d, roughness: 0.95 });
    const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), m);
    r.rotation.x = -Math.PI/2;
    r.rotation.z = 0;
    r.rotation.y = rotY || 0;
    r.position.set(x, 0.06, z);
    r.receiveShadow = true;
    poiGroup.add(r);
  }

  function addHouse(x, z, w, d, h, colWall, colRoof) {
    const g = new THREE.Group();

    const wallMat = new THREE.MeshStandardMaterial({ color: colWall, roughness: 0.88 });
    const roofMat = new THREE.MeshStandardMaterial({ color: colRoof, roughness: 0.90 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    body.position.y = h * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // “ossature” bois (look médiéval simple)
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.9 });
    const beam1 = new THREE.Mesh(new THREE.BoxGeometry(w+0.02, 0.12, 0.12), beamMat);
    beam1.position.set(0, h*0.55, d*0.46);
    beam1.castShadow = true; g.add(beam1);
    const beam2 = beam1.clone(); beam2.position.z = -d*0.46; g.add(beam2);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.62, h * 0.65, 4), roofMat);
    roof.position.y = h + (h * 0.28);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);

    g.position.set(x, 0, z);
    poiGroup.add(g);

    // collision box (simple)
    const box = new THREE.Box3().setFromObject(body);
    return box;
  }

  function addLamppost(x, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.10, 3.2, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 })
    );
    pole.position.y = 1.6;
    pole.castShadow = true;
    g.add(pole);

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.25, emissive: 0x442200, emissiveIntensity: 0.35 })
    );
    lantern.position.set(0.0, 3.0, 0.0);
    lantern.castShadow = false;
    g.add(lantern);

    const light = new THREE.PointLight(0xffd6a3, 1.2, 10, 2.0);
    light.position.set(0.0, 3.0, 0.0);
    g.add(light);

    g.position.set(x, 0, z);
    poiGroup.add(g);
  }

  addPlaza();
  addRoad(0, 0, 10, 80, 0);
  addRoad(0, 0, 80, 10, 0);

  const colliders = [];
  colliders.push(addHouse(12, 10, 5.4, 4.2, 3.2, 0x445063, 0x242424)); // taverne
  colliders.push(addHouse(-13, 9, 5.0, 4.0, 3.0, 0x3d4a3d, 0x2a2a2a)); // forge
  colliders.push(addHouse(-11, -12, 4.8, 3.8, 2.9, 0x4b3a2b, 0x1f1f1f)); // marché
  colliders.push(addHouse(14, -12, 4.8, 3.8, 2.9, 0x384a5c, 0x1f1f1f)); // écurie

  addLamppost(6, 18);
  addLamppost(-6, 18);
  addLamppost(18, 6);
  addLamppost(-18, 6);
  addLamppost(18, -6);
  addLamppost(-18, -6);

  // ---------- Player (3e personne) ----------
  const player = new THREE.Group();
  scene.add(player);

  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(SKINS[avatar.skinIndex]), roughness: 0.55, metalness: 0.0 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf2d7b5, roughness: 0.95 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 6, 12), skinMat);
  body.position.y = 1.05;
  body.castShadow = true;
  player.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 18), headMat);
  head.position.y = 2.0;
  head.castShadow = true;
  player.add(head);

  // accessoires (placeholder, mais propre)
  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.55, 18),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 })
  );
  hat.position.y = 2.35;
  hat.castShadow = true;
  player.add(hat);

  const bag = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.6, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 })
  );
  bag.position.set(0, 1.35, -0.38);
  bag.castShadow = true;
  player.add(bag);

  function applyAvatarToModel() {
    skinMat.color.set(SKINS[avatar.skinIndex]);
    player.scale.setScalar(avatar.scale);
    hat.visible = avatar.hat;
    bag.visible = avatar.bag;
  }
  applyAvatarToModel();

  // Spawn
  player.position.set(0, 0, 7);

  // ---------- Inputs: clavier + souris + joystick ----------
  const keys = { up:false, down:false, left:false, right:false, run:false };

  function setKey(e, down) {
    const k = (e.key || "").toLowerCase();
    if (k === "z" || e.key === "ArrowUp") keys.up = down;
    if (k === "s" || e.key === "ArrowDown") keys.down = down;
    if (k === "q" || e.key === "ArrowLeft") keys.left = down;
    if (k === "d" || e.key === "ArrowRight") keys.right = down;
    if (k === "shift") keys.run = down;
  }
  window.addEventListener("keydown", (e) => setKey(e, true));
  window.addEventListener("keyup", (e) => setKey(e, false));

  // caméra
  let camYaw = Math.PI;
  let camPitch = 0.40;
  let camDist = 8.8;

  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();

  let dragging = false;
  let lastX = 0, lastY = 0;

  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (e.target && e.target.closest && (e.target.closest(".hud") || e.target.closest(".panel"))) return;
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    camYaw -= dx * 0.0047;
    camPitch -= dy * 0.0038;
    camPitch = clamp(camPitch, 0.20, 1.05);
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    dragging = false;
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch(_) {}
  });

  // joystick move
  const joyZone = document.getElementById("joyLeftZone");
  const joyKnob = document.getElementById("joyLeftKnob");
  let joyActive = false, joyId = null;
  let joyCX = 0, joyCY = 0;
  let joyX = 0, joyY = 0;

  function knob(nx, ny) {
    const r = 46;
    joyKnob.style.transform = `translate(calc(-50% + ${nx*r}px), calc(-50% + ${ny*r}px))`;
  }
  function knobReset() { joyKnob.style.transform = "translate(-50%,-50%)"; }

  joyZone.addEventListener("pointerdown", (e) => {
    if (!showJoysticks) return;
    if (e.pointerType === "mouse") return;
    joyActive = true; joyId = e.pointerId;
    joyCX = e.clientX; joyCY = e.clientY;
    joyX = 0; joyY = 0;
    joyZone.setPointerCapture(e.pointerId);
  });
  joyZone.addEventListener("pointermove", (e) => {
    if (!joyActive || e.pointerId !== joyId) return;
    const dx = e.clientX - joyCX;
    const dy = e.clientY - joyCY;
    const max = 56;
    const nx = clamp(dx / max, -1, 1);
    const ny = clamp(dy / max, -1, 1);
    joyX = nx; joyY = ny;
    knob(nx, ny);
  });
  function endJoy(e){
    if (!joyActive || e.pointerId !== joyId) return;
    joyActive = false; joyId = null;
    joyX = 0; joyY = 0;
    knobReset();
    try { joyZone.releasePointerCapture(e.pointerId); } catch(_) {}
  }
  joyZone.addEventListener("pointerup", endJoy);
  joyZone.addEventListener("pointercancel", endJoy);

  // touch look zone
  const lookZone = document.getElementById("lookRightZone");
  let lookActive = false, lookId = null;
  let lookLX = 0, lookLY = 0;

  lookZone.addEventListener("pointerdown", (e) => {
    if (!showJoysticks) return;
    if (e.pointerType === "mouse") return;
    if (e.target && e.target.closest && (e.target.closest(".hud") || e.target.closest(".panel"))) return;
    lookActive = true; lookId = e.pointerId;
    lookLX = e.clientX; lookLY = e.clientY;
    lookZone.setPointerCapture(e.pointerId);
  });
  lookZone.addEventListener("pointermove", (e) => {
    if (!lookActive || e.pointerId !== lookId) return;
    const dx = e.clientX - lookLX;
    const dy = e.clientY - lookLY;
    lookLX = e.clientX; lookLY = e.clientY;
    camYaw -= dx * 0.0062;
    camPitch -= dy * 0.0042;
    camPitch = clamp(camPitch, 0.20, 1.05);
  });
  function endLook(e){
    if (!lookActive || e.pointerId !== lookId) return;
    lookActive = false; lookId = null;
    try { lookZone.releasePointerCapture(e.pointerId); } catch(_) {}
  }
  lookZone.addEventListener("pointerup", endLook);
  lookZone.addEventListener("pointercancel", endLook);

  // ---------- Movement + collisions ----------
  const vel = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function getInputVector() {
    let ix = 0, iz = 0;
    if (keys.left) ix -= 1;
    if (keys.right) ix += 1;
    if (keys.up) iz -= 1;
    if (keys.down) iz += 1;
    // joystick (ny vers bas => reculer)
    ix += joyX;
    iz += joyY;

    const len = Math.hypot(ix, iz);
    if (len > 1e-6) { ix /= Math.max(1, len); iz /= Math.max(1, len); }
    return { ix, iz, mag: Math.min(1, len) };
  }

  function playerRadius() {
    return 0.50 * avatar.scale;
  }

  function resolveCollisions(pos) {
    // collision très simple: repousser hors des box (sur XZ)
    const r = playerRadius();
    for (const b of colliders) {
      // élargir la box du rayon du joueur
      const bb = b.clone().expandByScalar(r);
      if (bb.containsPoint(pos)) {
        const cx = (bb.min.x + bb.max.x) * 0.5;
        const cz = (bb.min.z + bb.max.z) * 0.5;
        const dx = pos.x - cx;
        const dz = pos.z - cz;

        // pousser vers l'extérieur par l'axe dominant
        const px = Math.min(pos.x - bb.min.x, bb.max.x - pos.x);
        const pz = Math.min(pos.z - bb.min.z, bb.max.z - pos.z);

        if (px < pz) pos.x += (dx >= 0 ? px : -px);
        else pos.z += (dz >= 0 ? pz : -pz);
      }
    }
  }

  function updateCamera(dt) {
    const px = player.position.x;
    const pz = player.position.z;

    // cible regard
    camTarget.set(px, player.position.y + 1.6 * avatar.scale, pz);

    // position caméra souhaitée
    const cp = camPitch;
    const behindX = Math.cos(camYaw) * camDist * Math.cos(cp);
    const behindZ = Math.sin(camYaw) * camDist * Math.cos(cp);
    const upY = Math.sin(cp) * camDist;

    const desired = new THREE.Vector3(
      px + behindX,
      player.position.y + 2.2 * avatar.scale + upY,
      pz + behindZ
    );

    // smoothing
    const k = 1 - Math.exp(-10 * dt);
    camPos.lerp(desired, k);

    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  // ---------- Main loop ----------
  let started = false;
  let last = performance.now();

  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;

    // terrain height
    const groundY = sampleHeightWorld(player.position.x, player.position.z);
    player.position.y = groundY;

    const inp = getInputVector();

    // direction relative caméra
    const forward = new THREE.Vector3(-Math.cos(camYaw), 0, -Math.sin(camYaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    tmp.set(0,0,0);
    tmp.addScaledVector(right, inp.ix);
    tmp.addScaledVector(forward, -inp.iz);
    if (tmp.lengthSq() > 1e-6) tmp.normalize();

    const baseSpeed = 4.8;
    const runMul = keys.run ? 1.55 : 1.0;
    const targetSpeed = baseSpeed * runMul * inp.mag;

    // accel / friction (mouvement “propre”)
    const accel = 18.0;
    const friction = 14.0;

    const desiredVelX = tmp.x * targetSpeed;
    const desiredVelZ = tmp.z * targetSpeed;

    vel.x = lerp(vel.x, desiredVelX, 1 - Math.exp(-accel * dt));
    vel.z = lerp(vel.z, desiredVelZ, 1 - Math.exp(-accel * dt));

    // si aucun input -> friction plus forte
    if (inp.mag < 0.05) {
      vel.x = lerp(vel.x, 0, 1 - Math.exp(-friction * dt));
      vel.z = lerp(vel.z, 0, 1 - Math.exp(-friction * dt));
    }

    // déplacer
    player.position.x += vel.x * dt;
    player.position.z += vel.z * dt;

    resolveCollisions(player.position);

    // orienter vers déplacement
    if (tmp.lengthSq() > 1e-4) {
      player.rotation.y = Math.atan2(tmp.x, tmp.z);
    }

    updateChunksAround(player.position.x, player.position.z);
    updateCamera(dt);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  // ---------- Resize ----------
  window.addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  }, { passive: true });

  // ---------- Global error -> overlay ----------
  window.addEventListener("error", (e) => {
    showError(String(e.message || e.error || "Erreur inconnue"));
  });

  // ---------- Start: load assets then run ----------
  async function start() {
    try {
      setLoading(0, "Chargement textures sol…");

      maps.albedo = await loadTexture(ASSETS.albedo, true, "Albedo");
      maps.normal = await loadTexture(ASSETS.normal, false, "Normal");
      maps.rough  = await loadTexture(ASSETS.rough, false, "Roughness");
      maps.ao     = await loadTexture(ASSETS.ao, false, "AO");
      maps.heightImg = await loadHeightImage(ASSETS.height, "Height");

      // apply texture params
      applyTextureParams(maps.albedo);
      applyTextureParams(maps.normal);
      applyTextureParams(maps.rough);
      applyTextureParams(maps.ao);

      if (maps.heightImg) imageToHeightData(maps.heightImg);

      if (loaded.ok) {
        setAssetStatus(true, "Assets: OK (PBR + relief)");
      } else {
        setAssetStatus(false, "Assets: partiels (fallback)");
        showError(loaded.errors.join("\n"));
      }

      rebuildGroundMaterial();

      // Re-assign material to chunks (si reconstruit)
      for (const c of chunks) c.material = groundMat;

      // recalcul chunks maintenant que height et maps sont dispo
      for (const c of chunks) updateChunk(c, c.userData.cx, c.userData.cz);

      // finir
      setLoading(100, "Prêt.");
      loading.classList.add("hidden");

      if (!started) {
        started = true;
        requestAnimationFrame(loop);
      }
    } catch (err) {
      showError(String(err));
    }
  }

  start();
})();

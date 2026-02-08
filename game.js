(function () {
  // =========================
  // 0) UTIL (sans console)
  // =========================
  const QS = (s) => document.querySelector(s);
  const QSA = (s) => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");

  function showScreen(name) {
    QSA(".screen").forEach(sc => {
      sc.classList.toggle("hidden", sc.getAttribute("data-screen") !== name);
    });
  }

  function setDebug(html) {
    const el = QS("#debug");
    if (!DEBUG) { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    el.innerHTML = html;
  }

  function nowMs() { return performance.now(); }

  // RNG seedable (pour stabilité)
  function makeRNG(seed) {
    let s = (seed >>> 0) || 1;
    return function rand() {
      // xorshift32
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17; s >>>= 0;
      s ^= s << 5;  s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }

  // =========================
  // 1) OPTIONS (localStorage)
  // =========================
  const OPT_KEY = "werewolf_options_v1";
  const optDefault = {
    showTimer: true,
    showHints: true,
    showFPS: false,
    bgSpeed: 1.0
  };

  function loadOptions() {
    try {
      const raw = localStorage.getItem(OPT_KEY);
      if (!raw) return { ...optDefault };
      const parsed = JSON.parse(raw);
      return { ...optDefault, ...parsed };
    } catch (_) {
      return { ...optDefault };
    }
  }
  function saveOptions(opt) {
    try { localStorage.setItem(OPT_KEY, JSON.stringify(opt)); } catch(_) {}
  }

  const OPT = loadOptions();

  // UI options wiring
  function syncOptionsToUI() {
    QS("#oShowTimer").checked = !!OPT.showTimer;
    QS("#oShowHints").checked = !!OPT.showHints;
    QS("#oShowFPS").checked = !!OPT.showFPS;
    QS("#oBgSpeed").value = String(OPT.bgSpeed);
    QS("#oBgSpeedText").textContent = "x" + OPT.bgSpeed.toFixed(2);
  }
  function syncOptionsFromUI() {
    OPT.showTimer = QS("#oShowTimer").checked;
    OPT.showHints = QS("#oShowHints").checked;
    OPT.showFPS = QS("#oShowFPS").checked;
    OPT.bgSpeed = Number(QS("#oBgSpeed").value);
  }

  QS("#oBgSpeed").addEventListener("input", () => {
    QS("#oBgSpeedText").textContent = "x" + Number(QS("#oBgSpeed").value).toFixed(2);
  });

  // =========================
  // 2) THREE BACKGROUND (ambiance)
  // =========================
  const canvas = QS("#bg");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  // color pipeline safe
  if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else if ("outputEncoding" in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.FogExp2(0x07090d, 0.045);

  const cam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
  cam.position.set(0, 6, 14);

  const hemi = new THREE.HemisphereLight(0x5b6cff, 0x0b0e12, 0.55);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xdfe6ff, 1.1);
  moon.position.set(-12, 18, 6);
  scene.add(moon);

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 1.0, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  scene.add(ground);

  // village silhouettes (cheap)
  const houses = new THREE.Group();
  scene.add(houses);

  function buildHouses() {
    houses.clear();
    const matA = new THREE.MeshStandardMaterial({ color: 0x1b2030, roughness: 1.0 });
    const matB = new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 1.0 });

    const n = 40;
    for (let i = 0; i < n; i++) {
      const w = 1.2 + Math.random() * 2.2;
      const h = 1.4 + Math.random() * 4.0;
      const d = 1.2 + Math.random() * 2.2;

      const m = (i % 2 === 0) ? matA : matB;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

      const angle = (i / n) * Math.PI * 2;
      const radius = 14 + Math.random() * 10;
      box.position.set(Math.cos(angle) * radius, h * 0.5, Math.sin(angle) * radius);
      box.rotation.y = Math.random() * Math.PI * 2;

      houses.add(box);
    }

    // moon disc
    const moonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8eeff, roughness: 0.2, metalness: 0.0, emissive: new THREE.Color(0x2a2f40) })
    );
    moonDisc.position.set(-10, 12, -18);
    houses.add(moonDisc);
  }
  buildHouses();

  // background camera orbit
  const bg = { angle: 0 };
  function renderBG(dt) {
    const speed = OPT.bgSpeed || 1.0;
    bg.angle += dt * 0.18 * speed;

    const r = 16;
    cam.position.x = Math.sin(bg.angle) * r;
    cam.position.z = Math.cos(bg.angle) * r;
    cam.position.y = 6.2 + Math.sin(bg.angle * 0.7) * 0.5;
    cam.lookAt(0, 2.5, 0);

    renderer.render(scene, cam);
  }

  // =========================
  // 3) GAME MODEL
  // =========================
  const ROLE = { CITIZEN: "Citoyen", WOLF: "Loup-Garou", HUNTER: "Chasseur" };
  const PHASE = {
    REVEAL: "REVEAL",
    NIGHT: "NIGHT",
    DAY_TALK: "DAY_TALK",
    DAY_VOTE: "DAY_VOTE",
    HUNTER_SHOT: "HUNTER_SHOT",
    GAMEOVER: "GAMEOVER"
  };

  const MODE = { MAIN:"main", SETUP:"setup", OPTIONS:"options", REVEAL:"reveal", GAME:"game", PAUSE:"pause", GAMEOVER:"gameover" };

  const Game = {
    uiMode: MODE.MAIN,
    phase: PHASE.REVEAL,
    day: 1,
    seed: 0,
    rng: null,

    difficulty: "normal",
    hunterEnabled: true,

    youId: 0,
    players: [],

    phaseEndsAt: 0,
    hunterShotPending: false,
    hunterShooterId: -1,
    hunterShotUsed: false,

    wolfTargetId: -1,
    voteTargetId: -1,

    lastEvent: ""
  };

  function alivePlayers() {
    return Game.players.filter(p => p.alive);
  }
  function getYou() {
    return Game.players.find(p => p.id === Game.youId);
  }
  function wolvesAlive() {
    return Game.players.filter(p => p.alive && p.role === ROLE.WOLF);
  }
  function citizensAlive() {
    return Game.players.filter(p => p.alive && p.role !== ROLE.WOLF);
  }

  // =========================
  // 4) UI HELPERS
  // =========================
  const phaseNameEl = QS("#phaseName");
  const phaseSubEl = QS("#phaseSub");
  const aliveCountEl = QS("#aliveCount");
  const dayCountEl = QS("#dayCount");
  const timerWrap = QS("#timerWrap");
  const timerText = QS("#timerText");
  const fpsWrap = QS("#fpsWrap");
  const fpsText = QS("#fpsText");
  const playerListEl = QS("#playerList");
  const actionBoxEl = QS("#actionBox");
  const logEl = QS("#log");

  function logLine(text, emph=false) {
    const div = document.createElement("div");
    div.className = "logLine";
    if (emph) div.innerHTML = `<span class="logEm">${text}</span>`;
    else div.textContent = text;
    logEl.appendChild(div);
    while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearActions() { actionBoxEl.innerHTML = ""; }

  function makeActionCard(title, hint) {
    const c = document.createElement("div");
    c.className = "actionCard";
    const t = document.createElement("div");
    t.className = "actionTitle";
    t.textContent = title;

    const h = document.createElement("div");
    h.className = "actionHint";
    h.textContent = hint || "";

    const btns = document.createElement("div");
    btns.className = "actionBtns";

    c.appendChild(t);
    if (hint) c.appendChild(h);
    c.appendChild(btns);
    actionBoxEl.appendChild(c);
    return { card: c, btns };
  }

  function setTopBar(phaseName, phaseSub) {
    phaseNameEl.textContent = phaseName;
    phaseSubEl.textContent = phaseSub || "";
    aliveCountEl.textContent = String(alivePlayers().length);
    dayCountEl.textContent = String(Game.day);

    timerWrap.classList.toggle("hidden", !OPT.showTimer);
    fpsWrap.classList.toggle("hidden", !OPT.showFPS);
  }

  function updateTimerUI() {
    if (!OPT.showTimer) return;
    const ms = Math.max(0, Game.phaseEndsAt - nowMs());
    timerText.textContent = String(Math.ceil(ms / 1000));
  }

  function renderPlayerList({ showButtons, buttonLabel, onPick, disablePickSelf, disableDead } = {}) {
    playerListEl.innerHTML = "";

    const you = getYou();
    const canButtons = !!showButtons;

    Game.players.forEach(p => {
      const row = document.createElement("div");
      row.className = "pRow" + (p.alive ? "" : " dead");

      const left = document.createElement("div");
      left.className = "pLeft";
      const name = document.createElement("div");
      name.className = "pName";
      name.textContent = p.name;

      const meta = document.createElement("div");
      meta.className = "pMeta";
      const status = p.alive ? "Vivant" : "Mort";
      const hint = (OPT.showHints && p.alive && p.id !== you.id && p.hint) ? ` • ${p.hint}` : "";
      meta.textContent = status + hint;

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      if (p.id === you.id) {
        const tag = document.createElement("div");
        tag.className = "tagYou";
        tag.textContent = "TOI";
        right.appendChild(tag);
      } else if (canButtons) {
        const btn = document.createElement("button");
        btn.className = "pBtn";
        btn.textContent = buttonLabel || "Choisir";
        const disabled =
          (!!disablePickSelf && p.id === you.id) ||
          (!!disableDead && !p.alive);

        btn.disabled = disabled;

        btn.addEventListener("click", () => onPick?.(p.id));
        right.appendChild(btn);
      }

      row.appendChild(left);
      row.appendChild(right);
      playerListEl.appendChild(row);
    });
  }

  // =========================
  // 5) GAME FLOW
  // =========================
  function checkWin() {
    const wolves = wolvesAlive().length;
    const alive = alivePlayers().length;

    if (wolves === 0) {
      endGame("Victoire des Citoyens", "Le Loup-Garou a été éliminé.");
      return true;
    }

    if (alive <= 2 && wolves === 1) {
      endGame("Victoire du Loup-Garou", "Il ne reste plus que 2 survivants.");
      return true;
    }

    return false;
  }

  function endGame(title, sub) {
    Game.phase = PHASE.GAMEOVER;
    Game.uiMode = MODE.GAMEOVER;

    QS("#gameOverTitle").textContent = title;
    QS("#gameOverSub").textContent = sub;

    showScreen("gameover");
  }

  function killPlayer(id, reasonText) {
    const p = Game.players.find(x => x.id === id);
    if (!p || !p.alive) return;
    p.alive = false;

    logLine(reasonText, true);

    // Si le chasseur meurt -> tir immédiat (une fois)
    if (p.role === ROLE.HUNTER && !Game.hunterShotUsed) {
      Game.hunterShotPending = true;
      Game.hunterShooterId = p.id;
      Game.phase = PHASE.HUNTER_SHOT;
      Game.phaseEndsAt = nowMs() + 15000; // 15s pour choisir
      logLine("Le Chasseur peut tirer une dernière fois…", true);
      renderPhase();
    }
  }

  function startNewGame({ youName, count, difficulty, hunterEnabled }) {
    Game.seed = (Date.now() ^ (count * 2654435761)) >>> 0;
    Game.rng = makeRNG(Game.seed);

    Game.difficulty = difficulty || "normal";
    Game.hunterEnabled = !!hunterEnabled;

    Game.day = 1;
    Game.hunterShotPending = false;
    Game.hunterShooterId = -1;
    Game.hunterShotUsed = false;

    Game.wolfTargetId = -1;
    Game.voteTargetId = -1;

    // build players
    const namesPool = [
      "Aline","Bastien","Cédric","Daria","Eliot","Fanny","Gaspard","Hugo","Inès","Jules","Khadija","Léo",
      "Mila","Nina","Oscar","Pia","Quentin","Rita","Sami","Tara","Ugo","Vera","Wassim","Yara"
    ];

    const used = new Set();
    function pickName() {
      for (let tries = 0; tries < 50; tries++) {
        const n = namesPool[Math.floor(Game.rng() * namesPool.length)];
        if (!used.has(n)) { used.add(n); return n; }
      }
      return "Villageois";
    }

    Game.players = [];
    Game.youId = 0;

    const you = { id: 0, name: youName || "Toi", role: ROLE.CITIZEN, alive: true, hint: "" };
    Game.players.push(you);

    for (let i = 1; i < count; i++) {
      Game.players.push({ id: i, name: pickName(), role: ROLE.CITIZEN, alive: true, hint: "" });
    }

    // assign roles: 1 wolf, 1 hunter (optional)
    const ids = Game.players.map(p => p.id).slice(0);
    // shuffle
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Game.rng() * (i + 1));
      const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }

    const wolfId = ids[0];
    Game.players.find(p => p.id === wolfId).role = ROLE.WOLF;

    if (Game.hunterEnabled && ids.length >= 6) {
      const hunterId = ids[1];
      if (hunterId !== wolfId) Game.players.find(p => p.id === hunterId).role = ROLE.HUNTER;
    } else if (Game.hunterEnabled && ids.length < 6) {
      // si peu de joueurs, on place hunter sur un autre id si possible
      const hunterId = ids[1] ?? 1;
      if (hunterId !== wolfId) Game.players.find(p => p.id === hunterId).role = ROLE.HUNTER;
    }

    // UI state
    logEl.innerHTML = "";
    logLine("La partie commence…", true);

    Game.phase = PHASE.REVEAL;
    Game.uiMode = MODE.REVEAL;
    showScreen("reveal");

    renderReveal();
    renderHints(); // init hints
    renderPhase();
  }

  function renderReveal() {
    const you = getYou();
    const badge = QS("#roleBadge");
    const desc = QS("#roleDesc");

    badge.textContent = you.role;

    if (you.role === ROLE.CITIZEN) {
      desc.textContent = "Tu dois voter pour éliminer le Loup-Garou. Observe les comportements.";
    } else if (you.role === ROLE.WOLF) {
      desc.textContent = "Chaque nuit, choisis une victime. Gagne si tu es 2 survivants (toi + 1).";
    } else {
      desc.textContent = "Si tu meurs, tu peux tirer une fois pour éliminer quelqu’un.";
    }
  }

  function goToNight() {
    if (checkWin()) return;
    Game.phase = PHASE.NIGHT;
    Game.phaseEndsAt = nowMs() + 20000; // 20s
    Game.wolfTargetId = -1;

    logLine(`Nuit ${Game.day}… Le village s’endort.`, true);
    renderHints();
    renderPhase();
  }

  function goToDayTalk(nightVictimIdOrNull) {
    if (checkWin()) return;

    Game.phase = PHASE.DAY_TALK;
    Game.phaseEndsAt = nowMs() + 22000; // 22s discussion

    if (nightVictimIdOrNull != null) {
      const v = Game.players.find(p => p.id === nightVictimIdOrNull);
      logLine(`Au matin… ${v.name} a été retrouvé(e) mort(e).`, true);
    } else {
      logLine("Au matin… personne n’est mort cette nuit.", true);
    }

    renderHints();
    renderPhase();
  }

  function goToDayVote() {
    if (checkWin()) return;
    Game.phase = PHASE.DAY_VOTE;
    Game.phaseEndsAt = nowMs() + 20000; // 20s pour voter
    Game.voteTargetId = -1;

    logLine("C’est l’heure du vote.", true);
    renderHints();
    renderPhase();
  }

  function resolveNight() {
    // Wolf chooses target (player if wolf -> chosen, else bot)
    const wolf = wolvesAlive()[0];
    if (!wolf) return;

    const you = getYou();
    let targetId = Game.wolfTargetId;

    if (you.role !== ROLE.WOLF) {
      // bot wolf picks
      targetId = botPickWolfTarget(wolf.id);
    } else {
      // player wolf might not choose: fallback
      if (targetId < 0) targetId = botPickWolfTarget(wolf.id);
    }

    // kill target if valid
    if (targetId >= 0) {
      killPlayer(targetId, "Pendant la nuit, une attaque a eu lieu…");
      // si chasseur meurt, la phase devient HUNTER_SHOT via killPlayer
      if (Game.phase !== PHASE.HUNTER_SHOT) {
        goToDayTalk(targetId);
      }
    } else {
      goToDayTalk(null);
    }
  }

  function resolveVote() {
    // votes: you + bots
    const alive = alivePlayers();
    const you = getYou();

    let yourVote = Game.voteTargetId;
    if (yourVote < 0) {
      // no choice: random alive other than you
      const choices = alive.filter(p => p.id !== you.id).map(p => p.id);
      yourVote = choices.length ? choices[Math.floor(Game.rng() * choices.length)] : -1;
    }

    const tally = new Map();
    function addVote(targetId) {
      if (targetId < 0) return;
      tally.set(targetId, (tally.get(targetId) || 0) + 1);
    }

    addVote(yourVote);

    // bots vote
    for (const p of alive) {
      if (p.id === you.id) continue;
      const t = botPickVoteTarget(p.id);
      addVote(t);
    }

    // pick max votes (tie -> random among top)
    let max = -1;
    let top = [];
    for (const [tid, c] of tally.entries()) {
      if (c > max) { max = c; top = [tid]; }
      else if (c === max) top.push(tid);
    }

    const eliminatedId = top.length ? top[Math.floor(Game.rng() * top.length)] : -1;
    if (eliminatedId < 0) {
      logLine("Vote impossible (aucune cible).", true);
      Game.day++;
      goToNight();
      return;
    }

    const target = Game.players.find(p => p.id === eliminatedId);
    logLine(`Résultat du vote : ${target.name} est éliminé(e).`, true);

    killPlayer(eliminatedId, `${target.name} est mort(e) suite au vote.`);

    // si chasseur meurt -> phase HUNTER_SHOT gérée par killPlayer
    if (Game.phase !== PHASE.HUNTER_SHOT) {
      Game.day++;
      goToNight();
    }
  }

  function resolveHunterShot() {
    // shooter is dead hunter; must pick a target
    const shooter = Game.players.find(p => p.id === Game.hunterShooterId);
    if (!shooter) {
      Game.hunterShotPending = false;
      Game.hunterShooterId = -1;
      Game.day++;
      goToNight();
      return;
    }

    // if player didn't pick -> bot pick
    let targetId = Game.voteTargetId; // reused as "shot target"
    if (targetId < 0) targetId = botPickHunterShotTarget(Game.hunterShooterId);

    if (targetId >= 0) {
      Game.hunterShotUsed = true;
      Game.hunterShotPending = false;

      const t = Game.players.find(p => p.id === targetId);
      logLine(`Le Chasseur tire… ${t.name} tombe.`, true);
      killPlayer(targetId, `${t.name} a été abattu(e) par le Chasseur.`);
    } else {
      logLine("Le Chasseur n’a tiré sur personne.", true);
      Game.hunterShotPending = false;
    }

    // ensuite, on reprend le flow : si on était en nuit -> aller au jour, si vote -> nuit suivante
    // Simplification : si chasseur tir après une mort, on check win puis:
    if (checkWin()) return;

    // On décide selon l’état précédent: si on tirait après la nuit -> aller au jour, sinon -> nuit suivante.
    // Ici, on ne garde pas l’état précédent, donc on choisit logique simple:
    // si c’était la nuit (jour n’a pas encore commencé) -> on part sur le jour.
    // mais comme on arrive ici seulement juste après une mort (nuit ou vote),
    // on utilise le compteur day: si phase a été déclenchée pendant la nuit (avant day talk), day n’a pas incrémenté. Pendant vote, on incrémente après.
    // => on regarde la dernière ligne d’event via Game.lastEvent n’existe pas; on fait robuste :
    // Si on est en HUNTER_SHOT, on enchaîne par Jour discussion si c’était la nuit, sinon Nuit.
    // Heuristique: si Game.dayCount affiché n’a pas changé, on est encore sur le même jour -> après nuit.
    goToDayTalk(null);
  }

  // =========================
  // 6) BOTS (logique simple)
  // =========================
  function botPickWolfTarget(wolfId) {
    const alive = alivePlayers().filter(p => p.id !== wolfId);
    if (!alive.length) return -1;

    // Les bots plus “durs” ciblent préférentiellement les joueurs “dangereux”
    // Ici, on met un biais simple : éviter de tuer quelqu’un déjà suspecté (ça attire l’attention).
    const weights = alive.map(p => {
      let w = 1.0;
      if (Game.difficulty === "hard") {
        // éviter celui qui a un "hint" très accusateur (pour rester discret)
        if (p.hint && p.hint.includes("suspect")) w *= 0.7;
        // viser parfois le chasseur si le wolf “devine”
        if (p.role === ROLE.HUNTER) w *= 1.15;
      } else if (Game.difficulty === "easy") {
        // plus random
        w *= 1.0;
      } else {
        // normal: léger biais
        if (p.role === ROLE.HUNTER) w *= 1.05;
      }
      return w;
    });

    return weightedPick(alive.map(p => p.id), weights);
  }

  function botPickVoteTarget(voterId) {
    const alive = alivePlayers();
    const voter = Game.players.find(p => p.id === voterId);
    if (!voter || !voter.alive) return -1;

    // ne pas voter pour soi
    const candidates = alive.filter(p => p.id !== voterId);
    if (!candidates.length) return -1;

    // Heuristique ultra simple : les bots suivent parfois une “accusation” (hint),
    // sinon random. Les bots hard ont un peu plus de chance de voter le loup,
    // mais sans tricher à 100%.
    const weights = candidates.map(p => {
      let w = 1.0;

      // suivre les indices
      if (OPT.showHints && p.hint) {
        if (p.hint.includes("suspect")) w *= 1.25;
        if (p.hint.includes("calme")) w *= 0.9;
      }

      if (Game.difficulty === "hard") {
        // léger avantage pour viser le loup (mais pas sûr)
        if (p.role === ROLE.WOLF) w *= 1.35;
      } else if (Game.difficulty === "easy") {
        // très aléatoire
        w *= 1.0;
      } else {
        if (p.role === ROLE.WOLF) w *= 1.15;
      }

      // Les loups bots essaient de détourner le vote
      if (voter.role === ROLE.WOLF && p.role !== ROLE.WOLF) {
        w *= 1.15;
      }
      if (voter.role === ROLE.WOLF && p.role === ROLE.WOLF) {
        w *= 0.3;
      }

      return w;
    });

    return weightedPick(candidates.map(p => p.id), weights);
  }

  function botPickHunterShotTarget(hunterId) {
    const alive = alivePlayers();
    const candidates = alive.filter(p => p.id !== hunterId);
    if (!candidates.length) return -1;

    // Le chasseur bot “hard” tente plus souvent de tirer le loup
    const weights = candidates.map(p => {
      let w = 1.0;
      if (Game.difficulty === "hard") {
        if (p.role === ROLE.WOLF) w *= 1.7;
      } else if (Game.difficulty === "normal") {
        if (p.role === ROLE.WOLF) w *= 1.25;
      } else {
        if (p.role === ROLE.WOLF) w *= 1.05;
      }
      // suivre hints
      if (OPT.showHints && p.hint && p.hint.includes("suspect")) w *= 1.2;
      return w;
    });

    return weightedPick(candidates.map(p => p.id), weights);
  }

  function weightedPick(ids, weights) {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Math.max(0, weights[i]);
    if (sum <= 0) return ids[Math.floor(Game.rng() * ids.length)];

    let r = Game.rng() * sum;
    for (let i = 0; i < ids.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return ids[i];
    }
    return ids[ids.length - 1];
  }

  // =========================
  // 7) HINTS + DISCUSSION (ambiance)
  // =========================
  function renderHints() {
    // Hints uniquement pour l’ambiance (pas de “révélation” brute)
    // On met des petites phrases neutres. (Le hard a un peu plus de pertinence.)
    for (const p of Game.players) p.hint = "";

    if (!OPT.showHints) return;

    const alive = alivePlayers();
    if (alive.length < 4) return;

    // choisir 3 joueurs à annoter
    const pickCount = Math.min(3, alive.length - 1);
    const pool = alive.filter(p => p.id !== Game.youId);

    for (let k = 0; k < pickCount; k++) {
      const idx = Math.floor(Game.rng() * pool.length);
      const p = pool.splice(idx, 1)[0];
      if (!p) continue;

      let hint = "";
      const r = Game.rng();

      // un tout petit biais en hard pour être “un peu plus vrai”, mais pas déterministe
      const bias = (Game.difficulty === "hard") ? 0.12 : (Game.difficulty === "normal") ? 0.06 : 0.0;
      const isWolf = (p.role === ROLE.WOLF);

      if (r < 0.33) {
        if (isWolf && Game.rng() < (0.45 + bias)) hint = "semble suspect";
        else hint = "semble calme";
      } else if (r < 0.66) {
        if (isWolf && Game.rng() < (0.40 + bias)) hint = "évite les regards (suspect)";
        else hint = "parle beaucoup";
      } else {
        if (isWolf && Game.rng() < (0.35 + bias)) hint = "accuse vite (suspect)";
        else hint = "reste en retrait";
      }

      p.hint = hint;
    }
  }

  let lastTalkAt = 0;
  function updateDiscussion(dt) {
    // Génère des lignes “NPC” pendant DAY_TALK
    const t = nowMs();
    if (t - lastTalkAt < 2200) return;
    lastTalkAt = t;

    const alive = alivePlayers();
    if (alive.length < 3) return;

    const speaker = alive[Math.floor(Game.rng() * alive.length)];
    const targets = alive.filter(p => p.id !== speaker.id);
    const target = targets[Math.floor(Game.rng() * targets.length)];

    const lines = [
      `${speaker.name} : “On doit rester lucides…”`,
      `${speaker.name} : “J’ai un mauvais pressentiment sur ${target.name}.”`,
      `${speaker.name} : “Pourquoi ${target.name} parle si peu ?”`,
      `${speaker.name} : “Hier, ${target.name} accusait trop vite.”`,
      `${speaker.name} : “On manque d’indices…”`,
      `${speaker.name} : “Le loup essaie de se fondre.”`,
    ];

    logLine(lines[Math.floor(Game.rng() * lines.length)]);
  }

  // =========================
  // 8) PHASE RENDER
  // =========================
  function renderPhase() {
    if (Game.uiMode !== MODE.GAME && Game.uiMode !== MODE.REVEAL) return;

    const you = getYou();

    if (Game.uiMode === MODE.REVEAL) {
      renderReveal();
      return;
    }

    if (Game.phase === PHASE.NIGHT) {
      setTopBar("Nuit", "Le village dort. Le Loup-Garou agit.");
      clearActions();

      if (!you.alive) {
        const c = makeActionCard("Tu es mort.", "Observe jusqu’à la fin.");
        c.btns.innerHTML = "";
        renderPlayerList({ showButtons: false });
        return;
      }

      if (you.role === ROLE.WOLF) {
        const c = makeActionCard("Choisis une victime", "Clique sur un joueur vivant (pas toi).");
        renderPlayerList({
          showButtons: true,
          buttonLabel: "Tuer",
          disablePickSelf: true,
          disableDead: true,
          onPick: (id) => {
            Game.wolfTargetId = id;
            logLine("Tu as choisi une victime.", true);
          }
        });

        const confirm = document.createElement("button");
        confirm.className = "btn primary";
        confirm.textContent = "Confirmer (fin de nuit)";
        confirm.addEventListener("click", () => {
          Game.phaseEndsAt = nowMs(); // force end
        });
        c.btns.appendChild(confirm);

      } else {
        const c = makeActionCard("Tu dors…", "Attend le matin.");
        c.btns.innerHTML = "";
        renderPlayerList({ showButtons: false });
      }

      return;
    }

    if (Game.phase === PHASE.DAY_TALK) {
      setTopBar("Jour – Discussion", "Écoute les débats, puis vote.");
      clearActions();

      const c = makeActionCard("Discussion", "Le vote arrive bientôt.");
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Passer au vote";
      btn.addEventListener("click", () => { Game.phaseEndsAt = nowMs(); });
      c.btns.appendChild(btn);

      renderPlayerList({ showButtons: false });
      return;
    }

    if (Game.phase === PHASE.DAY_VOTE) {
      setTopBar("Jour – Vote", "Choisis qui éliminer.");
      clearActions();

      if (!you.alive) {
        const c = makeActionCard("Tu es mort.", "Tu ne votes plus.");
        c.btns.innerHTML = "";
        renderPlayerList({ showButtons: false });
        return;
      }

      const c = makeActionCard("Vote", "Clique sur un joueur vivant (pas toi).");
      renderPlayerList({
        showButtons: true,
        buttonLabel: "Voter",
        disablePickSelf: true,
        disableDead: true,
        onPick: (id) => {
          Game.voteTargetId = id;
          const p = Game.players.find(x => x.id === id);
          logLine(`Tu votes contre ${p.name}.`, true);
        }
      });

      const confirm = document.createElement("button");
      confirm.className = "btn primary";
      confirm.textContent = "Confirmer vote";
      confirm.addEventListener("click", () => { Game.phaseEndsAt = nowMs(); });
      c.btns.appendChild(confirm);

      return;
    }

    if (Game.phase === PHASE.HUNTER_SHOT) {
      setTopBar("Chasseur", "Dernière action : tirer.");
      clearActions();

      // Si le joueur n’est pas le chasseur mort, on laisse le bot décider rapidement
      const youHunter = (Game.hunterShooterId === Game.youId);

      const c = makeActionCard("Tir du Chasseur", youHunter ? "Choisis une cible." : "Le Chasseur choisit…");
      if (youHunter) {
        renderPlayerList({
          showButtons: true,
          buttonLabel: "Tirer",
          disablePickSelf: true,
          disableDead: true,
          onPick: (id) => {
            Game.voteTargetId = id; // réutilisé
            const p = Game.players.find(x => x.id === id);
            logLine(`Tu vises ${p.name}.`, true);
          }
        });

        const confirm = document.createElement("button");
        confirm.className = "btn primary";
        confirm.textContent = "Tirer";
        confirm.addEventListener("click", () => { Game.phaseEndsAt = nowMs(); });
        c.btns.appendChild(confirm);
      } else {
        renderPlayerList({ showButtons: false });
      }
      return;
    }
  }

  // =========================
  // 9) INPUT (Escape pause)
  // =========================
  const keyDown = Object.create(null);
  const pressed = Object.create(null);

  window.addEventListener("keydown", (e) => {
    if (!keyDown[e.code]) pressed[e.code] = true;
    keyDown[e.code] = true;
  });
  window.addEventListener("keyup", (e) => { keyDown[e.code] = false; });

  function wasPressed(code) {
    if (pressed[code]) { pressed[code] = false; return true; }
    return false;
  }

  function togglePause() {
    if (Game.uiMode === MODE.GAME) {
      Game.uiMode = MODE.PAUSE;
      showScreen("pause");
      return;
    }
    if (Game.uiMode === MODE.PAUSE) {
      Game.uiMode = MODE.GAME;
      showScreen("game");
      renderPhase();
      return;
    }
  }

  // =========================
  // 10) MAIN LOOP / PHASE TIMER
  // =========================
  const clock = new THREE.Clock();

  let fpsAcc = 0, fpsCount = 0;
  function updateFPS(dt) {
    if (!OPT.showFPS) return;
    fpsAcc += dt; fpsCount++;
    if (fpsAcc >= 0.35) {
      fpsText.textContent = String(Math.round(fpsCount / fpsAcc));
      fpsAcc = 0; fpsCount = 0;
    }
  }

  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    renderBG(dt);
    updateFPS(dt);

    if (wasPressed("Escape")) {
      if (Game.uiMode === MODE.GAME || Game.uiMode === MODE.PAUSE) togglePause();
    }

    if (Game.uiMode === MODE.GAME) {
      updateTimerUI();

      if (Game.phase === PHASE.DAY_TALK) updateDiscussion(dt);

      // phase auto end
      if (nowMs() >= Game.phaseEndsAt) {
        if (Game.phase === PHASE.NIGHT) resolveNight();
        else if (Game.phase === PHASE.DAY_TALK) goToDayVote();
        else if (Game.phase === PHASE.DAY_VOTE) resolveVote();
        else if (Game.phase === PHASE.HUNTER_SHOT) {
          resolveHunterShot();
          if (Game.uiMode === MODE.GAME) renderPhase();
        }
      }
    }

    // Debug info
    setDebug(
      `<b>Debug</b><br>` +
      `seed: ${Game.seed}<br>` +
      `phase: ${Game.phase}<br>` +
      `alive: ${alivePlayers().length}<br>` +
      (DEBUG ? `<span style="opacity:.9">roles: ${Game.players.map(p => `${p.name}=${p.role[0]}`).join(" • ")}</span>` : "")
    );

    requestAnimationFrame(tick);
  }

  // =========================
  // 11) BUTTONS
  // =========================
  QS("#btnPlay").addEventListener("click", () => { Game.uiMode = MODE.SETUP; showScreen("setup"); });
  QS("#btnOptionsMain").addEventListener("click", () => { Game.uiMode = MODE.OPTIONS; showScreen("options"); syncOptionsToUI(); });
  QS("#btnQuit").addEventListener("click", () => { Game.uiMode = MODE.MAIN; showScreen("main"); });

  QS("#btnBackMain").addEventListener("click", () => { Game.uiMode = MODE.MAIN; showScreen("main"); });

  QS("#btnSaveOptions").addEventListener("click", () => {
    syncOptionsFromUI();
    saveOptions(OPT);
    fpsWrap.classList.toggle("hidden", !OPT.showFPS);
    Game.uiMode = MODE.MAIN;
    showScreen("main");
  });
  QS("#btnBackFromOptions").addEventListener("click", () => { Game.uiMode = MODE.MAIN; showScreen("main"); });

  QS("#btnPause").addEventListener("click", () => {
    if (Game.uiMode === MODE.GAME) togglePause();
  });
  QS("#btnResume").addEventListener("click", () => togglePause());
  QS("#btnOptionsPause").addEventListener("click", () => { Game.uiMode = MODE.OPTIONS; showScreen("options"); syncOptionsToUI(); });
  QS("#btnToMenu").addEventListener("click", () => { Game.uiMode = MODE.MAIN; showScreen("main"); });

  QS("#btnReplay").addEventListener("click", () => { Game.uiMode = MODE.SETUP; showScreen("setup"); });
  QS("#btnGoMenu").addEventListener("click", () => { Game.uiMode = MODE.MAIN; showScreen("main"); });

  QS("#btnReady").addEventListener("click", () => {
    Game.uiMode = MODE.GAME;
    showScreen("game");
    renderPhase();
    goToNight();
  });

  // Setup UI: player count
  const playerCount = QS("#playerCount");
  const playerCountText = QS("#playerCountText");
  playerCount.value = "8";
  function updatePlayerCountText() {
    playerCountText.textContent = `${playerCount.value} joueurs (1 Loup-Garou, ${QS("#optHunter").checked ? "1 Chasseur" : "0 Chasseur"})`;
  }
  playerCount.addEventListener("input", updatePlayerCountText);
  QS("#optHunter").addEventListener("change", updatePlayerCountText);
  updatePlayerCountText();

  QS("#btnStart").addEventListener("click", () => {
    const youName = (QS("#youName").value || "").trim() || "Toi";
    const count = Number(playerCount.value);
    const difficulty = QS("#difficulty").value;
    const hunterEnabled = QS("#optHunter").checked;

    startNewGame({ youName, count, difficulty, hunterEnabled });
  });

  // =========================
  // 12) RESIZE
  // =========================
  window.addEventListener("resize", () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  });

  // =========================
  // BOOT
  // =========================
  syncOptionsToUI();
  fpsWrap.classList.toggle("hidden", !OPT.showFPS);

  Game.uiMode = MODE.MAIN;
  showScreen("main");

  tick();

})();

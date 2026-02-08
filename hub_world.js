<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <title>Salon (Hub) — Monde 3D</title>
  <link rel="icon" href="data:," />
  <style>
    :root{
      --panel: rgba(0,0,0,.45);
      --bd: rgba(255,255,255,.14);
      --txt:#eaeef7;
      --mut: rgba(234,238,247,.72);
      --acc:#7c5cff;
    }
    *{box-sizing:border-box; -webkit-tap-highlight-color: transparent;}
    html,body{height:100%}
    body{margin:0; overflow:hidden; background:#07090d; color:var(--txt); font-family:system-ui,Segoe UI,Arial}
    canvas{display:block}

    .hud{
      position:fixed; left:12px; top:12px;
      width:min(360px, calc(100vw - 24px));
      background:var(--panel);
      border:1px solid var(--bd);
      border-radius:18px;
      padding:12px;
      backdrop-filter: blur(8px);
      user-select:none;
    }
    .row{display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between}
    .title{font-weight:950; font-size:14px}
    .mut{color:var(--mut); font-size:12px; line-height:1.35}
    .btn{
      border:1px solid var(--bd);
      background:rgba(255,255,255,.06);
      color:var(--txt);
      padding:10px 12px;
      border-radius:14px;
      cursor:pointer;
      font-weight:900;
      user-select:none;
    }
    .btn.acc{border-color: rgba(124,92,255,.55); background: rgba(124,92,255,.14)}
    .kbd{display:inline-block; padding:2px 8px; border:1px solid rgba(255,255,255,.16); border-radius:10px; background:rgba(255,255,255,.04); color:var(--txt); font-weight:800; font-size:12px}

    .joyWrap{ position:fixed; inset:0; pointer-events:none; }
    .joyLeftZone{
      position:fixed; left:0; bottom:0;
      width:50vw; height:55vh;
      pointer-events:auto;
    }
    .lookRightZone{
      position:fixed; right:0; bottom:0;
      width:50vw; height:55vh;
      pointer-events:auto;
    }
    .joy{
      position:absolute; left:18px; bottom:18px;
      width:140px; height:140px; border-radius:999px;
      background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.14);
      backdrop-filter: blur(6px);
      pointer-events:none;
    }
    .joy .knob{
      position:absolute; left:50%; top:50%;
      width:54px; height:54px; border-radius:999px;
      transform: translate(-50%,-50%);
      background:rgba(124,92,255,.35);
      border:1px solid rgba(124,92,255,.55);
    }
    .hidden{display:none !important}
  </style>
</head>

<body>
  <div class="hud">
    <div class="row">
      <div>
        <div class="title">Salon (Hub) — Monde 3D (local)</div>
        <div class="mut">Déplacement: <span class="kbd">ZQSD</span> / <span class="kbd">←↑↓→</span> · Joysticks: <span class="kbd">J</span></div>
      </div>
      <button id="btnJoy" class="btn acc">👁 Joysticks</button>
    </div>
    <div class="mut" style="margin-top:10px">
      Caméra: glisser sur la scène (souris) · Mobile: joystick gauche = bouger, glisser à droite = tourner.
    </div>
  </div>

  <div class="joyWrap" id="joyWrap">
    <div class="joyLeftZone" id="joyLeftZone">
      <div class="joy">
        <div class="knob" id="joyLeftKnob"></div>
      </div>
    </div>
    <div class="lookRightZone" id="lookRightZone"></div>
  </div>

  <script src="three.min.js"></script>
  <script src="hub_world.js"></script>
</body>
</html>

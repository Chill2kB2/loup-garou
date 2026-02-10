#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebSocket server for Loup-Garou:
- Room "lg" (default): lobby + party events used by lg.html
- Room "hub": 3D hub presence (positions/orientation + skins)

Protocol (JSON):
Client -> Server:
  {t:"join", name:"Stan"}                         # default room "lg"
  {t:"join", room:"hub", name:"Stan", skin:{...}} # hub
  {t:"ready", ready:true}                         # lg
  {t:"start"}                                     # lg (host only)
  {t:"settings", settings:{...}}                  # lg (host only)
  {t:"chat", text:"..."}                          # lg
  {t:"hub_state", st:{x,y,z,yaw}}                 # hub
  {t:"hub_skin", skin:{model,scale,...}}          # hub
  {t:"leave"}                                     # both (optional)

Server -> Client:
  {t:"welcome", id:<int>, isHost:<bool>, phase:<str>}         # lg
  {t:"lobby", hostId, phase, players:[...], settings:{...}}   # lg
  {t:"log", text, level}                                      # lg
  {t:"chat", from, text}                                      # lg
  {t:"error", text}                                           # both

  {t:"welcome", id:<int>}                                     # hub
  {t:"hub_snapshot", players:[{id,name,skin,st}...]}           # hub
  {t:"hub_join", p:{id,name,skin,st}}                          # hub
  {t:"hub_leave", id, name}                                   # hub
  {t:"hub_state", id, st:{x,y,z,yaw}}                          # hub
  {t:"hub_skin", p:{id,name,skin,st}}                          # hub
"""
import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Any

import websockets
from http import HTTPStatus
from websockets.server import WebSocketServerProtocol

PORT = int(os.getenv("PORT", "8080"))
HOST = os.getenv("HOST", "0.0.0.0")

# -------------------------
# Helpers
# -------------------------

def jdump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

async def ws_send(ws: WebSocketServerProtocol, obj: Any) -> None:
    try:
        await ws.send(jdump(obj))
    except Exception:
        pass

# -------------------------
# State
# -------------------------

_next_id = 1

def new_id() -> int:
    global _next_id
    i = _next_id
    _next_id += 1
    return i

@dataclass
class Client:
    id: int
    ws: WebSocketServerProtocol
    room: str
    name: str = "Joueur"
    joined_at: float = field(default_factory=time.time)

    # lobby
    ready: bool = False

    # hub
    skin: dict = field(default_factory=dict)
    st: dict = field(default_factory=lambda: {"x": 0, "y": 0, "z": 0, "yaw": 0})
    last_hub_update: float = field(default_factory=time.time)

clients_by_ws: Dict[WebSocketServerProtocol, Client] = {}

# Room maps: room -> {id -> Client}
rooms: Dict[str, Dict[int, Client]] = {"lg": {}, "hub": {}}

# Lobby (lg) room state
lg_phase = "LOBBY"  # or "GAME"
lg_host_id: Optional[int] = None
lg_settings: Dict[str, Any] = {
    "minPlayers": 4,
}

# -------------------------
# Broadcast utilities
# -------------------------

async def broadcast(room: str, obj: Any, exclude_id: Optional[int] = None) -> None:
    rs = rooms.get(room, {})
    if not rs:
        return
    msg = jdump(obj)
    coros = []
    for cid, c in list(rs.items()):
        if exclude_id is not None and cid == exclude_id:
            continue
        try:
            coros.append(c.ws.send(msg))
        except Exception:
            continue
    if coros:
        # avoid failing if one send fails
        results = await asyncio.gather(*coros, return_exceptions=True)
        _ = results

def lg_players_payload():
    rs = rooms["lg"]
    return [
        {"id": c.id, "name": c.name, "ready": c.ready}
        for c in sorted(rs.values(), key=lambda x: x.id)
    ]

async def lg_push_state() -> None:
    await broadcast("lg", {
        "t": "lobby",
        "hostId": lg_host_id,
        "phase": lg_phase,
        "players": lg_players_payload(),
        "settings": lg_settings,
    })

def lg_can_start() -> bool:
    rs = rooms["lg"]
    if lg_host_id is None or lg_host_id not in rs:
        return False
    if len(rs) < int(lg_settings.get("minPlayers", 4)):
        return False
    return all(c.ready for c in rs.values())

# -------------------------
# Join / Leave
# -------------------------

async def handle_join(ws: WebSocketServerProtocol, msg: dict) -> Client:
    room = (msg.get("room") or "lg").strip().lower()
    if room not in rooms:
        room = "lg"

    cid = new_id()
    name = (msg.get("name") or "Joueur").strip()[:24] or "Joueur"
    c = Client(id=cid, ws=ws, room=room, name=name)

    clients_by_ws[ws] = c
    rooms[room][cid] = c

    if room == "lg":
        global lg_host_id
        if lg_host_id is None or lg_host_id not in rooms["lg"]:
            lg_host_id = cid

        await ws_send(ws, {"t": "welcome", "id": cid, "isHost": cid == lg_host_id, "phase": lg_phase})
        await broadcast("lg", {"t": "log", "text": f"{name} a rejoint.", "level": "info"})
        await lg_push_state()
        return c

    # hub
    skin = msg.get("skin") or {}
    if isinstance(skin, dict):
        # keep only simple fields
        c.skin = {
            "model": str(skin.get("model") or "humanoid_placeholder"),
            "scale": float(skin.get("scale") or 1.0),
            "hairHue": int(skin.get("hairHue") or 0),
            "eyeHue": int(skin.get("eyeHue") or 200),
        }

    # send welcome + snapshot
    await ws_send(ws, {"t": "welcome", "id": cid})
    snapshot = []
    for other in rooms["hub"].values():
        if other.id == cid:
            continue
        snapshot.append({"id": other.id, "name": other.name, "skin": other.skin, "st": other.st})
    await ws_send(ws, {"t": "hub_snapshot", "players": snapshot})

    # notify others
    await broadcast("hub", {"t": "hub_join", "p": {"id": cid, "name": c.name, "skin": c.skin, "st": c.st}}, exclude_id=cid)
    return c

async def handle_disconnect(ws: WebSocketServerProtocol) -> None:
    c = clients_by_ws.pop(ws, None)
    if not c:
        return

    rs = rooms.get(c.room)
    if rs and c.id in rs:
        del rs[c.id]

    if c.room == "lg":
        global lg_host_id, lg_phase
        # host reassignment
        if lg_host_id == c.id:
            lg_host_id = min(rs.keys(), default=None) if rs else None
            if lg_host_id is None:
                lg_phase = "LOBBY"  # reset if empty
        await broadcast("lg", {"t": "log", "text": f"{c.name} a quitté.", "level": "warn"})
        await lg_push_state()
        return

    # hub
    await broadcast("hub", {"t": "hub_leave", "id": c.id, "name": c.name})

# -------------------------
# Message handlers
# -------------------------

async def handle_lg(c: Client, msg: dict) -> None:
    global lg_phase, lg_settings

    t = msg.get("t")
    if t == "ready":
        c.ready = bool(msg.get("ready", True))
        await lg_push_state()
        return

    if t == "start":
        if c.id != lg_host_id:
            await ws_send(c.ws, {"t": "error", "text": "Seul l'hôte peut démarrer."})
            return
        if not lg_can_start():
            await ws_send(c.ws, {"t": "error", "text": "Pas assez de joueurs prêts."})
            return
        lg_phase = "GAME"
        await broadcast("lg", {"t": "log", "text": "Partie lancée.", "level": "ok"})
        await lg_push_state()
        return

    if t == "settings":
        if c.id != lg_host_id:
            return
        settings = msg.get("settings") or {}
        if isinstance(settings, dict):
            # Only accept safe keys
            if "minPlayers" in settings:
                try:
                    lg_settings["minPlayers"] = int(settings["minPlayers"])
                except Exception:
                    pass
        await lg_push_state()
        return

    if t == "chat":
        text = (msg.get("text") or "").strip()
        if not text:
            return
        text = text[:300]
        await broadcast("lg", {"t": "chat", "from": {"id": c.id, "name": c.name}, "text": text})
        return

    # action / leave / unknown -> ignore (backwards compatible)

async def handle_hub(c: Client, msg: dict) -> None:
    t = msg.get("t")
    if t == "hub_state":
        st = msg.get("st") or {}
        if not isinstance(st, dict):
            return
        # throttle per client (avoid flood)
        now = time.time()
        if now - c.last_hub_update < 1/60:  # cap at ~60Hz inbound
            return
        c.last_hub_update = now

        def clamp(v, lo, hi):
            return max(lo, min(hi, v))

        try:
            x = float(st.get("x", 0))
            y = float(st.get("y", 0))
            z = float(st.get("z", 0))
            yaw = float(st.get("yaw", 0))
        except Exception:
            return

        c.st = {
            "x": clamp(x, -2000, 2000),
            "y": clamp(y, -200, 200),
            "z": clamp(z, -2000, 2000),
            "yaw": yaw,
        }
        await broadcast("hub", {"t": "hub_state", "id": c.id, "st": c.st}, exclude_id=c.id)
        return

    if t == "hub_skin":
        skin = msg.get("skin") or {}
        if isinstance(skin, dict):
            c.skin = {
                "model": str(skin.get("model") or c.skin.get("model") or "humanoid_placeholder"),
                "scale": float(skin.get("scale") or c.skin.get("scale") or 1.0),
                "hairHue": int(skin.get("hairHue") or c.skin.get("hairHue") or 0),
                "eyeHue": int(skin.get("eyeHue") or c.skin.get("eyeHue") or 200),
            }
            await broadcast("hub", {"t": "hub_skin", "p": {"id": c.id, "name": c.name, "skin": c.skin, "st": c.st}}, exclude_id=c.id)
        return

# -------------------------
# Main connection loop
# -------------------------

async def handler(ws: WebSocketServerProtocol):
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue

            c = clients_by_ws.get(ws)
            if c is None:
                # only join allowed before being in a room
                if msg.get("t") != "join":
                    await ws_send(ws, {"t": "error", "text": "Veuillez envoyer {t:'join'} d'abord."})
                    continue
                await handle_join(ws, msg)
                continue

            # optional leave
            if msg.get("t") == "leave":
                try:
                    await ws.close()
                except Exception:
                    pass
                break

            if c.room == "lg":
                await handle_lg(c, msg)
            else:
                await handle_hub(c, msg)

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await handle_disconnect(ws)

async def process_request(path, request_headers):
    """Render health check support.
    Render hits http://<service>:<port>/health expecting 200.
    websockets can serve plain HTTP responses via process_request.
    """
    if path == "/health" or path == "/":
        body = b"ok"
        headers = [
            ("Content-Type", "text/plain; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
        ]
        return HTTPStatus.OK, headers, body
    return None


async def main():
    print(f"WS server on ws://{HOST}:{PORT}/ws")
    async with websockets.serve(handler, HOST, PORT, process_request=process_request, ping_interval=20, ping_timeout=20, max_size=2_000_000):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Loup-Garou WebSocket server (Render-friendly)

- HTTP: GET/HEAD /health  -> 200 "ok" (Render health checks may use HEAD)
- WS:   /ws               -> JSON protocol for:
          room "lg"  (default): lobby + party
          room "hub": 3D hub presence (positions/orientation + skins)

Designed to be stable on Render.
"""

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from aiohttp import web, WSMsgType

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "10000"))


def jdump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


@dataclass
class Conn:
    ws: web.WebSocketResponse
    id: int
    room: str = "lg"
    name: str = "Player"
    ready: bool = False
    skin: Dict[str, Any] = field(default_factory=dict)
    st: Dict[str, Any] = field(default_factory=dict)  # hub state {x,y,z,yaw,pitch,...}
    last_seen: float = field(default_factory=lambda: time.time())


class State:
    def __init__(self) -> None:
        self.next_id = 1
        self.conns: Dict[int, Conn] = {}
        self.lock = asyncio.Lock()

        # Lobby ("lg") state
        self.lg_phase: str = "lobby"
        self.lg_settings: Dict[str, Any] = {}
        self.lg_host_id: Optional[int] = None

    def alloc_id(self) -> int:
        i = self.next_id
        self.next_id += 1
        return i


STATE = State()


async def ws_send(ws: web.WebSocketResponse, obj: Any) -> None:
    if ws.closed:
        return
    try:
        await ws.send_str(jdump(obj))
    except Exception:
        pass


async def broadcast(room: str, obj: Any, exclude_id: Optional[int] = None) -> None:
    conns = list(STATE.conns.values())
    msg = jdump(obj)
    for c in conns:
        if c.room != room:
            continue
        if exclude_id is not None and c.id == exclude_id:
            continue
        if c.ws.closed:
            continue
        try:
            await c.ws.send_str(msg)
        except Exception:
            pass


def lg_players_snapshot() -> list:
    players = []
    for c in STATE.conns.values():
        if c.room != "lg":
            continue
        players.append({"id": c.id, "name": c.name, "ready": bool(c.ready)})
    players.sort(key=lambda p: p["id"])
    return players


async def lg_broadcast_lobby() -> None:
    await broadcast(
        "lg",
        {
            "t": "lobby",
            "hostId": STATE.lg_host_id,
            "phase": STATE.lg_phase,
            "players": lg_players_snapshot(),
            "settings": STATE.lg_settings,
        },
    )


def hub_players_snapshot() -> list:
    ps = []
    for c in STATE.conns.values():
        if c.room != "hub":
            continue
        ps.append({"id": c.id, "name": c.name, "skin": c.skin, "st": c.st})
    ps.sort(key=lambda p: p["id"])
    return ps


async def handle_join(conn: Conn, data: Dict[str, Any]) -> None:
    room = str(data.get("room") or "lg")
    if room not in ("lg", "hub"):
        room = "lg"

    conn.room = room
    conn.name = str(data.get("name") or conn.name)[:32]
    if isinstance(data.get("skin"), dict):
        conn.skin = data["skin"]

    # optional initial state (avoid everyone spawning at 0,0,0)
    st = data.get("st")
    if isinstance(st, dict):
        def fnum(v, d=0.0):
            try:
                return float(v)
            except Exception:
                return float(d)
        conn.st = {
            "x": fnum(st.get("x"), 0.0),
            "y": fnum(st.get("y"), 0.0),
            "z": fnum(st.get("z"), 0.0),
            "yaw": fnum(st.get("yaw"), 0.0),
        }


    if room == "lg":
        if STATE.lg_host_id is None or STATE.lg_host_id not in STATE.conns:
            STATE.lg_host_id = conn.id
        is_host = conn.id == STATE.lg_host_id
        await ws_send(conn.ws, {"t": "welcome", "id": conn.id, "isHost": is_host, "phase": STATE.lg_phase})
        await lg_broadcast_lobby()
        await broadcast("lg", {"t": "log", "text": f"{conn.name} a rejoint.", "level": "info"})
    else:
        await ws_send(conn.ws, {"t": "welcome", "id": conn.id})
        await ws_send(conn.ws, {"t": "hub_welcome", "id": conn.id})
        await ws_send(conn.ws, {"t": "hub_snapshot", "players": hub_players_snapshot()})
        await broadcast("hub", {"t": "hub_join", "p": {"id": conn.id, "name": conn.name, "skin": conn.skin, "st": conn.st}}, exclude_id=conn.id)


async def handle_lg_ready(conn: Conn, data: Dict[str, Any]) -> None:
    conn.ready = bool(data.get("ready"))
    await lg_broadcast_lobby()


async def handle_lg_start(conn: Conn, data: Dict[str, Any]) -> None:
    if conn.id != STATE.lg_host_id:
        await ws_send(conn.ws, {"t": "error", "text": "Seul l'hôte peut démarrer."})
        return
    STATE.lg_phase = "started"
    await lg_broadcast_lobby()
    await broadcast("lg", {"t": "log", "text": "La partie démarre.", "level": "info"})


async def handle_lg_settings(conn: Conn, data: Dict[str, Any]) -> None:
    if conn.id != STATE.lg_host_id:
        await ws_send(conn.ws, {"t": "error", "text": "Seul l'hôte peut changer les paramètres."})
        return
    settings = data.get("settings")
    if isinstance(settings, dict):
        STATE.lg_settings = settings
    await lg_broadcast_lobby()


async def handle_chat(conn: Conn, data: Dict[str, Any]) -> None:
    text = str(data.get("text") or "")[:500]
    if not text.strip():
        return
    await broadcast(conn.room, {"t": "chat", "from": conn.name, "text": text})


async def handle_hub_state(conn: Conn, data: Dict[str, Any]) -> None:
    st = data.get("st")
    if not isinstance(st, dict):
        return
    conn.st = dict(st)
    conn.last_seen = time.time()
    await broadcast("hub", {"t": "hub_state", "id": conn.id, "st": conn.st}, exclude_id=conn.id)


async def handle_hub_skin(conn: Conn, data: Dict[str, Any]) -> None:
    skin = data.get("skin")
    if not isinstance(skin, dict):
        return
    conn.skin = dict(skin)
    await broadcast("hub", {"t": "hub_skin", "p": {"id": conn.id, "name": conn.name, "skin": conn.skin, "st": conn.st}}, exclude_id=conn.id)


async def disconnect(conn: Conn) -> None:
    async with STATE.lock:
        STATE.conns.pop(conn.id, None)
        if conn.id == STATE.lg_host_id:
            lg_ids = sorted([c.id for c in STATE.conns.values() if c.room == "lg"])
            STATE.lg_host_id = lg_ids[0] if lg_ids else None

    if conn.room == "lg":
        await broadcast("lg", {"t": "log", "text": f"{conn.name} a quitté.", "level": "info"})
        await lg_broadcast_lobby()
    else:
        await broadcast("hub", {"t": "hub_leave", "id": conn.id, "name": conn.name})


async def ws_endpoint(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)

    async with STATE.lock:
        cid = STATE.alloc_id()
        conn = Conn(ws=ws, id=cid)
        STATE.conns[cid] = conn

    await ws_send(ws, {"t": "hello", "id": conn.id})

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            t = str(data.get("t") or "")
            if not t:
                continue

            if t == "join":
                await handle_join(conn, data)
            elif t == "ready" and conn.room == "lg":
                await handle_lg_ready(conn, data)
            elif t == "start" and conn.room == "lg":
                await handle_lg_start(conn, data)
            elif t == "settings" and conn.room == "lg":
                await handle_lg_settings(conn, data)
            elif t == "chat":
                await handle_chat(conn, data)
            elif t == "hub_state" and conn.room == "hub":
                await handle_hub_state(conn, data)
            elif t == "hub_skin" and conn.room == "hub":
                await handle_hub_skin(conn, data)
            elif t == "leave":
                break
            else:
                pass
    finally:
        await disconnect(conn)
        await ws.close()

    return ws


async def health(_: web.Request) -> web.Response:
    return web.Response(text="ok", content_type="text/plain")


def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", health)         # add_get also registers HEAD by default
    app.router.add_get("/health", health)   # Render health checks
    app.router.add_get("/ws", ws_endpoint)  # websocket endpoint
    return app


def main() -> None:
    app = create_app()
    print(f"HTTP+WS on http://{HOST}:{PORT}   (WS: /ws)")
    web.run_app(app, host=HOST, port=PORT, access_log=None)


if __name__ == "__main__":
    main()

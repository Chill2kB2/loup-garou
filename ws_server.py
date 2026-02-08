import asyncio
import json
import os
import random
import time
from dataclasses import dataclass, field
from http import HTTPStatus

import websockets

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8765"))

ROLE_CITIZEN = "Citoyen"
ROLE_WOLF = "Loup-Garou"
ROLE_HUNTER = "Chasseur"

PHASE_LOBBY = "LOBBY"
PHASE_REVEAL = "REVEAL"
PHASE_NIGHT = "NIGHT"
PHASE_DAY_TALK = "DAY_TALK"
PHASE_DAY_VOTE = "DAY_VOTE"
PHASE_HUNTER_SHOT = "HUNTER_SHOT"
PHASE_GAMEOVER = "GAMEOVER"


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Player:
    id: int
    ws: any
    name: str = "Joueur"
    ready: bool = False
    role: str = ROLE_CITIZEN
    alive: bool = True
    hunter_shot_used: bool = False


@dataclass
class Room:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    players: dict[int, Player] = field(default_factory=dict)
    host_id: int = -1

    phase: str = PHASE_LOBBY
    day: int = 1
    ends_at: int = 0

    hunter_enabled: bool = True
    wolf_target_id: int = -1
    votes: dict[int, int] = field(default_factory=dict)

    hunter_shooter_id: int = -1
    pending_after_phase: str = ""
    pending_after_day: int = 1

    seed: int = 0
    rng: random.Random = field(default_factory=random.Random)

    def get_player(self, pid: int):
        return self.players.get(pid)

    def alive_players(self):
        return [p for p in self.players.values() if p.alive]

    def wolves_alive(self):
        return [p for p in self.players.values() if p.alive and p.role == ROLE_WOLF]

    def check_win(self):
        wolves = len(self.wolves_alive())
        alive = len(self.alive_players())

        if self.phase == PHASE_GAMEOVER:
            return True, "", ""

        if wolves == 0:
            return True, "Victoire des Citoyens", "Le Loup-Garou a été éliminé."
        if alive <= 2 and wolves == 1:
            return True, "Victoire du Loup-Garou", "Il ne reste plus que 2 survivants."
        return False, "", ""


ROOM = Room()
NEXT_ID = 1


async def send(ws, obj):
    try:
        await ws.send(json.dumps(obj, ensure_ascii=False))
    except Exception:
        pass


async def broadcast(obj):
    for p in list(ROOM.players.values()):
        await send(p.ws, obj)


async def broadcast_lobby():
    players = [{
        "id": p.id,
        "name": p.name,
        "ready": p.ready
    } for p in ROOM.players.values()]

    await broadcast({
        "t": "lobby",
        "hostId": ROOM.host_id,
        "phase": ROOM.phase,
        "players": players,
        "hunterEnabled": ROOM.hunter_enabled
    })


async def broadcast_state(ends_in_ms: int | None = None):
    players_pub = [{
        "id": p.id,
        "name": p.name,
        "alive": p.alive
    } for p in ROOM.players.values()]

    payload = {
        "t": "state",
        "phase": ROOM.phase,
        "day": ROOM.day,
        "players": players_pub,
        "hunterShooterId": ROOM.hunter_shooter_id,
        "endsInMs": 0
    }

    if ends_in_ms is None:
        payload["endsInMs"] = max(0, ROOM.ends_at - now_ms()) if ROOM.ends_at > 0 else 0
    else:
        payload["endsInMs"] = max(0, ends_in_ms)

    await broadcast(payload)


async def log(text: str, emph: bool = False):
    await broadcast({"t": "log", "text": text, "emph": emph})


def pick_random_alive_except(exclude_id: int) -> int:
    alive = [p.id for p in ROOM.players.values() if p.alive and p.id != exclude_id]
    return ROOM.rng.choice(alive) if alive else -1


async def kill_player(pid: int, reason: str):
    p = ROOM.get_player(pid)
    if not p or not p.alive:
        return

    p.alive = False
    await log(reason, emph=True)

    if p.role == ROLE_HUNTER and not p.hunter_shot_used:
        ROOM.phase = PHASE_HUNTER_SHOT
        ROOM.ends_at = now_ms() + 15000
        ROOM.hunter_shooter_id = p.id
        await log("Le Chasseur peut tirer une dernière fois…", emph=True)
        await broadcast_state()


async def start_game():
    plist = list(ROOM.players.values())
    if len(plist) < 5:
        await log("Impossible: minimum 5 joueurs.", emph=True)
        return
    if not all(p.ready for p in plist):
        await log("Impossible: tous les joueurs doivent être 'Prêts'.", emph=True)
        return

    ROOM.seed = (now_ms() ^ (len(plist) * 2654435761)) & 0xFFFFFFFF
    ROOM.rng = random.Random(ROOM.seed)

    ROOM.day = 1
    ROOM.phase = PHASE_REVEAL
    ROOM.ends_at = now_ms() + 12000

    ROOM.wolf_target_id = -1
    ROOM.votes = {}
    ROOM.hunter_shooter_id = -1
    ROOM.pending_after_phase = ""
    ROOM.pending_after_day = 1

    for p in ROOM.players.values():
        p.alive = True
        p.hunter_shot_used = False
        p.role = ROLE_CITIZEN

    ids = [p.id for p in ROOM.players.values()]
    ROOM.rng.shuffle(ids)

    wolf_id = ids[0]
    ROOM.get_player(wolf_id).role = ROLE_WOLF

    if ROOM.hunter_enabled and len(ids) >= 5:
        hunter_id = ids[1]
        if hunter_id != wolf_id:
            ROOM.get_player(hunter_id).role = ROLE_HUNTER

    for p in ROOM.players.values():
        await send(p.ws, {"t": "private", "id": p.id, "role": p.role, "seed": ROOM.seed})

    await log("La partie commence… Mémorisez votre rôle.", emph=True)
    await broadcast_state()


async def advance_from_reveal():
    ROOM.phase = PHASE_NIGHT
    ROOM.ends_at = now_ms() + 20000
    ROOM.wolf_target_id = -1
    await log(f"Nuit {ROOM.day}… Le village s’endort.", emph=True)
    await broadcast_state()


async def resolve_night():
    wolves = ROOM.wolves_alive()
    if not wolves:
        return

    wolf = wolves[0]
    target = ROOM.wolf_target_id
    if target < 0:
        target = pick_random_alive_except(wolf.id)

    if target >= 0:
        await kill_player(target, "Pendant la nuit, une attaque a eu lieu…")

        won, title, sub = ROOM.check_win()
        if won:
            ROOM.phase = PHASE_GAMEOVER
            await broadcast({"t": "gameover", "title": title, "sub": sub})
            await broadcast_state(0)
            return

        if ROOM.phase == PHASE_HUNTER_SHOT:
            ROOM.pending_after_phase = PHASE_DAY_TALK
            ROOM.pending_after_day = ROOM.day
            await broadcast_state()
            return

        victim = ROOM.get_player(target)
        vname = victim.name if victim else "Quelqu’un"
        ROOM.phase = PHASE_DAY_TALK
        ROOM.ends_at = now_ms() + 22000
        await log(f"Au matin… {vname} a été retrouvé(e) mort(e).", emph=True)
        await broadcast_state()
        return

    ROOM.phase = PHASE_DAY_TALK
    ROOM.ends_at = now_ms() + 22000
    await log("Au matin… personne n’est mort cette nuit.", emph=True)
    await broadcast_state()


async def advance_to_vote():
    ROOM.phase = PHASE_DAY_VOTE
    ROOM.ends_at = now_ms() + 20000
    ROOM.votes = {}
    await log("C’est l’heure du vote.", emph=True)
    await broadcast_state()


async def resolve_vote():
    alive = ROOM.alive_players()
    if len(alive) <= 1:
        return

    alive_ids = [p.id for p in alive]
    for p in alive:
        if p.id not in ROOM.votes:
            choices = [x for x in alive_ids if x != p.id]
            if choices:
                ROOM.votes[p.id] = ROOM.rng.choice(choices)

    tally: dict[int, int] = {}
    for _, target in ROOM.votes.items():
        if target in alive_ids:
            tally[target] = tally.get(target, 0) + 1

    if not tally:
        await log("Vote sans résultat.", emph=True)
        ROOM.day += 1
        ROOM.phase = PHASE_NIGHT
        ROOM.ends_at = now_ms() + 20000
        await broadcast_state()
        return

    maxv = max(tally.values())
    top = [tid for tid, c in tally.items() if c == maxv]
    eliminated = ROOM.rng.choice(top)

    tp = ROOM.get_player(eliminated)
    tname = tp.name if tp else "Quelqu’un"
    await log(f"Résultat du vote : {tname} est éliminé(e).", emph=True)

    await kill_player(eliminated, f"{tname} est mort(e) suite au vote.")

    won, title, sub = ROOM.check_win()
    if won:
        ROOM.phase = PHASE_GAMEOVER
        await broadcast({"t": "gameover", "title": title, "sub": sub})
        await broadcast_state(0)
        return

    if ROOM.phase == PHASE_HUNTER_SHOT:
        ROOM.pending_after_phase = PHASE_NIGHT
        ROOM.pending_after_day = ROOM.day + 1
        await broadcast_state()
        return

    ROOM.day += 1
    ROOM.phase = PHASE_NIGHT
    ROOM.ends_at = now_ms() + 20000
    await broadcast_state()


async def resolve_hunter_shot(selected_target: int | None):
    shooter = ROOM.get_player(ROOM.hunter_shooter_id)
    if shooter:
        shooter.hunter_shot_used = True

    target = selected_target if selected_target is not None else -1
    if target < 0:
        target = pick_random_alive_except(ROOM.hunter_shooter_id)

    if target >= 0:
        tp = ROOM.get_player(target)
        tname = tp.name if tp else "Quelqu’un"
        await log(f"Le Chasseur tire… {tname} tombe.", emph=True)
        await kill_player(target, f"{tname} a été abattu(e) par le Chasseur.")

    won, title, sub = ROOM.check_win()
    if won:
        ROOM.phase = PHASE_GAMEOVER
        await broadcast({"t": "gameover", "title": title, "sub": sub})
        await broadcast_state(0)
        return

    ROOM.day = ROOM.pending_after_day
    nextp = ROOM.pending_after_phase or PHASE_NIGHT
    ROOM.pending_after_phase = ""
    ROOM.pending_after_day = ROOM.day
    ROOM.hunter_shooter_id = -1

    if nextp == PHASE_DAY_TALK:
        ROOM.phase = PHASE_DAY_TALK
        ROOM.ends_at = now_ms() + 22000
    else:
        ROOM.phase = PHASE_NIGHT
        ROOM.ends_at = now_ms() + 20000

    await broadcast_state()


async def timer_loop():
    while True:
        await asyncio.sleep(0.25)
        async with ROOM.lock:
            if ROOM.phase in (PHASE_LOBBY, PHASE_GAMEOVER):
                continue
            if ROOM.ends_at <= 0 or now_ms() < ROOM.ends_at:
                continue

            if ROOM.phase == PHASE_REVEAL:
                await advance_from_reveal()
            elif ROOM.phase == PHASE_NIGHT:
                await resolve_night()
            elif ROOM.phase == PHASE_DAY_TALK:
                await advance_to_vote()
            elif ROOM.phase == PHASE_DAY_VOTE:
                await resolve_vote()
            elif ROOM.phase == PHASE_HUNTER_SHOT:
                await resolve_hunter_shot(None)


def process_request(path, request_headers):
    # Réponses HTTP normales (Render healthcheck + réveil)
    if path in ("/", "/health"):
        body = b"ok"
        headers = [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))]
        return HTTPStatus.OK, headers, body

    # WebSocket UNIQUEMENT sur /ws
    if path != "/ws":
        body = b"not found"
        headers = [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))]
        return HTTPStatus.NOT_FOUND, headers, body

    return None  # laisse passer la négociation WebSocket


async def handler(ws):
    global NEXT_ID

    async with ROOM.lock:
        pid = NEXT_ID
        NEXT_ID += 1
        p = Player(id=pid, ws=ws, name=f"Joueur {pid}")
        ROOM.players[pid] = p
        if ROOM.host_id < 0:
            ROOM.host_id = pid

        await send(ws, {"t": "welcome", "id": pid, "isHost": (pid == ROOM.host_id), "phase": ROOM.phase})
        await broadcast_lobby()
        await log(f"{p.name} a rejoint le lobby.", emph=False)

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            t = msg.get("t")
            async with ROOM.lock:
                me = ROOM.get_player(pid)
                if not me:
                    continue

                if t == "join":
                    name = (msg.get("name") or "").strip()
                    if 1 <= len(name) <= 18:
                        me.name = name
                    await broadcast_lobby()

                elif t == "ready":
                    me.ready = bool(msg.get("ready"))
                    await broadcast_lobby()

                elif t == "setHunter":
                    if pid == ROOM.host_id and ROOM.phase == PHASE_LOBBY:
                        ROOM.hunter_enabled = bool(msg.get("enabled"))
                        await broadcast_lobby()

                elif t == "start":
                    if pid == ROOM.host_id and ROOM.phase == PHASE_LOBBY:
                        await start_game()

                elif t == "wolfKill":
                    if ROOM.phase == PHASE_NIGHT and me.alive and me.role == ROLE_WOLF:
                        target = int(msg.get("targetId", -1))
                        tp = ROOM.get_player(target)
                        if tp and tp.alive and tp.id != me.id:
                            ROOM.wolf_target_id = tp.id

                elif t == "vote":
                    if ROOM.phase == PHASE_DAY_VOTE and me.alive:
                        target = int(msg.get("targetId", -1))
                        tp = ROOM.get_player(target)
                        if tp and tp.alive and tp.id != me.id:
                            ROOM.votes[me.id] = tp.id

                elif t == "hunterShot":
                    if ROOM.phase == PHASE_HUNTER_SHOT and pid == ROOM.hunter_shooter_id:
                        target = int(msg.get("targetId", -1))
                        tp = ROOM.get_player(target)
                        if tp and tp.alive and tp.id != pid:
                            await resolve_hunter_shot(tp.id)

    finally:
        async with ROOM.lock:
            left = ROOM.players.pop(pid, None)
            if left:
                await log(f"{left.name} a quitté.", emph=False)

            if ROOM.host_id == pid:
                ROOM.host_id = min(ROOM.players.keys(), default=-1)

            await broadcast_lobby()


async def main():
    asyncio.create_task(timer_loop())
    async with websockets.serve(
        handler,
        HOST,
        PORT,
        process_request=process_request,
        ping_interval=20,
        ping_timeout=20,
        origins=None
    ):
        print(f"WS ready on 0.0.0.0:{PORT} (path: /ws)")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

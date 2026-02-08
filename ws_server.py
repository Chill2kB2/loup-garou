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


def clamp_int(v, lo, hi, default):
    try:
        v = int(v)
    except Exception:
        return default
    return max(lo, min(hi, v))


@dataclass
class Settings:
    # Durées en millisecondes
    reveal_ms: int = 12000
    night_ms: int = 20000
    talk_ms: int = 22000
    vote_ms: int = 20000
    hunter_ms: int = 15000

    wolves_count: int = 1  # 1..3 (clamp selon nb joueurs)
    hunter_enabled: bool = True

    def to_public(self):
        return {
            "revealMs": self.reveal_ms,
            "nightMs": self.night_ms,
            "talkMs": self.talk_ms,
            "voteMs": self.vote_ms,
            "hunterMs": self.hunter_ms,
            "wolvesCount": self.wolves_count,
            "hunterEnabled": self.hunter_enabled,
        }


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

    settings: Settings = field(default_factory=Settings)

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
        if self.phase == PHASE_GAMEOVER:
            return True, "", ""

        wolves = len(self.wolves_alive())
        alive = len(self.alive_players())

        # Citoyens gagnent si 0 loup
        if wolves == 0:
            return True, "Victoire des Citoyens", "Tous les Loups-Garous ont été éliminés."

        # Loups gagnent si loups >= autres vivants
        others = alive - wolves
        if wolves >= others:
            return True, "Victoire des Loups-Garous", "Ils sont devenus majoritaires."

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


async def log(text: str, emph: bool = False):
    await broadcast({"t": "log", "text": text, "emph": emph})


def all_ready_min5():
    plist = list(ROOM.players.values())
    if len(plist) < 5:
        return False
    return all(p.ready for p in plist)


async def broadcast_lobby():
    players = [{"id": p.id, "name": p.name, "ready": p.ready} for p in ROOM.players.values()]

    await broadcast({
        "t": "lobby",
        "hostId": ROOM.host_id,
        "phase": ROOM.phase,
        "players": players,
        "settings": ROOM.settings.to_public(),
        "allReady": all_ready_min5(),
        "minPlayers": 5,
    })


async def broadcast_state(ends_in_ms: int | None = None):
    players_pub = [{"id": p.id, "name": p.name, "alive": p.alive} for p in ROOM.players.values()]

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


def pick_random_alive_except(exclude_id: int) -> int:
    alive = [p.id for p in ROOM.players.values() if p.alive and p.id != exclude_id]
    return ROOM.rng.choice(alive) if alive else -1


async def reset_to_lobby(reason: str = "", keep_players: bool = True):
    ROOM.phase = PHASE_LOBBY
    ROOM.day = 1
    ROOM.ends_at = 0

    ROOM.wolf_target_id = -1
    ROOM.votes = {}

    ROOM.hunter_shooter_id = -1
    ROOM.pending_after_phase = ""
    ROOM.pending_after_day = 1

    if keep_players:
        for p in ROOM.players.values():
            p.ready = False
            p.role = ROLE_CITIZEN
            p.alive = True
            p.hunter_shot_used = False

    if reason:
        await log(reason, emph=True)

    await broadcast_lobby()


async def kill_player(pid: int, reason: str):
    p = ROOM.get_player(pid)
    if not p or not p.alive:
        return

    p.alive = False
    await log(reason, emph=True)

    if p.role == ROLE_HUNTER and ROOM.settings.hunter_enabled and not p.hunter_shot_used:
        ROOM.phase = PHASE_HUNTER_SHOT
        ROOM.ends_at = now_ms() + ROOM.settings.hunter_ms
        ROOM.hunter_shooter_id = p.id
        await log("Le Chasseur peut tirer une dernière fois…", emph=True)
        await broadcast_state()


def apply_settings_from_msg(msg: dict):
    s = ROOM.settings

    # Durées : clamp en secondes puis *1000
    reveal_s = clamp_int(msg.get("revealS"), 5, 40, s.reveal_ms // 1000)
    night_s = clamp_int(msg.get("nightS"), 10, 60, s.night_ms // 1000)
    talk_s = clamp_int(msg.get("talkS"), 10, 120, s.talk_ms // 1000)
    vote_s = clamp_int(msg.get("voteS"), 10, 60, s.vote_ms // 1000)
    hunter_s = clamp_int(msg.get("hunterS"), 8, 45, s.hunter_ms // 1000)

    wolves_count = clamp_int(msg.get("wolvesCount"), 1, 3, s.wolves_count)
    hunter_enabled = bool(msg.get("hunterEnabled")) if ("hunterEnabled" in msg) else s.hunter_enabled

    # clamp wolves selon nb joueurs
    n = len(ROOM.players)
    max_wolves = max(1, min(3, n - 2))  # garde au moins 2 non-loups si possible
    wolves_count = max(1, min(max_wolves, wolves_count))

    s.reveal_ms = reveal_s * 1000
    s.night_ms = night_s * 1000
    s.talk_ms = talk_s * 1000
    s.vote_ms = vote_s * 1000
    s.hunter_ms = hunter_s * 1000
    s.wolves_count = wolves_count
    s.hunter_enabled = hunter_enabled


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
    ROOM.ends_at = now_ms() + ROOM.settings.reveal_ms

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

    # Assigner N loups
    wolves_n = max(1, min(ROOM.settings.wolves_count, max(1, len(ids) - 2)))
    wolf_ids = ids[:wolves_n]
    for wid in wolf_ids:
        ROOM.get_player(wid).role = ROLE_WOLF

    # Assigner chasseur (si activé) sur le 1er non-loup dispo
    if ROOM.settings.hunter_enabled and len(ids) >= 5:
        hunter_id = None
        for pid in ids:
            if ROOM.get_player(pid).role != ROLE_WOLF:
                hunter_id = pid
                break
        if hunter_id is not None:
            ROOM.get_player(hunter_id).role = ROLE_HUNTER

    # Envoyer rôle privé
    for p in ROOM.players.values():
        await send(p.ws, {"t": "private", "id": p.id, "role": p.role, "seed": ROOM.seed})

    await log("La partie commence… Mémorisez votre rôle.", emph=True)
    await broadcast_state()


async def advance_from_reveal():
    ROOM.phase = PHASE_NIGHT
    ROOM.ends_at = now_ms() + ROOM.settings.night_ms
    ROOM.wolf_target_id = -1
    await log(f"Nuit {ROOM.day}… Le village s’endort.", emph=True)
    await broadcast_state()


async def resolve_night():
    wolves = ROOM.wolves_alive()
    if not wolves:
        return

    # Si personne n’a ciblé, on choisit au hasard (on exclut un loup au hasard)
    exclude = wolves[0].id
    target = ROOM.wolf_target_id
    if target < 0:
        target = pick_random_alive_except(exclude)

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
        ROOM.ends_at = now_ms() + ROOM.settings.talk_ms
        await log(f"Au matin… {vname} a été retrouvé(e) mort(e).", emph=True)
        await broadcast_state()
        return

    ROOM.phase = PHASE_DAY_TALK
    ROOM.ends_at = now_ms() + ROOM.settings.talk_ms
    await log("Au matin… personne n’est mort cette nuit.", emph=True)
    await broadcast_state()


async def advance_to_vote():
    ROOM.phase = PHASE_DAY_VOTE
    ROOM.ends_at = now_ms() + ROOM.settings.vote_ms
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
        ROOM.ends_at = now_ms() + ROOM.settings.night_ms
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
    ROOM.ends_at = now_ms() + ROOM.settings.night_ms
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
        ROOM.ends_at = now_ms() + ROOM.settings.talk_ms
    else:
        ROOM.phase = PHASE_NIGHT
        ROOM.ends_at = now_ms() + ROOM.settings.night_ms

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
    if path in ("/", "/health"):
        body = b"ok"
        headers = [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))]
        return HTTPStatus.OK, headers, body

    if path != "/ws":
        body = b"not found"
        headers = [("Content-Type", "text/plain"), ("Content-Length", str(len(body)))]
        return HTTPStatus.NOT_FOUND, headers, body

    return None


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

                elif t == "setSettings":
                    # Hôte only + lobby only + (option) uniquement quand all-ready
                    if pid == ROOM.host_id and ROOM.phase == PHASE_LOBBY and all_ready_min5():
                        apply_settings_from_msg(msg)
                        await log("Paramètres de partie mis à jour par l’hôte.", emph=False)
                        await broadcast_lobby()

                elif t == "start":
                    if pid == ROOM.host_id and ROOM.phase == PHASE_LOBBY:
                        await start_game()

                elif t == "backToLobby":
                    if pid == ROOM.host_id:
                        await reset_to_lobby("Retour au lobby.", keep_players=True)

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

            if len(ROOM.players) == 0:
                ROOM.host_id = -1
                await reset_to_lobby("", keep_players=False)
                return

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

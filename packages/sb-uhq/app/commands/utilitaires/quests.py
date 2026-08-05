"""quests — complétion automatique des quêtes Discord.

Port de src/self/commands/utilitaires/quests.js. Endpoints non officiels (voir func/quest_http).
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime

from ...func import quest_http as http
from ...func.client_token import get_token
from ...func.data_path import data_path, read_json, write_json
from ...func.logbus import log, logerr

QUESTS_LOG_FILE = data_path("logs", "quests_history.json")
QUESTS_CONFIG_FILE = data_path("config", "quests.json")

_DEFAULTS = {"enabled": False, "intervalMin": 360}

_task: asyncio.Task | None = None

TASK_NAMES = [
    "WATCH_VIDEO", "PLAY_ON_DESKTOP", "PLAY_ON_XBOX", "PLAY_ON_PLAYSTATION",
    "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "ACHIEVEMENT_IN_ACTIVITY",
]


def load_config() -> dict:
    raw = read_json(QUESTS_CONFIG_FILE, {})
    return {**_DEFAULTS, **(raw or {})}


def save_config(data) -> None:
    write_json(QUESTS_CONFIG_FILE, data)


def load_history() -> list:
    return read_json(QUESTS_LOG_FILE, [])


def save_history(history) -> None:
    write_json(QUESTS_LOG_FILE, history)


def _push_history(entry) -> None:
    history = load_history()
    history.append(entry)
    if len(history) > 50:
        history.pop(0)
    save_history(history)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _expires_ms(quest) -> float:
    try:
        return datetime.fromisoformat(
            quest["config"]["expires_at"].replace("Z", "+00:00")).timestamp() * 1000
    except Exception:
        return 0


def _filter_valid(quests):
    # user_status peut être présent mais null (≠ absent) : (… or {}) est obligatoire,
    # dict.get(k, {}) ne protège pas contre une valeur null.
    return [q for q in quests if (q.get("user_status") or {}).get("enrolled_at")
            and not (q.get("user_status") or {}).get("completed_at")
            and _expires_ms(q) > _now_ms()]


def _filter_enrollable(quests):
    return [q for q in quests if not (q.get("user_status") or {}).get("enrolled_at")
            and not (q.get("user_status") or {}).get("completed_at")
            and _expires_ms(q) > _now_ms()]


def _filter_active(quests):
    return [q for q in quests if _expires_ms(q) > _now_ms()]


def _get_task_name(quest):
    tasks = (quest["config"].get("task_config_v2") or {}).get("tasks") or {}
    for name in TASK_NAMES:
        if tasks.get(name) is not None:
            return name
    return None


async def _do_watch_video(token, quest, on_progress):
    tasks = quest["config"]["task_config_v2"]["tasks"]
    task_name = "WATCH_VIDEO" if tasks.get("WATCH_VIDEO") else "WATCH_VIDEO_ON_MOBILE"
    seconds_needed = tasks[task_name]["target"]
    enrolled_at = datetime.fromisoformat(
        quest["user_status"]["enrolled_at"].replace("Z", "+00:00")).timestamp() * 1000
    seconds_done = ((quest.get("user_status") or {}).get("progress") or {}).get(task_name, {}).get("value", 0)

    max_future, speed, interval = 10, 7, 7
    completed = False
    on_progress(f"[QUESTS] 🎬 {quest['config']['messages']['quest_name']} — vidéo en cours…")

    import random
    while True:
        max_allowed = int((_now_ms() - enrolled_at) / 1000) + max_future
        diff = max_allowed - seconds_done
        timestamp = seconds_done + speed
        if diff >= speed:
            res = await http.post_video_progress(token, quest["id"],
                                                 min(seconds_needed, timestamp + random.random()))
            if res["ok"]:
                completed = res["data"].get("completed_at") is not None
                seconds_done = min(seconds_needed, timestamp)
        if timestamp >= seconds_needed:
            break
        await asyncio.sleep(interval)

    if not completed:
        await http.post_video_progress(token, quest["id"], seconds_needed)
    return {"success": True}


async def _do_play_platform(token, quest, task_name, on_progress):
    seconds_needed = quest["config"]["task_config_v2"]["tasks"][task_name]["target"]
    application_id = quest["config"]["application"]["id"]
    application_name = quest["config"]["application"]["name"]
    interval = 20
    on_progress(f"[QUESTS] 🎮 {quest['config']['messages']['quest_name']} — simulation plateforme…")

    current = quest["user_status"]
    while True:
        done = ((current or {}).get("progress") or {}).get(task_name, {}).get("value", 0)
        if done >= seconds_needed:
            break
        res = await http.post_heartbeat(token, quest["id"],
                                        {"application_id": application_id, "terminal": False})
        if not res["ok"]:
            on_progress(f"[QUESTS] ⚠️ Heartbeat failed ({res['status']})")
            await asyncio.sleep(interval)
            continue
        current = res["data"]
        done = ((current or {}).get("progress") or {}).get(task_name, {}).get("value", 0)
        remaining = -(-(seconds_needed - done) // 60)
        on_progress(f"[QUESTS] 🎮 {application_name} — encore ~{remaining} min")
        if done >= seconds_needed:
            break
        await asyncio.sleep(interval)

    await http.post_heartbeat(token, quest["id"],
                              {"application_id": application_id, "terminal": True})
    return {"success": True}


async def _do_play_activity(token, quest, task_name, on_progress):
    seconds_needed = quest["config"]["task_config_v2"]["tasks"][task_name]["target"]
    application_name = quest["config"]["application"]["name"]
    stream_key = "call:1:1"
    interval = 20
    on_progress(f"[QUESTS] 🎲 {quest['config']['messages']['quest_name']} — simulation activité…")

    current = quest["user_status"]
    while True:
        done = ((current or {}).get("progress") or {}).get(task_name, {}).get("value", 0)
        if done >= seconds_needed:
            break
        res = await http.post_heartbeat(token, quest["id"],
                                        {"stream_key": stream_key, "terminal": False})
        if not res["ok"]:
            on_progress(f"[QUESTS] ⚠️ Heartbeat failed ({res['status']})")
            await asyncio.sleep(interval)
            continue
        current = res["data"]
        done = ((current or {}).get("progress") or {}).get(task_name, {}).get("value", 0)
        remaining = -(-(seconds_needed - done) // 60)
        on_progress(f"[QUESTS] 🎲 {application_name} — encore ~{remaining} min")
        if done >= seconds_needed:
            break
        await asyncio.sleep(interval)

    await http.post_heartbeat(token, quest["id"], {"stream_key": stream_key, "terminal": True})
    return {"success": True}


async def _do_achievement(token, quest, on_progress):
    application_id = quest["config"]["application"]["id"]
    application_name = quest["config"]["application"]["name"]
    quest_target = quest["config"]["task_config_v2"]["tasks"]["ACHIEVEMENT_IN_ACTIVITY"]["target"]
    on_progress(f"[QUESTS] 🏆 {quest['config']['messages']['quest_name']} — OAuth2…")

    auth_res = await http.authorize_oauth2(token, application_id)
    if not auth_res["ok"]:
        raise RuntimeError(f"OAuth2 authorize failed ({auth_res['status']})")
    location = (auth_res["data"] or {}).get("location")
    if not location:
        raise RuntimeError("Pas de location dans la réponse OAuth2")
    auth_code = http.extract_code_from_location(location)
    if not auth_code:
        raise RuntimeError("Pas de code OAuth2")

    ds = await http.authorize_discord_says(token, application_id, quest["id"], auth_code)
    ds_token = ds.get("token")
    if not ds_token:
        raise RuntimeError("Impossible d'obtenir le token Discord Says")
    on_progress(f"[QUESTS] 🏆 {application_name} — progression achievement…")

    ok = await http.progress_discord_says(application_id, quest["id"], ds_token,
                                          quest_target, ds["activityReferrer"])
    if not ok:
        raise RuntimeError("progressDiscordSays a échoué")

    try:
        tokens_res = await http.get_oauth2_tokens(token)
        if tokens_res["ok"] and isinstance(tokens_res["data"], list):
            info = next((t for t in tokens_res["data"]
                         if (t.get("application") or {}).get("id") == application_id), None)
            if info:
                await http.delete_oauth2_token(token, info["id"])
    except Exception:
        pass
    return {"success": True}


async def _run_quest(token, quest, on_progress):
    quest_name = quest["config"]["messages"]["quest_name"]
    tasks = (quest["config"].get("task_config_v2") or {}).get("tasks") or {}
    is_android = bool(tasks.get("WATCH_VIDEO_ON_MOBILE")) and not bool(tasks.get("WATCH_VIDEO"))

    if not (quest.get("user_status") or {}).get("enrolled_at"):
        on_progress(f'[QUESTS] 📋 Inscription à "{quest_name}"…')
        enroll = await http.enroll_quest(token, quest, is_android)
        if not enroll["ok"]:
            raise RuntimeError(f"Inscription échouée ({enroll['status']})")
        quest["user_status"] = enroll["data"]

    task_name = _get_task_name(quest)
    if not task_name:
        raise RuntimeError(f'Aucun taskName reconnu pour "{quest_name}"')
    on_progress(f'[QUESTS] ▶️ "{quest_name}" — tâche: {task_name}')

    if task_name in ("WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"):
        return await _do_watch_video(token, quest, on_progress)
    if task_name in ("PLAY_ON_DESKTOP", "PLAY_ON_XBOX", "PLAY_ON_PLAYSTATION"):
        return await _do_play_platform(token, quest, task_name, on_progress)
    if task_name == "PLAY_ACTIVITY":
        return await _do_play_activity(token, quest, task_name, on_progress)
    if task_name == "ACHIEVEMENT_IN_ACTIVITY":
        return await _do_achievement(token, quest, on_progress)
    if task_name == "STREAM_ON_DESKTOP":
        raise RuntimeError("STREAM_ON_DESKTOP non supporté en mode bridge")
    raise RuntimeError(f"TaskName inconnu: {task_name}")


# Dernière sollicitation du système de distribution, pour ne pas la rejouer à chaque
# ouverture du panel : le client officiel espace lui aussi ces appels.
_last_delivery_ms = 0
_DELIVERY_COOLDOWN_MS = 60_000


async def _request_delivery(token, force: bool = False) -> None:
    """Réclame à Discord les quêtes du moment, comme l'ouverture de l'onglet Quêtes.

    Sans cet appel, ``/quests/@me`` ne renvoie que les quêtes déjà rattachées au compte
    — en pratique celles acceptées à la main dans le client officiel. L'échec n'est pas
    bloquant : on continue avec la liste telle quelle.
    """
    global _last_delivery_ms
    if not force and _now_ms() - _last_delivery_ms < _DELIVERY_COOLDOWN_MS:
        return
    _last_delivery_ms = _now_ms()
    for placement in (http.PLACEMENT_QUEST_HOME_BANNER_DESKTOP,
                      http.PLACEMENT_DESKTOP_ACCOUNT_PANEL):
        try:
            res = await http.fetch_quest_decisions(token, placement)
            if not res["ok"]:
                log(f"[QUESTS] ⚠️ Distribution refusée pour l'emplacement "
                    f"{placement} (HTTP {res['status']})")
        except Exception as err:  # noqa: BLE001
            log(f"[QUESTS] ⚠️ Distribution injoignable pour l'emplacement {placement} : {err}")


def _unique(quests):
    seen = set()
    out = []
    for q in quests:
        if q["id"] in seen:
            continue
        seen.add(q["id"])
        out.append(q)
    return out


async def run_all(client) -> None:
    token = get_token(client)
    log("[QUESTS] 🔄 Lancement de la complétion automatique des quêtes…")
    await _request_delivery(token, force=True)
    try:
        res = await http.fetch_quests(token)
        if not res["ok"]:
            raise RuntimeError(f"HTTP {res['status']}")
        raw = res["data"] or {}
    except Exception as err:  # noqa: BLE001
        logerr(f"[QUESTS] ❌ Impossible de récupérer les quêtes : {err}")
        return

    quests = raw.get("quests") or []
    todo = _unique(_filter_valid(quests) + _filter_enrollable(quests))
    if not todo:
        log("[QUESTS] ✅ Aucune quête à compléter pour l'instant.")
        return

    log(f"[QUESTS] {len(todo)} quête(s) à traiter.")
    for quest in todo:
        quest_name = quest["config"]["messages"]["quest_name"]
        task_name = _get_task_name(quest)
        try:
            await _run_quest(token, quest, log)
            log(f'[QUESTS] ✅ "{quest_name}" complétée !')
            _push_history({"questId": quest["id"], "questName": quest_name,
                           "taskName": task_name, "success": True, "timestamp": _now_ms()})
        except Exception as err:  # noqa: BLE001
            logerr(f'[QUESTS] ❌ "{quest_name}" échouée : {err}')
            _push_history({"questId": quest["id"], "questName": quest_name, "taskName": task_name,
                           "success": False, "error": str(err), "timestamp": _now_ms()})


async def _loop(client, interval_min):
    interval = max(interval_min, 30) * 60
    log(f"[QUESTS] 🔄 Boucle automatique démarrée (toutes les {interval_min} min)")
    while True:
        await asyncio.sleep(interval)
        await run_all(client)


def _stop_loop():
    global _task
    if _task:
        _task.cancel()
        _task = None


def _start_loop(client):
    global _task
    _stop_loop()
    config = load_config()
    if not config["enabled"]:
        return
    _task = asyncio.get_event_loop().create_task(_loop(client, config["intervalMin"]))


def on_ready(client) -> None:
    config = load_config()
    if config["enabled"]:
        _start_loop(client)
        asyncio.get_event_loop().create_task(_safe_run_all(client))


async def _safe_run_all(client):
    try:
        await run_all(client)
    except Exception:
        pass


async def execute(client, payload):
    action = payload.get("action")
    token = get_token(client)

    if action == "getConfig":
        return load_config()

    if action == "toggle":
        config = load_config()
        config["enabled"] = not config["enabled"]
        save_config(config)
        if config["enabled"]:
            _start_loop(client)
            asyncio.get_event_loop().create_task(_safe_run_all(client))
        else:
            _stop_loop()
        return config

    if action == "setInterval":
        try:
            minutes = int(payload.get("intervalMin"))
        except (TypeError, ValueError):
            minutes = 0
        if not minutes or minutes < 30:
            raise ValueError("Intervalle minimum : 30 minutes.")
        config = load_config()
        config["intervalMin"] = minutes
        save_config(config)
        if config["enabled"]:
            _start_loop(client)
        return config

    if action == "list":
        await _request_delivery(token)
        res = await http.fetch_quests(token)
        if not res["ok"]:
            raise ValueError(f"Impossible de récupérer les quêtes ({res['status']})")
        raw = res["data"] or {}
        quests = raw.get("quests") or []
        excluded = raw.get("excluded_quests") or []
        all_active = _filter_active(quests)
        todo = _filter_valid(quests)
        enroll = _filter_enrollable(quests)
        completed = [q for q in quests if (q.get("user_status") or {}).get("completed_at")]
        config = load_config()
        return {
            "quests": [{
                "id": q["id"],
                "name": q["config"]["messages"]["quest_name"],
                "game": q["config"]["application"]["name"],
                "taskName": _get_task_name(q),
                "expiresAt": q["config"]["expires_at"],
                "enrolled": bool((q.get("user_status") or {}).get("enrolled_at")),
                "completed": bool((q.get("user_status") or {}).get("completed_at")),
                "claimed": bool((q.get("user_status") or {}).get("claimed_at")),
                "progress": (q.get("user_status") or {}).get("progress") or {},
            } for q in all_active],
            "blockedUntil": raw.get("quest_enrollment_blocked_until"),
            # `excluded` compte les quêtes que Discord distribue mais auxquelles le
            # compte n'est pas éligible : sans ce chiffre, une liste vide ne dit pas
            # si rien n'a été distribué ou si tout a été écarté.
            "stats": {"total": len(all_active), "todo": len(todo),
                      "enroll": len(enroll), "completed": len(completed),
                      "excluded": len(excluded)},
            "config": config,
        }

    if action == "run":
        await _request_delivery(token, force=True)
        res = await http.fetch_quests(token)
        if not res["ok"]:
            raise ValueError(f"Impossible de récupérer les quêtes ({res['status']})")
        raw = res["data"] or {}
        quests = raw.get("quests") or []
        todo = _unique(_filter_valid(quests) + _filter_enrollable(quests))
        if not todo:
            return {"done": 0, "results": [], "message": "Aucune quête à compléter."}
        log(f"[QUESTS] {len(todo)} quête(s) à traiter.")
        results = []
        for quest in todo:
            quest_name = quest["config"]["messages"]["quest_name"]
            task_name = _get_task_name(quest)
            try:
                await _run_quest(token, quest, log)
                log(f'[QUESTS] ✅ "{quest_name}" complétée !')
                entry = {"questId": quest["id"], "questName": quest_name, "taskName": task_name,
                         "success": True, "timestamp": _now_ms()}
            except Exception as err:  # noqa: BLE001
                logerr(f'[QUESTS] ❌ "{quest_name}" échouée : {err}')
                entry = {"questId": quest["id"], "questName": quest_name, "taskName": task_name,
                         "success": False, "error": str(err), "timestamp": _now_ms()}
            _push_history(entry)
            results.append(entry)
        return {"done": sum(1 for r in results if r["success"]),
                "failed": sum(1 for r in results if not r["success"]), "results": results}

    if action == "getHistory":
        return {"history": load_history()}

    if action == "clearHistory":
        save_history([])
        return {"history": []}

    raise ValueError(f"Action quests inconnue : '{action}'")

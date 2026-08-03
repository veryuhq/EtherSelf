"""roles — consultation des rôles d'un serveur (lecture seule).

Deux recherches, à partir d'identifiants Discord :
  • les rôles d'un membre  → ID du serveur + ID du membre ;
  • les membres d'un rôle  → ID du serveur + ID du rôle.

Rien n'est modifié côté Discord : le module ne fait que lire. Les listes de
membres partent toujours du cache du selfbot, complété par les requêtes gateway
de discord.py-self. Le scan complet de la liste des membres reste une action
explicite, plafonnée et volontairement espacée (``SCAN_DELAY``) pour ne pas
exposer le compte.
"""

from __future__ import annotations

import asyncio
import time

from ...func.discord_util import user_tag

# Délai (s) entre deux requêtes lors du scan complet de la liste des membres.
SCAN_DELAY = 1.0
# Abandon du scan complet au-delà de cette durée (s) — la réponse du bridge est
# synchrone, un scan sans fin bloquerait la requête du controller.
SCAN_TIMEOUT = 240.0
# Refus du scan complet au-delà de ce nombre de membres : trop de requêtes pour
# un panel de consultation.
MAX_SCAN_MEMBERS = 20_000
# Durée de validité (s) d'un scan complet — évite de re-scanner à chaque
# changement de page côté panel.
SCAN_TTL = 600
# Nombre de serveurs conservés simultanément dans le cache de scan.
SCAN_CACHE_MAX = 2
# Nombre max de membres renvoyés au controller pour un rôle.
MAX_LISTED = 300

# guildId → {"ts": float, "members": [membre sérialisé avec roleIds]}
_scan_cache: dict[str, dict] = {}

# Permissions mises en avant dans le panel (attribut discord.py → clé camelCase).
_KEY_PERMISSIONS = (
    ("administrator", "administrator"),
    ("manage_guild", "manageGuild"),
    ("manage_roles", "manageRoles"),
    ("manage_channels", "manageChannels"),
    ("ban_members", "banMembers"),
    ("kick_members", "kickMembers"),
    ("manage_messages", "manageMessages"),
    ("mention_everyone", "mentionEveryone"),
    ("moderate_members", "moderateMembers"),
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _ms(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value.timestamp() * 1000)
    except Exception:
        return None


def _snowflake(value, label: str) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f"{label} invalide : un ID Discord numérique est attendu.") from None


def _get_guild(client, guild_id):
    if not guild_id:
        raise ValueError("guildId requis.")
    gid = _snowflake(guild_id, "ID de serveur")
    guild = client.get_guild(gid)
    if guild is None:
        raise ValueError(f"Serveur `{gid}` introuvable — le selfbot doit en être membre.")
    return guild


def _get_role(guild, role_id):
    if not role_id:
        raise ValueError("roleId requis.")
    rid = _snowflake(role_id, "ID de rôle")
    role = guild.get_role(rid)
    if role is None:
        raise ValueError(f"Rôle `{rid}` introuvable sur « {guild.name} ».")
    return role


def _key_permissions(permissions) -> list[str]:
    return [key for attr, key in _KEY_PERMISSIONS if getattr(permissions, attr, False)]


def _avatar_url(member) -> str | None:
    try:
        return str(member.display_avatar.replace(size=128))
    except Exception:
        return None


def _serialize_guild(guild) -> dict:
    return {
        "id": str(guild.id),
        "name": guild.name,
        "icon": str(guild.icon.replace(size=64)) if guild.icon else None,
        "memberCount": guild.member_count,
        "cachedMembers": len(guild.members),
        "chunked": bool(guild.chunked),
        "roleCount": len(guild.roles),
        "ownerId": str(guild.owner_id) if guild.owner_id else None,
    }


def _serialize_role(role, *, member_count=None, cached_members=None) -> dict:
    colour = role.colour.value
    return {
        "id": str(role.id),
        "name": role.name,
        "color": colour,
        "colorHex": f"#{colour:06X}" if colour else None,
        "position": role.position,
        "hoist": bool(role.hoist),
        "mentionable": bool(role.mentionable),
        "managed": bool(role.managed),
        "isEveryone": role.is_default(),
        "isBotManaged": role.is_bot_managed(),
        "isBooster": role.is_premium_subscriber(),
        "unicodeEmoji": role.unicode_emoji,
        "createdAt": _ms(role.created_at),
        "keyPermissions": _key_permissions(role.permissions),
        "memberCount": member_count,
        "cachedMembers": cached_members,
    }


def _serialize_member(member, *, with_roles=False) -> dict:
    data = {
        "id": str(member.id),
        "tag": user_tag(member),
        "displayName": member.display_name,
        "nick": member.nick,
        "bot": bool(member.bot),
        "joinedAt": _ms(member.joined_at),
        "premiumSince": _ms(member.premium_since),
    }
    if with_roles:
        data["roleIds"] = [str(r.id) for r in member.roles]
    return data


async def _resolve_member(guild, user_id):
    """Membre depuis le cache, sinon via le gateway, sinon via l'API REST."""
    uid = _snowflake(user_id, "ID de membre")

    member = guild.get_member(uid)
    if member is not None:
        return member

    # query_members est la requête que le client Discord utilise lui-même pour
    # résoudre un membre précis : c'est la plus discrète des trois.
    try:
        found = await guild.query_members(user_ids=[uid], cache=True)
        if found:
            return found[0]
    except Exception:
        pass

    try:
        return await guild.fetch_member(uid)
    except Exception:
        return None


async def _exact_member_count(role) -> int | None:
    """Nombre exact de membres du rôle — nécessite des permissions, d'où le None."""
    try:
        return await role.member_count()
    except Exception:
        return None


async def _scan_members(guild) -> list[dict]:
    """Liste complète des membres du serveur (scan gateway), mise en cache."""
    key = str(guild.id)
    now = time.time()

    cached = _scan_cache.get(key)
    if cached and now - cached["ts"] < SCAN_TTL:
        return cached["members"]

    total = guild.member_count or 0
    if total > MAX_SCAN_MEMBERS:
        raise ValueError(
            f"Scan complet refusé : « {guild.name} » compte {total} membres "
            f"(limite {MAX_SCAN_MEMBERS}). Reste sur la recherche rapide.")

    try:
        members = await asyncio.wait_for(
            guild.fetch_members(cache=False, delay=SCAN_DELAY), timeout=SCAN_TIMEOUT)
    except asyncio.TimeoutError:
        raise ValueError(
            f"Scan complet interrompu après {int(SCAN_TIMEOUT // 60)} min — serveur trop gros "
            "ou liste des membres inaccessible.") from None
    except Exception as err:  # noqa: BLE001 — remonté tel quel au panel
        raise ValueError(f"Scan complet impossible : {err}") from err

    entries = [_serialize_member(m, with_roles=True) for m in members]

    if key not in _scan_cache and len(_scan_cache) >= SCAN_CACHE_MAX:
        oldest = min(_scan_cache, key=lambda k: _scan_cache[k]["ts"])
        _scan_cache.pop(oldest, None)
    _scan_cache[key] = {"ts": now, "members": entries}
    return entries


async def _quick_members(role) -> tuple[list[dict], str]:
    """Membres du rôle : cache local, complété par la liste renvoyée par Discord.

    ``role.fetch_members()`` ne renvoie que les 100 premiers membres du rôle :
    la liste peut donc rester partielle, d'où ``source`` et le scan complet.
    """
    found = {str(m.id): _serialize_member(m) for m in role.members}
    source = "cache"

    if not role.is_default():
        try:
            fetched = await role.fetch_members()
        except Exception:
            fetched = []
        if fetched:
            source = "api"
            for member in fetched:
                found[str(member.id)] = _serialize_member(member)

    return list(found.values()), source


async def _deep_members(guild, role) -> tuple[list[dict], str]:
    entries = await _scan_members(guild)
    role_id = str(role.id)
    matched = entries if role.is_default() else [e for e in entries if role_id in e["roleIds"]]
    return [{k: v for k, v in e.items() if k != "roleIds"} for e in matched], "scan"


def _sort_key(member: dict):
    return ((member.get("displayName") or member.get("tag") or "").lower(), member["id"])


# ── Actions ──────────────────────────────────────────────────────────────────

async def execute(client, payload):
    action = payload.get("action")

    if action == "guildInfo":
        guild = _get_guild(client, payload.get("guildId"))
        return {"guild": _serialize_guild(guild)}

    if action == "listRoles":
        guild = _get_guild(client, payload.get("guildId"))
        roles = sorted(guild.roles, key=lambda r: r.position, reverse=True)
        return {
            "guild": _serialize_guild(guild),
            # Comptes issus du cache uniquement : le compte exact demande une
            # requête par rôle, on le réserve à l'ouverture d'un rôle.
            "roles": [_serialize_role(r, cached_members=len(r.members)) for r in roles],
        }

    if action == "memberRoles":
        guild = _get_guild(client, payload.get("guildId"))
        user_id = payload.get("userId")
        if not user_id:
            raise ValueError("userId requis.")
        member = await _resolve_member(guild, user_id)
        if member is None:
            raise ValueError(
                f"Membre `{user_id}` introuvable sur « {guild.name} » — "
                "vérifie l'ID, ou la personne a quitté le serveur.")

        roles = sorted((r for r in member.roles if not r.is_default()),
                       key=lambda r: r.position, reverse=True)
        top_role = member.top_role
        return {
            "guild": _serialize_guild(guild),
            "member": {
                **_serialize_member(member),
                "avatar": _avatar_url(member),
                "isOwner": guild.owner_id == member.id,
                "colorHex": f"#{member.colour.value:06X}" if member.colour.value else None,
                "topRole": _serialize_role(top_role) if top_role and not top_role.is_default() else None,
                "keyPermissions": _key_permissions(member.guild_permissions),
            },
            "roles": [_serialize_role(r) for r in roles],
        }

    if action == "roleMembers":
        guild = _get_guild(client, payload.get("guildId"))
        role = _get_role(guild, payload.get("roleId"))
        deep = bool(payload.get("deep"))

        exact = await _exact_member_count(role)
        members, source = await (_deep_members(guild, role) if deep else _quick_members(role))
        members.sort(key=_sort_key)
        found = len(members)

        return {
            "guild": _serialize_guild(guild),
            "role": _serialize_role(role, member_count=exact, cached_members=len(role.members)),
            "members": members[:MAX_LISTED],
            "source": source,
            "found": found,
            "exactCount": exact,
            "complete": exact is not None and found >= exact,
            "truncated": found > MAX_LISTED,
            "deep": deep,
        }

    raise ValueError(f"Action roles inconnue : '{action}'")

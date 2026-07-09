"""Rendu HTML des snapshots de salon / MP — port de src/self/func/snapshot-html.js.

Reproduit le mini-moteur markdown → HTML, le rendu des embeds / stickers / réactions
/ pièces jointes, et le document complet (même CSS, même structure)."""

from __future__ import annotations

import html as _html
import re
from datetime import datetime


def escape_html(s) -> str:
    if not s:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def format_ts(ts) -> str:
    try:
        return datetime.fromtimestamp(ts / 1000).strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        return str(ts)


def emoji_cdn_url(emoji_id, animated) -> str:
    if animated:
        return f"https://cdn.discordapp.com/emojis/{emoji_id}.gif?size=64&quality=lossless"
    return f"https://cdn.discordapp.com/emojis/{emoji_id}.png?size=64"


def sticker_cdn_url(sticker):
    fmt = sticker.get("format_type")
    sid = sticker.get("id")
    if fmt == 3:
        return None
    if fmt in (4, 2):
        return f"https://media.discordapp.net/stickers/{sid}.gif?size=240"
    return f"https://media.discordapp.net/stickers/{sid}.png?size=240"


def resolve_url(val):
    if not val:
        return None
    if callable(val):
        try:
            return val() or None
        except Exception:
            return None
    if isinstance(val, str):
        return val or None
    return None


# ── Messages système ──────────────────────────────────────────────────────────

SYSTEM_MESSAGE_LABELS = {
    1: "a rejoint le groupe", 2: "a quitté le groupe", 3: "a lancé un appel",
    4: "a changé le nom du canal", 5: "a changé l'icône du groupe", 6: "a épinglé un message",
    7: "a rejoint le serveur", 8: "a boosté le serveur", 9: "a boosté le serveur au niveau 1",
    10: "a boosté le serveur au niveau 2", 11: "a boosté le serveur au niveau 3",
    12: "a suivi le canal", 14: "a été disqualifié de la découverte",
    15: "a été requalifié dans la découverte", 16: "avertissement découverte (grâce initiale)",
    17: "avertissement découverte (dernier avertissement)", 18: "a créé un fil de discussion",
    22: "a créé un fil à partir d'un message", 23: "rappel de règles du serveur",
    25: "action automatique de modération", 26: "achat d'abonnement", 27: "interaction premium",
    28: "étape de bienvenue terminée", 29: "scène terminée", 30: "speaker invité sur scène",
    32: "sujet de scène", 36: "achat d'abonnement",
    "RECIPIENT_ADD": "a rejoint le groupe", "RECIPIENT_REMOVE": "a quitté le groupe",
    "CALL": "a lancé un appel", "CHANNEL_NAME_CHANGE": "a changé le nom du canal",
    "CHANNEL_ICON_CHANGE": "a changé l'icône du groupe",
    "CHANNEL_PINNED_MESSAGE": "a épinglé un message", "GUILD_MEMBER_JOIN": "a rejoint le serveur",
    "USER_PREMIUM_GUILD_SUBSCRIPTION": "a boosté le serveur",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1": "a boosté le serveur au niveau 1",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2": "a boosté le serveur au niveau 2",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3": "a boosté le serveur au niveau 3",
    "CHANNEL_FOLLOW_ADD": "a suivi le canal",
    "GUILD_DISCOVERY_DISQUALIFIED": "a été disqualifié de la découverte",
    "GUILD_DISCOVERY_REQUALIFIED": "a été requalifié dans la découverte",
    "THREAD_CREATED": "a créé un fil de discussion",
    "GUILD_INVITE_REMINDER": "rappel de règles du serveur",
    "AUTO_MODERATION_ACTION": "modération automatique",
}

SYSTEM_TYPES = {
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 22, 23, 25, 26, 27, 28, 29, 30, 32, 36,
    "RECIPIENT_ADD", "RECIPIENT_REMOVE", "CALL", "CHANNEL_NAME_CHANGE", "CHANNEL_ICON_CHANGE",
    "CHANNEL_PINNED_MESSAGE", "GUILD_MEMBER_JOIN", "USER_PREMIUM_GUILD_SUBSCRIPTION",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1", "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3", "CHANNEL_FOLLOW_ADD",
    "GUILD_DISCOVERY_DISQUALIFIED", "GUILD_DISCOVERY_REQUALIFIED", "THREAD_CREATED",
    "GUILD_INVITE_REMINDER", "AUTO_MODERATION_ACTION",
}

_SYSTEM_ICONS = {
    7: "👋", "GUILD_MEMBER_JOIN": "👋", 8: "🚀", "USER_PREMIUM_GUILD_SUBSCRIPTION": "🚀",
    9: "🚀", "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1": "🚀", 10: "🚀",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2": "🚀", 11: "🚀",
    "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3": "🚀", 6: "📌", "CHANNEL_PINNED_MESSAGE": "📌",
    18: "🧵", "THREAD_CREATED": "🧵", 1: "➕", "RECIPIENT_ADD": "➕", 2: "➖",
    "RECIPIENT_REMOVE": "➖", 3: "📞", "CALL": "📞", 12: "📢", "CHANNEL_FOLLOW_ADD": "📢",
    25: "🛡️", "AUTO_MODERATION_ACTION": "🛡️",
}


def is_system_message(msg_type) -> bool:
    return msg_type in SYSTEM_TYPES


def get_system_label(msg_type) -> str:
    return SYSTEM_MESSAGE_LABELS.get(msg_type, f"message système (type {msg_type})")


def get_system_icon(msg_type) -> str:
    return _SYSTEM_ICONS.get(msg_type, "ℹ️")


# ── Markdown → HTML ─────────────────────────────────────────────────────────

_RE_CODEBLOCK = re.compile(r"```(\w+)?\n?([\s\S]*?)```")
_RE_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_RE_EMOJI = re.compile(r"<(a?):(\w+):(\d+)>")
_RE_MD_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")
_RE_RAW_LINK = re.compile(r'(https?://[^\s<>"&\x00]+)')
_RE_SPOILER = re.compile(r"\|\|(.+?)\|\|", re.DOTALL)
_RE_BI = re.compile(r"\*\*\*(.+?)\*\*\*", re.DOTALL)
_RE_BOLD = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_RE_ITALIC_STAR = re.compile(r"\*([^*\n]+)\*")
_RE_UNDERLINE = re.compile(r"__(.+?)__", re.DOTALL)
_RE_ITALIC_US = re.compile(r"_([^_\n]+)_")
_RE_STRIKE = re.compile(r"~~(.+?)~~", re.DOTALL)
_RE_MENTION_USER = re.compile(r"&lt;@!?(\d+)&gt;")
_RE_MENTION_CHANNEL = re.compile(r"&lt;#(\d+)&gt;")
_RE_MENTION_ROLE = re.compile(r"&lt;@&amp;(\d+)&gt;")
_RE_TIMESTAMP = re.compile(r"&lt;t:(\d+)(?::([tTdDfFR]))?&gt;")
_RE_H3 = re.compile(r"^### (.+)$")
_RE_H2 = re.compile(r"^## (.+)$")
_RE_H1 = re.compile(r"^# (.+)$")
_RE_BQ = re.compile(r"^(&gt;|>) ")
_RE_BQ_STRIP = re.compile(r"^(&gt;|>)\s?")
_RE_UL = re.compile(r"^[-*•] (.+)$")
_RE_OL = re.compile(r"^(\d+)\. (.+)$")
_RE_HR = re.compile(r"^---+$")


def render_content(content, mention_maps=None) -> str:
    if not content:
        return ""
    mention_maps = mention_maps or {}
    users_map = mention_maps.get("users") if isinstance(mention_maps.get("users"), dict) else {}
    roles_map = mention_maps.get("roles") if isinstance(mention_maps.get("roles"), dict) else {}

    placeholders: list[str] = []

    def stash(html_str: str) -> str:
        idx = len(placeholders)
        placeholders.append(html_str)
        return f"\x00PH{idx}\x00"

    def unstash(text: str) -> str:
        return re.sub(r"\x00PH(\d+)\x00",
                      lambda m: placeholders[int(m.group(1))] if int(m.group(1)) < len(placeholders) else "",
                      text)

    s = content

    def _codeblock(m):
        lang = m.group(1) or ""
        code = re.sub(r"^\n|\n$", "", m.group(2))
        return stash(f'<pre><code class="lang-{escape_html(lang)}">{escape_html(code)}</code></pre>')

    s = _RE_CODEBLOCK.sub(_codeblock, s)
    s = _RE_INLINE_CODE.sub(lambda m: stash(f"<code>{escape_html(m.group(1))}</code>"), s)

    def _emoji(m):
        animated = m.group(1) == "a"
        url = emoji_cdn_url(m.group(3), animated)
        safe = escape_html(m.group(2))
        return stash(
            f'<img class="emoji" src="{url}" alt=":{safe}:" title=":{safe}:" '
            f"onerror=\"this.style.display='none';this.insertAdjacentText('afterend',':{safe}:')\">")

    s = _RE_EMOJI.sub(_emoji, s)

    s = (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))

    s = _RE_MD_LINK.sub(
        lambda m: stash(f'<a href="{escape_html(m.group(2))}" target="_blank" '
                        f'rel="noopener">{escape_html(m.group(1))}</a>'), s)
    s = _RE_RAW_LINK.sub(
        lambda m: stash(f'<a href="{m.group(1)}" target="_blank" rel="noopener">{m.group(1)}</a>'), s)
    s = _RE_SPOILER.sub(
        lambda m: stash(f'<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">{m.group(1)}</span>'), s)

    s = _RE_BI.sub(lambda m: stash(f"<strong><em>{m.group(1)}</em></strong>"), s)
    s = _RE_BOLD.sub(lambda m: stash(f"<strong>{m.group(1)}</strong>"), s)
    s = _RE_ITALIC_STAR.sub(lambda m: stash(f"<em>{m.group(1)}</em>"), s)
    s = _RE_UNDERLINE.sub(lambda m: stash(f"<u>{m.group(1)}</u>"), s)
    s = _RE_ITALIC_US.sub(lambda m: stash(f"<em>{m.group(1)}</em>"), s)
    s = _RE_STRIKE.sub(lambda m: stash(f"<del>{m.group(1)}</del>"), s)

    def _mention_user(m):
        name = users_map.get(m.group(1))
        display = f"@{name}" if name else f"@{m.group(1)}"
        return stash(f'<span class="mention">{escape_html(display)}</span>')

    s = _RE_MENTION_USER.sub(_mention_user, s)
    s = _RE_MENTION_CHANNEL.sub(lambda m: stash(f'<span class="mention">#{m.group(1)}</span>'), s)

    def _mention_role(m):
        name = roles_map.get(m.group(1))
        display = f"@{name}" if name else "@role"
        return stash(f'<span class="mention mention-role">{escape_html(display)}</span>')

    s = _RE_MENTION_ROLE.sub(_mention_role, s)

    def _timestamp(m):
        try:
            date = datetime.fromtimestamp(int(m.group(1)))
            return stash(f'<span class="timestamp">{date.strftime("%d/%m/%Y %H:%M:%S")}</span>')
        except Exception:
            return stash(f'<span class="timestamp">{m.group(1)}</span>')

    s = _RE_TIMESTAMP.sub(_timestamp, s)

    # Rendu ligne par ligne
    lines = s.split("\n")
    out: list[str] = []
    state = {"ul": False, "ol": False}
    bq_buf: list[str] = []

    def flush_ul():
        if state["ul"]:
            out.append("</ul>")
            state["ul"] = False

    def flush_ol():
        if state["ol"]:
            out.append("</ol>")
            state["ol"] = False

    def flush_lists():
        flush_ul()
        flush_ol()

    def flush_bq():
        nonlocal bq_buf
        if not bq_buf:
            return
        inner = render_content("\n".join(_RE_BQ_STRIP.sub("", ln) for ln in bq_buf), mention_maps)
        out.append(f"<blockquote>{inner}</blockquote>")
        bq_buf = []

    def flush_all():
        flush_lists()
        flush_bq()

    i = 0
    while i < len(lines):
        line = lines[i]
        h3, h2, h1 = _RE_H3.match(line), _RE_H2.match(line), _RE_H1.match(line)
        if h3:
            flush_all(); out.append(f"<h3>{h3.group(1)}</h3>"); i += 1; continue
        if h2:
            flush_all(); out.append(f"<h2>{h2.group(1)}</h2>"); i += 1; continue
        if h1:
            flush_all(); out.append(f"<h1>{h1.group(1)}</h1>"); i += 1; continue

        if _RE_BQ.match(line):
            flush_lists()
            bq_buf.append(line)
            while i + 1 < len(lines) and _RE_BQ.match(lines[i + 1]):
                i += 1
                bq_buf.append(lines[i])
            flush_bq()
            i += 1
            continue

        ul = _RE_UL.match(line)
        if ul:
            flush_bq(); flush_ol()
            if not state["ul"]:
                out.append("<ul>"); state["ul"] = True
            out.append(f"<li>{ul.group(1)}</li>")
            i += 1
            continue

        ol = _RE_OL.match(line)
        if ol:
            flush_bq(); flush_ul()
            if not state["ol"]:
                out.append("<ol>"); state["ol"] = True
            out.append(f"<li>{ol.group(2)}</li>")
            i += 1
            continue

        if _RE_HR.match(line.strip()):
            flush_all(); out.append("<hr>"); i += 1; continue

        if line.strip() == "":
            flush_all(); out.append("<br>"); i += 1; continue

        flush_all()
        out.append(f'<span class="line">{line}</span><br>')
        i += 1

    flush_all()
    return unstash("".join(out))


# ── Embeds ──────────────────────────────────────────────────────────────────

def render_embed_fields(fields, mention_maps) -> str:
    if not fields:
        return ""
    rows = []
    current = []
    for field in fields:
        if field.get("inline"):
            current.append(field)
            if len(current) == 3:
                rows.append(("inline", current)); current = []
        else:
            if current:
                rows.append(("inline", current)); current = []
            rows.append(("block", field))
    if current:
        rows.append(("inline", current))

    parts = []
    for kind, data in rows:
        if kind == "block":
            f = data
            parts.append(
                f'<div class="embed-field embed-field-block">'
                f'<div class="embed-field-name">{render_content(f.get("name"), mention_maps)}</div>'
                f'<div class="embed-field-value">{render_content(f.get("value"), mention_maps)}</div></div>')
        else:
            cols = "".join(
                f'<div class="embed-field-inline-col">'
                f'<div class="embed-field-name">{render_content(f.get("name"), mention_maps)}</div>'
                f'<div class="embed-field-value">{render_content(f.get("value"), mention_maps)}</div></div>'
                for f in data)
            parts.append(f'<div class="embed-field embed-field-inline">{cols}</div>')
    return "".join(parts)


def render_embed(e, mention_maps) -> str:
    if e.get("type") in ("gifv", "image"):
        if e.get("videoUrl"):
            fallback = escape_html(e.get("thumbnailUrl") or e.get("imageUrl") or "")
            return (f'<div class="attachment"><video class="attachment-img" '
                    f'src="{escape_html(e["videoUrl"])}" autoplay loop muted playsinline '
                    f"onerror=\"this.outerHTML='<img class=\\'attachment-img\\' src=\\'{fallback}\\' "
                    f"alt=\\'gif\\' loading=\\'lazy\\'>'\"></video></div>")
        gif_url = e.get("imageUrl") or e.get("thumbnailUrl")
        if gif_url:
            return (f'<div class="attachment"><img class="attachment-img" '
                    f'src="{escape_html(gif_url)}" alt="gif" loading="lazy"></div>')
        if e.get("url"):
            return (f'<div class="attachment"><a class="attachment-file" '
                    f'href="{escape_html(e["url"])}" target="_blank" rel="noopener">🎞️ {escape_html(e["url"])}</a></div>')
        return ""

    color = e.get("color")
    color_style = f"border-left-color: #{color:06x};" if color is not None else ""

    if e.get("type") == "link":
        title = ""
        if e.get("title"):
            inner = (f'<a href="{escape_html(e["url"])}" target="_blank" rel="noopener">'
                     f'{render_content(e["title"], mention_maps)}</a>') if e.get("url") \
                else render_content(e["title"], mention_maps)
            title = f'<div class="embed-title">{inner}</div>'
        desc = f'<div class="embed-desc">{render_content(e["description"], mention_maps)}</div>' if e.get("description") else ""
        img = (f'<div class="embed-image"><img src="{escape_html(e["imageUrl"])}" alt="" '
               f"loading=\"lazy\" onerror=\"this.style.display='none'\"></div>") if e.get("imageUrl") else ""
        return (f'<div class="embed" style="{color_style}"><div class="embed-inner">'
                f"{title}{desc}{img}</div></div>")

    provider = f'<div class="embed-provider">{escape_html((e.get("provider") or {}).get("name") or "")}</div>' if e.get("provider") else ""

    author = ""
    if e.get("author"):
        a = e["author"]
        icon = (f'<img class="embed-author-icon" src="{escape_html(a["iconUrl"])}" alt="" '
                f"onerror=\"this.style.display='none'\">") if a.get("iconUrl") else ""
        if a.get("url"):
            name = (f'<a class="embed-author-name" href="{escape_html(a["url"])}" target="_blank" '
                    f'rel="noopener">{render_content(a.get("name"), mention_maps)}</a>')
        else:
            name = f'<span class="embed-author-name">{render_content(a.get("name"), mention_maps)}</span>'
        author = f'<div class="embed-author">{icon}{name}</div>'

    title = ""
    if e.get("title"):
        inner = (f'<a href="{escape_html(e["url"])}" target="_blank" rel="noopener">'
                 f'{render_content(e["title"], mention_maps)}</a>') if e.get("url") \
            else render_content(e["title"], mention_maps)
        title = f'<div class="embed-title">{inner}</div>'

    desc = f'<div class="embed-desc">{render_content(e["description"], mention_maps)}</div>' if e.get("description") else ""
    fields = render_embed_fields(e.get("fields"), mention_maps)
    image = (f'<div class="embed-image"><img src="{escape_html(e["imageUrl"])}" alt="" '
             f"loading=\"lazy\" onerror=\"this.style.display='none'\"></div>") if e.get("imageUrl") else ""
    thumb = (f'<img class="embed-thumbnail" src="{escape_html(e["thumbnailUrl"])}" alt="" '
             f"onerror=\"this.style.display='none'\">") if e.get("thumbnailUrl") else ""
    video = (f'<div class="embed-video"><video controls src="{escape_html(e["videoUrl"])}" '
             f"onerror=\"this.style.display='none'\"></video></div>") if e.get("videoUrl") and e.get("type") != "gifv" else ""

    footer = ""
    if e.get("footer") or e.get("timestamp"):
        ficon = (f'<img class="embed-footer-icon" src="{escape_html(e["footerIconUrl"])}" alt="" '
                 f"onerror=\"this.style.display='none'\">") if e.get("footerIconUrl") else ""
        ftext = f"<span>{escape_html(e['footer'])}</span>" if e.get("footer") else ""
        sep = '<span class="embed-footer-sep">•</span>' if e.get("footer") and e.get("timestamp") else ""
        fts = f"<span>{format_ts(e['timestamp'])}</span>" if e.get("timestamp") else ""
        footer = f'<div class="embed-footer">{ficon}{ftext}{sep}{fts}</div>'

    fields_wrap = f'<div class="embed-fields">{fields}</div>' if fields else ""
    return (f'<div class="embed" style="{color_style}">{thumb}<div class="embed-inner">'
            f"{provider}{author}{title}{desc}{fields_wrap}{image}{video}{footer}</div></div>")


def render_sticker(sticker) -> str:
    url = sticker_cdn_url(sticker)
    safe = escape_html(sticker.get("name") or "sticker")
    if not url:
        return (f'<div class="sticker sticker-lottie" title="{safe}">'
                f'<span class="sticker-lottie-label">🎭 {safe}</span>'
                f'<span class="sticker-lottie-hint">Sticker animé (Lottie)</span></div>')
    return (f'<div class="sticker"><img class="sticker-img" src="{escape_html(url)}" alt="{safe}" '
            f'title="{safe}" loading="lazy" '
            f"onerror=\"this.parentElement.innerHTML='<span class=\\'sticker-error\\'>🎭 {safe}</span>'\"></div>")


_RE_IMG = re.compile(r"\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$", re.IGNORECASE)
_RE_VID = re.compile(r"\.(mp4|webm|mov)(\?.*)?$", re.IGNORECASE)
_RE_AUD = re.compile(r"\.(mp3|wav|ogg|flac|aac)(\?.*)?$", re.IGNORECASE)


def render_message(m, mention_maps) -> str:
    ts = format_ts(m["timestamp"])

    if m.get("isSystem"):
        label = get_system_label(m["messageType"])
        icon = get_system_icon(m["messageType"])
        extra = f" — <em>{escape_html((m.get('content') or '')[:100])}</em>" if m.get("content") else ""
        return (f'<div class="msg-system" id="msg-{m["id"]}">'
                f'<span class="system-icon">{icon}</span>'
                f'<span class="system-text"><strong>{escape_html(m["authorTag"])}</strong> '
                f'{escape_html(label)}{extra}</span><span class="ts">{ts}</span></div>')

    if m.get("authorAvatar"):
        ext = "gif" if str(m["authorAvatar"]).startswith("a_") else "png"
        avatar_url = f"https://cdn.discordapp.com/avatars/{m['authorId']}/{m['authorAvatar']}.{ext}?size=80"
    else:
        try:
            idx = (int(m.get("authorId") or "0") >> 22) % 6
        except ValueError:
            idx = 0
        avatar_url = f"https://cdn.discordapp.com/embed/avatars/{idx}.png"

    attachments = []
    for att in m.get("attachments") or []:
        url = att.get("url") or ""
        name = escape_html(att.get("name") or url)
        if _RE_IMG.search(url):
            attachments.append(
                f'<div class="attachment"><img class="attachment-img" src="{escape_html(url)}" '
                f'alt="{escape_html(att.get("name") or "image")}" loading="lazy" '
                f"onerror=\"this.outerHTML='<a class=\\'attachment-file\\' href=\\'{escape_html(url)}\\' "
                f"target=\\'_blank\\'>📎 {name}</a>'\"></div>")
        elif _RE_VID.search(url):
            attachments.append(f'<div class="attachment"><video class="attachment-video" controls '
                               f'src="{escape_html(url)}"></video></div>')
        elif _RE_AUD.search(url):
            attachments.append(f'<div class="attachment"><audio class="attachment-audio" controls '
                               f'src="{escape_html(url)}"></audio>'
                               f'<span class="attachment-audio-name">🎵 {name}</span></div>')
        else:
            attachments.append(f'<div class="attachment"><a class="attachment-file" '
                               f'href="{escape_html(url)}" target="_blank" rel="noopener">📎 {name}</a></div>')
    attachments_html = "".join(attachments)

    embeds_html = "".join(render_embed(e, mention_maps) for e in (m.get("embeds") or []))
    stickers_html = "".join(render_sticker(s) for s in (m.get("stickers") or []))

    reply_html = ""
    if m.get("replyAuthor"):
        rc = f": {escape_html((m.get('replyContent') or '')[:120])}" if m.get("replyContent") else ""
        reply_html = f'<div class="reply">↩ <strong>{escape_html(m["replyAuthor"])}</strong>{rc}</div>'

    reactions_html = ""
    if m.get("reactions"):
        chips = []
        for r in m["reactions"]:
            if r.get("emojiId"):
                emoji = (f'<img class="reaction-emoji" src="{emoji_cdn_url(r["emojiId"], r.get("animated", False))}" '
                         f'alt="{escape_html(r.get("emojiName") or "")}" '
                         f"onerror=\"this.replaceWith(document.createTextNode('{escape_html(r.get('emojiName') or '?')}'))\">")
            else:
                emoji = escape_html(r.get("emoji"))
            chips.append(f'<span class="reaction">{emoji} {r["count"]}</span>')
        reactions_html = f'<div class="reactions">{"".join(chips)}</div>'

    initials = escape_html((m.get("authorTag") or "?")[0].upper())
    bot_class = " bot" if m.get("isBot") else ""
    bot_badge = '<span class="badge-bot">BOT</span>' if m.get("isBot") else ""
    edited = '<span class="edited">(édité)</span>' if m.get("editedAt") else ""
    iso = datetime.fromtimestamp(m["timestamp"] / 1000).isoformat()
    fallback_svg = (
        "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 "
        "height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%235865F2%22 rx=%2220%22/>"
        f"<text x=%2220%22 y=%2226%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2218%22 "
        f"font-family=%22sans-serif%22>{initials}</text></svg>")

    return (f'<div class="msg{bot_class}" id="msg-{m["id"]}">'
            f'<img class="avatar" src="{avatar_url}" alt="{escape_html(m["authorTag"])}" loading="lazy" '
            f"onerror=\"this.src='{fallback_svg}'\">"
            f'<div class="msg-body"><div class="msg-header">'
            f'<span class="author">{escape_html(m["authorTag"])}</span>{bot_badge}'
            f'<span class="ts" title="{iso}">{ts}</span>{edited}</div>'
            f'{reply_html}<div class="msg-content">{render_content(m.get("content"), mention_maps)}</div>'
            f"{attachments_html}{stickers_html}{embeds_html}{reactions_html}</div></div>")


def build_mention_maps(messages) -> dict:
    users, roles = {}, {}
    for m in messages:
        if m.get("authorId") and m.get("authorTag"):
            users[m["authorId"]] = m["authorTag"]
        for u in m.get("mentionedUsers") or []:
            if u.get("id") and u.get("tag"):
                users[u["id"]] = u["tag"]
        for r in m.get("mentionedRoles") or []:
            if r.get("id") and r.get("name"):
                roles[r["id"]] = r["name"]
    return {"users": users, "roles": roles}


CSS = """
  :root {
    --bg:               #313338;
    --bg2:              #2b2d31;
    --bg3:              #1e1f22;
    --text:             #dcddde;
    --text-muted:       #949ba4;
    --accent:           #5865f2;
    --mention-bg:       #3c4270;
    --mention-text:     #c9cdfb;
    --mention-role-bg:  #3d2f58;
    --mention-role-text:#d4b8ff;
    --embed-bg:         #2b2d31;
    --link:             #00aff4;
    --sep:              #3f4147;
    --reaction-bg:      #374151;
    --system-text:      #949ba4;
    --bq-border:        #4e5058;
    --bq-bg:            rgba(255,255,255,.04);
    --spoiler-bg:       #202225;
    --code-bg:          #1e1f22;
    --code-border:      #2b2d31;
    --dm-accent:        #eb459e;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 15px;
    line-height: 1.375;
  }
  header {
    background: var(--bg2);
    padding: 14px 24px;
    position: sticky;
    top: 0;
    z-index: 100;
    border-bottom: 1px solid var(--bg3);
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 2px 8px rgba(0,0,0,.4);
  }
  .header-icon  { font-size: 22px; }
  header h1     { font-size: 17px; font-weight: 700; color: #fff; }
  header .header-meta { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
  header.dm-header { border-bottom-color: var(--dm-accent); }
  .badge-dm {
    background: var(--dm-accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: .5px;
    text-transform: uppercase;
    margin-left: 6px;
  }
  .container { max-width: 960px; margin: 0 auto; padding: 20px 24px 40px; }
  .stats {
    background: var(--bg2);
    border-radius: 8px;
    padding: 12px 18px;
    margin-bottom: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    font-size: 13px;
    color: var(--text-muted);
  }
  .stats strong { color: var(--text); }
  .day-separator { text-align: center; margin: 24px 0 16px; position: relative; }
  .day-separator::before {
    content: "";
    position: absolute;
    top: 50%; left: 0; right: 0;
    height: 1px;
    background: var(--sep);
  }
  .day-separator span {
    background: var(--bg);
    padding: 0 14px;
    position: relative;
    z-index: 1;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }
  .msg {
    display: flex;
    gap: 14px;
    padding: 3px 8px 3px 4px;
    border-radius: 4px;
    transition: background .08s;
  }
  .msg:hover     { background: rgba(0,0,0,.07); }
  .msg.bot       { background: rgba(88,101,242,.04); }
  .msg.bot:hover { background: rgba(88,101,242,.08); }
  .msg-system {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 4px 54px;
    color: var(--system-text);
    font-size: 13px;
    border-radius: 4px;
  }
  .msg-system:hover   { background: rgba(0,0,0,.05); }
  .system-icon        { font-size: 16px; flex-shrink: 0; }
  .system-text        { flex: 1; }
  .system-text strong { color: var(--text); }
  .msg-system .ts     { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
  .avatar {
    width: 40px; height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 2px;
    object-fit: cover;
    background: var(--bg3);
  }
  .msg-body    { flex: 1; min-width: 0; }
  .msg-header  { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; flex-wrap: wrap; }
  .author      { font-weight: 600; color: #fff; font-size: 15px; }
  .badge-bot {
    background: var(--accent);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: .5px;
  }
  .ts     { font-size: 11px; color: var(--text-muted); }
  .edited { font-size: 11px; color: var(--text-muted); font-style: italic; }
  .msg-content { color: var(--text); word-break: break-word; }
  .msg-content:empty { display: none; }
  code {
    background: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 3px;
    padding: 0 5px;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 13px;
    color: #e3e3e3;
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 6px;
    padding: 12px 16px;
    margin: 6px 0;
    overflow-x: auto;
  }
  pre code { background: none; border: none; padding: 0; font-size: 13px; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .msg-content h1 { font-size: 22px; font-weight: 700; color: #fff; margin: 8px 0 4px; border-bottom: 1px solid var(--sep); padding-bottom: 4px; }
  .msg-content h2 { font-size: 18px; font-weight: 700; color: #fff; margin: 6px 0 4px; border-bottom: 1px solid var(--sep); padding-bottom: 3px; }
  .msg-content h3 { font-size: 15px; font-weight: 700; color: #fff; margin: 4px 0 2px; }
  .msg-content ul, .msg-content ol, blockquote ul, blockquote ol { padding-left: 22px; margin: 4px 0; }
  .msg-content li, blockquote li { margin: 2px 0; }
  hr { border: none; border-top: 1px solid var(--sep); margin: 8px 0; }
  blockquote {
    border-left: 4px solid var(--bq-border);
    background: var(--bq-bg);
    padding: 6px 12px;
    margin: 4px 0;
    border-radius: 0 4px 4px 0;
    color: var(--text-muted);
  }
  blockquote strong { color: var(--text); }
  blockquote blockquote { margin-left: 4px; }
  .mention {
    background: var(--mention-bg);
    color: var(--mention-text);
    border-radius: 3px;
    padding: 0 4px;
    font-weight: 500;
    font-size: 14px;
    cursor: default;
  }
  .mention:hover { background: var(--accent); color: #fff; }
  .mention-role  { background: var(--mention-role-bg); color: var(--mention-role-text); }
  .mention-role:hover { background: #7c4dba; color: #fff; }
  .timestamp {
    background: var(--bg3);
    border-radius: 3px;
    padding: 0 4px;
    font-size: 13px;
    color: var(--text-muted);
  }
  .spoiler {
    background: var(--spoiler-bg);
    color: transparent;
    border-radius: 3px;
    padding: 0 4px;
    cursor: pointer;
    transition: color .15s, background .15s;
    user-select: none;
  }
  .spoiler.revealed { background: rgba(255,255,255,.1); color: var(--text); }
  .spoiler:hover:not(.revealed) { background: #333; }
  .emoji {
    width: 22px; height: 22px;
    vertical-align: middle;
    margin: 0 1px;
    object-fit: contain;
    display: inline-block;
  }
  .reply {
    background: var(--bg3);
    border-left: 3px solid var(--sep);
    padding: 3px 10px;
    margin-bottom: 5px;
    font-size: 12.5px;
    color: var(--text-muted);
    border-radius: 0 4px 4px 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 560px;
  }
  .attachment { margin-top: 8px; }
  .attachment-img {
    max-width: min(100%, 520px);
    max-height: 360px;
    border-radius: 6px;
    display: block;
    object-fit: contain;
    background: var(--bg3);
    border: 1px solid rgba(255,255,255,.04);
  }
  video.attachment-img { background: transparent; border: none; }
  .attachment-video { max-width: min(100%, 520px); max-height: 300px; border-radius: 6px; display: block; background: #000; }
  .attachment-audio { width: 100%; max-width: 400px; display: block; margin-bottom: 2px; border-radius: 6px; }
  .attachment-audio-name { font-size: 12px; color: var(--text-muted); }
  .attachment-file { font-size: 13px; }
  .sticker { margin-top: 8px; }
  .sticker-img { width: 160px; height: 160px; object-fit: contain; border-radius: 8px; display: block; image-rendering: pixelated; }
  .sticker-lottie {
    display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    background: var(--bg2); border: 1px solid var(--sep); border-radius: 8px;
    padding: 14px 20px; width: 160px; height: 160px;
  }
  .sticker-lottie-label { font-size: 13px; font-weight: 600; color: var(--text); }
  .sticker-lottie-hint  { font-size: 11px; color: var(--text-muted); }
  .sticker-error        { font-size: 13px; color: var(--text-muted); }
  .embed {
    background: var(--embed-bg);
    border-radius: 4px;
    border-left: 4px solid #4e5058;
    padding: 12px 16px 12px 12px;
    margin-top: 8px;
    max-width: 520px;
    display: flex;
    gap: 12px;
  }
  .embed-inner         { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .embed-thumbnail     { width: 80px; height: 80px; border-radius: 4px; flex-shrink: 0; object-fit: cover; align-self: flex-start; }
  .embed-provider      { font-size: 12px; color: var(--text-muted); font-weight: 500; }
  .embed-author        { display: flex; align-items: center; gap: 8px; }
  .embed-author-icon   { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
  .embed-author-name   { font-size: 13px; font-weight: 600; color: var(--text); text-decoration: none; }
  .embed-author-name:hover { text-decoration: underline; }
  .embed-title   { font-size: 14px; font-weight: 700; color: #fff; }
  .embed-title a { color: var(--link); text-decoration: none; }
  .embed-title a:hover { text-decoration: underline; }
  .embed-desc { font-size: 13px; color: var(--text-muted); line-height: 1.4; word-break: break-word; }
  .embed-desc code { font-size: 12px; }
  .embed-desc pre  { font-size: 12px; padding: 8px; margin: 4px 0; }
  .embed-desc blockquote { padding: 2px 8px; margin: 4px 0; }
  .embed-fields        { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .embed-field-inline  { display: flex; gap: 16px; flex-wrap: wrap; }
  .embed-field-inline-col { flex: 1; min-width: 80px; }
  .embed-field-name    { font-size: 12px; font-weight: 700; color: var(--text); margin-bottom: 2px; }
  .embed-field-value   { font-size: 13px; color: var(--text-muted); word-break: break-word; }
  .embed-image img     { max-width: 100%; max-height: 300px; border-radius: 4px; display: block; object-fit: contain; margin-top: 6px; }
  .embed-video video   { max-width: 100%; max-height: 260px; border-radius: 4px; display: block; background: #000; margin-top: 6px; }
  .embed-footer        { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
  .embed-footer-icon   { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
  .embed-footer-sep    { opacity: .5; }
  .reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .reaction {
    background: var(--reaction-bg);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 8px;
    padding: 3px 8px;
    font-size: 12px;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }
  .reaction:hover { background: rgba(88,101,242,.3); border-color: var(--accent); }
  .reaction-emoji { width: 16px; height: 16px; vertical-align: middle; object-fit: contain; }
  footer {
    text-align: center;
    padding: 28px;
    color: var(--text-muted);
    font-size: 12px;
    border-top: 1px solid var(--sep);
    margin-top: 40px;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: var(--bg3); }
  ::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #777; }
"""


def build_html(*, channel_name, guild_name, is_dm, dm_with, messages) -> str:
    mention_maps = build_mention_maps(messages)

    last_day = None
    parts = []
    for m in messages:
        day = datetime.fromtimestamp(m["timestamp"] / 1000).strftime("%d/%m/%Y")
        day_sep = ""
        if day != last_day:
            last_day = day
            day_sep = f'<div class="day-separator"><span>{day}</span></div>'
        parts.append(day_sep + render_message(m, mention_maps))
    msg_html = "\n".join(parts)

    header_icon = "💬" if is_dm else "#"
    header_class = "dm-header" if is_dm else ""
    badge_dm = '<span class="badge-dm">MP</span>' if is_dm else ""

    if is_dm:
        title_display = f"MP avec {escape_html(dm_with)}" if dm_with else "Conversation privée"
        sub_display = f"Groupe : {escape_html(guild_name)}" if guild_name else None
    else:
        title_display = f"#{escape_html(channel_name)}"
        sub_display = escape_html(guild_name) if guild_name else None

    first_ts = format_ts(messages[0]["timestamp"]) if len(messages) >= 1 else None
    last_ts = format_ts(messages[-1]["timestamp"]) if len(messages) >= 2 else None
    now = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    sub_html = f'<div class="header-meta">{sub_display}</div>' if sub_display else ""
    first_html = f"<div>📅 Du <strong>{first_ts}</strong></div>" if first_ts else ""
    last_html = f"<div>au <strong>{last_ts}</strong></div>" if last_ts else ""
    dm_html = "<div>💬 <strong>Message privé</strong></div>" if is_dm else ""

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Snapshot — {escape_html(title_display)}</title>
<style>{CSS}</style>
</head>
<body>
<header class="{header_class}">
  <div class="header-icon">{header_icon}</div>
  <div>
    <h1>{escape_html(title_display)}{badge_dm}</h1>
    {sub_html}
  </div>
</header>
<div class="container">
  <div class="stats">
    <div>📋 <strong>{len(messages)}</strong> messages</div>
    {first_html}
    {last_html}
    <div>🕐 Généré le <strong>{now}</strong></div>
    {dm_html}
  </div>
  <div class="messages">
{msg_html}
  </div>
</div>
<footer>📸 Snapshot généré par <strong>EtherSelf</strong> — {len(messages)} messages archivés</footer>
</body>
</html>"""

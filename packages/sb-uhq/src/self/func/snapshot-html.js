"use strict";

// ─────────────────────────────────────────────────────────────────────────────
//  SNAPSHOT HTML — Rendu visuel des snapshots de salon / MP
//  Ce fichier gère uniquement la partie présentation :
//    - helpers d'échappement / formatage
//    - rendu markdown → HTML
//    - rendu des embeds, stickers, réactions, pièces jointes
//    - construction du document HTML complet
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers de base ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTs(ts) {
  try { return new Date(ts).toLocaleString("fr-FR"); }
  catch { return String(ts); }
}

function emojiCdnUrl(emojiId, animated) {
  if (animated) return `https://cdn.discordapp.com/emojis/${emojiId}.gif?size=64&quality=lossless`;
  return `https://cdn.discordapp.com/emojis/${emojiId}.png?size=64`;
}

function stickerCdnUrl(sticker) {
  const { id, format_type } = sticker;
  if (format_type === 3) return null;
  if (format_type === 4 || format_type === 2) return `https://media.discordapp.net/stickers/${id}.gif?size=240`;
  return `https://media.discordapp.net/stickers/${id}.png?size=240`;
}

function resolveUrl(val) {
  if (!val) return null;
  if (typeof val === "function") { try { return val() ?? null; } catch { return null; } }
  if (typeof val === "string") return val || null;
  return null;
}

// ── Labels des messages système ───────────────────────────────────────────────

const SYSTEM_MESSAGE_LABELS = {
  1:  "a rejoint le groupe",
  2:  "a quitté le groupe",
  3:  "a lancé un appel",
  4:  "a changé le nom du canal",
  5:  "a changé l'icône du groupe",
  6:  "a épinglé un message",
  7:  "a rejoint le serveur",
  8:  "a boosté le serveur",
  9:  "a boosté le serveur au niveau 1",
  10: "a boosté le serveur au niveau 2",
  11: "a boosté le serveur au niveau 3",
  12: "a suivi le canal",
  14: "a été disqualifié de la découverte",
  15: "a été requalifié dans la découverte",
  16: "avertissement découverte (grâce initiale)",
  17: "avertissement découverte (dernier avertissement)",
  18: "a créé un fil de discussion",
  22: "a créé un fil à partir d'un message",
  23: "rappel de règles du serveur",
  25: "action automatique de modération",
  26: "achat d'abonnement",
  27: "interaction premium",
  28: "étape de bienvenue terminée",
  29: "scène terminée",
  30: "speaker invité sur scène",
  32: "sujet de scène",
  36: "achat d'abonnement",
  RECIPIENT_ADD:                          "a rejoint le groupe",
  RECIPIENT_REMOVE:                       "a quitté le groupe",
  CALL:                                   "a lancé un appel",
  CHANNEL_NAME_CHANGE:                    "a changé le nom du canal",
  CHANNEL_ICON_CHANGE:                    "a changé l'icône du groupe",
  CHANNEL_PINNED_MESSAGE:                 "a épinglé un message",
  GUILD_MEMBER_JOIN:                      "a rejoint le serveur",
  USER_PREMIUM_GUILD_SUBSCRIPTION:        "a boosté le serveur",
  USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1: "a boosté le serveur au niveau 1",
  USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2: "a boosté le serveur au niveau 2",
  USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3: "a boosté le serveur au niveau 3",
  CHANNEL_FOLLOW_ADD:                     "a suivi le canal",
  GUILD_DISCOVERY_DISQUALIFIED:           "a été disqualifié de la découverte",
  GUILD_DISCOVERY_REQUALIFIED:            "a été requalifié dans la découverte",
  THREAD_CREATED:                         "a créé un fil de discussion",
  GUILD_INVITE_REMINDER:                  "rappel de règles du serveur",
  AUTO_MODERATION_ACTION:                 "modération automatique",
};

const SYSTEM_TYPES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 22, 23, 25, 26, 27, 28, 29, 30, 32, 36,
  "RECIPIENT_ADD", "RECIPIENT_REMOVE", "CALL", "CHANNEL_NAME_CHANGE", "CHANNEL_ICON_CHANGE",
  "CHANNEL_PINNED_MESSAGE", "GUILD_MEMBER_JOIN",
  "USER_PREMIUM_GUILD_SUBSCRIPTION", "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1",
  "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2", "USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3",
  "CHANNEL_FOLLOW_ADD", "GUILD_DISCOVERY_DISQUALIFIED", "GUILD_DISCOVERY_REQUALIFIED",
  "THREAD_CREATED", "GUILD_INVITE_REMINDER", "AUTO_MODERATION_ACTION",
]);

function isSystemMessage(msgType) { return SYSTEM_TYPES.has(msgType); }
function getSystemLabel(msgType)  { return SYSTEM_MESSAGE_LABELS[msgType] ?? `message système (type ${msgType})`; }
function getSystemIcon(msgType) {
  const icons = {
    7:  "👋", GUILD_MEMBER_JOIN:                      "👋",
    8:  "🚀", USER_PREMIUM_GUILD_SUBSCRIPTION:        "🚀",
    9:  "🚀", USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_1: "🚀",
    10: "🚀", USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_2: "🚀",
    11: "🚀", USER_PREMIUM_GUILD_SUBSCRIPTION_TIER_3: "🚀",
    6:  "📌", CHANNEL_PINNED_MESSAGE:                 "📌",
    18: "🧵", THREAD_CREATED:                         "🧵",
    1:  "➕", RECIPIENT_ADD:                          "➕",
    2:  "➖", RECIPIENT_REMOVE:                       "➖",
    3:  "📞", CALL:                                   "📞",
    12: "📢", CHANNEL_FOLLOW_ADD:                     "📢",
    25: "🛡️", AUTO_MODERATION_ACTION:                "🛡️",
  };
  return icons[msgType] ?? "ℹ️";
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────
// mentionMaps = { users: Map<id, tag>, roles: Map<id, name> }

function renderContent(content, mentionMaps = {}) {
  if (!content) return "";

  const usersMap = mentionMaps.users instanceof Map ? mentionMaps.users : new Map();
  const rolesMap = mentionMaps.roles instanceof Map ? mentionMaps.roles : new Map();

  const placeholders = [];

  function stash(html) {
    const idx = placeholders.length;
    placeholders.push(html);
    return `\x00PH${idx}\x00`;
  }

  function unstash(str) {
    return str.replace(/\x00PH(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)] ?? "");
  }

  let s = content;

  // Blocs de code
  s = s.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code.replace(/^\n|\n$/g, ""));
    return stash(`<pre><code class="lang-${escapeHtml(lang || "")}">${escaped}</code></pre>`);
  });

  // Code inline
  s = s.replace(/`([^`\n]+)`/g, (_, code) =>
    stash(`<code>${escapeHtml(code)}</code>`)
  );

  // Emojis custom
  s = s.replace(/<(a?):(\w+):(\d+)>/g, (_, a, name, id) => {
    const animated = a === "a";
    const url      = emojiCdnUrl(id, animated);
    const safe     = escapeHtml(name);
    return stash(
      `<img class="emoji" src="${url}" alt=":${safe}:" title=":${safe}:" ` +
      `onerror="this.style.display='none';this.insertAdjacentText('afterend',':${safe}:')">`
    );
  });

  // Échapper HTML
  s = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Liens markdown
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_, text, url) => stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`)
  );

  // Liens bruts
  s = s.replace(/(https?:\/\/[^\s<>"&\x00]+)/g, (url) =>
    stash(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
  );

  // Spoilers
  s = s.replace(/\|\|(.+?)\|\|/gs, (_, t) =>
    stash(`<span class="spoiler" onclick="this.classList.toggle('revealed')">${t}</span>`)
  );

  // Gras + italique
  s = s.replace(/\*\*\*(.+?)\*\*\*/gs, (_, t) => stash(`<strong><em>${t}</em></strong>`));
  s = s.replace(/\*\*(.+?)\*\*/gs,     (_, t) => stash(`<strong>${t}</strong>`));
  s = s.replace(/\*([^*\n]+)\*/g,      (_, t) => stash(`<em>${t}</em>`));
  s = s.replace(/__(.+?)__/gs,         (_, t) => stash(`<u>${t}</u>`));
  s = s.replace(/_([^_\n]+)_/g,        (_, t) => stash(`<em>${t}</em>`));
  s = s.replace(/~~(.+?)~~/gs,         (_, t) => stash(`<del>${t}</del>`));

  // Mentions utilisateur
  s = s.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
    const name    = usersMap.get(id);
    const display = name ? `@${name}` : `@${id}`;
    return stash(`<span class="mention">${escapeHtml(display)}</span>`);
  });

  // Mentions salon
  s = s.replace(/&lt;#(\d+)&gt;/g, (_, id) =>
    stash(`<span class="mention">#${id}</span>`)
  );

  // Mentions rôle
  s = s.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
    const name    = rolesMap.get(id);
    const display = name ? `@${name}` : `@role`;
    return stash(`<span class="mention mention-role">${escapeHtml(display)}</span>`);
  });

  // Timestamps Discord
  s = s.replace(/&lt;t:(\d+)(?::([tTdDfFR]))?&gt;/g, (_, ts) => {
    try {
      const date = new Date(parseInt(ts, 10) * 1000);
      return stash(`<span class="timestamp">${date.toLocaleString("fr-FR")}</span>`);
    } catch { return stash(`<span class="timestamp">${ts}</span>`); }
  });

  // Rendu ligne par ligne (titres, listes, blockquotes, HR)
  const lines = s.split("\n");
  const out   = [];
  let inUl    = false;
  let inOl    = false;
  let bqBuf   = [];

  function flushUl() { if (inUl) { out.push("</ul>"); inUl = false; } }
  function flushOl() { if (inOl) { out.push("</ol>"); inOl = false; } }
  function flushLists() { flushUl(); flushOl(); }
  function flushBq() {
    if (!bqBuf.length) return;
    const inner = renderContent(
      bqBuf.map(l => l.replace(/^(&gt;|>)\s?/, "")).join("\n"),
      mentionMaps
    );
    out.push(`<blockquote>${inner}</blockquote>`);
    bqBuf = [];
  }
  function flushAll() { flushLists(); flushBq(); }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h3 = line.match(/^### (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h1 = line.match(/^# (.+)$/);
    if (h3) { flushAll(); out.push(`<h3>${h3[1]}</h3>`); continue; }
    if (h2) { flushAll(); out.push(`<h2>${h2[1]}</h2>`); continue; }
    if (h1) { flushAll(); out.push(`<h1>${h1[1]}</h1>`); continue; }

    if (/^(&gt;|>) /.test(line)) {
      flushLists();
      bqBuf.push(line);
      while (i + 1 < lines.length && /^(&gt;|>) /.test(lines[i + 1])) {
        i++;
        bqBuf.push(lines[i]);
      }
      flushBq();
      continue;
    }

    const ulMatch = line.match(/^[-*•] (.+)$/);
    if (ulMatch) {
      flushBq(); flushOl();
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${ulMatch[1]}</li>`);
      continue;
    }

    const olMatch = line.match(/^(\d+)\. (.+)$/);
    if (olMatch) {
      flushBq(); flushUl();
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${olMatch[2]}</li>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      out.push("<br>");
      continue;
    }

    flushAll();
    out.push(`<span class="line">${line}</span><br>`);
  }

  flushAll();
  return unstash(out.join(""));
}

// ── Rendu des champs d'embed ──────────────────────────────────────────────────

function renderEmbedFields(fields, mentionMaps) {
  if (!fields || !fields.length) return "";

  const rows = [];
  let currentRow = [];

  for (const field of fields) {
    if (field.inline) {
      currentRow.push(field);
      if (currentRow.length === 3) { rows.push({ type: "inline", fields: currentRow }); currentRow = []; }
    } else {
      if (currentRow.length > 0) { rows.push({ type: "inline", fields: currentRow }); currentRow = []; }
      rows.push({ type: "block", field });
    }
  }
  if (currentRow.length > 0) rows.push({ type: "inline", fields: currentRow });

  return rows.map(row => {
    if (row.type === "block") {
      const f = row.field;
      return `<div class="embed-field embed-field-block">
        <div class="embed-field-name">${renderContent(f.name, mentionMaps)}</div>
        <div class="embed-field-value">${renderContent(f.value, mentionMaps)}</div>
      </div>`;
    }
    const cols = row.fields.map(f =>
      `<div class="embed-field-inline-col">
        <div class="embed-field-name">${renderContent(f.name, mentionMaps)}</div>
        <div class="embed-field-value">${renderContent(f.value, mentionMaps)}</div>
      </div>`
    ).join("");
    return `<div class="embed-field embed-field-inline">${cols}</div>`;
  }).join("");
}

// ── Rendu d'un embed complet ──────────────────────────────────────────────────

function renderEmbed(e, mentionMaps) {
  // Embeds GIF / image pure
  if (e.type === "gifv" || e.type === "image") {
    if (e.videoUrl) {
      return `<div class="attachment">
        <video class="attachment-img" src="${escapeHtml(e.videoUrl)}" autoplay loop muted playsinline
          onerror="this.outerHTML='<img class=\\'attachment-img\\' src=\\'${escapeHtml(e.thumbnailUrl || e.imageUrl || "")}\\' alt=\\'gif\\' loading=\\'lazy\\'>'">
        </video>
      </div>`;
    }
    const gifUrl = e.imageUrl || e.thumbnailUrl;
    if (gifUrl) return `<div class="attachment"><img class="attachment-img" src="${escapeHtml(gifUrl)}" alt="gif" loading="lazy"></div>`;
    if (e.url)  return `<div class="attachment"><a class="attachment-file" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">🎞️ ${escapeHtml(e.url)}</a></div>`;
    return "";
  }

  const colorStyle = e.color != null
    ? `border-left-color: #${e.color.toString(16).padStart(6, "0")};`
    : "";

  // Embeds de type lien
  if (e.type === "link") {
    return `<div class="embed" style="${colorStyle}">
      <div class="embed-inner">
        ${e.title       ? `<div class="embed-title">${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${renderContent(e.title, mentionMaps)}</a>` : renderContent(e.title, mentionMaps)}</div>` : ""}
        ${e.description ? `<div class="embed-desc">${renderContent(e.description, mentionMaps)}</div>` : ""}
        ${e.imageUrl    ? `<div class="embed-image"><img src="${escapeHtml(e.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>` : ""}
      </div>
    </div>`;
  }

  // Embeds rich (défaut)
  const providerHtml = e.provider
    ? `<div class="embed-provider">${escapeHtml(e.provider.name ?? "")}</div>`
    : "";

  const authorHtml = e.author
    ? `<div class="embed-author">
        ${e.author.iconUrl ? `<img class="embed-author-icon" src="${escapeHtml(e.author.iconUrl)}" alt="" onerror="this.style.display='none'">` : ""}
        ${e.author.url
          ? `<a class="embed-author-name" href="${escapeHtml(e.author.url)}" target="_blank" rel="noopener">${renderContent(e.author.name, mentionMaps)}</a>`
          : `<span class="embed-author-name">${renderContent(e.author.name, mentionMaps)}</span>`}
      </div>`
    : "";

  const titleHtml = e.title
    ? `<div class="embed-title">${e.url
        ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${renderContent(e.title, mentionMaps)}</a>`
        : renderContent(e.title, mentionMaps)}</div>`
    : "";

  const descHtml      = e.description ? `<div class="embed-desc">${renderContent(e.description, mentionMaps)}</div>` : "";
  const fieldsHtml    = renderEmbedFields(e.fields, mentionMaps);
  const imageHtml     = e.imageUrl     ? `<div class="embed-image"><img src="${escapeHtml(e.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>` : "";
  const thumbnailHtml = e.thumbnailUrl ? `<img class="embed-thumbnail" src="${escapeHtml(e.thumbnailUrl)}" alt="" onerror="this.style.display='none'">` : "";
  const videoHtml     = e.videoUrl && e.type !== "gifv" ? `<div class="embed-video"><video controls src="${escapeHtml(e.videoUrl)}" onerror="this.style.display='none'"></video></div>` : "";

  const footerHtml = (e.footer || e.timestamp)
    ? `<div class="embed-footer">
        ${e.footerIconUrl ? `<img class="embed-footer-icon" src="${escapeHtml(e.footerIconUrl)}" alt="" onerror="this.style.display='none'">` : ""}
        ${e.footer    ? `<span>${escapeHtml(e.footer)}</span>` : ""}
        ${e.footer && e.timestamp ? `<span class="embed-footer-sep">•</span>` : ""}
        ${e.timestamp ? `<span>${formatTs(e.timestamp)}</span>` : ""}
      </div>`
    : "";

  return `<div class="embed" style="${colorStyle}">
    ${thumbnailHtml}
    <div class="embed-inner">
      ${providerHtml}${authorHtml}${titleHtml}${descHtml}
      ${fieldsHtml ? `<div class="embed-fields">${fieldsHtml}</div>` : ""}
      ${imageHtml}${videoHtml}${footerHtml}
    </div>
  </div>`;
}

// ── Rendu d'un sticker ────────────────────────────────────────────────────────

function renderSticker(sticker) {
  const url      = stickerCdnUrl(sticker);
  const safeName = escapeHtml(sticker.name ?? "sticker");

  if (!url) {
    return `<div class="sticker sticker-lottie" title="${safeName}">
      <span class="sticker-lottie-label">🎭 ${safeName}</span>
      <span class="sticker-lottie-hint">Sticker animé (Lottie)</span>
    </div>`;
  }

  return `<div class="sticker">
    <img class="sticker-img" src="${escapeHtml(url)}" alt="${safeName}" title="${safeName}" loading="lazy"
      onerror="this.parentElement.innerHTML='<span class=\\'sticker-error\\'>🎭 ${safeName}</span>'">
  </div>`;
}

// ── Rendu HTML d'un message ───────────────────────────────────────────────────

function renderMessage(m, mentionMaps) {
  const ts = formatTs(m.timestamp);

  // Messages système
  if (m.isSystem) {
    const label = getSystemLabel(m.messageType);
    const icon  = getSystemIcon(m.messageType);
    return `<div class="msg-system" id="msg-${m.id}">
  <span class="system-icon">${icon}</span>
  <span class="system-text">
    <strong>${escapeHtml(m.authorTag)}</strong> ${escapeHtml(label)}
    ${m.content ? ` — <em>${escapeHtml(m.content.slice(0, 100))}</em>` : ""}
  </span>
  <span class="ts">${ts}</span>
</div>`;
  }

  // Avatar
  let avatarUrl;
  if (m.authorAvatar) {
    const ext = m.authorAvatar.startsWith("a_") ? "gif" : "png";
    avatarUrl = `https://cdn.discordapp.com/avatars/${m.authorId}/${m.authorAvatar}.${ext}?size=80`;
  } else {
    const idx = (BigInt(m.authorId || "0") >> 22n) % 6n;
    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }

  // Pièces jointes
  const attachmentsHtml = (m.attachments || []).map(att => {
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(att.url);
    const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(att.url);
    const isAudio = /\.(mp3|wav|ogg|flac|aac)(\?.*)?$/i.test(att.url);
    if (isImage) return `<div class="attachment"><img class="attachment-img" src="${escapeHtml(att.url)}" alt="${escapeHtml(att.name || "image")}" loading="lazy" onerror="this.outerHTML='<a class=\\'attachment-file\\' href=\\'${escapeHtml(att.url)}\\' target=\\'_blank\\'>📎 ${escapeHtml(att.name || att.url)}</a>'"></div>`;
    if (isVideo) return `<div class="attachment"><video class="attachment-video" controls src="${escapeHtml(att.url)}"></video></div>`;
    if (isAudio) return `<div class="attachment"><audio class="attachment-audio" controls src="${escapeHtml(att.url)}"></audio><span class="attachment-audio-name">🎵 ${escapeHtml(att.name || att.url)}</span></div>`;
    return `<div class="attachment"><a class="attachment-file" href="${escapeHtml(att.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(att.name || att.url)}</a></div>`;
  }).join("");

  const embedsHtml    = (m.embeds   || []).map(e => renderEmbed(e, mentionMaps)).join("");
  const stickersHtml  = (m.stickers || []).map(renderSticker).join("");

  const replyHtml = m.replyAuthor
    ? `<div class="reply">↩ <strong>${escapeHtml(m.replyAuthor)}</strong>${m.replyContent ? `: ${escapeHtml(m.replyContent.slice(0, 120))}` : ""}</div>`
    : "";

  const reactionsHtml = (m.reactions || []).length
    ? `<div class="reactions">${m.reactions.map(r => {
        const emojiHtml = r.emojiId
          ? `<img class="reaction-emoji" src="${emojiCdnUrl(r.emojiId, r.animated ?? false)}" alt="${escapeHtml(r.emojiName || "")}" onerror="this.replaceWith(document.createTextNode('${escapeHtml(r.emojiName || "?")}'))">`
          : escapeHtml(r.emoji);
        return `<span class="reaction">${emojiHtml} ${r.count}</span>`;
      }).join("")}</div>`
    : "";

  const initials = escapeHtml((m.authorTag || "?")[0].toUpperCase());

  return `<div class="msg${m.isBot ? " bot" : ""}" id="msg-${m.id}">
  <img class="avatar" src="${avatarUrl}" alt="${escapeHtml(m.authorTag)}" loading="lazy"
    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%235865F2%22 rx=%2220%22/><text x=%2220%22 y=%2226%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2218%22 font-family=%22sans-serif%22>${initials}</text></svg>'">
  <div class="msg-body">
    <div class="msg-header">
      <span class="author">${escapeHtml(m.authorTag)}</span>
      ${m.isBot ? '<span class="badge-bot">BOT</span>' : ""}
      <span class="ts" title="${new Date(m.timestamp).toISOString()}">${ts}</span>
      ${m.editedAt ? `<span class="edited">(édité)</span>` : ""}
    </div>
    ${replyHtml}
    <div class="msg-content">${renderContent(m.content, mentionMaps)}</div>
    ${attachmentsHtml}${stickersHtml}${embedsHtml}${reactionsHtml}
  </div>
</div>`;
}

// ── Construction des maps de mentions ─────────────────────────────────────────

function buildMentionMaps(messages) {
  const users = new Map();
  const roles = new Map();

  for (const m of messages) {
    if (m.authorId && m.authorTag) {
      users.set(m.authorId, m.authorTag);
    }
    if (Array.isArray(m.mentionedUsers)) {
      for (const u of m.mentionedUsers) {
        if (u.id && u.tag) users.set(u.id, u.tag);
      }
    }
    if (Array.isArray(m.mentionedRoles)) {
      for (const r of m.mentionedRoles) {
        if (r.id && r.name) roles.set(r.id, r.name);
      }
    }
  }

  return { users, roles };
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
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
`;

// ── Construction du document HTML complet ─────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}  opts.channelName    Nom du salon ou de l'utilisateur (DM)
 * @param {string|null} opts.guildName  Nom du serveur (null si DM)
 * @param {boolean} opts.isDm           true si c'est un DM ou Group DM
 * @param {string|null} opts.dmWith     Tag de l'autre utilisateur (DM uniquement)
 * @param {object[]} opts.messages      Messages sérialisés
 */
function buildHtml({ channelName, guildName, isDm, dmWith, messages }) {
  const mentionMaps = buildMentionMaps(messages);

  let lastDay = null;
  const msgHtml = messages.map(m => {
    const day = new Date(m.timestamp).toLocaleDateString("fr-FR");
    let daySep = "";
    if (day !== lastDay) {
      lastDay = day;
      daySep  = `<div class="day-separator"><span>${day}</span></div>`;
    }
    return daySep + renderMessage(m, mentionMaps);
  }).join("\n");

  const headerIcon = isDm ? "💬" : "#";
  const headerClass = isDm ? "dm-header" : "";
  const badgeDm     = isDm ? `<span class="badge-dm">MP</span>` : "";

  const titleDisplay  = isDm
    ? (dmWith ? `MP avec ${escapeHtml(dmWith)}` : `Conversation privée`)
    : `#${escapeHtml(channelName)}`;
  const subDisplay    = isDm
    ? (guildName ? `Groupe : ${escapeHtml(guildName)}` : null)
    : (guildName ? escapeHtml(guildName) : null);

  const firstTs = messages.length >= 1 ? formatTs(messages[0].timestamp) : null;
  const lastTs  = messages.length >= 2 ? formatTs(messages[messages.length - 1].timestamp) : null;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Snapshot — ${escapeHtml(titleDisplay)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="${headerClass}">
  <div class="header-icon">${headerIcon}</div>
  <div>
    <h1>${escapeHtml(titleDisplay)}${badgeDm}</h1>
    ${subDisplay ? `<div class="header-meta">${subDisplay}</div>` : ""}
  </div>
</header>
<div class="container">
  <div class="stats">
    <div>📋 <strong>${messages.length}</strong> messages</div>
    ${firstTs ? `<div>📅 Du <strong>${firstTs}</strong></div>` : ""}
    ${lastTs  ? `<div>au <strong>${lastTs}</strong></div>`     : ""}
    <div>🕐 Généré le <strong>${new Date().toLocaleString("fr-FR")}</strong></div>
    ${isDm ? `<div>💬 <strong>Message privé</strong></div>` : ""}
  </div>
  <div class="messages">
${msgHtml}
  </div>
</div>
<footer>📸 Snapshot généré par <strong>EtherSelf</strong> — ${messages.length} messages archivés</footer>
</body>
</html>`;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  buildHtml,
  renderMessage,
  renderEmbed,
  renderContent,
  buildMentionMaps,
  escapeHtml,
  isSystemMessage,
  resolveUrl,
};
"use strict";

const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { signedHeaders } = require("../../../bridge/auth");
const { makeDesktopHeaders } = require("../../func/discord-client-headers");

const BRIDGE_CONTROLLER_URL = process.env.BRIDGE_CONTROLLER_URL ?? "http://127.0.0.1:3001";

// ── Constantes de rate-limit ──────────────────────────────────────────────────
const PARALLEL_DELETE = 5;
const BATCH_DELAY_MS  = 50;

// ── Registre des jobs actifs (pour annulation) ────────────────────────────────

const activeJobs = new Map();

function registerJob(jobId) {
  activeJobs.set(jobId, { cancelled: false });
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job) {
    job.cancelled = true;
    return true;
  }
  return false;
}

function isCancelled(jobId) {
  return activeJobs.get(jobId)?.cancelled === true;
}

function cleanJob(jobId) {
  activeJobs.delete(jobId);
}

// ── Helper : notifie le bot-controller de la progression ─────────────────────

async function notifyProgress(jobId, data) {
  const body = JSON.stringify({ jobId, ...data });
  fetch(`${BRIDGE_CONTROLLER_URL}/progress`, {
    method:  "POST",
    headers: signedHeaders(body, { "Content-Type": "application/json" }),
    body,
  }).catch(() => {});
}

// ── Helper : vérifie si le selfbot a au moins un message dans un salon ────────
//
// On utilise l'endpoint de recherche Discord qui supporte author_id.
// Pour les salons de serveur : /channels/{id}/messages/search?author_id=...
// Pour les DMs               : /channels/{id}/messages/search?author_id=...
//
// Cet endpoint n'est disponible que pour les comptes utilisateur (selfbot),
// pas pour les bots classiques.
//
// En cas d'échec (rate-limit, 403, erreur réseau), on retourne `true` par
// sécurité pour ne pas rater de suppressions.
//
async function hasOwnMessages(client, channelId) {
  try {
    const res = await fetch(
      `https://discord.com/api/v9/channels/${channelId}/messages/search?author_id=${client.user.id}&limit=1`,
      {
        headers: makeDesktopHeaders(client.token),
      }
    );

    // 404 = salon introuvable ou pas d'accès → skip sans risque
    if (res.status === 404) return false;
    // 403 = pas les perms de chercher → on ne skip pas, le purgeChannel gèrera
    if (res.status === 403) return true;
    // Autre erreur (rate-limit 429, 5xx…) → optimiste, on ne skip pas
    if (!res.ok) return true;

    const data = await res.json();
    // La réponse de search a la forme { total_results: N, messages: [[...]] }
    return (data?.total_results ?? 0) > 0;
  } catch {
    return true;
  }
}

// ── Helper : purge un salon unique ────────────────────────────────────────────

async function purgeChannel(client, channel, limit = Infinity, jobId = null) {
  let deleted = 0;
  let lastId  = undefined;

  while (deleted < limit) {
    if (jobId && isCancelled(jobId)) break;

    const batch = await channel.messages
      .fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) })
      .catch(() => null);
    if (!batch || !batch.size) break;

    const own = [...batch.values()].filter(m => m.author.id === client.user.id);

    const toDelete = limit < Infinity
      ? own.slice(0, limit - deleted)
      : own;

    for (let i = 0; i < toDelete.length; i += PARALLEL_DELETE) {
      if (jobId && isCancelled(jobId)) break;

      const group = toDelete.slice(i, i + PARALLEL_DELETE);
      const results = await Promise.allSettled(group.map(msg => msg.delete()));

      for (const r of results) {
        if (r.status === "fulfilled") deleted++;
      }

      if (i + PARALLEL_DELETE < toDelete.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return deleted;
}

// ── Logique principale ────────────────────────────────────────────────────────

/**
 * @param {import("discord.js-selfbot-v13").Client} client
 * @param {{
 *   channelId?: string,
 *   amount?: number,
 *   scope?: "channel"|"dms"|"guilds"|"guild",
 *   guildId?: string,
 *   jobId?: string
 * }} payload
 */
async function execute(client, payload) {
  const { channelId, amount, scope = "channel", jobId, guildId } = payload;

  // ── Annulation d'un job en cours ──────────────────────────────────────────
  if (scope === "cancel") {
    if (!jobId) throw new Error("jobId requis pour annuler.");
    const cancelled = cancelJob(jobId);
    return { cancelled };
  }

  // ── Purge salon unique ────────────────────────────────────────────────────
  if (scope === "channel") {
    if (!channelId) throw new Error("channelId requis.");
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) throw new Error(`Salon ${channelId} introuvable.`);
    const limit   = amount ? Math.min(Math.max(parseInt(amount, 10), 1), 100) : Infinity;

    if (jobId) registerJob(jobId);
    const deleted = await purgeChannel(client, channel, limit, jobId);
    if (jobId) {
      cleanJob(jobId);
      await notifyProgress(jobId, {
        scope:       "channel",
        queue:       [],
        activeLabel: null,
        doneCount:   1,
        total:       1,
        totalDeleted: deleted,
        done:        true,
        cancelled:   false,
      });
    }
    return { deleted, scope: "channel" };
  }

  // ── Purge tous les DMs ────────────────────────────────────────────────────
  if (scope === "dms") {
    const dmChannels = [...client.channels.cache.values()].filter(c => c.type === "DM");
    let totalDeleted = 0;
    let doneCount    = 0;

    registerJob(jobId);

    // ── Pré-filtrage : on élimine les DMs où le selfbot n'a rien envoyé ──────
    // On vérifie en parallèle par groupes de 10 pour ne pas saturer le rate-limit.
    const CHECK_CONCURRENCY = 10;
    const filtered = [];

    for (let i = 0; i < dmChannels.length; i += CHECK_CONCURRENCY) {
      if (isCancelled(jobId)) break;
      const batch = dmChannels.slice(i, i + CHECK_CONCURRENCY);
      const checks = await Promise.all(
        batch.map(async ch => ({ ch, has: await hasOwnMessages(client, ch.id) }))
      );
      for (const { ch, has } of checks) {
        if (has) filtered.push(ch);
      }
      // Petit délai entre les groupes de checks pour le rate-limit
      if (i + CHECK_CONCURRENCY < dmChannels.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const total = filtered.length;

    const queue = filtered.map(ch => ({
      id:    ch.id,
      label: ch.recipient?.tag ?? ch.recipient?.username ?? ch.id,
    }));

    if (jobId) {
      await notifyProgress(jobId, {
        scope: "dms",
        queue,
        activeLabel: null,
        doneCount:   0,
        total,
        totalDeleted: 0,
        done:      false,
        cancelled: false,
      });
    }

    for (let i = 0; i < filtered.length; i++) {
      if (isCancelled(jobId)) {
        await notifyProgress(jobId, {
          scope: "dms",
          queue: queue.slice(i),
          activeLabel: null,
          doneCount,
          total,
          totalDeleted,
          done:      true,
          cancelled: true,
        });
        cleanJob(jobId);
        return { deleted: totalDeleted, scope: "dms", cancelled: true };
      }

      const ch    = filtered[i];
      const label = queue[i]?.label ?? ch.id;

      const remaining = queue.slice(i + 1);
      if (jobId) {
        await notifyProgress(jobId, {
          scope: "dms",
          queue:       remaining,
          activeLabel: label,
          doneCount,
          total,
          totalDeleted,
          done:      false,
          cancelled: false,
        });
      }

      const deleted  = await purgeChannel(client, ch, Infinity, jobId);
      totalDeleted  += deleted;
      doneCount++;

      if (jobId) {
        await notifyProgress(jobId, {
          scope: "dms",
          queue:       remaining,
          activeLabel: null,
          doneCount,
          total,
          totalDeleted,
          done:      false,
          cancelled: false,
        });
      }
    }

    const wasCancelled = isCancelled(jobId);
    cleanJob(jobId);

    if (jobId) {
      await notifyProgress(jobId, {
        scope: "dms",
        queue:       [],
        activeLabel: null,
        doneCount,
        total,
        totalDeleted,
        done:      true,
        cancelled: wasCancelled,
      });
    }

    return { deleted: totalDeleted, scope: "dms", cancelled: wasCancelled };
  }

  // ── Purge tous les serveurs ───────────────────────────────────────────────
  if (scope === "guilds") {
    const guildsArr  = [...client.guilds.cache.values()];
    let totalDeleted = 0;
    let doneCount    = 0;
    const total      = guildsArr.length;

    registerJob(jobId);

    const queue = guildsArr.map(g => ({
      id:    g.id,
      label: g.name ?? g.id,
    }));

    if (jobId) {
      await notifyProgress(jobId, {
        scope: "guilds",
        queue,
        activeLabel: null,
        doneCount:   0,
        total,
        totalDeleted: 0,
        done:      false,
        cancelled: false,
      });
    }

    for (let i = 0; i < guildsArr.length; i++) {
      if (isCancelled(jobId)) {
        await notifyProgress(jobId, {
          scope: "guilds",
          queue: queue.slice(i),
          activeLabel: null,
          doneCount,
          total,
          totalDeleted,
          done:      true,
          cancelled: true,
        });
        cleanJob(jobId);
        return { deleted: totalDeleted, scope: "guilds", cancelled: true };
      }

      const guild = guildsArr[i];
      const label = queue[i]?.label ?? guild.id;

      const remaining = queue.slice(i + 1);
      if (jobId) {
        await notifyProgress(jobId, {
          scope: "guilds",
          queue:       remaining,
          activeLabel: label,
          doneCount,
          total,
          totalDeleted,
          done:      false,
          cancelled: false,
        });
      }

      const channels = [...guild.channels.cache.values()].filter(c =>
        c.isText?.() && c.permissionsFor?.(client.user)?.has?.("VIEW_CHANNEL")
      );

      let guildDeleted = 0;
      for (const ch of channels) {
        if (isCancelled(jobId)) break;
        // Pré-check par salon aussi pour les serveurs
        const has = await hasOwnMessages(client, ch.id);
        if (!has) continue;
        guildDeleted += await purgeChannel(client, ch, Infinity, jobId);
      }

      totalDeleted += guildDeleted;
      doneCount++;

      if (jobId) {
        await notifyProgress(jobId, {
          scope: "guilds",
          queue:       remaining,
          activeLabel: null,
          doneCount,
          total,
          totalDeleted,
          done:      false,
          cancelled: false,
        });
      }
    }

    const wasCancelled = isCancelled(jobId);
    cleanJob(jobId);

    if (jobId) {
      await notifyProgress(jobId, {
        scope: "guilds",
        queue:       [],
        activeLabel: null,
        doneCount,
        total,
        totalDeleted,
        done:      true,
        cancelled: wasCancelled,
      });
    }

    return { deleted: totalDeleted, scope: "guilds", cancelled: wasCancelled };
  }

  // ── Purge un serveur spécifique ───────────────────────────────────────────
  if (scope === "guild") {
    if (!guildId) throw new Error("guildId requis.");

    const guild = client.guilds.cache.get(guildId)
      ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) throw new Error(`Serveur ${guildId} introuvable.`);

    registerJob(jobId);

    await guild.channels.fetch().catch(() => {});

    const channels = [...guild.channels.cache.values()].filter(c =>
      c.isText?.() && c.permissionsFor?.(client.user)?.has?.("VIEW_CHANNEL")
    );

    let totalDeleted = 0;
    let doneCount    = 0;
    const total      = channels.length;

    const queue = channels.map(ch => ({
      id:    ch.id,
      label: ch.name ?? ch.id,
    }));

    if (jobId) {
      await notifyProgress(jobId, {
        scope: "guild",
        guildName: guild.name,
        queue,
        activeLabel: null,
        doneCount:   0,
        total,
        totalDeleted: 0,
        done:      false,
        cancelled: false,
      });
    }

    for (let i = 0; i < channels.length; i++) {
      if (isCancelled(jobId)) {
        await notifyProgress(jobId, {
          scope: "guild",
          guildName: guild.name,
          queue: queue.slice(i),
          activeLabel: null,
          doneCount,
          total,
          totalDeleted,
          done:      true,
          cancelled: true,
        });
        cleanJob(jobId);
        return { deleted: totalDeleted, scope: "guild", guildId, cancelled: true };
      }

      const ch    = channels[i];
      const label = `#${ch.name ?? ch.id}`;

      // Pré-check : skip les salons où le selfbot n'a rien envoyé
      const has = await hasOwnMessages(client, ch.id);
      if (!has) {
        doneCount++;
        if (jobId) {
          await notifyProgress(jobId, {
            scope: "guild",
            guildName: guild.name,
            queue:       queue.slice(i + 1),
            activeLabel: null,
            doneCount,
            total,
            totalDeleted,
            done:      false,
            cancelled: false,
          });
        }
        continue;
      }

      const remaining = queue.slice(i + 1);
      if (jobId) {
        await notifyProgress(jobId, {
          scope: "guild",
          guildName: guild.name,
          queue:       remaining,
          activeLabel: label,
          doneCount,
          total,
          totalDeleted,
          done:      false,
          cancelled: false,
        });
      }

      const deleted = await purgeChannel(client, ch, Infinity, jobId);
      totalDeleted += deleted;
      doneCount++;

      if (jobId) {
        await notifyProgress(jobId, {
          scope: "guild",
          guildName: guild.name,
          queue:       remaining,
          activeLabel: null,
          doneCount,
          total,
          totalDeleted,
          done:      false,
          cancelled: false,
        });
      }
    }

    const wasCancelled = isCancelled(jobId);
    cleanJob(jobId);

    if (jobId) {
      await notifyProgress(jobId, {
        scope: "guild",
        guildName: guild.name,
        queue:       [],
        activeLabel: null,
        doneCount,
        total,
        totalDeleted,
        done:      true,
        cancelled: wasCancelled,
      });
    }

    return { deleted: totalDeleted, scope: "guild", guildId, cancelled: wasCancelled };
  }

  throw new Error(`Scope purge inconnu : '${scope}'`);
}

module.exports = { name: "purge", execute, cancelJob };
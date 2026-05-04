"use strict";

const { sendAction } = require("../bridge/client");
const { modal } = require("../utils/components");

// Panels
const home        = require("../panels/home");
const config      = require("../panels/config");
const prefix      = require("../panels/prefix");
const afk         = require("../panels/afk");
const snipe       = require("../panels/snipe");
const stalk       = require("../panels/stalk");
const tags        = require("../panels/tags");
const bookmarks   = require("../panels/bookmarks");
const msgbm       = require("../panels/msgbookmarks");
const antigroup   = require("../panels/antigroup");
const autobump    = require("../panels/autobump");
const gunslol     = require("../panels/gunslol");
const joinvc      = require("../panels/joinvc");
const purge       = require("../panels/purge");
const sysinfo     = require("../panels/sysinfo");
const nitro       = require("../panels/nitro");
const rpc         = require("../panels/rpc");
const quests      = require("../panels/quests");
const backups     = require("../panels/backups");
const { getCloneConfig } = require("../store/clone-config");

async function fetchAndBuild(panelKey) {
  const fetchers = {
    home:         () => sendAction("prefix.get"),
    config:       () => null,
    prefix:       () => sendAction("prefix.get"),
    afk:          () => sendAction("afk.getState"),
    snipe:        () => sendAction("snipe.getWhitelist"),
    stalk:        () => sendAction("stalk.getList"),
    tags:         async () => {
      const [tagsRes, prefixRes] = await Promise.all([sendAction("tag.list"), sendAction("prefix.get")]);
      return { tags: tagsRes?.data?.tags ?? {}, prefix: prefixRes?.data?.prefix ?? "." };
    },
    bookmarks:    () => sendAction("bookmark.list"),
    msgbookmarks: () => sendAction("msgbm.list"),
    antigroup:    () => sendAction("antigroup.getState"),
    autobump:     () => sendAction("autobump.list"),
    gunslol:      () => sendAction("gunslol.getState"),
    joinvc:       () => sendAction("voice.getState"),
    nitro:        () => sendAction("nitro.getState"),
    rpc:          () => sendAction("rpc.getState"),
    rpc_cs:       () => sendAction("rpc.getState"),
    rpc_spotify:  () => sendAction("rpc.getState"),
    quests:       () => sendAction("quests.list"),
    backups:      async () => {
      const [res, res2] = await Promise.allSettled([
        sendAction("backups.guilds.get"),
        sendAction("backups.friends.get"),
      ]);
      const gData = res.status === "fulfilled" ? res.value?.data : null;
      const fData = res2.status === "fulfilled" ? res2.value?.data : null;
      return {
        guildsCount:    gData?.count    ?? null,
        guildsSavedAt:  gData?.savedAt  ?? null,
        friendsCount:   fData?.count    ?? null,
        friendsSavedAt: fData?.savedAt  ?? null,
      };
    },
  };

  const builders = {
    home:         (d) => home.build(d),
    config:       ()  => config.build(),
    prefix:       (d) => prefix.build(d),
    afk:          (d) => afk.build(d),
    snipe:        (d) => snipe.build(d),
    stalk:        (d) => stalk.build(d),
    tags:         (d) => tags.build(d),
    bookmarks:    (d) => bookmarks.build(d),
    msgbookmarks: (d) => msgbm.build(d),
    antigroup:    (d) => antigroup.build(d),
    autobump:     (d) => autobump.build(d),
    gunslol:      (d) => gunslol.build(d),
    joinvc:       (d) => joinvc.build(d),
    purge:        ()  => purge.build(),
    sysinfo:      ()  => sysinfo.build(),
    nitro:        (d) => nitro.build(d),
    rpc:          (d) => rpc.build(d),
    rpc_cs:       (d) => rpc.buildCs(d),
    rpc_spotify:  (d) => rpc.buildSpotify(d),
    rpc_hub:      ()  => rpc.buildHub(),
    quests:       (d) => quests.build(d),
    backups:      (d) => backups.build(d ?? {}),
  };

  if (!builders[panelKey]) return null;

  let data = {};
  if (fetchers[panelKey]) {
    const res = await fetchers[panelKey]();
    if (panelKey === "tags" || panelKey === "backups") {
      data = res ?? {};
    } else if (res === null) {
      data = {};
    } else {
      data = res?.data ?? {};
    }
  }

  return builders[panelKey](data);
}

/**
 * @param {import("discord.js").StringSelectMenuInteraction} interaction
 */
async function handle(interaction) {
  if (interaction.customId === "rpc:actions") {
    const id = interaction.values[0];

    if (id === "toggle") {
      const res = await sendAction("rpc.toggle");
      if (!res?.success) return interaction.reply({ content: `❌ ${res?.error ?? "Une erreur est survenue."}`, ephemeral: true });
      return interaction.update(rpc.build(res?.data ?? {}));
    }
    if (id === "setAppId") {
      const res = await sendAction("rpc.getState");
      return interaction.showModal(modal("modal:rpc_setAppId", "Définir l'Application ID", [
        { id: "applicationId", label: "Application ID (Discord Developer Portal)", placeholder: "123456789012345678", value: res?.data?.applicationId ?? "", required: false },
      ]));
    }
    if (id === "addActivity") {
      return interaction.showModal(modal("modal:rpc_addActivity", "Ajouter une activité", [
        { id: "type",    label: "Type (playing/streaming/listening…)", placeholder: "playing", value: "playing", maxLength: 10 },
        { id: "name",    label: "Nom de l'activité", placeholder: "Minecraft, une playlist…", maxLength: 128 },
        { id: "details", label: "Détails (ligne 2, optionnel)", placeholder: "Survie solo — Niveau 42", required: false, maxLength: 128 },
        { id: "state",   label: "État (ligne 3, optionnel)", placeholder: "Dans les mines", required: false, maxLength: 128 },
        { id: "url",     label: "URL stream (streaming only, vide sinon)", placeholder: "https://twitch.tv/tonpseudo", required: false, maxLength: 512 },
      ]));
    }
    if (id === "editActivity") {
      const state = await sendAction("rpc.getState");
      const activities = state?.data?.activities ?? [];
      if (activities.length === 1) {
        const a = activities[0];
        return interaction.showModal(modal("modal:rpc_editActivity", "Éditer l'activité", [
          { id: "index", label: "Numéro de l'activité", placeholder: "1", value: "1", maxLength: 3 },
          { id: "type", label: "Type (playing/streaming/listening…)", placeholder: "playing", value: a.type ?? "playing", maxLength: 10 },
          { id: "name", label: "Nom de l'activité", placeholder: "Minecraft, une playlist…", value: a.name ?? "", maxLength: 128 },
          { id: "details", label: "Détails (ligne 2, optionnel)", placeholder: "Survie solo — Niveau 42", value: a.details ?? "", required: false, maxLength: 128 },
          { id: "state", label: "État (ligne 3, optionnel)", placeholder: "Dans les mines", value: a.state ?? "", required: false, maxLength: 128 },
        ]));
      }
      return interaction.showModal(modal("modal:rpc_editActivity", "Éditer une activité", [
        { id: "index", label: `Numéro (1–${activities.length})`, placeholder: "1", maxLength: 3 },
        { id: "type", label: "Type (playing/streaming/listening…)", placeholder: "playing", maxLength: 10 },
        { id: "name", label: "Nom de l'activité", placeholder: "Minecraft, une playlist…", maxLength: 128 },
        { id: "details", label: "Détails (ligne 2, optionnel)", placeholder: "Survie solo — Niveau 42", required: false, maxLength: 128 },
        { id: "state", label: "État (ligne 3, optionnel)", placeholder: "Dans les mines", required: false, maxLength: 128 },
      ]));
    }
    if (id === "removeActivity") {
      return interaction.showModal(modal("modal:rpc_removeActivity", "Supprimer une activité", [
        { id: "index", label: "Numéro de l'activité à supprimer", placeholder: "1" },
      ]));
    }
    if (id === "editAssets") {
      return interaction.showModal(modal("modal:rpc_editAssets", "Éditer les assets d'une activité", [
        { id: "index", label: "Numéro de l'activité (voir la liste)", placeholder: "1", maxLength: 3 },
        { id: "largeImage", label: "Large Image (clé asset ou URL)", placeholder: "game_logo  ou  https://i.imgur.com/…", required: false, maxLength: 256 },
        { id: "largeText", label: "Large Image Text (tooltip au survol)", placeholder: "Version 1.21.4", required: false, maxLength: 128 },
        { id: "smallImage", label: "Small Image (clé asset ou URL)", placeholder: "icon_online  ou  https://i.imgur.com/…", required: false, maxLength: 256 },
        { id: "smallText", label: "Small Image Text (tooltip au survol)", placeholder: "En ligne", required: false, maxLength: 128 },
      ]));
    }
    if (id === "editTimestamps") {
      const state = await sendAction("rpc.getState");
      const activities = state?.data?.activities ?? [];
      const first = activities[0]?.timestamps ?? {};
      const now = Date.now();
      const startOffsetSec = first.start ? Math.max(0, Math.round((first.start - now) / 1000)) : 0;
      const durationSec = (first.start && first.end && first.end > first.start) ? Math.round((first.end - first.start) / 1000) : "";
      return interaction.showModal(modal("modal:rpc_editTimestamps", "Configurer le temps d'une activité", [
        { id: "index", label: activities.length === 1 ? "Numéro de l'activité" : `Numéro (1–${activities.length})`, placeholder: "1", value: activities.length === 1 ? "1" : "", maxLength: 3 },
        { id: "startOffsetSec", label: "Début dans combien de sec", placeholder: "0", value: activities.length === 1 ? String(startOffsetSec) : "0", required: false, maxLength: 10 },
        { id: "durationSec", label: "Durée en sec", placeholder: "210", value: activities.length === 1 && durationSec !== "" ? String(durationSec) : "", required: false, maxLength: 10 },
      ]));
    }
    if (id === "setPlatform") {
      const state = await sendAction("rpc.getState");
      const activities = state?.data?.activities ?? [];
      return interaction.showModal(modal("modal:rpc_setPlatform", "Définir la plateforme", [
        { id: "index", label: activities.length === 1 ? "Numéro de l'activité" : `Numéro (1–${activities.length})`, placeholder: "1", value: activities.length === 1 ? "1" : "", maxLength: 3 },
        { id: "platform", label: "Plateforme (vide = aucune)", placeholder: "desktop / xbox / ps4 / ps5 / ios / android…", required: false, maxLength: 10 },
      ]));
    }
    if (id === "editButtons") {
      const state = await sendAction("rpc.getState");
      const activities = state?.data?.activities ?? [];
      const hint = activities.length === 1 ? (() => {
        const btns = activities[0].buttons ?? [];
        return btns.length ? btns.map((b, i) => `${i + 1}: ${b.label}`).join(" / ") : "aucun bouton";
      })() : null;
      return interaction.showModal(modal("modal:rpc_editButtons", "Gérer les boutons RPC", [
        { id: "index", label: activities.length === 1 ? "Numéro de l'activité" : `Numéro de l'activité (1–${activities.length})`, placeholder: "1", value: activities.length === 1 ? "1" : "", maxLength: 3 },
        { id: "buttonAction", label: "Action (add / remove / clear)", placeholder: "add", value: "add", maxLength: 6 },
        { id: "label", label: "Label du bouton (max 32 chars)", placeholder: hint ? `Boutons actuels : ${hint}` : "Mon site", required: false, maxLength: 32 },
        { id: "url", label: "URL du bouton", placeholder: "https://example.com", required: false, maxLength: 512 },
        { id: "buttonIndex", label: "Numéro bouton à supprimer (remove only)", placeholder: "1 ou 2", required: false, maxLength: 1 },
      ]));
    }
    if (id === "moveUp") {
      return interaction.showModal(modal("modal:rpc_moveUp", "Monter une activité", [
        { id: "index", label: "Numéro de l'activité à monter", placeholder: "2" },
      ]));
    }
    if (id === "moveDown") {
      return interaction.showModal(modal("modal:rpc_moveDown", "Descendre une activité", [
        { id: "index", label: "Numéro de l'activité à descendre", placeholder: "1" },
      ]));
    }
    if (id === "setStatus") {
      const res = await sendAction("rpc.getState");
      return interaction.showModal(modal("modal:rpc_setStatus", "Définir le statut en ligne", [
        { id: "status", label: "Statut (online/idle/dnd/invisible)", placeholder: "online", value: res?.data?.status ?? "online", maxLength: 10 },
      ]));
    }
    if (id === "toggleMode") {
      const state = await sendAction("rpc.getState");
      const newMode = state?.data?.mode === "rotate" ? "static" : "rotate";
      const res = await sendAction("rpc.setMode", { mode: newMode });
      if (!res?.success) return interaction.reply({ content: `❌ ${res?.error ?? "Une erreur est survenue."}`, ephemeral: true });
      return interaction.update(rpc.build(res?.data ?? {}));
    }
    if (id === "setInterval") {
      const res = await sendAction("rpc.getState");
      return interaction.showModal(modal("modal:rpc_setInterval", "Intervalle de rotation des activités", [
        { id: "intervalSec", label: "Intervalle en secondes (min. 5)", placeholder: "30", value: String(res?.data?.intervalSec ?? 30), maxLength: 6 },
      ]));
    }
    if (id === "clear") {
      const res = await sendAction("rpc.clearActivities");
      if (!res?.success) return interaction.reply({ content: `❌ ${res?.error ?? "Une erreur est survenue."}`, ephemeral: true });
      return interaction.update(rpc.build(res?.data ?? {}));
    }
    return interaction.reply({ content: "❌ Action RPC inconnue.", ephemeral: true });
  }

  if (interaction.customId === "rpc:spotifyActions") {
    // Géré via modals/buttons côté rpc_spotify — on laisse passer sans erreur
    return;
  }

  if (interaction.customId !== "panel:nav") return;

  const val = interaction.values[0];
  if (!val) return;

  // Defer immédiatement pour éviter le timeout Discord (3s)
  await interaction.deferUpdate();

  const panel = await fetchAndBuild(val);

  if (!panel) {
    return interaction.followUp({ content: `❌ Module \`${val}\` inconnu.`, ephemeral: true });
  }

  return interaction.editReply(panel);
}

module.exports = { handle, fetchAndBuild };
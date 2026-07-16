import { promisify } from "util";
import { execFile } from "child_process";
import type { MessageComponentInteraction } from "discord.js";

import { sendAction } from "../bridge/client";
import { modal } from "../utils/components";
import { snipeModeOptions, statusOptions, activityTypeOptions, buttonActionOptions, platformOptions, purgeExclKindOptions } from "./modal-options";
import { fetchAndBuild } from "./fetch-and-build";
import { getCloneConfig } from "../store/clone-config";
import { registerProgressJob, registerCloneJob } from "../store/jobs";

// Panels
import * as afk       from "../panels/afk";
import * as snipe     from "../panels/snipe";
import * as msgbm     from "../panels/msgbookmarks";
import * as antigroup from "../panels/antigroup";
import * as autobump  from "../panels/autobump";
import * as purge     from "../panels/purge";
import * as sysinfo   from "../panels/sysinfo";
import * as rpc       from "../panels/rpc";
import * as quests    from "../panels/quests";
import * as backups   from "../panels/backups";
import * as config    from "../panels/config";
import * as voice     from "../panels/voice";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────

function makeJobId(prefix = "job"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function validatePm2Name(name: string): string {
  const value = String(name ?? "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error("Nom PM2 invalide : seuls lettres, chiffres, points, tirets et underscores sont autorisés.");
  }
  return value;
}

/**
 * Route les clics de boutons du panel. Accepte aussi les interactions de
 * select proxyfiées par selects.ts (menu:* → redispatch avec le customId
 * du bouton d'origine).
 */
export async function handle(interaction: MessageComponentInteraction): Promise<unknown> {
  const id = interaction.customId;

  // ── Navigation ────────────────────────────────────────────────────────────
  if (id === "panel:home") {
    const panel = await fetchAndBuild("home");
    return interaction.update(panel!);
  }

  const NAV_MAP: Record<string, string> = {
    "panel:config":       "config",
    "panel:afk":          "afk",
    "panel:snipe":        "snipe",
    "panel:tags":         "tags",
    "panel:bookmarks":    "bookmarks",
    "panel:msgbookmarks": "msgbookmarks",
    "panel:antigroup":    "antigroup",
    "panel:autobump":     "autobump",
    "panel:purge":        "purge",
    "panel:sysinfo":      "sysinfo",
    "panel:rpc":          "rpc",
    "panel:rpc_cs":       "rpc_cs",
    "panel:rpc_spotify":  "rpc_spotify",
    "panel:rpc_hub":      "rpc_hub",
    "panel:quests":       "quests",
    "panel:backups":      "backups",
    "panel:voice":        "voice",
  };
  if (NAV_MAP[id]) {
    const panel = await fetchAndBuild(NAV_MAP[id]);
    return interaction.update(panel!);
  }

  if (id === "config:prefix") {
    const panel = await fetchAndBuild("prefix");
    return interaction.update(panel!);
  }
  if (id === "config:token") {
    return interaction.showModal(modal("modal:token", "Modifier le token du selfbot", [
      { id: "token", label: "Nouveau token (variable TOKEN)", placeholder: "Colle le token du selfbot", long: true, maxLength: 120 },
      { id: "ownerId", label: "Confirme ton OWNER_ID", placeholder: "123456789012345678", maxLength: 20 },
    ]));
  }
  if (id === "config:restart") {
    return interaction.update(config.buildRestartConfirm());
  }
  if (id === "config:restart:skip" || id === "config:token:restart:skip") {
    const panel = await fetchAndBuild("config");
    return interaction.update(panel!);
  }
  if (id === "config:restart:confirm" || id === "config:token:restart") {
    const sbName = validatePm2Name(process.env.PM2_SB_NAME || "EtherSelf-SB");
    const ctrlName = validatePm2Name(process.env.PM2_CTRL_NAME || "EtherSelf-Bot");

    const panel = await fetchAndBuild("config");
    await interaction.update(panel!);
    await interaction.followUp({
      content: `\`✅\` Redémarrage PM2 planifié dans 5 secondes pour \`${sbName}\` et \`${ctrlName}\`.`,
      ephemeral: true,
    });

    setTimeout(() => {
      execFileAsync("pm2", ["restart", sbName, ctrlName], { shell: false }).catch(() => {});
    }, 5000);
    return;
  }
  if (id === "config:sysinfo") {
    const panel = await fetchAndBuild("sysinfo");
    return interaction.update(panel!);
  }

  // ── PREFIX ────────────────────────────────────────────────────────────────
  if (id === "prefix:edit") {
    const res = await sendAction("prefix.get");
    return interaction.showModal(modal("modal:prefix", "Changer le préfixe", [
      { id: "prefix", label: "Nouveau préfixe (1–3 caractères)", placeholder: ".", value: res?.data?.prefix ?? ".", maxLength: 3 },
    ]));
  }

  // ── AFK ───────────────────────────────────────────────────────────────────
  if (id === "afk:toggle") { const res = await sendAction("afk.toggle"); return interaction.update(afk.build(res?.data ?? {})); }
  if (id === "afk:setReason") {
    const res = await sendAction("afk.getState");
    return interaction.showModal(modal("modal:afk_reason", "Raison AFK", [
      { id: "reason", label: "Raison", placeholder: "Je suis absent…", value: res?.data?.reason ?? "", required: false },
    ]));
  }
  if (id === "afk:setMessage") {
    const res = await sendAction("afk.getState");
    return interaction.showModal(modal("modal:afk_msg", "Message AFK", [
      { id: "msg", label: "Message ({reason} = raison, vide = défaut)", placeholder: "Je suis AFK ({reason})…", value: res?.data?.message ?? "", required: false, long: true },
    ]));
  }
  if (id === "afk:addExclusion") {
    return interaction.showModal(modal("modal:afk_excl_add", "Ajouter une exclusion AFK", [
      { id: "userId", label: "ID Discord (user, serveur ou groupe)", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "afk:removeExclusion") {
    return interaction.showModal(modal("modal:afk_excl_remove", "Retirer une exclusion AFK", [
      { id: "userId", label: "ID à retirer", placeholder: "123456789012345678" },
    ]));
  }

  // ── SNIPE ─────────────────────────────────────────────────────────────────
  if (id === "snipe:add") {
    return interaction.showModal(modal("modal:snipe_add", "Ajouter un serveur", [
      { id: "guildId", label: "ID du serveur", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "snipe:remove") {
    return interaction.showModal(modal("modal:snipe_remove", "Retirer un serveur", [
      { id: "guildId", label: "ID du serveur", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "snipe:viewDeleted") {
    return interaction.showModal(modal("modal:snipe_view:deleted", "Rechercher des messages", [
      { id: "mode",  label: "Mode de recherche", radio: snipeModeOptions("channel") },
      { id: "query", label: "ID du salon, serveur ou utilisateur", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "snipe:viewEdited") {
    return interaction.showModal(modal("modal:snipe_view:edited", "Rechercher des messages", [
      { id: "mode",  label: "Mode de recherche", radio: snipeModeOptions("channel") },
      { id: "query", label: "ID du salon, serveur ou utilisateur", placeholder: "123456789012345678" },
    ]));
  }
  if (id.startsWith("snipe:page:")) {
    const parts = id.split(":");
    const type = parts[2];
    const page = parseInt(parts[3], 10);
    const searchMode = parts[4];
    const scopeId = parts[5];
    let res;
    if (searchMode === "guild") res = await sendAction("snipe.getMessagesByGuild", { guildId: scopeId, type });
    else if (searchMode === "user") res = await sendAction("snipe.getMessagesByUser", { userId: scopeId, type });
    else res = await sendAction("snipe.getMessages", { channelId: scopeId, type });
    return interaction.update(snipe.buildResults({ ...(res?.data ?? {}), page }));
  }
  if (id.startsWith("snipe:inputChannel:") || id.startsWith("snipe:inputGuild:") || id.startsWith("snipe:inputUser:")) {
    const [, kind, type] = id.split(":");
    const mode = kind === "inputGuild" ? "guild" : kind === "inputUser" ? "user" : "channel";
    return interaction.showModal(modal(`modal:snipe_view:${type}`, "Voir les messages snipés", [
      { id: "mode", label: "Mode de recherche", radio: snipeModeOptions(mode) },
      { id: "query", label: "ID du salon, serveur ou utilisateur", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "snipe:snapshot") {
    return interaction.showModal(modal("modal:snipe_snapshot", "Snapshot d'un salon", [
      { id: "channelId",       label: "ID du salon à archiver",                        placeholder: "123456789012345678" },
      { id: "limit",           label: "Limite (0 = tous les messages)",                 placeholder: "0", value: "0", required: false, maxLength: 6 },
      { id: "sendToChannelId", label: "ID salon de réception (vide = DM selfbot)",      placeholder: "Laisser vide pour recevoir en DM", required: false },
    ]));
  }
  if (id === "snipe:snapshotPeriodicAdd") {
    return interaction.showModal(modal("modal:snipe_snapshot_periodic_add", "Snapshot périodique", [
      { id: "channelId",       label: "ID du salon à archiver",                   placeholder: "123456789012345678" },
      { id: "interval",        label: "Intervalle (1w, 7d, 24h, 60m)",            placeholder: "1w", value: "1w", maxLength: 20 },
      { id: "limit",           label: "Limite (0 = tous les messages)",            placeholder: "0", value: "0", required: false, maxLength: 6 },
      { id: "sendToChannelId", label: "ID salon réception (vide = DM selfbot)",    placeholder: "Laisser vide pour recevoir en DM", required: false },
    ]));
  }
  if (id === "snipe:snapshotPeriodicRemove") {
    return interaction.showModal(modal("modal:snipe_snapshot_periodic_remove", "Retirer un périodique", [
      { id: "channelId", label: "ID du salon à retirer", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "snipe:snapshotPeriodicToggle") {
    const state = await sendAction("snapshot.periodic.list");
    if (!state?.success) return _error(interaction, state?.error);
    const action = state?.data?.running ? "snapshot.periodic.stop" : "snapshot.periodic.start";
    const res = await sendAction(action);
    if (!res?.success) return _error(interaction, res?.error);
    // On passe par fetchAndBuild pour avoir les noms de serveurs ET les schedules
    const panel = await fetchAndBuild("snipe");
    return interaction.update(panel!);
  }

  // ── TAGS ──────────────────────────────────────────────────────────────────
  if (id === "tags:add") {
    return interaction.showModal(modal("modal:tags_add", "Créer un tag", [
      { id: "name",    label: "Nom du tag",    placeholder: "ex: intro" },
      { id: "content", label: "Contenu",       placeholder: "Texte du tag…", long: true },
    ]));
  }
  if (id === "tags:edit") {
    return interaction.showModal(modal("modal:tags_edit", "Modifier un tag", [
      { id: "name",    label: "Nom du tag à modifier", placeholder: "ex: intro" },
      { id: "content", label: "Nouveau contenu",       placeholder: "Texte du tag…", long: true },
    ]));
  }
  if (id === "tags:remove") {
    return interaction.showModal(modal("modal:tags_remove", "Supprimer un tag", [
      { id: "name", label: "Nom du tag à supprimer", placeholder: "ex: intro" },
    ]));
  }
  if (id === "tags:view") {
    return interaction.showModal(modal("modal:tags_view", "Voir un tag", [
      { id: "name", label: "Nom du tag à afficher", placeholder: "ex: intro" },
    ]));
  }

  // ── BOOKMARKS SALONS ──────────────────────────────────────────────────────
  if (id === "bookmarks:add") {
    return interaction.showModal(modal("modal:bookmarks_add", "Ajouter un salon bookmark", [
      { id: "channelId", label: "ID du salon", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "bookmarks:remove") {
    return interaction.showModal(modal("modal:bookmarks_remove", "Retirer un salon bookmark", [
      { id: "channelId", label: "ID du salon", placeholder: "123456789012345678" },
    ]));
  }

  // ── BOOKMARKS MESSAGES ────────────────────────────────────────────────────
  if (id === "msgbm:add") {
    return interaction.showModal(modal("modal:msgbm_add", "Ajouter un bookmark message", [
      { id: "url",  label: "URL du message Discord", placeholder: "https://discord.com/channels/..." },
      { id: "note", label: "Note (optionnel)",        placeholder: "Ma note…", required: false },
    ]));
  }
  if (id === "msgbm:remove") {
    return interaction.showModal(modal("modal:msgbm_remove", "Supprimer un bookmark message", [
      { id: "index", label: "Numéro (index) du bookmark", placeholder: "ex: 1" },
    ]));
  }
  if (id === "msgbm:note") {
    return interaction.showModal(modal("modal:msgbm_note", "Ajouter/modifier une note", [
      { id: "index", label: "Index du bookmark",  placeholder: "ex: 1" },
      { id: "note",  label: "Note",               placeholder: "Ma note…", required: false },
    ]));
  }
  if (id === "msgbm:clear") {
    const res = await sendAction("msgbm.clear");
    return interaction.update(msgbm.build(res?.data ?? {}));
  }

  // ── ANTIGROUP ─────────────────────────────────────────────────────────────
  if (id === "antigroup:toggle") { const res = await sendAction("antigroup.toggle"); return interaction.update(antigroup.build(res?.data ?? {})); }
  if (id === "antigroup:confirmLeaveAll") { return interaction.update(antigroup.buildConfirmLeaveAll()); }
  if (id === "antigroup:leaveAll") {
    await interaction.update(antigroup.buildLeaveAllResult({ left: 0, failed: 0, total: null }));
    const res = await sendAction("antigroup.leaveAll");
    if (!res?.success) return interaction.editReply({ content: `❌ ${res?.error ?? "Erreur inconnue."}` }).catch(() => {});
    return interaction.editReply(antigroup.buildLeaveAllResult(res?.data ?? {})).catch(() => {});
  }

  // ── AUTOBUMP ──────────────────────────────────────────────────────────────
  if (id === "autobump:add") {
    return interaction.showModal(modal("modal:autobump_add", "Ajouter un salon autobump", [
      { id: "guildId",     label: "ID du serveur", placeholder: "123456789012345678" },
      { id: "channelId",   label: "ID du salon",   placeholder: "123456789012345678" },
      { id: "appId",       label: "APP ID du bot de bump", placeholder: "302050872383242240" },
      { id: "commandName", label: "Nom de la commande", placeholder: "bump" },
    ]));
  }
  if (id === "autobump:remove") {
    return interaction.showModal(modal("modal:autobump_remove", "Retirer un salon autobump", [
      { id: "guildId",   label: "ID du serveur", placeholder: "123456789012345678" },
      { id: "channelId", label: "ID du salon",   placeholder: "123456789012345678" },
    ]));
  }
  if (id === "autobump:start") {
    const res = await sendAction("autobump.start");
    if (!res?.success) return _error(interaction, res?.error);
    const state = await sendAction("autobump.list");
    return interaction.update(autobump.build(state?.data ?? {}));
  }
  if (id === "autobump:stop") {
    await sendAction("autobump.stop");
    const state = await sendAction("autobump.list");
    return interaction.update(autobump.build(state?.data ?? {}));
  }

  // ── RPC — Activités ───────────────────────────────────────────────────────
  if (id === "rpc:toggle") { const res = await sendAction("rpc.toggle"); if (!res?.success) return _error(interaction, res?.error); return interaction.update(rpc.build(res?.data ?? {})); }
  if (id === "rpc:addActivity") {
    return interaction.showModal(modal("modal:rpc_addActivity", "Ajouter une activité", [
      { id: "type",    label: "Type d'activité", radio: activityTypeOptions() },
      { id: "name",    label: "Nom de l'activité",                   placeholder: "Minecraft, une playlist…", maxLength: 128 },
      { id: "details", label: "Détails (ligne 2, optionnel)",        placeholder: "Survie solo — Niveau 42", required: false, maxLength: 128 },
      { id: "state",   label: "État (ligne 3, optionnel)",           placeholder: "Dans les mines", required: false, maxLength: 128 },
      { id: "url",     label: "URL stream (streaming only, vide sinon)", placeholder: "https://twitch.tv/tonpseudo", required: false, maxLength: 512 },
    ]));
  }
  if (id === "rpc:editActivity") {
    const state = await sendAction("rpc.getState");
    const activities = state?.data?.activities ?? [];
    if (activities.length === 1) {
      const a = activities[0];
      return interaction.showModal(modal("modal:rpc_editActivity", "Éditer l'activité", [
        { id: "index",   label: "Numéro de l'activité", placeholder: "1", value: "1", maxLength: 3 },
        { id: "type",    label: "Type d'activité", radio: activityTypeOptions(a.type ?? "playing") },
        { id: "name",    label: "Nom de l'activité", placeholder: "Minecraft, une playlist…", value: a.name ?? "", maxLength: 128 },
        { id: "details", label: "Détails (ligne 2, optionnel)", placeholder: "Survie solo — Niveau 42", value: a.details ?? "", required: false, maxLength: 128 },
        { id: "state",   label: "État (ligne 3, optionnel)", placeholder: "Dans les mines", value: a.state ?? "", required: false, maxLength: 128 },
      ]));
    }
    return interaction.showModal(modal("modal:rpc_editActivity", "Éditer une activité", [
      { id: "index",   label: `Numéro (1–${activities.length})`, placeholder: "1", maxLength: 3 },
      { id: "type",    label: "Type d'activité", radio: activityTypeOptions() },
      { id: "name",    label: "Nom de l'activité", placeholder: "Minecraft, une playlist…", maxLength: 128 },
      { id: "details", label: "Détails (ligne 2, optionnel)", placeholder: "Survie solo — Niveau 42", required: false, maxLength: 128 },
      { id: "state",   label: "État (ligne 3, optionnel)", placeholder: "Dans les mines", required: false, maxLength: 128 },
    ]));
  }
  if (id === "rpc:setPlatform") {
    const state = await sendAction("rpc.getState");
    const activities = state?.data?.activities ?? [];
    return interaction.showModal(modal("modal:rpc_setPlatform", "Définir la plateforme", [
      { id: "index",    label: activities.length === 1 ? "Numéro de l'activité" : `Numéro (1–${activities.length})`, placeholder: "1", value: activities.length === 1 ? "1" : "", maxLength: 3 },
      { id: "platform", label: "Plateforme", radio: platformOptions(activities.length === 1 ? activities[0]?.platform : null) },
    ]));
  }
  if (id === "rpc:editButtons") {
    const state = await sendAction("rpc.getState");
    const activities = state?.data?.activities ?? [];
    const hint = activities.length === 1 ? (() => {
      const btns = activities[0].buttons ?? [];
      return btns.length ? btns.map((b: { label: string }, i: number) => `${i + 1}: ${b.label}`).join(" / ") : "aucun bouton";
    })() : null;
    return interaction.showModal(modal("modal:rpc_editButtons", "Gérer les boutons RPC", [
      { id: "index",        label: activities.length === 1 ? "Numéro de l'activité" : `Numéro de l'activité (1–${activities.length})`, placeholder: "1", value: activities.length === 1 ? "1" : "", maxLength: 3 },
      { id: "buttonAction", label: "Action", radio: buttonActionOptions() },
      { id: "label",        label: "Label du bouton (max 32 chars)", placeholder: hint ? `Boutons actuels : ${hint}` : "Mon site", required: false, maxLength: 32 },
      { id: "url",          label: "URL du bouton", placeholder: "https://example.com", required: false, maxLength: 512 },
      { id: "buttonIndex",  label: "Numéro bouton à supprimer (remove only)", placeholder: "1 ou 2", required: false, maxLength: 1 },
    ]));
  }
  if (id === "rpc:editAssets") {
    return interaction.showModal(modal("modal:rpc_editAssets", "Éditer les assets d'une activité", [
      { id: "index",      label: "Numéro de l'activité (voir la liste)", placeholder: "1", maxLength: 3 },
      { id: "largeImage", label: "Large Image (clé asset ou URL)",        placeholder: "game_logo  ou  https://i.imgur.com/…", required: false, maxLength: 256 },
      { id: "largeText",  label: "Large Image Text (tooltip au survol)",  placeholder: "Version 1.21.4", required: false, maxLength: 128 },
      { id: "smallImage", label: "Small Image (clé asset ou URL)",        placeholder: "icon_online  ou  https://i.imgur.com/…", required: false, maxLength: 256 },
      { id: "smallText",  label: "Small Image Text (tooltip au survol)",  placeholder: "En ligne", required: false, maxLength: 128 },
    ]));
  }
  if (id === "rpc:editTimestamps") {
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
  if (id === "rpc:removeActivity") {
    return interaction.showModal(modal("modal:rpc_removeActivity", "Supprimer une activité", [
      { id: "index", label: "Numéro de l'activité à supprimer", placeholder: "1" },
    ]));
  }
  if (id === "rpc:setStatus") {
    const res = await sendAction("rpc.getState");
    return interaction.showModal(modal("modal:rpc_setStatus", "Définir le statut en ligne", [
      { id: "status", label: "Statut", radio: statusOptions(res?.data?.status ?? "online") },
    ]));
  }
  if (id === "rpc:toggleMode") { const state = await sendAction("rpc.getState"); const newMode = state?.data?.mode === "rotate" ? "static" : "rotate"; const res = await sendAction("rpc.setMode", { mode: newMode }); if (!res?.success) return _error(interaction, res?.error); return interaction.update(rpc.build(res?.data ?? {})); }
  if (id === "rpc:setInterval") {
    const res = await sendAction("rpc.getState");
    return interaction.showModal(modal("modal:rpc_setInterval", "Intervalle de rotation des activités", [
      { id: "intervalSec", label: "Intervalle en secondes (min. 5)", placeholder: "30", value: String(res?.data?.intervalSec ?? 30), maxLength: 6 },
    ]));
  }
  if (id === "rpc:moveUp") { return interaction.showModal(modal("modal:rpc_moveUp", "Monter une activité", [{ id: "index", label: "Numéro de l'activité à monter", placeholder: "2" }])); }
  if (id === "rpc:moveDown") { return interaction.showModal(modal("modal:rpc_moveDown", "Descendre une activité", [{ id: "index", label: "Numéro de l'activité à descendre", placeholder: "1" }])); }
  if (id === "rpc:clear") { const res = await sendAction("rpc.clearActivities"); return interaction.update(rpc.build(res?.data ?? {})); }
  if (id === "rpc:applyNow") { const res = await sendAction("rpc.applyNow"); if (!res?.success) return _error(interaction, res?.error); return interaction.update(rpc.build(res?.data ?? {})); }
  if (id === "rpc:setAppId") {
    const res = await sendAction("rpc.getState");
    return interaction.showModal(modal("modal:rpc_setAppId", "Définir l'Application ID", [
      { id: "applicationId", label: "Application ID (Discord Developer Portal)", placeholder: "123456789012345678", value: res?.data?.applicationId ?? "", required: false },
    ]));
  }
  if (id === "rpc:spotify") {
    const res = await sendAction("rpc.getState");
    const spotify = res?.data?.spotify ?? {};
    const displayValue = [spotify.details ?? "", spotify.state ?? ""].filter(Boolean).join(" | ");
    return interaction.showModal(modal("modal:rpc_spotify", "Configurer Spotify RPC", [
      { id: "enabled",   label: "Activer ? (on/off)", placeholder: "off", value: spotify.enabled ? "on" : "off", maxLength: 3 },
      { id: "songId",    label: "Track ID / URI / URL Spotify", placeholder: "https://open.spotify.com/track/...", value: spotify.songId ?? "", required: false, maxLength: 128 },
      { id: "albumId",   label: "Album ID / URI / URL (optionnel)", placeholder: "spotify:album:...", value: spotify.albumId ?? "", required: false, maxLength: 128 },
      { id: "artistIds", label: "Artist IDs Spotify (virgules)", placeholder: "artist1, artist2", value: (spotify.artistIds ?? []).join(", "), required: false, maxLength: 400 },
      { id: "display",   label: "Affichage (titre | artiste, optionnel)", placeholder: "Nom du morceau | Nom de l'artiste", value: displayValue, required: false, maxLength: 128 },
    ]));
  }
  if (id === "rpc:spotifyAssets") {
    const res = await sendAction("rpc.getState");
    const assets = res?.data?.spotify?.assets ?? {};
    return interaction.showModal(modal("modal:rpc_spotifyAssets", "Configurer les assets Spotify", [
      { id: "largeImage", label: "Large image", placeholder: "spotify:image_id / mp:... / asset id", value: assets.largeImage ?? "", required: false, maxLength: 256 },
      { id: "largeText",  label: "Large text",  placeholder: "Tooltip image large", value: assets.largeText ?? "", required: false, maxLength: 128 },
      { id: "smallImage", label: "Small image", placeholder: "spotify:image_id / mp:... / asset id", value: assets.smallImage ?? "", required: false, maxLength: 256 },
      { id: "smallText",  label: "Small text",  placeholder: "Tooltip image small", value: assets.smallText ?? "", required: false, maxLength: 128 },
    ]));
  }
  if (id === "rpc:spotifyTimestamps") {
    const res = await sendAction("rpc.getState");
    const timestamps = res?.data?.spotify?.timestamps ?? {};
    const now = Date.now();
    const startOffsetSec = timestamps.start ? Math.max(0, Math.round((timestamps.start - now) / 1000)) : 0;
    const durationSec = (timestamps.start && timestamps.end && timestamps.end > timestamps.start) ? Math.round((timestamps.end - timestamps.start) / 1000) : "";
    return interaction.showModal(modal("modal:rpc_spotifyTimestamps", "Configurer le temps Spotify", [
      { id: "startOffsetSec", label: "Début dans combien de sec", placeholder: "0", value: String(startOffsetSec), required: false, maxLength: 10 },
      { id: "durationSec",    label: "Durée en sec",              placeholder: "210", value: durationSec === "" ? "" : String(durationSec), required: false, maxLength: 10 },
    ]));
  }
  if (id === "rpc:spotifyExtras") {
    const res = await sendAction("rpc.getState");
    const spotify = res?.data?.spotify ?? {};
    return interaction.showModal(modal("modal:rpc_spotifyExtras", "Configurer les extras Spotify", [
      { id: "applicationId", label: "Application ID (optionnel)", placeholder: "123456789012345678", value: spotify.applicationId ?? "", required: false, maxLength: 20 },
      { id: "platform",      label: "Plateforme", radio: platformOptions(spotify.platform) },
      { id: "url",           label: "URL (optionnel)",            placeholder: "https://open.spotify.com/track/...", value: spotify.url ?? "", required: false, maxLength: 256 },
    ]));
  }

  // ── RPC — Custom Status ───────────────────────────────────────────────────
  if (id === "rpc:csToggle") { const res = await sendAction("rpc.csToggle"); if (!res?.success) return _error(interaction, res?.error); return interaction.update(rpc.buildCs(res?.data ?? {})); }
  if (id === "rpc:csAdd") {
    return interaction.showModal(modal("modal:rpc_csAdd", "Ajouter un custom status", [
      { id: "emoji", label: "Emoji (optionnel)", placeholder: "🎯  ou  <:nom:123456789012345678>", required: false, maxLength: 64 },
      { id: "text",  label: "Texte du statut",   placeholder: "En train de coder…", maxLength: 128 },
    ]));
  }
  if (id === "rpc:csEdit") {
    return interaction.showModal(modal("modal:rpc_csEdit", "Modifier un custom status", [
      { id: "index", label: "Numéro du statut à modifier", placeholder: "1", maxLength: 3 },
      { id: "emoji", label: "Emoji (optionnel)", placeholder: "🎯  ou  <:nom:123456789012345678>", required: false, maxLength: 64 },
      { id: "text",  label: "Nouveau texte", placeholder: "En train de coder…", maxLength: 128 },
    ]));
  }
  if (id === "rpc:csRemove") {
    return interaction.showModal(modal("modal:rpc_csRemove", "Supprimer un custom status", [
      { id: "index", label: "Numéro du statut à supprimer", placeholder: "1" },
    ]));
  }
  if (id === "rpc:csClear") { const res = await sendAction("rpc.csClear"); return interaction.update(rpc.buildCs(res?.data ?? {})); }
  if (id === "rpc:setCsInterval") {
    const res = await sendAction("rpc.getState");
    return interaction.showModal(modal("modal:rpc_setCsInterval", "Intervalle de rotation des statuts", [
      { id: "intervalSec", label: "Intervalle en secondes (min. 5)", placeholder: "15", value: String(res?.data?.csIntervalSec ?? 15), maxLength: 6 },
    ]));
  }

  // ── PURGE ─────────────────────────────────────────────────────────────────
  if (id === "purge:confirm:channel") {
    return interaction.showModal(modal("modal:purge_ask_channel", "Purger un salon", [
      { id: "channelId", label: "ID du salon", placeholder: "123456789012345678" },
      { id: "amount",    label: "Nombre de messages (vide = tous)", placeholder: "Laisser vide pour tout supprimer", required: false },
    ]));
  }
  if (id === "purge:confirm:guild") {
    return interaction.showModal(modal("modal:purge_ask_guild", "Purger un serveur", [
      { id: "guildId", label: "ID du serveur", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "purge:confirm:dms") { return interaction.update(purge.buildConfirm({ scope: "dms" })); }
  if (id === "purge:confirm:guilds") { return interaction.update(purge.buildConfirm({ scope: "guilds" })); }

  if (id.startsWith("purge:run:channel:")) {
    const parts = id.split(":");
    const channelId = parts[3];
    const amount = parseInt(parts[4] ?? "0", 10) || 0;
    const jobId = makeJobId("purge");
    await interaction.update(purge.buildProgress({ scope: "channel", queue: [], activeLabel: `<#${channelId}>`, doneCount: 0, total: 1, totalDeleted: 0, done: false, cancelled: false, jobId }));
    registerProgressJob(jobId, interaction);
    sendAction("purge.channel", { channelId, amount: amount || undefined, jobId }).catch(() => {});
    return;
  }
  if (id.startsWith("purge:run:guild:")) {
    const guildId = id.split(":")[3];
    const jobId = makeJobId("purge");
    await interaction.update(purge.buildProgress({ scope: "guild", queue: [], activeLabel: null, doneCount: 0, total: 0, totalDeleted: 0, done: false, cancelled: false, jobId }));
    registerProgressJob(jobId, interaction);
    sendAction("purge.guild", { guildId, jobId }).catch(() => {});
    return;
  }
  if (id === "purge:run:dms") {
    const jobId = makeJobId("purge");
    await interaction.update(purge.buildProgress({ scope: "dms", queue: [], activeLabel: null, doneCount: 0, total: 0, totalDeleted: 0, done: false, cancelled: false, jobId }));
    registerProgressJob(jobId, interaction);
    sendAction("purge.dms", { jobId }).catch(() => {});
    return;
  }
  if (id === "purge:run:guilds") {
    const jobId = makeJobId("purge");
    await interaction.update(purge.buildProgress({ scope: "guilds", queue: [], activeLabel: null, doneCount: 0, total: 0, totalDeleted: 0, done: false, cancelled: false, jobId }));
    registerProgressJob(jobId, interaction);
    sendAction("purge.guilds", { jobId }).catch(() => {});
    return;
  }
  // Exclusions (serveurs / groupes DM / salons)
  if (id === "purge:exclusions") {
    const panel = await fetchAndBuild("purge_exclusions");
    return interaction.update(panel!);
  }
  // `purge:excl:add:<kind>` (ancien format, menus déjà rendus) pré-sélectionne le type.
  if (id === "purge:excl:add" || id.startsWith("purge:excl:add:")) {
    const kind = id.split(":")[3];
    return interaction.showModal(modal("modal:purge_excl_add", "Exclure une cible de purge", [
      { id: "kind", label: "Type de cible", radio: purgeExclKindOptions(kind) },
      { id: "id",   label: "ID de la cible", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "purge:excl:remove") {
    return interaction.showModal(modal("modal:purge_excl_remove", "Retirer une exclusion", [
      { id: "id", label: "ID à retirer", placeholder: "123456789012345678" },
    ]));
  }

  if (id.startsWith("purge:cancel:")) {
    const jobId = id.slice("purge:cancel:".length);
    const res = await sendAction("purge.cancel", { jobId });
    if (!res?.success) return _error(interaction, res?.error ?? "Impossible d'annuler la purge.");
    return interaction.update(purge.buildProgress({ scope: "dms", queue: [], activeLabel: "Arrêt en cours…", doneCount: 0, total: 0, totalDeleted: 0, done: false, cancelled: false, jobId }));
  }

  // ── SALON VOCAL ───────────────────────────────────────────────────────────
  // « Se connecter » et « Quitter » sont deux boutons distincts (custom_id
  // unique par message obligatoire) mais pilotent la même bascule côté selfbot :
  // chacun n'est cliquable que dans l'état où il a du sens (l'autre est grisé).
  if (id === "voice:connect" || id === "voice:quit") {
    const res = await sendAction("voice.toggle");
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(voice.build(res?.data ?? {}));
  }
  if (id === "voice:setChannel") {
    const res = await sendAction("voice.getState");
    return interaction.showModal(modal("modal:voice_channel", "Définir le salon vocal", [
      { id: "channelId", label: "ID du salon vocal", placeholder: "123456789012345678", value: res?.data?.channelId ?? "", maxLength: 20 },
    ]));
  }

  // ── SYSINFO ───────────────────────────────────────────────────────────────
  if (id === "sysinfo:ping") { const res = await sendAction("info.ping"); return interaction.update(sysinfo.buildPing(res?.data ?? {})); }
  if (id === "sysinfo:uptime") { const res = await sendAction("info.uptime"); return interaction.update(sysinfo.buildUptime(res?.data ?? {})); }
  if (id === "sysinfo:hostinfo") { const res = await sendAction("info.hostinfo"); return interaction.update(sysinfo.buildHostinfo(res?.data ?? {})); }

  // ── QUESTS ────────────────────────────────────────────────────────────────
  if (id === "quests:toggle") { const res = await sendAction("quests.toggle"); if (!res?.success) return _error(interaction, res?.error); const lr = await sendAction("quests.list"); return interaction.update(quests.build(lr?.data ?? {})); }
  if (id === "quests:setInterval") {
    const cr = await sendAction("quests.getConfig");
    return interaction.showModal(modal("modal:quests_interval", "Intervalle de complétion automatique", [
      { id: "intervalMin", label: "Intervalle en minutes (min. 30)", placeholder: "360", value: String(cr?.data?.intervalMin ?? 360), maxLength: 6 },
    ]));
  }
  if (id === "quests:refresh") { const res = await sendAction("quests.list"); if (!res?.success) return _error(interaction, res?.error); return interaction.update(quests.build(res?.data ?? {})); }
  if (id === "quests:run") {
    await interaction.update(quests.buildRunning());
    sendAction("quests.run").then(async () => { const lr = await sendAction("quests.list"); interaction.editReply(quests.build(lr?.data ?? {})).catch(() => {}); }).catch(() => {});
    return;
  }
  if (id === "quests:history") { const res = await sendAction("quests.getHistory"); return interaction.update(quests.buildHistory(res?.data ?? {})); }
  if (id === "quests:clearHistory") { const res = await sendAction("quests.clearHistory"); return interaction.update(quests.buildHistory(res?.data ?? {})); }

  // ── BACKUPS : hub ─────────────────────────────────────────────────────────
  if (id === "backups:friends") {
    const res = await sendAction("backups.friends.get");
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(backups.buildFriends({ ...res.data, page: 0 }));
  }
  if (id === "backups:guilds") {
    const res = await sendAction("backups.guilds.get");
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(backups.buildGuilds({ ...res.data, page: 0 }));
  }
  if (id === "backups:clone") {
    const cfg = getCloneConfig(interaction.user.id);
    return interaction.update(backups.buildClone(cfg));
  }

  // ── BACKUPS : amis ────────────────────────────────────────────────────────
  if (id === "backups:friends_refresh") {
    await interaction.update(backups.buildFriends({ friends: [], savedAt: null, count: 0, page: 0, _loading: true }));
    const res = await sendAction("backups.friends.backup");
    if (!res?.success) return interaction.editReply({ content: `❌ ${res?.error}` }).catch(() => {});
    return interaction.editReply(backups.buildFriends({ ...res.data, page: 0 })).catch(() => {});
  }
  if (id === "backups:friends_clear") {
    await sendAction("backups.friends.clearBackup");
    const hub = await sendAction("backups.guilds.get").catch(() => null);
    return interaction.update(backups.build({
      friendsCount: null, friendsSavedAt: null,
      guildsCount: hub?.data?.count ?? null, guildsSavedAt: hub?.data?.savedAt ?? null,
    }));
  }
  if (id.startsWith("backups:friends_page:")) {
    const page = parseInt(id.split(":")[2], 10);
    const res = await sendAction("backups.friends.get");
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(backups.buildFriends({ ...res.data, page }));
  }

  // ── BACKUPS : serveurs ────────────────────────────────────────────────────
  if (id === "backups:guilds_refresh") {
    await interaction.update(backups.buildGuilds({ guilds: [], savedAt: null, count: 0, page: 0, _loading: true }));
    const res = await sendAction("backups.guilds.backup");
    if (!res?.success) return interaction.editReply({ content: `❌ ${res?.error}` }).catch(() => {});
    return interaction.editReply(backups.buildGuilds({ ...res.data, page: 0 })).catch(() => {});
  }
  if (id === "backups:guilds_clear") {
    await sendAction("backups.guilds.clearBackup");
    const hub2 = await sendAction("backups.friends.get").catch(() => null);
    return interaction.update(backups.build({
      guildsCount: null, guildsSavedAt: null,
      friendsCount: hub2?.data?.count ?? null, friendsSavedAt: hub2?.data?.savedAt ?? null,
    }));
  }
  if (id.startsWith("backups:guilds_page:")) {
    const page = parseInt(id.split(":")[2], 10);
    const res = await sendAction("backups.guilds.get");
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(backups.buildGuilds({ ...res.data, page }));
  }

  // ── CLONE ─────────────────────────────────────────────────────────────────
  if (id === "clone:setSource") {
    return interaction.showModal(modal("modal:clone_source", "Serveur source", [
      { id: "guildId", label: "ID du serveur SOURCE (à copier)", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "clone:setTarget") {
    return interaction.showModal(modal("modal:clone_target", "Serveur cible", [
      { id: "guildId", label: "ID du serveur CIBLE (qui sera modifié)", placeholder: "123456789012345678" },
    ]));
  }
  if (id === "clone:toggleRoles") { const cfg = getCloneConfig(interaction.user.id); cfg.cloneRoles = !cfg.cloneRoles; return interaction.update(backups.buildClone(cfg)); }
  if (id === "clone:toggleChannels") { const cfg = getCloneConfig(interaction.user.id); cfg.cloneChannels = !cfg.cloneChannels; return interaction.update(backups.buildClone(cfg)); }
  if (id === "clone:toggleEmojis") { const cfg = getCloneConfig(interaction.user.id); cfg.cloneEmojis = !cfg.cloneEmojis; return interaction.update(backups.buildClone(cfg)); }
  if (id === "clone:toggleSettings") { const cfg = getCloneConfig(interaction.user.id); cfg.cloneSettings = !cfg.cloneSettings; return interaction.update(backups.buildClone(cfg)); }

  if (id === "clone:run") {
    const cfg = getCloneConfig(interaction.user.id);
    const jobId = makeJobId("clone");
    await interaction.update(backups.buildCloneRunning({ sourceGuild: cfg.sourceGuildName ?? cfg.sourceGuildId ?? "?", targetGuild: cfg.targetGuildName ?? cfg.targetGuildId ?? "?", jobId }));
    registerCloneJob(jobId, interaction);
    sendAction("backups.clone.run", { sourceGuildId: cfg.sourceGuildId, targetGuildId: cfg.targetGuildId, cloneRoles: cfg.cloneRoles ?? true, cloneChannels: cfg.cloneChannels ?? true, cloneEmojis: cfg.cloneEmojis ?? true, cloneSettings: cfg.cloneSettings ?? true, jobId }).catch(() => {});
    return;
  }
  if (id.startsWith("clone:cancel:")) {
    const jobId = id.slice("clone:cancel:".length);
    const res = await sendAction("backups.clone.cancel", { jobId });
    if (!res?.success) return _error(interaction, res?.error ?? "Impossible d'annuler le job.");
    return interaction.update(backups.buildCloneRunning({ step: "start", label: "Annulation en cours…", logs: "🛑 Demande d'annulation envoyée…", jobId }));
  }
  if (id === "clone:cancel") { return interaction.update(backups.buildCloneResult({ success: false, cancelled: true })); }
  if (id === "clone:history") { const res = await sendAction("backups.clone.getHistory"); return interaction.update(backups.buildCloneHistory(res?.data ?? {})); }
  if (id === "clone:clearHistory") { const res = await sendAction("backups.clone.clearHistory"); return interaction.update(backups.buildCloneHistory(res?.data ?? {})); }
  if (id === "clone:listGuilds") { const res = await sendAction("backups.listGuilds"); return interaction.update(backups.buildCloneGuildList(res?.data ?? {})); }
}

function _error(interaction: MessageComponentInteraction, message: string | undefined = "Une erreur est survenue."): Promise<unknown> {
  return interaction.reply({ content: `❌ ${message ?? "Une erreur est survenue."}`, ephemeral: true });
}

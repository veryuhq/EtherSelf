import { promisify } from "util";
import { execFile } from "child_process";
import type { MessageComponentInteraction } from "discord.js";

import { sendAction } from "../bridge/client";
import { modal, NO_MENTIONS } from "../utils/components";
import { NAV_MAP, makeJobId, fetchMemberRolesPanel, fetchRoleMembersPanel } from "./common";
import { snipeTypeOptions, snipeModeOptions, statusOptions, activityTypeOptions, buttonActionOptions, platformOptions, purgeExclKindOptions, moveDirectionOptions, cloneOptionsCheckboxes } from "./modal-options";
import { fetchAndBuild } from "./fetch-and-build";
import { getCloneConfig } from "../store/clone-config";
import { getRolesConfig } from "../store/roles-config";
import { registerProgressJob, registerCloneJob } from "../store/jobs";

// Panels
import * as afk       from "../panels/afk";
import * as snipe     from "../panels/snipe";
import * as msgbm     from "../panels/msgbookmarks";
import * as antigroup from "../panels/antigroup";
import * as purge     from "../panels/purge";
import * as sysinfo   from "../panels/sysinfo";
import * as rpc       from "../panels/rpc";
import * as quests    from "../panels/quests";
import * as backups   from "../panels/backups";
import * as config    from "../panels/config";
import * as roles     from "../panels/roles";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────

/** Modal de recherche snipe — partagé entre le menu et les boutons
 *  « Autre recherche » des résultats (seuls les défauts des radios changent). */
function snipeViewModal(type = "deleted", mode = "channel") {
  return modal("modal:snipe_view", "Rechercher des messages", [
    { id: "type",  label: "Type de messages",  radio: snipeTypeOptions(type) },
    { id: "mode",  label: "Mode de recherche", radio: snipeModeOptions(mode) },
    { id: "query", label: "ID du salon, serveur ou utilisateur", placeholder: "123456789012345678" },
  ]);
}

/** Modals de recherche du panel Rôles — l'ID du serveur est prérempli quand on
 *  en a un (serveur ciblé, ou serveur du résultat d'où l'on relance une recherche). */
function rolesMemberModal(guildId: string) {
  return modal("modal:roles_member", "Rôles d'un membre", [
    { id: "guildId", label: "ID du serveur", placeholder: "123456789012345678", value: guildId, maxLength: 20 },
    { id: "userId",  label: "ID du membre",  description: "Mode développeur → clic droit sur la personne → Copier l'identifiant", placeholder: "123456789012345678", maxLength: 20 },
  ]);
}

function rolesRoleModal(guildId: string) {
  return modal("modal:roles_role", "Membres d'un rôle", [
    { id: "guildId", label: "ID du serveur", placeholder: "123456789012345678", value: guildId, maxLength: 20 },
    { id: "roleId",  label: "ID du rôle",    description: "Paramètres du serveur → Rôles → clic droit → Copier l'identifiant", placeholder: "123456789012345678", maxLength: 20 },
  ]);
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

  if (NAV_MAP[id]) {
    const panel = await fetchAndBuild(NAV_MAP[id], interaction.user.id);
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
  if (id === "config:restart:skip") {
    const panel = await fetchAndBuild("config");
    return interaction.update(panel!);
  }
  if (id === "config:restart:confirm") {
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
  // ── PREFIX ────────────────────────────────────────────────────────────────
  if (id === "prefix:edit") {
    const res = await sendAction("prefix.get");
    return interaction.showModal(modal("modal:prefix", "Changer le préfixe", [
      { id: "prefix", label: "Nouveau préfixe (1–3 caractères)", placeholder: ".", value: res?.data?.prefix ?? ".", maxLength: 3 },
    ]));
  }

  // ── AFK ───────────────────────────────────────────────────────────────────
  if (id === "afk:toggle") { const res = await sendAction("afk.toggle"); return interaction.update(afk.build(res?.data ?? {})); }
  if (id === "afk:setMessage") {
    const res = await sendAction("afk.getState");
    return interaction.showModal(modal("modal:afk_msg", "Message AFK", [
      { id: "msg", label: "Message (vide = défaut)", placeholder: "Je suis AFK…", value: res?.data?.message ?? "", required: false, long: true },
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
  if (id === "snipe:view") {
    return interaction.showModal(snipeViewModal());
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
    return interaction.showModal(snipeViewModal(type, mode));
  }
  if (id === "snipe:snapshot") {
    return interaction.showModal(modal("modal:snipe_snapshot", "Snapshot d'un salon", [
      { id: "channelId",       label: "ID du salon à archiver",                    placeholder: "123456789012345678" },
      { id: "limit",           label: "Limite (0 = tous les messages)",            placeholder: "0", value: "0", required: false, maxLength: 6 },
      { id: "dm",              label: "Recevoir le fichier en DM",                 description: "Décoche pour l'envoyer dans le salon indiqué ci-dessous", checkbox: true, checked: true },
      { id: "sendToChannelId", label: "ID salon de réception (si DM décoché)",     placeholder: "123456789012345678", required: false },
    ]));
  }
  if (id === "snipe:snapshotPeriodicAdd") {
    return interaction.showModal(modal("modal:snipe_snapshot_periodic_add", "Snapshot périodique", [
      { id: "channelId",       label: "ID du salon à archiver",                    placeholder: "123456789012345678" },
      { id: "interval",        label: "Intervalle (1w, 7d, 24h, 60m)",             placeholder: "1w", value: "1w", maxLength: 20 },
      { id: "limit",           label: "Limite (0 = tous les messages)",            placeholder: "0", value: "0", required: false, maxLength: 6 },
      { id: "dm",              label: "Recevoir les fichiers en DM",               description: "Décoche pour les envoyer dans le salon indiqué ci-dessous", checkbox: true, checked: true },
      { id: "sendToChannelId", label: "ID salon de réception (si DM décoché)",     placeholder: "123456789012345678", required: false },
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
  if (id === "rpc:move") {
    return interaction.showModal(modal("modal:rpc_move", "Déplacer une activité", [
      { id: "index",     label: "Numéro de l'activité à déplacer", placeholder: "1", maxLength: 3 },
      { id: "direction", label: "Direction", radio: moveDirectionOptions() },
    ]));
  }
  if (id === "rpc:clear") { const res = await sendAction("rpc.clearActivities"); return interaction.update(rpc.build(res?.data ?? {})); }
  if (id === "rpc:applyNow") { const res = await sendAction("rpc.applyNow"); if (!res?.success) return _error(interaction, res?.error); return interaction.update(rpc.build(res?.data ?? {})); }
  if (id === "rpc:setAppId") {
    const res = await sendAction("rpc.getState");
    return interaction.showModal(modal("modal:rpc_setAppId", "Définir l'Application ID", [
      { id: "applicationId", label: "Application ID (Discord Developer Portal)", placeholder: "123456789012345678", value: res?.data?.applicationId ?? "", required: false },
    ]));
  }
  if (id === "rpc:spotifyToggle") {
    const state = await sendAction("rpc.getState");
    const spotify = state?.data?.spotify ?? {};
    // On ne peut pas activer sans songId
    if (!spotify.enabled && !spotify.songId) {
      return _error(interaction, "Définis d'abord un Track ID Spotify avant d'activer. Utilise **⚙️ Base** dans le menu.");
    }
    const res = await sendAction("rpc.setSpotifyConfig", {
      enabled:    !spotify.enabled,
      songId:     spotify.songId     ?? null,
      albumId:    spotify.albumId    ?? null,
      details:    spotify.details    ?? null,
      state:      spotify.state      ?? null,
    });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(rpc.buildSpotify(res?.data ?? {}));
  }
  if (id === "rpc:spotify") {
    const res = await sendAction("rpc.getState");
    const spotify = res?.data?.spotify ?? {};
    return interaction.showModal(modal("modal:rpc_spotify", "Configurer Spotify RPC", [
      { id: "songId",  label: "Track ID / URI / URL Spotify", placeholder: "https://open.spotify.com/track/...", value: spotify.songId ?? "", required: false, maxLength: 128 },
      { id: "albumId", label: "Album ID / URI / URL (optionnel)", placeholder: "spotify:album:...", value: spotify.albumId ?? "", required: false, maxLength: 128 },
      { id: "title",   label: "Titre affiché (optionnel)", placeholder: "Nom du morceau", value: spotify.details ?? "", required: false, maxLength: 128 },
      { id: "artists", label: "Artiste(s) — texte libre (virgules)", placeholder: "Artiste 1, Artiste 2", value: spotify.state ?? "", required: false, maxLength: 128 },
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
      { id: "artistIds",     label: "IDs artistes — liens cliquables (opt.)", description: "ID / URI / URL Spotify, séparés par des virgules", placeholder: "spotify:artist:... ou URL", value: (spotify.artistIds ?? []).join(", "), required: false, maxLength: 400 },
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
      { id: "all",       label: "Tout supprimer", description: "Décoche pour limiter au nombre de messages ci-dessous", checkbox: true, checked: true },
      { id: "amount",    label: "Nombre de messages (si limité)", placeholder: "50", required: false, maxLength: 6 },
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
  if (id === "clone:options") {
    const cfg = getCloneConfig(interaction.user.id);
    return interaction.showModal(modal("modal:clone_options", "Options de clonage", [
      { id: "options", label: "Éléments à cloner", description: "Décoche ce que tu ne veux pas copier", checkboxes: cloneOptionsCheckboxes(cfg), minValues: 0, required: false },
    ]));
  }

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

  // ── RÔLES ─────────────────────────────────────────────────────────────────
  if (id === "roles:pickGuild" || id.startsWith("roles:guildPage:")) {
    const page = id.startsWith("roles:guildPage:") ? parseInt(id.split(":")[2], 10) || 0 : 0;
    const res = await sendAction("backups.listGuilds");
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(roles.buildGuildPicker({
      guilds:          res.data?.guilds ?? [],
      page,
      selectedGuildId: getRolesConfig(interaction.user.id).guildId,
    }));
  }
  if (id.startsWith("roles:useGuild:")) {
    const guildId = id.split(":")[2];
    const res = await sendAction("roles.guildInfo", { guildId });
    if (!res?.success) return _error(interaction, res?.error);
    const cfg = getRolesConfig(interaction.user.id);
    cfg.guildId   = guildId;
    cfg.guildName = res.data?.guild?.name ?? null;
    return interaction.update(roles.build({ guild: res.data?.guild ?? null }));
  }
  if (id === "roles:setGuild") {
    return interaction.showModal(modal("modal:roles_guild", "Cibler un serveur", [
      { id: "guildId", label: "ID du serveur", placeholder: "123456789012345678", value: getRolesConfig(interaction.user.id).guildId ?? "", maxLength: 20 },
    ]));
  }
  if (id === "roles:member" || id.startsWith("roles:member:")) {
    return interaction.showModal(rolesMemberModal(id.split(":")[2] ?? getRolesConfig(interaction.user.id).guildId ?? ""));
  }
  if (id === "roles:role" || id.startsWith("roles:role:")) {
    return interaction.showModal(rolesRoleModal(id.split(":")[2] ?? getRolesConfig(interaction.user.id).guildId ?? ""));
  }
  if (id === "roles:list" || id.startsWith("roles:listPage:")) {
    const parts   = id.split(":");
    const guildId = id === "roles:list" ? (getRolesConfig(interaction.user.id).guildId ?? "") : parts[2];
    const page    = id === "roles:list" ? 0 : parseInt(parts[3], 10) || 0;
    if (!guildId) return _error(interaction, "Aucun serveur ciblé — utilise **📂 Mes serveurs** ou **⌨️ Saisir l'ID du serveur**.");
    const res = await sendAction("roles.listRoles", { guildId });
    if (!res?.success) return _error(interaction, res?.error);
    return interaction.update(roles.buildRolesList({ ...(res.data ?? {}), page }));
  }
  // Les deux recherches interrogent le gateway Discord : on acquitte d'abord
  // l'interaction (fenêtre de 3 s) avant de rendre le résultat.
  if (id.startsWith("roles:showRole:") || id.startsWith("roles:rolePage:")) {
    const parts = id.split(":");
    const guildId = parts[2];
    const roleId  = parts[3];
    const deep    = id.startsWith("roles:rolePage:") ? parts[4] === "1" : false;
    const page    = id.startsWith("roles:rolePage:") ? parseInt(parts[5], 10) || 0 : 0;
    await interaction.deferUpdate();
    const { panel, error } = await fetchRoleMembersPanel(guildId, roleId, page, deep);
    if (!panel) return _lateError(interaction, error);
    return interaction.editReply(panel);
  }
  if (id.startsWith("roles:memberPage:")) {
    const [, , guildId, userId, rawPage] = id.split(":");
    await interaction.deferUpdate();
    const { panel, error } = await fetchMemberRolesPanel(guildId, userId, parseInt(rawPage, 10) || 0);
    if (!panel) return _lateError(interaction, error);
    return interaction.editReply(panel);
  }
  if (id.startsWith("roles:deepScan:")) {
    const [, , guildId, roleId] = id.split(":");
    // Le scan peut durer plusieurs minutes : on affiche un panel d'attente,
    // puis on remplace par le résultat une fois le selfbot revenu.
    const info = await sendAction("roles.guildInfo", { guildId });
    await interaction.update(roles.buildScanning({ guild: info?.data?.guild ?? { id: guildId }, role: { id: roleId } }));
    const { panel, error } = await fetchRoleMembersPanel(guildId, roleId, 0, true);
    if (!panel) {
      await interaction.followUp({ content: `❌ ${error ?? "Scan impossible."}`, ephemeral: true, allowedMentions: NO_MENTIONS }).catch(() => {});
      const { panel: fallback } = await fetchRoleMembersPanel(guildId, roleId, 0, false);
      return fallback ? interaction.editReply(fallback).catch(() => {}) : undefined;
    }
    return interaction.editReply(panel).catch(() => {});
  }
}

function _error(interaction: MessageComponentInteraction, message: string | undefined = "Une erreur est survenue."): Promise<unknown> {
  return interaction.reply({
    content: `❌ ${message ?? "Une erreur est survenue."}`,
    ephemeral: true,
    allowedMentions: NO_MENTIONS,
  });
}

/** Même chose, mais après un deferUpdate() : l'interaction est déjà acquittée,
 *  reply() échouerait — il faut passer par followUp(). */
function _lateError(interaction: MessageComponentInteraction, message: string | undefined = "Une erreur est survenue."): Promise<unknown> {
  return interaction.followUp({
    content: `❌ ${message ?? "Une erreur est survenue."}`,
    ephemeral: true,
    allowedMentions: NO_MENTIONS,
  });
}

import type { MessageComponentInteraction, StringSelectMenuInteraction } from "discord.js";

import { sendAction } from "../bridge/client";
import { modal } from "../utils/components";
import { statusOptions, activityTypeOptions, buttonActionOptions, platformOptions, moveDirectionOptions } from "./modal-options";
import { fetchAndBuild } from "./fetch-and-build";
import { handle as handleButton } from "./buttons";

// Panels
import * as rpc from "../panels/rpc";

export async function handle(interaction: StringSelectMenuInteraction): Promise<unknown> {
  // ── menu:* — boutons regroupés en menu déroulant ──────────────────────────
  // Quand un panel dépasse 3 boutons d'action, ceux-ci sont regroupés dans un
  // select (les boutons de navigation, de pagination et les bascules à état
  // restent des boutons). La valeur choisie correspond au custom_id du bouton
  // d'origine : on la redispatche vers le handler de boutons pour réutiliser
  // toute sa logique existante (modals, updates, etc.).
  if (interaction.customId.startsWith("menu:")) {
    const selected = interaction.values?.[0];
    if (!selected) return;
    const proxy = new Proxy(interaction, {
      get(target, prop) {
        if (prop === "customId") return selected;
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as MessageComponentInteraction;
    return handleButton(proxy);
  }

  // ── rpc:actions ──────────────────────────────────────────────────────────
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
        { id: "type",    label: "Type d'activité", radio: activityTypeOptions() },
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
          { id: "type", label: "Type d'activité", radio: activityTypeOptions(a.type ?? "playing") },
          { id: "name", label: "Nom de l'activité", placeholder: "Minecraft, une playlist…", value: a.name ?? "", maxLength: 128 },
          { id: "details", label: "Détails (ligne 2, optionnel)", placeholder: "Survie solo — Niveau 42", value: a.details ?? "", required: false, maxLength: 128 },
          { id: "state", label: "État (ligne 3, optionnel)", placeholder: "Dans les mines", value: a.state ?? "", required: false, maxLength: 128 },
        ]));
      }
      return interaction.showModal(modal("modal:rpc_editActivity", "Éditer une activité", [
        { id: "index", label: `Numéro (1–${activities.length})`, placeholder: "1", maxLength: 3 },
        { id: "type", label: "Type d'activité", radio: activityTypeOptions() },
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
        { id: "platform", label: "Plateforme", radio: platformOptions(activities.length === 1 ? activities[0]?.platform : null) },
      ]));
    }
    if (id === "editButtons") {
      const state = await sendAction("rpc.getState");
      const activities = state?.data?.activities ?? [];
      const hint = activities.length === 1 ? (() => {
        const btns = activities[0].buttons ?? [];
        return btns.length ? btns.map((b: { label: string }, i: number) => `${i + 1}: ${b.label}`).join(" / ") : "aucun bouton";
      })() : null;
      return interaction.showModal(modal("modal:rpc_editButtons", "Gérer les boutons RPC", [
        { id: "index", label: activities.length === 1 ? "Numéro de l'activité" : `Numéro de l'activité (1–${activities.length})`, placeholder: "1", value: activities.length === 1 ? "1" : "", maxLength: 3 },
        { id: "buttonAction", label: "Action", radio: buttonActionOptions() },
        { id: "label", label: "Label du bouton (max 32 chars)", placeholder: hint ? `Boutons actuels : ${hint}` : "Mon site", required: false, maxLength: 32 },
        { id: "url", label: "URL du bouton", placeholder: "https://example.com", required: false, maxLength: 512 },
        { id: "buttonIndex", label: "Numéro bouton à supprimer (remove only)", placeholder: "1 ou 2", required: false, maxLength: 1 },
      ]));
    }
    if (id === "move") {
      return interaction.showModal(modal("modal:rpc_move", "Déplacer une activité", [
        { id: "index",     label: "Numéro de l'activité à déplacer", placeholder: "1", maxLength: 3 },
        { id: "direction", label: "Direction", radio: moveDirectionOptions() },
      ]));
    }
    if (id === "setStatus") {
      const res = await sendAction("rpc.getState");
      return interaction.showModal(modal("modal:rpc_setStatus", "Définir le statut en ligne", [
        { id: "status", label: "Statut", radio: statusOptions(res?.data?.status ?? "online") },
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

  // ── rpc:spotifyActions ────────────────────────────────────────────────────
  if (interaction.customId === "rpc:spotifyActions") {
    const id = interaction.values[0];

    if (id === "spotifyToggle") {
      const state = await sendAction("rpc.getState");
      const currentEnabled = state?.data?.spotify?.enabled ?? false;
      const spotify = state?.data?.spotify ?? {};

      // On ne peut pas activer sans songId
      if (!currentEnabled && !spotify.songId) {
        return interaction.reply({
          content: "❌ Définis d'abord un Track ID Spotify avant d'activer. Utilise **⚙️ Base** dans le menu.",
          ephemeral: true,
        });
      }

      const res = await sendAction("rpc.setSpotifyConfig", {
        enabled:    !currentEnabled,
        songId:     spotify.songId     ?? null,
        albumId:    spotify.albumId    ?? null,
        artistIds:  spotify.artistIds  ?? [],
        details:    spotify.details    ?? null,
        state:      spotify.state      ?? null,
      });
      if (!res?.success) return interaction.reply({ content: `❌ ${res?.error ?? "Une erreur est survenue."}`, ephemeral: true });
      return interaction.update(rpc.buildSpotify(res?.data ?? {}));
    }

    if (id === "spotifyBase") {
      const res = await sendAction("rpc.getState");
      const spotify = res?.data?.spotify ?? {};
      const displayValue = [spotify.details ?? "", spotify.state ?? ""].filter(Boolean).join(" | ");
      return interaction.showModal(modal("modal:rpc_spotify", "Configurer Spotify RPC (base)", [
        { id: "enabled",   label: "Activer Spotify RPC", checkbox: true, checked: !!spotify.enabled },
        { id: "songId",    label: "Track ID / URI / URL Spotify", placeholder: "https://open.spotify.com/track/...", value: spotify.songId ?? "", required: false, maxLength: 128 },
        { id: "albumId",   label: "Album ID / URI / URL (optionnel)", placeholder: "spotify:album:...", value: spotify.albumId ?? "", required: false, maxLength: 128 },
        { id: "artistIds", label: "Artist IDs Spotify (virgules)", placeholder: "artist1, artist2", value: (spotify.artistIds ?? []).join(", "), required: false, maxLength: 400 },
        { id: "display",   label: "Affichage (titre | artiste, optionnel)", placeholder: "Nom du morceau | Nom de l'artiste", value: displayValue, required: false, maxLength: 128 },
      ]));
    }

    if (id === "spotifyAssets") {
      const res = await sendAction("rpc.getState");
      const assets = res?.data?.spotify?.assets ?? {};
      return interaction.showModal(modal("modal:rpc_spotifyAssets", "Configurer les assets Spotify", [
        { id: "largeImage", label: "Large image", placeholder: "spotify:image_id / mp:... / asset id", value: assets.largeImage ?? "", required: false, maxLength: 256 },
        { id: "largeText",  label: "Large text",  placeholder: "Tooltip image large", value: assets.largeText ?? "", required: false, maxLength: 128 },
        { id: "smallImage", label: "Small image", placeholder: "spotify:image_id / mp:... / asset id", value: assets.smallImage ?? "", required: false, maxLength: 256 },
        { id: "smallText",  label: "Small text",  placeholder: "Tooltip image small", value: assets.smallText ?? "", required: false, maxLength: 128 },
      ]));
    }

    if (id === "spotifyTimestamps") {
      const res = await sendAction("rpc.getState");
      const timestamps = res?.data?.spotify?.timestamps ?? {};
      const now = Date.now();
      const startOffsetSec = timestamps.start ? Math.max(0, Math.round((timestamps.start - now) / 1000)) : 0;
      const durationSec = (timestamps.start && timestamps.end && timestamps.end > timestamps.start)
        ? Math.round((timestamps.end - timestamps.start) / 1000)
        : "";
      return interaction.showModal(modal("modal:rpc_spotifyTimestamps", "Configurer les timestamps Spotify", [
        { id: "startOffsetSec", label: "Début dans combien de sec", placeholder: "0", value: String(startOffsetSec), required: false, maxLength: 10 },
        { id: "durationSec",    label: "Durée en sec",              placeholder: "810", value: durationSec === "" ? "" : String(durationSec), required: false, maxLength: 10 },
      ]));
    }

    if (id === "spotifyExtras") {
      const res = await sendAction("rpc.getState");
      const spotify = res?.data?.spotify ?? {};
      return interaction.showModal(modal("modal:rpc_spotifyExtras", "Configurer les extras Spotify", [
        { id: "applicationId", label: "Application ID (optionnel)", placeholder: "123456789012345678", value: spotify.applicationId ?? "", required: false, maxLength: 20 },
        { id: "platform",      label: "Plateforme", radio: platformOptions(spotify.platform) },
        { id: "url",           label: "URL (optionnel)",            placeholder: "https://open.spotify.com/track/...", value: spotify.url ?? "", required: false, maxLength: 256 },
      ]));
    }

    return interaction.reply({ content: "❌ Action Spotify inconnue.", ephemeral: true });
  }

  // ── panel:nav ─────────────────────────────────────────────────────────────
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

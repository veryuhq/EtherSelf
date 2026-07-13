"use strict";

const { ButtonStyle } = require("discord.js");

// ─────────────────────────────────────────────────────────────────────────────
//  COMPONENTS V2 — Builders centralisés
//  Tous les panels importent depuis ici pour rester cohérents.
// ─────────────────────────────────────────────────────────────────────────────

/** Container (type 17) */
function container(components, accentColor = 0x5865F2) {
  return { type: 17, accent_color: accentColor, components };
}

/** TextDisplay (type 10) */
function textDisplay(content) {
  return { type: 10, content };
}

/** Separator (type 14) */
function separator(spacing = 1, divider = true) {
  return { type: 14, spacing, divider };
}

/** File (type 13) — affiche un fichier attaché, à référencer par son nom d'attachment */
function fileComponent(attachmentName) {
  return { type: 13, file: { url: `attachment://${attachmentName}` } };
}

/** ActionRow (type 1) */
function actionRow(components) {
  return { type: 1, components };
}

/** Button (type 2) */
function btn(label, customId, style = ButtonStyle.Secondary, emoji = null, disabled = false) {
  const b = { type: 2, label, custom_id: customId, style, disabled };
  if (emoji) b.emoji = { name: emoji };
  return b;
}

/** StringSelect (type 3) enveloppé dans un ActionRow */
function selectMenu(customId, placeholder, options, minValues = 1, maxValues = 1) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: customId,
      placeholder,
      min_values: minValues,
      max_values: maxValues,
      options,
    }],
  };
}

/** Modal — chaque champ est enveloppé dans un Label (type 18), le format
 *  standard des modals : label (≤ 45 car.) + description optionnelle
 *  (≤ 100 car.) + un composant enfant (TextInput type 4). */
function modal(customId, title, fields) {
  const components = fields.map(f => {
    const component = {
      type:        4,
      custom_id:   f.id,
      style:       f.long ? 2 : 1,
      placeholder: f.placeholder ?? "",
      value:       f.value ?? "",
      required:    f.required ?? true,
      min_length:  f.minLength ?? 0,
      max_length:  f.maxLength ?? 1000,
    };
    return { type: 18, label: f.label, description: f.description, component };
  });

  return { custom_id: customId, title, components };
}

/**
 * Formate un texte de log multi-lignes pour affichage dans un Container :
 * chaque ligne devient une citation en code inline (`> \`ligne\``), le rendu
 * "logs" du repo (plus de bloc de code ```).
 */
function logLines(text) {
  return String(text ?? "")
    .split("\n")
    .map(line => (line.trim() ? `> \`${line.replace(/`/g, "'")}\`` : "> "))
    .join("\n");
}

/**
 * Barre de navigation commune.
 * @param {string|null} backId      - customId du bouton "◀ Retour" (null = pas de retour)
 * @param {string}      backLabel   - label du bouton retour
 * @param {boolean}     showHome    - affiche le bouton "🏠 Accueil"
 */
function navRow(backId = null, backLabel = "Retour", showHome = true) {
  const buttons = [];
  if (backId)   buttons.push(btn(`◀️  ${backLabel}`, backId,      ButtonStyle.Secondary));
  if (showHome) buttons.push(btn("🏠  Accueil",       "panel:home", ButtonStyle.Secondary));
  return actionRow(buttons);
}

/**
 * Réponse ephemeral Components V2 standard.
 * Encapsule les composants dans le flag is_components_v2.
 */
function ephemeralV2(...components) {
  return {
    flags: (1 << 15) | (1 << 6), // IS_COMPONENTS_V2 | EPHEMERAL
    components,
  };
}

/**
 * Réponse Components V2 (non-ephemeral, pour les updates).
 */
function replyV2(...components) {
  return {
    flags: 1 << 15, // IS_COMPONENTS_V2
    components,
  };
}

module.exports = {
  container,
  textDisplay,
  separator,
  fileComponent,
  actionRow,
  btn,
  selectMenu,
  modal,
  logLines,
  navRow,
  ephemeralV2,
  replyV2,
};

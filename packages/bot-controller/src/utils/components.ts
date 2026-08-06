import { ButtonStyle } from "discord.js";
import type {
  APIModalInteractionResponseCallbackData,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessageCreateOptions,
} from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
//  COMPONENTS V2 — builders centralisés, importés par tous les panels.
//  JSON brut (pas de builders discord.js), d'où les types locaux ci-dessous.
// ─────────────────────────────────────────────────────────────────────────────

export interface TextDisplayComponent {
  type: 10;
  content: string;
}

export interface SeparatorComponent {
  type: 14;
  spacing: number;
  divider: boolean;
}

export interface FileDisplayComponent {
  type: 13;
  file: { url: string };
}

export interface ButtonComponent {
  type: 2;
  label: string;
  custom_id: string;
  style: ButtonStyle;
  disabled: boolean;
  emoji?: { name: string };
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

export interface StringSelectComponent {
  type: 3;
  custom_id: string;
  placeholder: string;
  min_values: number;
  max_values: number;
  options: SelectOption[];
}

export interface ActionRowComponent {
  type: 1;
  components: Array<ButtonComponent | StringSelectComponent>;
}

export interface ThumbnailComponent {
  type: 11;
  media: { url: string };
  description?: string;
}

export interface SectionComponent {
  type: 9;
  components: TextDisplayComponent[];
  accessory: ThumbnailComponent | ButtonComponent;
}

export type ContainerChild =
  | TextDisplayComponent
  | SeparatorComponent
  | FileDisplayComponent
  | SectionComponent
  | ActionRowComponent;

export interface ContainerComponent {
  type: 17;
  accent_color: number;
  components: ContainerChild[];
}

export type TopLevelComponent = ContainerComponent | ContainerChild;

/** Payload Components V2 assignable à toutes les cibles d'envoi (reply, update,
 *  editReply, followUp, send) sans cast aux call sites. */
export type V2MessagePayload = InteractionReplyOptions &
  InteractionUpdateOptions &
  MessageCreateOptions;

/** Container (type 17) */
export function container(components: ContainerChild[], accentColor = 0x5865f2): ContainerComponent {
  return { type: 17, accent_color: accentColor, components };
}

/** TextDisplay (type 10) */
export function textDisplay(content: string): TextDisplayComponent {
  return { type: 10, content };
}

/** Separator (type 14) */
export function separator(spacing = 1, divider = true): SeparatorComponent {
  return { type: 14, spacing, divider };
}

/** File (type 13) — affiche un fichier attaché, à référencer par son nom d'attachment */
export function fileComponent(attachmentName: string): FileDisplayComponent {
  return { type: 13, file: { url: `attachment://${attachmentName}` } };
}

/** Thumbnail (type 11) — uniquement en accessoire de Section */
export function thumbnail(url: string, description?: string): ThumbnailComponent {
  const t: ThumbnailComponent = { type: 11, media: { url } };
  if (description) t.description = description;
  return t;
}

/** Section (type 9) — 1 à 3 Text Display + un accessoire (bouton ou thumbnail) */
export function section(
  texts: string[],
  accessory: ThumbnailComponent | ButtonComponent,
): SectionComponent {
  return { type: 9, components: texts.slice(0, 3).map(textDisplay), accessory };
}

/** ActionRow (type 1) */
export function actionRow(components: Array<ButtonComponent | StringSelectComponent>): ActionRowComponent {
  return { type: 1, components };
}

/** Button (type 2) */
export function btn(
  label: string,
  customId: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  emoji: string | null = null,
  disabled = false,
): ButtonComponent {
  const b: ButtonComponent = { type: 2, label, custom_id: customId, style, disabled };
  if (emoji) b.emoji = { name: emoji };
  return b;
}

/** StringSelect (type 3) enveloppé dans un ActionRow */
export function selectMenu(
  customId: string,
  placeholder: string,
  options: SelectOption[],
  minValues = 1,
  maxValues = 1,
): ActionRowComponent {
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

export interface ModalField {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
  long?: boolean;
  minLength?: number;
  maxLength?: number;
  /** true = champ FileUpload (type 19) au lieu d'un TextInput. */
  file?: boolean;
  /** FileUpload uniquement : nombre max de fichiers (défaut 1). */
  maxFiles?: number;
  /** Présent = champ StringSelect (type 3) au lieu d'un TextInput.
   *  Les options sont figées à l'ouverture du modal (pas de dynamique). */
  options?: SelectOption[];
  /** StringSelect/CheckboxGroup : nombre min/max de sélections
   *  (défaut 1/1 pour un select, 1/toutes pour un groupe de checkboxes). */
  minValues?: number;
  maxValues?: number;
  /** Présent = champ RadioGroup (type 21) : choix unique, 2 à 10 options. */
  radio?: SelectOption[];
  /** Présent = champ CheckboxGroup (type 22) : cases à cocher, 2 à 10 options. */
  checkboxes?: SelectOption[];
  /** true = Checkbox seule (type 23), question oui/non. */
  checkbox?: boolean;
  /** Checkbox uniquement : cochée par défaut (défaut false). */
  checked?: boolean;
}

/** Modal — chaque champ (texte, `file`, `options`, `radio`, `checkboxes`, `checkbox`)
 *  est enveloppé dans un Label (type 18) : label ≤ 45 car., description ≤ 100 car.,
 *  un composant enfant. Soumission via `fields.getTextInputValue(id)` et compagnie. */
export function modal(
  customId: string,
  title: string,
  fields: ModalField[],
): APIModalInteractionResponseCallbackData {
  const components = fields.map((f) => {
    const component = f.options
      ? {
          type:        3,
          custom_id:   f.id,
          placeholder: f.placeholder ?? "",
          min_values:  f.minValues ?? 1,
          max_values:  f.maxValues ?? 1,
          required:    f.required ?? true,
          options:     f.options,
        }
      : f.radio
      ? {
          type:      21,
          custom_id: f.id,
          required:  f.required ?? true,
          options:   f.radio,
        }
      : f.checkboxes
      ? {
          type:       22,
          custom_id:  f.id,
          min_values: f.minValues ?? 1,
          max_values: f.maxValues ?? f.checkboxes.length,
          required:   f.required ?? true,
          options:    f.checkboxes,
        }
      : f.checkbox
      ? {
          type:      23,
          custom_id: f.id,
          default:   f.checked ?? false,
        }
      : f.file
      ? {
          type:       19,
          custom_id:  f.id,
          min_values: (f.required ?? true) ? 1 : 0,
          max_values: f.maxFiles ?? 1,
          required:   f.required ?? true,
        }
      : {
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

  // Le type Label (18) n'est pas encore couvert par la version publiée de
  // discord-api-types : on garde le JSON brut et on l'aligne sur le type
  // attendu par showModal().
  return { custom_id: customId, title, components } as unknown as APIModalInteractionResponseCallbackData;
}

/** Formate un log multi-lignes pour un Container : chaque ligne devient une citation
 *  en code inline (`> \`ligne\``).
 *
 *  Lignes et longueurs bornées : ces logs contiennent des messages d'erreur bruts de
 *  l'API Discord, qui peuvent être très longs. Sans bornage, le bloc à lui seul
 *  dépassait les 4000 caractères du message et faisait rejeter tout le panel. */
export function logLines(text: string | null | undefined, maxLines = 10, maxLineLength = 200): string {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "> ";
      const cut = trimmed.length > maxLineLength ? `${trimmed.slice(0, maxLineLength - 1)}…` : trimmed;
      return `> \`${cut.replace(/`/g, "'")}\``;
    });
  return boundedList(lines, { maxLines, maxChars: 1400, empty: "" });
}

/**
 * Barre de navigation commune.
 * @param backId    customId du bouton "◀ Retour" (null = pas de retour)
 * @param backLabel label du bouton retour
 * @param showHome  affiche le bouton "🏠 Accueil"
 */
export function navRow(
  backId: string | null = null,
  backLabel: string | null = "Retour",
  showHome = true,
): ActionRowComponent {
  const buttons: ButtonComponent[] = [];
  if (backId)   buttons.push(btn(`◀️  ${backLabel}`, backId,      ButtonStyle.Secondary));
  if (showHome) buttons.push(btn("🏠  Accueil",       "panel:home", ButtonStyle.Secondary));
  return actionRow(buttons);
}

/**
 * Aucune mention n'est jamais résolue dans les messages du panel : les Text Display
 * notifient réellement, et les panels affichent du contenu tiers (un `@everyone` snipé
 * pingerait pour de bon au moment de son affichage).
 */
export const NO_MENTIONS = { parse: [] as never[] };

/** Réponse ephemeral Components V2 standard. */
export function ephemeralV2(...components: TopLevelComponent[]): V2MessagePayload {
  return {
    flags: (1 << 15) | (1 << 6), // IS_COMPONENTS_V2 | EPHEMERAL
    components,
    allowedMentions: NO_MENTIONS,
  } as unknown as V2MessagePayload;
}

/** Réponse Components V2 (non-ephemeral, pour les updates). */
export function replyV2(...components: TopLevelComponent[]): V2MessagePayload {
  return {
    flags: 1 << 15, // IS_COMPONENTS_V2
    components,
    allowedMentions: NO_MENTIONS,
  } as unknown as V2MessagePayload;
}

/**
 * Neutralise le markdown d'un texte tiers avant de l'insérer dans un Text Display :
 * sans ça, un backtick ou un `#` casse la mise en page. Les retours à la ligne sont
 * aplatis pour rester dans la citation `> ` qui entoure le contenu.
 *
 * @param maxLength longueur max AVANT échappement (0 = pas de troncature)
 */
export function plainText(value: unknown, maxLength = 0): string {
  const raw = String(value ?? "").replace(/\r?\n/g, " ");
  const sliced = maxLength > 0 ? raw.slice(0, maxLength) : raw;
  return sliced.replace(/[\\`*_~|]/g, (char) => `\\${char}`);
}

export interface BoundedListOptions {
  /** Nombre maximum d'entrées affichées. */
  maxLines?: number;
  /** Budget de caractères alloué à cette liste. */
  maxChars?: number;
  /** Texte rendu quand la liste est vide. */
  empty?: string;
  /** Séparateur entre deux entrées (`"\n\n"` pour des blocs multi-lignes). */
  separator?: string;
}

/**
 * Borne une liste avant de l'insérer dans un Text Display.
 *
 * Un message Components V2 plafonne à 4000 caractères cumulés sur ses Text Display,
 * et Discord rejette le message ENTIER au-delà : une liste non bornée (tags, favoris,
 * exclusions, historique…) ne tronque donc pas l'affichage, elle fait disparaître le
 * panel. On coupe au nombre d'entrées ET au budget de caractères, et on dit toujours
 * combien d'entrées sont masquées plutôt que de les escamoter en silence.
 */
export function boundedList(entries: string[], options: BoundedListOptions = {}): string {
  const { maxLines = 25, maxChars = 1800, empty = "*Aucune entrée.*", separator: sep = "\n" } = options;
  if (!entries.length) return empty;

  const kept: string[] = [];
  let budget = maxChars;
  for (const entry of entries) {
    const cost = entry.length + sep.length;
    if (kept.length >= maxLines || cost > budget) break;
    kept.push(entry);
    budget -= cost;
  }

  // Première entrée déjà hors budget : mieux vaut l'annoncer que rendre un bloc vide.
  if (!kept.length) return `-# *${entries.length} entrée(s), trop volumineuses pour être affichées ici.*`;

  const hidden = entries.length - kept.length;
  if (hidden > 0) kept.push(`-# *… et ${hidden} autre(s) non affichée(s).*`);
  return kept.join(sep);
}

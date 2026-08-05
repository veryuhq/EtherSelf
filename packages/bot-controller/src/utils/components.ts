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
 *  en code inline (`> \`ligne\``). */
export function logLines(text: string | null | undefined): string {
  return String(text ?? "")
    .split("\n")
    .map((line) => (line.trim() ? `> \`${line.replace(/`/g, "'")}\`` : "> "))
    .join("\n");
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

import { ButtonStyle } from "discord.js";
import type {
  APIModalInteractionResponseCallbackData,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessageCreateOptions,
} from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
//  COMPONENTS V2 — Builders centralisés
//  Tous les panels importent depuis ici pour rester cohérents.
//  Les composants sont construits en JSON brut (pas de builders discord.js),
//  d'où les types structurels locaux ci-dessous.
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

export type ContainerChild =
  | TextDisplayComponent
  | SeparatorComponent
  | FileDisplayComponent
  | ActionRowComponent;

export interface ContainerComponent {
  type: 17;
  accent_color: number;
  components: ContainerChild[];
}

export type TopLevelComponent = ContainerComponent | ContainerChild;

/**
 * Payload de message Components V2, assignable à toutes les cibles d'envoi
 * (reply, update, editReply, followUp, send). L'intersection permet de passer
 * le même objet partout sans cast aux call sites.
 */
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

/** Modal — chaque champ (texte, `file: true`, `options`, `radio`, `checkboxes`
 *  ou `checkbox: true`) est enveloppé dans un Label (type 18), le format
 *  standard des modals : label (≤ 45 car.) + description optionnelle
 *  (≤ 100 car.) + un composant enfant (TextInput type 4, FileUpload type 19,
 *  StringSelect type 3, RadioGroup type 21, CheckboxGroup type 22 ou
 *  Checkbox type 23).
 *  Soumission : `fields.getTextInputValue(id)`, `.getUploadedFiles(id)`,
 *  `.getStringSelectValues(id)` (sans sélection → `[]`),
 *  `.getRadioGroup(id)`, `.getCheckboxGroup(id)`, `.getCheckbox(id)`. */
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

/**
 * Formate un texte de log multi-lignes pour affichage dans un Container :
 * chaque ligne devient une citation en code inline (`> \`ligne\``), le rendu
 * "logs" du repo (plus de bloc de code ```).
 */
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
 * Réponse ephemeral Components V2 standard.
 * Encapsule les composants dans le flag is_components_v2.
 */
export function ephemeralV2(...components: TopLevelComponent[]): V2MessagePayload {
  return {
    flags: (1 << 15) | (1 << 6), // IS_COMPONENTS_V2 | EPHEMERAL
    components,
  } as unknown as V2MessagePayload;
}

/**
 * Réponse Components V2 (non-ephemeral, pour les updates).
 */
export function replyV2(...components: TopLevelComponent[]): V2MessagePayload {
  return {
    flags: 1 << 15, // IS_COMPONENTS_V2
    components,
  } as unknown as V2MessagePayload;
}

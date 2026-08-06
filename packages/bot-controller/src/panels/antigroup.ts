import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, navRow, boundedList, plainText, replyV2, type V2MessagePayload } from "../utils/components";

export interface AntigroupData {
  enabled?: boolean;
}

export interface LeaveAllResultData {
  left?: number;
  failed?: number;
  total?: number | null;
  details?: Array<{ id: string; success: boolean; error?: string }>;
}

export function build(data: AntigroupData = {}): V2MessagePayload {
  const { enabled = false } = data;
  return replyV2(
    container([
      textDisplay(
        `# 🔇 Anti-Group DM\n` +
        `${enabled ? "`🟢`" : "`🔴`"} **Statut :** ${enabled ? "Activé" : "Désactivé"}\n\n` +
        `*Quitte tout groupe DM entrant dès sa création.*`
      ),
      separator(),
      actionRow([
        btn(
          enabled ? "🔴  Désactiver" : "🟢  Activer",
          "antigroup:toggle",
          enabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
        btn("🚪  Quitter tous les groupes", "antigroup:confirmLeaveAll", ButtonStyle.Danger),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xE67E22)
  );
}

export function buildConfirmLeaveAll(): V2MessagePayload {
  return replyV2(
    container([
      textDisplay(
        `# ⚠️ Quitter tous les groupes DM\n\n` +
        `Tu vas quitter **tous les groupes DM** auxquels tu participes actuellement.\n\n` +
        `-# Cette action est irréversible. Tu devras être réinvité(e) pour rejoindre à nouveau ces groupes.`
      ),
      separator(),
      actionRow([
        btn("✅  Confirmer",  "antigroup:leaveAll", ButtonStyle.Danger),
        btn("❌  Annuler",    "panel:antigroup",    ButtonStyle.Secondary),
      ]),
    ], 0xE67E22)
  );
}

export function buildLeaveAllResult(data: LeaveAllResultData = {}): V2MessagePayload {
  const { left = 0, failed = 0, total = 0, details = [] } = data;

  let statusLine: string;
  if (total === 0 || total === null) {
    statusLine = "`ℹ️` **Aucun groupe DM trouvé dans le cache.**\n*Si tu es dans des groupes, essaie de les ouvrir dans Discord avant de relancer.*";
  } else if (failed === 0) {
    statusLine = `\`✅\` **${left}** groupe(s) quitté(s) avec succès.`;
  } else {
    // `error` remonte tel quel de l'API Discord via le selfbot : markdown neutralisé
    // (cf. plainText) et liste bornée avant d'entrer dans un Text Display.
    statusLine =
      `\`⚠️\` **${left}** groupe(s) quitté(s) — **${failed}** échec(s).\n\n` +
      boundedList(
        details
          .filter((d) => !d.success)
          .map((d) => `> ❌ \`${plainText(d.id)}\` — ${plainText(d.error ?? "Erreur inconnue", 120)}`),
        { maxLines: 15, maxChars: 1200 },
      );
  }

  return replyV2(
    container([
      textDisplay(
        `# 🚪 Résultat — Quitter les groupes\n` +
        `\`📊\` **${left}** quitté(s) sur **${total ?? 0}** groupe(s) détecté(s)\n\n` +
        `${statusLine}`
      ),
      separator(),
      navRow("panel:antigroup", "Anti-Group"),
    ], 0xE67E22)
  );
}

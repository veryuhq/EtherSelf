import { container, textDisplay, separator, selectMenu, navRow, boundedList, plainText, replyV2, type V2MessagePayload } from "../utils/components";

export interface MessageBookmark {
  content?: string;
  note?: string | null;
  url?: string | null;
  authorTag?: string;
}

export interface MsgBookmarksData {
  bookmarks?: MessageBookmark[];
}

export function build(data: MsgBookmarksData = {}): V2MessagePayload {
  const { bookmarks = [] } = data;
  // Le selfbot en conserve jusqu'à 200 : sans bornage, la liste dépassait à elle
  // seule les 4000 caractères cumulés des Text Display et Discord rejetait le panel.
  const list = boundedList(
    bookmarks.map((b, i) => {
      // content / authorTag viennent du message d'origine (donc d'un tiers).
      const content = plainText(b.content, 120) + ((b.content ?? "").length > 120 ? "…" : "");
      const note    = b.note ? `  •  📎 *${plainText(b.note, 100)}*` : "";
      const link    = b.url  ? `\n${plainText(b.url)}` : "";
      return `**${i + 1}. ${plainText(b.authorTag, 60) || "?"}**${note}\n> ${content || "*(vide)*"}${link}`;
    }),
    { maxLines: 10, separator: "\n\n", empty: "*Aucun message sauvegardé.*" },
  );

  return replyV2(
    container([
      textDisplay(`# 💬 Bookmarks messages\n**Messages sauvegardés (${bookmarks.length}) :**\n${list}`),
      separator(),
      selectMenu("menu:msgbm", "📋  Choisis une action…", [
        { label: "➕  Ajouter",      value: "msgbm:add",    description: "Ajouter un bookmark message" },
        { label: "➖  Supprimer",    value: "msgbm:remove", description: "Supprimer un bookmark" },
        { label: "📝  Ajouter note", value: "msgbm:note",   description: "Ajouter ou modifier une note" },
        { label: "🗑️  Tout effacer", value: "msgbm:clear",  description: "Effacer tous les bookmarks" },
      ]),
      separator(),
      navRow(null, null, true),
    ], 0x9B59B6)
  );
}

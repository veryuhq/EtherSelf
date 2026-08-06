import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, navRow, boundedList, replyV2, type V2MessagePayload } from "../utils/components";

export interface BookmarksData {
  bookmarks?: string[];
}

export function build(data: BookmarksData = {}): V2MessagePayload {
  const { bookmarks = [] } = data;
  const list = boundedList(
    bookmarks.map((id, i) => `\`${i + 1}.\` <#${id}>`),
    { maxLines: 40, empty: "*Aucun bookmark de salon.*" },
  );

  return replyV2(
    container([
      textDisplay(`# 📌 Bookmarks salons\n**Salons sauvegardés (${bookmarks.length}) :**\n${list}`),
      separator(),
      actionRow([
        btn("➕  Ajouter",    "bookmarks:add",    ButtonStyle.Success),
        btn("➖  Supprimer",  "bookmarks:remove", ButtonStyle.Danger),
      ]),
      separator(),
      navRow(null, null, true),
    ], 0xF1C40F)
  );
}

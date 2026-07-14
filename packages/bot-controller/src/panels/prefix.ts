import { ButtonStyle } from "discord.js";
import { container, textDisplay, separator, actionRow, btn, navRow, replyV2, type V2MessagePayload } from "../utils/components";

export interface PrefixData {
  prefix?: string;
}

export function build(data: PrefixData = {}): V2MessagePayload {
  const { prefix = "." } = data;
  return replyV2(
    container([
      textDisplay(`# ⚙️ Préfixe\nPréfixe actuel : \`${prefix}\``),
      separator(),
      actionRow([
        btn("✏️  Changer le préfixe", "prefix:edit", ButtonStyle.Primary),
      ]),
      separator(),
      navRow("panel:config", "Configuration"),
    ], 0xEB459E)
  );
}

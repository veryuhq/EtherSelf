import { container, textDisplay, separator, selectMenu, navRow, replyV2, type SelectOption, type V2MessagePayload } from "../utils/components";

export interface JoinVcData {
  joined?: boolean;
  channelId?: string | null;
  channelName?: string | null;
  guildName?: string | null;
}

export function build(data: JoinVcData = {}): V2MessagePayload {
  const { joined = false, channelId = null, channelName = null, guildName = null } = data;

  const status = joined
    ? "`🟢` **Connecté** dans **" + (channelName ?? channelId) + "**" + (guildName ? ` — *${guildName}*` : "")
    : "`🔴` **Non connecté**";

  const vcActions: SelectOption[] = [
    { label: "🔊  Rejoindre", value: "joinvc:join", description: "Rejoindre un salon vocal" },
  ];
  if (joined) {
    vcActions.push(
      { label: "🔄  Changer de salon", value: "joinvc:move",  description: "Changer de salon vocal" },
      { label: "🔇  Quitter",          value: "joinvc:leave", description: "Quitter le salon vocal" },
    );
  }

  return replyV2(
    container([
      textDisplay(`# 🔊 Salon vocal\n${status}`),
      separator(1, false),
      selectMenu("menu:joinvc", "📋  Choisis une action…", vcActions),
      separator(),
      navRow(null, null, true),
    ], 0x9B59B6)
  );
}

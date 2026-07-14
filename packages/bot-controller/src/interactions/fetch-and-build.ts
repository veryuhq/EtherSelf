import { sendAction } from "../bridge/client";
import type { V2MessagePayload } from "../utils/components";

// Panels
import * as home      from "../panels/home";
import * as config    from "../panels/config";
import * as prefix    from "../panels/prefix";
import * as afk       from "../panels/afk";
import * as snipe     from "../panels/snipe";
import * as tags      from "../panels/tags";
import * as bookmarks from "../panels/bookmarks";
import * as msgbm     from "../panels/msgbookmarks";
import * as antigroup from "../panels/antigroup";
import * as autobump  from "../panels/autobump";
import * as joinvc    from "../panels/joinvc";
import * as purge     from "../panels/purge";
import * as sysinfo   from "../panels/sysinfo";
import * as rpc       from "../panels/rpc";
import * as quests    from "../panels/quests";
import * as backups   from "../panels/backups";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PanelData = any;

/**
 * Récupère l'état d'un module auprès du selfbot puis construit son panel.
 * Point d'entrée commun aux boutons de navigation, aux selects et aux modals.
 */
export async function fetchAndBuild(panelKey: string): Promise<V2MessagePayload | null> {
  const fetchers: Record<string, () => Promise<PanelData> | null> = {
    home:         () => sendAction("prefix.get"),
    config:       () => null,
    prefix:       () => sendAction("prefix.get"),
    afk:          () => sendAction("afk.getState"),
    snipe:        async () => {
      const [whitelistRes, schedulesRes] = await Promise.all([
        sendAction("snipe.getWhitelist"),
        sendAction("snapshot.periodic.list"),
      ]);
      return {
        ...(whitelistRes?.data ?? {}),
        snapshotSchedules: schedulesRes?.data?.jobs ?? [],
        snapshotSchedulesRunning: schedulesRes?.data?.running ?? false,
      };
    },
    tags:         async () => {
      const [tagsRes, prefixRes] = await Promise.all([sendAction("tag.list"), sendAction("prefix.get")]);
      return { tags: tagsRes?.data?.tags ?? {}, prefix: prefixRes?.data?.prefix ?? "." };
    },
    bookmarks:    () => sendAction("bookmark.list"),
    msgbookmarks: () => sendAction("msgbm.list"),
    antigroup:    () => sendAction("antigroup.getState"),
    autobump:     () => sendAction("autobump.list"),
    joinvc:       () => sendAction("voice.getState"),
    purge_exclusions: () => sendAction("purge.getExclusions"),
    rpc:          () => sendAction("rpc.getState"),
    rpc_cs:       () => sendAction("rpc.getState"),
    rpc_spotify:  () => sendAction("rpc.getState"),
    quests:       () => sendAction("quests.list"),
    backups:      async () => {
      const [res, res2] = await Promise.allSettled([
        sendAction("backups.guilds.get"),
        sendAction("backups.friends.get"),
      ]);
      const gData = res.status === "fulfilled" ? res.value?.data : null;
      const fData = res2.status === "fulfilled" ? res2.value?.data : null;
      return {
        guildsCount:    gData?.count    ?? null,
        guildsSavedAt:  gData?.savedAt  ?? null,
        friendsCount:   fData?.count    ?? null,
        friendsSavedAt: fData?.savedAt  ?? null,
      };
    },
  };

  const builders: Record<string, (d: PanelData) => V2MessagePayload> = {
    home:         (d) => home.build(d),
    config:       ()  => config.build(),
    prefix:       (d) => prefix.build(d),
    afk:          (d) => afk.build(d),
    snipe:        (d) => snipe.build(d),
    tags:         (d) => tags.build(d),
    bookmarks:    (d) => bookmarks.build(d),
    msgbookmarks: (d) => msgbm.build(d),
    antigroup:    (d) => antigroup.build(d),
    autobump:     (d) => autobump.build(d),
    joinvc:       (d) => joinvc.build(d),
    purge:            ()  => purge.build(),
    purge_exclusions: (d) => purge.buildExclusions(d),
    sysinfo:      ()  => sysinfo.build(),
    rpc:          (d) => rpc.build(d),
    rpc_cs:       (d) => rpc.buildCs(d),
    rpc_spotify:  (d) => rpc.buildSpotify(d),
    rpc_hub:      ()  => rpc.buildHub(),
    quests:       (d) => quests.build(d),
    backups:      (d) => backups.build(d ?? {}),
  };

  if (!builders[panelKey]) return null;

  let data: PanelData = {};
  if (fetchers[panelKey]) {
    const res = await fetchers[panelKey]();
    if (panelKey === "tags" || panelKey === "backups" || panelKey === "snipe") {
      data = res ?? {};
    } else if (res === null) {
      data = {};
    } else {
      data = res?.data ?? {};
    }
  }

  return builders[panelKey](data);
}

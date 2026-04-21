"use strict";

const { sendAction } = require("../bridge/client");

// Panels
const home        = require("../panels/home");
const prefix      = require("../panels/prefix");
const afk         = require("../panels/afk");
const snipe       = require("../panels/snipe");
const stalk       = require("../panels/stalk");
const tags        = require("../panels/tags");
const bookmarks   = require("../panels/bookmarks");
const msgbm       = require("../panels/msgbookmarks");
const antigroup   = require("../panels/antigroup");
const autobump    = require("../panels/autobump");
const gunslol     = require("../panels/gunslol");
const joinvc      = require("../panels/joinvc");
const purge       = require("../panels/purge");
const sysinfo     = require("../panels/sysinfo");
const nitro       = require("../panels/nitro");
const rpc         = require("../panels/rpc");
const quests      = require("../panels/quests");
const clone       = require("../panels/clone");

async function fetchAndBuild(panelKey) {
  const fetchers = {
    home:         () => sendAction("prefix.get"),
    prefix:       () => sendAction("prefix.get"),
    afk:          () => sendAction("afk.getState"),
    snipe:        () => sendAction("snipe.getWhitelist"),
    stalk:        () => sendAction("stalk.getList"),
    tags:         () => sendAction("tag.list"),
    bookmarks:    () => sendAction("bookmark.list"),
    msgbookmarks: () => sendAction("msgbm.list"),
    antigroup:    () => sendAction("antigroup.getState"),
    autobump:     () => sendAction("autobump.list"),
    gunslol:      () => sendAction("gunslol.getState"),
    joinvc:       () => sendAction("voice.getState"),
    nitro:        () => sendAction("nitro.getState"),
    rpc:          () => sendAction("rpc.getState"),
    rpc_cs:       () => sendAction("rpc.getState"),
    quests:       () => sendAction("quests.list"),
    // clone, rpc_hub, purge, sysinfo n'ont pas besoin de fetch initial
  };

  const builders = {
    home:         (d) => home.build(d),
    prefix:       (d) => prefix.build(d),
    afk:          (d) => afk.build(d),
    snipe:        (d) => snipe.build(d),
    stalk:        (d) => stalk.build(d),
    tags:         (d) => tags.build(d),
    bookmarks:    (d) => bookmarks.build(d),
    msgbookmarks: (d) => msgbm.build(d),
    antigroup:    (d) => antigroup.build(d),
    autobump:     (d) => autobump.build(d),
    gunslol:      (d) => gunslol.build(d),
    joinvc:       (d) => joinvc.build(d),
    purge:        ()  => purge.build(),
    sysinfo:      ()  => sysinfo.build(),
    nitro:        (d) => nitro.build(d),
    rpc:          (d) => rpc.build(d),
    rpc_cs:       (d) => rpc.buildCs(d),
    rpc_hub:      ()  => rpc.buildHub(),
    quests:       (d) => quests.build(d),
    clone:        (d) => clone.build(d),
  };

  if (!builders[panelKey]) return null;

  let data = {};
  if (fetchers[panelKey]) {
    const res = await fetchers[panelKey]();
    data = res?.data ?? {};
  }

  return builders[panelKey](data);
}

/**
 * @param {import("discord.js").StringSelectMenuInteraction} interaction
 */
async function handle(interaction) {
  if (interaction.customId !== "panel:nav") return;

  const val   = interaction.values[0];
  const panel = await fetchAndBuild(val);

  if (!panel) {
    return interaction.reply({
      content: `❌ Module \`${val}\` inconnu.`,
      ephemeral: true,
    });
  }

  return interaction.update(panel);
}

module.exports = { handle, fetchAndBuild };
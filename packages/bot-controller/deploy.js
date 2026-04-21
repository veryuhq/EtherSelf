"use strict";

require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("🎛️ Ouvre le panneau de contrôle du selfbot")
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log("📡 Enregistrement de la commande /panel…");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Commande /panel enregistrée avec succès !");
  } catch (err) {
    console.error("❌ Erreur :", err);
  }
})();

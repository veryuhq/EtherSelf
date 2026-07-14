import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("🎛️ Ouvre le panneau de contrôle du selfbot")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("purgelogs")
    .setDescription("🧹 Supprime tous les messages du bot dans tes MPs")
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN ?? "");

(async () => {
  try {
    console.log("📡 Enregistrement de la commande /panel…");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID ?? ""),
      { body: commands }
    );
    console.log("✅ Commande /panel enregistrée avec succès !");
  } catch (err) {
    console.error("❌ Erreur :", err);
  }
})();

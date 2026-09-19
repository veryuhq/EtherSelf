import type { MessageComponentInteraction, ModalSubmitInteraction } from "discord.js";
import type { V2MessagePayload } from "../utils/components";

// ─────────────────────────────────────────────────────────────────────────────
//  STORES — jobs asynchrones (purge, clonage)
//  Le selfbot pousse la progression via le serveur HTTP local (voir index.ts),
//  qui retrouve ici l'interaction d'origine pour éditer le panel en place.
// ─────────────────────────────────────────────────────────────────────────────

/** Interaction capable d'éditer sa réponse d'origine (bouton, select ou modal). */
export type JobInteraction = MessageComponentInteraction | ModalSubmitInteraction;

interface ThrottledJob {
  interaction: JobInteraction;
  lastUpdate: number;
}

// ── Jobs de progression purge ────────────────────────────────────────────────

const progressJobs = new Map<string, ThrottledJob>();

export function registerProgressJob(jobId: string, interaction: JobInteraction): void {
  progressJobs.set(jobId, { interaction, lastUpdate: 0 });
}

export async function updateProgressJob(jobId: string, panelPayload: V2MessagePayload, force = false): Promise<void> {
  const job = progressJobs.get(jobId);
  if (!job) return;
  const now = Date.now();
  if (!force && now - job.lastUpdate < 2000) return;
  job.lastUpdate = now;
  try { await job.interaction.editReply(panelPayload); } catch { /* interaction expirée */ }
}

export function cleanProgressJob(jobId: string): void {
  progressJobs.delete(jobId);
}

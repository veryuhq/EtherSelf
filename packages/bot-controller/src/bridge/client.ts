import { signedHeaders } from "./auth";

const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://127.0.0.1:3000";

/** Réponse standard du bridge. `data` reste `any` : sa forme dépend de l'action
 *  côté Python et les panels appliquent leurs propres défauts. */
export interface BridgeResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  error?: string;
}

/** Envoie une action au selfbot via HTTP (ex. "afk.toggle", "prefix.set"). */
export async function sendAction(action: string, payload: Record<string, unknown> = {}): Promise<BridgeResponse> {
  try {
    const body = JSON.stringify({ action, payload });
    const res = await fetch(`${BRIDGE_URL}/action`, {
      method:  "POST",
      headers: signedHeaders(body, { "Content-Type": "application/json" }),
      body,
    });

    const json = (await res.json()) as BridgeResponse;
    return json;
  } catch (err) {
    return { success: false, error: `Bridge injoignable : ${(err as Error).message}` };
  }
}

export interface HealthCheckResult {
  online: boolean;
  data?: { user?: string; uptime?: number; ping?: number };
}

/**
 * Vérifie la connectivité avec le selfbot.
 */
export async function healthCheck(): Promise<HealthCheckResult> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, {
      headers: signedHeaders(""),
    });
    if (!res.ok) return { online: false };
    const json = (await res.json()) as { data?: HealthCheckResult["data"] };
    return { online: true, data: json.data };
  } catch {
    return { online: false };
  }
}

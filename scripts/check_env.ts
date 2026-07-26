import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

type Scope = "selfbot" | "controller";

const ENV_PATHS: Record<Scope, string> = {
  selfbot: path.join(ROOT, "packages", "sb-uhq", ".env"),
  controller: path.join(ROOT, "packages", "bot-controller", ".env"),
};

const REQUIRED: Record<Scope, string[]> = {
  // OWNER_ID est exigé des DEUX côtés : c'est le second facteur de `token.set`
  // côté selfbot (app/commands/gestion/token.py). Sans lui, l'action refuse
  // désormais de s'exécuter.
  selfbot: ["TOKEN", "BRIDGE_SECRET", "BRIDGE_PORT", "OWNER_ID"],
  controller: [
    "BOT_TOKEN",
    "CLIENT_ID",
    "OWNER_ID",
    "BRIDGE_SECRET",
    "BRIDGE_URL",
    "LOG_PORT",
    "BRIDGE_CONTROLLER_URL",
  ],
};

function parseEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, "utf8");
  const vars: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

function parsePort(rawValue: string | undefined, fieldName: string, errors: string[]): number | null {
  const port = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`${fieldName} invalide (${rawValue}). Port attendu: 1-65535.`);
    return null;
  }
  return port;
}

function parseHttpUrl(rawValue: string, fieldName: string, errors: string[]): URL | null {
  try {
    const url = new URL(rawValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      errors.push(`${fieldName} doit utiliser http:// ou https://.`);
      return null;
    }
    return url;
  } catch {
    errors.push(`${fieldName} invalide (${rawValue}).`);
    return null;
  }
}

function normalizeUrl(url: URL): string {
  const clone = new URL(url.toString());
  clone.hash = "";
  clone.search = "";
  clone.pathname = clone.pathname.replace(/\/+$/, "") || "/";
  return clone.toString();
}

function validateRequiredVars(scopeName: Scope, vars: Record<string, string>, errors: string[]): void {
  const missing = REQUIRED[scopeName].filter((name) => !vars[name] || String(vars[name]).trim() === "");
  if (missing.length) {
    errors.push(`${scopeName}: variables manquantes ou vides -> ${missing.join(", ")}`);
  }
}

function run(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log("\n🔍 Vérification des fichiers .env des deux packages...\n");

  for (const [scope, envPath] of Object.entries(ENV_PATHS)) {
    if (!fs.existsSync(envPath)) {
      errors.push(`${scope}: fichier introuvable (${path.relative(ROOT, envPath)}).`);
    }
  }

  if (errors.length) {
    console.error("❌ Vérification impossible :");
    for (const err of errors) console.error(`   - ${err}`);
    process.exit(1);
  }

  const sbEnv = parseEnvFile(ENV_PATHS.selfbot);
  const ctrlEnv = parseEnvFile(ENV_PATHS.controller);

  validateRequiredVars("selfbot", sbEnv, errors);
  validateRequiredVars("controller", ctrlEnv, errors);

  if (sbEnv.BRIDGE_SECRET && ctrlEnv.BRIDGE_SECRET && sbEnv.BRIDGE_SECRET !== ctrlEnv.BRIDGE_SECRET) {
    errors.push("BRIDGE_SECRET ne match pas entre selfbot et bot-controller.");
  }

  // Les deux OWNER_ID doivent désigner le même compte : le controller vérifie
  // la confirmation saisie dans le modal, le selfbot la revérifie de son côté.
  if (sbEnv.OWNER_ID && ctrlEnv.OWNER_ID && sbEnv.OWNER_ID !== ctrlEnv.OWNER_ID) {
    errors.push("OWNER_ID ne match pas entre selfbot et bot-controller.");
  }

  const sbBridgePort = parsePort(sbEnv.BRIDGE_PORT, "selfbot.BRIDGE_PORT", errors);
  const ctrlLogPort = parsePort(ctrlEnv.LOG_PORT, "controller.LOG_PORT", errors);

  const bridgeUrl = ctrlEnv.BRIDGE_URL
    ? parseHttpUrl(ctrlEnv.BRIDGE_URL, "controller.BRIDGE_URL", errors)
    : null;
  const controllerUrl = ctrlEnv.BRIDGE_CONTROLLER_URL
    ? parseHttpUrl(ctrlEnv.BRIDGE_CONTROLLER_URL, "controller.BRIDGE_CONTROLLER_URL", errors)
    : null;

  if (bridgeUrl && sbBridgePort !== null) {
    const bridgePort = bridgeUrl.port ? Number.parseInt(bridgeUrl.port, 10) : (bridgeUrl.protocol === "https:" ? 443 : 80);
    if (bridgePort !== sbBridgePort) {
      errors.push(`BRIDGE_URL (${ctrlEnv.BRIDGE_URL}) doit pointer vers BRIDGE_PORT (${sbBridgePort}).`);
    }
  }

  if (controllerUrl && ctrlLogPort !== null) {
    const controllerPort = controllerUrl.port
      ? Number.parseInt(controllerUrl.port, 10)
      : (controllerUrl.protocol === "https:" ? 443 : 80);
    if (controllerPort !== ctrlLogPort) {
      errors.push(`BRIDGE_CONTROLLER_URL (${ctrlEnv.BRIDGE_CONTROLLER_URL}) doit pointer vers LOG_PORT (${ctrlLogPort}).`);
    }
  }

  if (sbBridgePort !== null && ctrlLogPort !== null && sbBridgePort === ctrlLogPort) {
    errors.push(`Conflit de ports: BRIDGE_PORT (${sbBridgePort}) et LOG_PORT (${ctrlLogPort}) sont identiques.`);
  }

  if (bridgeUrl && controllerUrl && normalizeUrl(bridgeUrl) === normalizeUrl(controllerUrl)) {
    errors.push("BRIDGE_URL et BRIDGE_CONTROLLER_URL ne doivent pas pointer vers la même adresse.");
  }

  if (sbEnv.BRIDGE_CONTROLLER_URL) {
    const sbControllerUrl = parseHttpUrl(sbEnv.BRIDGE_CONTROLLER_URL, "selfbot.BRIDGE_CONTROLLER_URL", errors);
    if (sbControllerUrl && controllerUrl && normalizeUrl(sbControllerUrl) !== normalizeUrl(controllerUrl)) {
      errors.push("selfbot.BRIDGE_CONTROLLER_URL et controller.BRIDGE_CONTROLLER_URL ne matchent pas.");
    }
  } else {
    warnings.push("selfbot.BRIDGE_CONTROLLER_URL absent: le fallback interne sera utilisé (http://127.0.0.1:3001).");
  }

  if (errors.length) {
    console.error("❌ Vérification échouée :");
    for (const err of errors) console.error(`   - ${err}`);
    if (warnings.length) {
      console.error("\n⚠️  Avertissements :");
      for (const warning of warnings) console.error(`   - ${warning}`);
    }
    console.error("");
    process.exit(1);
  }

  console.log("✅ Tous les contrôles sont OK.");
  if (warnings.length) {
    console.log("\n⚠️  Avertissements :");
    for (const warning of warnings) console.log(`   - ${warning}`);
  }
  console.log("");
}

run();

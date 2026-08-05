import crypto from "crypto";
import type { IncomingHttpHeaders } from "http";

const MIN_SECRET_BYTES = 32;
const MAX_SKEW_MS = 5 * 60 * 1000;

export function getSecretBuffer(secret: string = process.env.BRIDGE_SECRET ?? ""): Buffer {
  const raw = String(secret ?? "");
  const buf = Buffer.from(raw, "utf8");
  if (buf.length < MIN_SECRET_BYTES) {
    throw new Error(`BRIDGE_SECRET doit contenir au moins ${MIN_SECRET_BYTES} octets aléatoires.`);
  }
  return buf;
}

function timingSafeEqualString(a: unknown, b: unknown, encoding: BufferEncoding = "hex"): boolean {
  const left = Buffer.from(String(a ?? ""), encoding);
  const right = Buffer.from(String(b ?? ""), encoding);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signBody(
  body = "",
  timestamp: number | string = Date.now(),
  secret: string = process.env.BRIDGE_SECRET ?? "",
): { timestamp: string; signature: string } {
  const secretBuf = getSecretBuffer(secret);
  const ts = String(timestamp);
  const payload = `${ts}.${String(body ?? "")}`;
  const signature = crypto.createHmac("sha256", secretBuf).update(payload).digest("hex");
  return { timestamp: ts, signature };
}

export function signedHeaders(body = "", extra: Record<string, string> = {}): Record<string, string> {
  const { timestamp, signature } = signBody(body);
  return {
    ...extra,
    "X-Bridge-Timestamp": timestamp,
    "X-Bridge-Signature": signature,
  };
}

/** Extrait un header en gérant le cas string[] renvoyé par Node. */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function verifySignedRequest({
  headers = {},
  body = "",
}: {
  headers?: IncomingHttpHeaders;
  body?: string;
}): boolean {
  const timestamp = headerValue(headers["x-bridge-timestamp"]) ?? headerValue(headers["X-Bridge-Timestamp"] as string | string[] | undefined);
  const signature = headerValue(headers["x-bridge-signature"]) ?? headerValue(headers["X-Bridge-Signature"] as string | string[] | undefined);
  if (!timestamp || !signature) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_SKEW_MS) return false;

  const expected = signBody(body, String(timestamp)).signature;
  return /^[a-f0-9]{64}$/i.test(String(signature)) && timingSafeEqualString(signature, expected);
}

// ── Anti-rejeu ───────────────────────────────────────────────────────────────
// Symétrique du selfbot : on mémorise les signatures vues pendant la fenêtre de
// dérive et on rejette les répétitions.
const _seenSignatures = new Map<string, number>();

export function registerSignature(signature: string | string[] | undefined): boolean {
  const now = Date.now();
  if (_seenSignatures.size > 10000) {
    for (const [key, expiry] of _seenSignatures) {
      if (expiry <= now) _seenSignatures.delete(key);
    }
  }
  const sig = String(headerValue(signature) ?? "");
  if (!sig) return false;
  const expiry = _seenSignatures.get(sig);
  if (expiry && expiry > now) return false;
  _seenSignatures.set(sig, now + MAX_SKEW_MS);
  return true;
}

interface RateLimitedResponse {
  setHeader?(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

export function makeRateLimiter<Req>({
  windowMs,
  max,
  keyFn = () => "global",
}: {
  windowMs: number;
  max: number;
  keyFn?: (req: Req) => string;
}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Req, res: RateLimitedResponse, next: () => unknown) => {
    const now = Date.now();
    const key = keyFn(req);
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader?.("Retry-After", String(retryAfter));
      return res.status(429).json({ success: false, error: "Too many requests" });
    }
    return next();
  };
}

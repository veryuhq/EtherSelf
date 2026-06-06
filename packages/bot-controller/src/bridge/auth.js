"use strict";

const crypto = require("crypto");

const MIN_SECRET_BYTES = 32;
const MAX_SKEW_MS = 5 * 60 * 1000;

function getSecretBuffer(secret = process.env.BRIDGE_SECRET ?? "") {
  const raw = String(secret ?? "");
  const buf = Buffer.from(raw, "utf8");
  if (buf.length < MIN_SECRET_BYTES) {
    throw new Error(`BRIDGE_SECRET doit contenir au moins ${MIN_SECRET_BYTES} octets aléatoires.`);
  }
  return buf;
}

function timingSafeEqualString(a, b, encoding = "hex") {
  const left = Buffer.from(String(a ?? ""), encoding);
  const right = Buffer.from(String(b ?? ""), encoding);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signBody(body = "", timestamp = Date.now(), secret = process.env.BRIDGE_SECRET ?? "") {
  const secretBuf = getSecretBuffer(secret);
  const ts = String(timestamp);
  const payload = `${ts}.${String(body ?? "")}`;
  const signature = crypto.createHmac("sha256", secretBuf).update(payload).digest("hex");
  return { timestamp: ts, signature };
}

function signedHeaders(body = "", extra = {}) {
  const { timestamp, signature } = signBody(body);
  return {
    ...extra,
    "X-Bridge-Timestamp": timestamp,
    "X-Bridge-Signature": signature,
  };
}

function verifySignedRequest({ headers = {}, body = "" }) {
  const timestamp = headers["x-bridge-timestamp"] ?? headers["X-Bridge-Timestamp"];
  const signature = headers["x-bridge-signature"] ?? headers["X-Bridge-Signature"];
  if (!timestamp || !signature) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_SKEW_MS) return false;

  const expected = signBody(body, String(timestamp)).signature;
  return /^[a-f0-9]{64}$/i.test(String(signature)) && timingSafeEqualString(signature, expected);
}

function makeRateLimiter({ windowMs, max, keyFn = () => "global" }) {
  const buckets = new Map();
  return (req, res, next) => {
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

module.exports = {
  getSecretBuffer,
  signBody,
  signedHeaders,
  verifySignedRequest,
  makeRateLimiter,
};

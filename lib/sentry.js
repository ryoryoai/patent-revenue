/**
 * Lightweight Sentry client for Vercel Serverless
 * @sentry/node v10 causes FUNCTION_INVOCATION_FAILED on Vercel,
 * so we use the raw HTTP envelope API instead.
 */
const https = require("https");

const dsn = process.env.SENTRY_DSN || "";
let _dsnParts = null;

function parseDsn(d) {
  if (_dsnParts) return _dsnParts;
  try {
    const url = new URL(d);
    _dsnParts = {
      publicKey: url.username,
      host: url.hostname,
      projectId: url.pathname.replace("/", ""),
    };
  } catch {
    _dsnParts = null;
  }
  return _dsnParts;
}

function captureException(error, opts = {}) {
  if (!dsn) return;
  const parts = parseDsn(dsn);
  if (!parts) return;

  const event = {
    event_id: randomHex(32),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV || "development",
    server_name: "patent-revenue",
    exception: {
      values: [{
        type: error.name || "Error",
        value: error.message || String(error),
        stacktrace: error.stack ? { frames: parseStack(error.stack) } : undefined,
      }],
    },
    extra: opts.extra || {},
  };

  sendEnvelope(parts, event);
}

function captureEvent(evt) {
  if (!dsn) return;
  const parts = parseDsn(dsn);
  if (!parts) return;

  const event = {
    event_id: randomHex(32),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: evt.level || "error",
    environment: process.env.NODE_ENV || "development",
    server_name: "patent-revenue",
    message: { formatted: evt.message || "" },
    extra: evt.extra || {},
  };

  sendEnvelope(parts, event);
}

function captureMessage(message, level = "info") {
  captureEvent({ message, level });
}

function close() {
  return Promise.resolve();
}

// --- internals ---

function sendEnvelope(parts, event) {
  const header = JSON.stringify({
    event_id: event.event_id,
    dsn: dsn,
    sent_at: new Date().toISOString(),
  });
  const payload = JSON.stringify(event);
  const itemHeader = JSON.stringify({ type: "event", length: Buffer.byteLength(payload) });
  const body = `${header}\n${itemHeader}\n${payload}\n`;

  const req = https.request({
    method: "POST",
    hostname: parts.host,
    path: `/api/${parts.projectId}/envelope/`,
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=patent-revenue/1.0, sentry_key=${parts.publicKey}`,
    },
  }, (res) => { res.resume(); });
  req.on("error", (e) => console.warn("[sentry] send failed:", e.message));
  req.end(body);
}

function parseStack(stack) {
  return stack.split("\n").slice(1, 10).map((line) => {
    const m = line.match(/at\s+(?:(.+?)\s+)?\(?(.*?):(\d+):(\d+)\)?/);
    if (!m) return { filename: line.trim(), lineno: 0, colno: 0, function: "?" };
    return { function: m[1] || "?", filename: m[2], lineno: parseInt(m[3], 10), colno: parseInt(m[4], 10) };
  }).reverse();
}

function randomHex(len) {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

if (dsn) console.log("[sentry] lightweight client initialized");

module.exports = { captureException, captureEvent, captureMessage, close };

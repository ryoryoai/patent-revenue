const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const isProduction = process.env.NODE_ENV === "production";

const QUOTA_PER_DAY = Number(process.env.ANON_DAILY_QUOTA || 5);
const BURST_INTERVAL_MS = Number(process.env.BURST_INTERVAL_MS || 15_000);
const PER_MIN_LIMIT = Number(process.env.PER_MIN_LIMIT || 3);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 5 * 60_000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30 * 24 * 60 * 60_000);
const BODY_LIMIT_BYTES = Number(process.env.BODY_LIMIT_BYTES || 4 * 1024);
const GLOBAL_DAY_LIMIT = Number(process.env.GLOBAL_DAY_LIMIT || 3_000);
const GLOBAL_HOUR_LIMIT = Number(process.env.GLOBAL_HOUR_LIMIT || 500);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 4_500);
const DEFAULT_ALLOWED_ORIGINS = ["https://ryoryoai.github.io"];
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || "";
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";
const CAPTCHA_REQUIRED_TTL_MS = Number(process.env.CAPTCHA_REQUIRED_TTL_MS || 10 * 60_000);

const EDGE_SHARED_SECRET = resolveSecret("EDGE_SHARED_SECRET", "");
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";

function resolveSecret(name, devDefault) {
  const configured = String(process.env[name] || "").trim();
  if (configured) return configured;
  if (isProduction) {
    throw new Error(`${name} must be set when NODE_ENV=production`);
  }
  console.warn(`[config] ${name} is not set. Using development default.`);
  return devDefault;
}

function normalizeOriginValue(value) {
  try {
    return new URL(String(value)).origin;
  } catch (error) {
    return null;
  }
}

function parseOriginList(raw, defaults = []) {
  const values = [...defaults, ...String(raw || "").split(",")]
    .map((value) => value.trim())
    .filter(Boolean);

  const normalized = new Set();
  values.forEach((value) => {
    const origin = normalizeOriginValue(value);
    if (origin) {
      normalized.add(origin);
    } else {
      console.warn(`[config] ignoring invalid origin: ${value}`);
    }
  });
  return normalized;
}

function normalizeIpLiteral(value) {
  return String(value || "").trim().replace(/^::ffff:/, "");
}

function parseProxyList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => normalizeIpLiteral(value))
    .filter(Boolean);
}

const HASH_SECRET = resolveSecret("HASH_SECRET", "pvc-dev-secret");
const METRICS_API_KEY = resolveSecret("METRICS_API_KEY", "dev-metrics-key");
const ALLOWED_ORIGINS = parseOriginList(process.env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
const TRUSTED_PROXIES = parseProxyList(process.env.TRUSTED_PROXIES);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

const mockPatents = {
  "7091234": {
    id: "7091234",
    title: "製造ライン異常検知システム",
    applicant: "株式会社ミライファクトリー",
    applicantType: "企業",
    registrationDate: "2022-11-15",
    filingDate: "2019-02-14",
    category: "製造DX / AI",
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/",
    metrics: { citations: 34, citationGrowth: 18, claimCount: 12, familySize: 6, classRank: 71, marketPlayers: 24, filingDensity: 68, prosecutionMonths: 20 }
  },
  "6810455": {
    id: "6810455",
    title: "高効率熱交換モジュール",
    applicant: "東都エネルギー株式会社",
    applicantType: "企業",
    registrationDate: "2021-06-30",
    filingDate: "2017-08-08",
    category: "エネルギー / 材料",
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/",
    metrics: { citations: 22, citationGrowth: 8, claimCount: 9, familySize: 4, classRank: 60, marketPlayers: 17, filingDensity: 58, prosecutionMonths: 26 }
  },
  "7420901": {
    id: "7420901",
    title: "マルチモーダル医療画像解析装置",
    applicant: "メディコアテック株式会社",
    applicantType: "企業",
    registrationDate: "2024-03-22",
    filingDate: "2021-10-03",
    category: "医療機器 / 画像解析",
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/",
    metrics: { citations: 28, citationGrowth: 23, claimCount: 15, familySize: 7, classRank: 78, marketPlayers: 26, filingDensity: 72, prosecutionMonths: 18 }
  }
};

const userLimitStore = new Map();
const resultCache = new Map();
const inFlight = new Map();

const globalBudget = {
  dayResetAt: nextJstMidnight(),
  dayCount: 0,
  hourResetAt: nextHour(),
  hourCount: 0
};

const metrics = {
  diagnoseRequests: 0,
  diagnoseAllowed: 0,
  diagnoseBlocked: 0,
  blockedByReason: {},
  cacheHit: 0,
  cacheMiss: 0,
  upstreamCalls: 0,
  errors4xx: 0,
  errors5xx: 0,
  latencyMsSamples: []
};

const alertState = {
  hour80Sent: false,
  day80Sent: false,
  highLatencyAlertAt: 0
};

function nextHour() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now.getTime() + 60 * 60_000;
}

function nextJstMidnight() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jstNow.setHours(24, 0, 0, 0);
  const diff = jstNow.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getTime();
  return Date.now() + diff;
}

function hashValue(raw) {
  return crypto.createHmac("sha256", HASH_SECRET).update(raw).digest("hex").slice(0, 24);
}

function normalizePatentNumber(input) {
  return String(input || "")
    .replace(/特許第/g, "")
    .replace(/号/g, "")
    .replace(/[\s-]/g, "")
    .replace(/[^0-9]/g, "");
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pseudoPatentFromQuery(query, number) {
  const token = number || query;
  const h = hashString(token);
  const categories = ["通信 / IoT", "ソフトウェア", "製造DX / AI", "エネルギー / 材料", "医療機器 / 画像解析"];
  const category = categories[h % categories.length];
  const filingYear = 2010 + (h % 14);
  const filingMonth = String((h % 12) + 1).padStart(2, "0");
  const filingDay = String((h % 27) + 1).padStart(2, "0");
  const applicantType = ["企業", "大学", "個人"][h % 3];

  return {
    id: number || `KW${(h % 900000 + 100000).toString()}`,
    title: number ? `特許第${number}号（モック推定）` : `「${query}」関連技術（モック推定）`,
    applicant: applicantType === "企業" ? "モックテック株式会社" : applicantType === "大学" ? "モック工業大学" : "モック発明者",
    applicantType,
    registrationDate: `${filingYear + 2}-${filingMonth}-${filingDay}`,
    filingDate: `${filingYear}-${filingMonth}-${filingDay}`,
    category,
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/",
    metrics: {
      citations: 2 + (h % 43),
      citationGrowth: -6 + (h % 34),
      claimCount: 3 + (h % 18),
      familySize: 1 + (h % 10),
      classRank: 35 + (h % 58),
      marketPlayers: 5 + (h % 33),
      filingDensity: 20 + (h % 70),
      prosecutionMonths: 12 + (h % 28)
    }
  };
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const map = {};
  raw.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    map[k] = decodeURIComponent(rest.join("=") || "");
  });
  return map;
}

function isTrustedProxy(req) {
  const remoteIp = normalizeIpLiteral(req.socket.remoteAddress || "");
  return TRUSTED_PROXIES.length > 0 && TRUSTED_PROXIES.includes(remoteIp);
}

function extractClientIp(req) {
  const remoteAddress = req.socket.remoteAddress || "0.0.0.0";
  if (isTrustedProxy(req)) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
      // rightmost non-proxy IP: walk from the end, skip trusted proxies
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!TRUSTED_PROXIES.includes(normalizeIpLiteral(parts[i]))) {
          return parts[i];
        }
      }
      return parts[0];
    }
  }
  return remoteAddress;
}

function normalizeIpForId(ip) {
  if (ip.includes(":")) {
    const parts = ip.replace(/^::ffff:/, "").split(":");
    return `${parts.slice(0, 4).join(":") || ip}::/64`;
  }
  return ip;
}

function ensureVisitorCookie(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies.pvc_vid;
  if (existing) return existing;

  const visitorId = crypto.randomUUID();
  const secureFlag = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
  const cookie = [`pvc_vid=${encodeURIComponent(visitorId)}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=31536000"];
  if (secureFlag) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
  return visitorId;
}

function getUserState(identifier) {
  const now = Date.now();
  let state = userLimitStore.get(identifier);
  if (!state) {
    state = {
      dayCount: 0,
      dayResetAt: nextJstMidnight(),
      lastRequestAt: 0,
      minuteHits: [],
      cooldownUntil: 0,
      violationCount: 0,
      lastViolationAt: 0,
      captchaRequiredUntil: 0
    };
    userLimitStore.set(identifier, state);
  }

  if (now >= state.dayResetAt) {
    state.dayCount = 0;
    state.dayResetAt = nextJstMidnight();
  }

  if (now - state.lastViolationAt > 15 * 60_000) {
    state.violationCount = 0;
  }

  state.minuteHits = state.minuteHits.filter((ts) => now - ts < 60_000);
  return state;
}

function markViolation(state, now) {
  state.violationCount += 1;
  state.lastViolationAt = now;
}

function checkAndConsumeUserQuota(identifier, captchaPassed) {
  const now = Date.now();
  const state = getUserState(identifier);

  if (captchaPassed) {
    state.captchaRequiredUntil = 0;
    state.violationCount = Math.max(state.violationCount - 2, 0);
  }

  if (now < state.captchaRequiredUntil && !captchaPassed) {
    return {
      ok: false,
      reason: "captcha_required",
      retryAfterSeconds: Math.ceil((state.captchaRequiredUntil - now) / 1000),
      challenge: true
    };
  }

  if (now < state.cooldownUntil) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: Math.ceil((state.cooldownUntil - now) / 1000)
    };
  }

  const delta = now - state.lastRequestAt;
  if (state.lastRequestAt > 0 && delta < BURST_INTERVAL_MS) {
    markViolation(state, now);
    if (TURNSTILE_SITE_KEY && state.violationCount >= 2) {
      state.captchaRequiredUntil = now + CAPTCHA_REQUIRED_TTL_MS;
      return {
        ok: false,
        reason: "captcha_required",
        retryAfterSeconds: Math.ceil(CAPTCHA_REQUIRED_TTL_MS / 1000),
        challenge: true
      };
    }
    return {
      ok: false,
      reason: "burst_interval",
      retryAfterSeconds: Math.ceil((BURST_INTERVAL_MS - delta) / 1000)
    };
  }

  if (state.minuteHits.length >= PER_MIN_LIMIT) {
    markViolation(state, now);
    state.cooldownUntil = now + COOLDOWN_MS;
    if (TURNSTILE_SITE_KEY) {
      state.captchaRequiredUntil = now + CAPTCHA_REQUIRED_TTL_MS;
      return {
        ok: false,
        reason: "captcha_required",
        retryAfterSeconds: Math.ceil(CAPTCHA_REQUIRED_TTL_MS / 1000),
        challenge: true
      };
    }
    return {
      ok: false,
      reason: "burst_per_minute",
      retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000)
    };
  }

  if (state.dayCount >= QUOTA_PER_DAY) {
    return {
      ok: false,
      reason: "daily_quota",
      retryAfterSeconds: Math.ceil((state.dayResetAt - now) / 1000)
    };
  }

  state.dayCount += 1;
  state.lastRequestAt = now;
  state.minuteHits.push(now);
  state.violationCount = Math.max(state.violationCount - 1, 0);

  return {
    ok: true,
    quota: {
      remainingToday: Math.max(QUOTA_PER_DAY - state.dayCount, 0),
      resetAt: new Date(state.dayResetAt).toISOString()
    }
  };
}

function maybeSendAlert(type, payload) {
  const message = {
    at: new Date().toISOString(),
    service: "patent-value-check",
    type,
    ...payload
  };

  if (!ALERT_WEBHOOK_URL) {
    console.warn("[alert]", JSON.stringify(message));
    return;
  }

  const endpoint = new URL(ALERT_WEBHOOK_URL);
  const data = JSON.stringify(message);
  const client = endpoint.protocol === "https:" ? https : http;
  const req = client.request(
    {
      method: "POST",
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === "https:" ? 443 : 80),
      path: `${endpoint.pathname}${endpoint.search}`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    },
    (res) => {
      res.resume();
    }
  );
  req.on("error", (error) => console.warn("alert_send_failed", error.message));
  req.write(data);
  req.end();
}

function p95(samples) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function recordLatency(ms) {
  metrics.latencyMsSamples.push(ms);
  if (metrics.latencyMsSamples.length > 500) {
    metrics.latencyMsSamples.shift();
  }

  const now = Date.now();
  const latencyP95 = p95(metrics.latencyMsSamples);
  if (latencyP95 > 3000 && now - alertState.highLatencyAlertAt > 15 * 60_000) {
    alertState.highLatencyAlertAt = now;
    maybeSendAlert("latency_p95_high", { latencyP95Ms: latencyP95 });
  }
}

function checkAndConsumeGlobalBudget() {
  const now = Date.now();

  if (now >= globalBudget.dayResetAt) {
    globalBudget.dayCount = 0;
    globalBudget.dayResetAt = nextJstMidnight();
    alertState.day80Sent = false;
  }

  if (now >= globalBudget.hourResetAt) {
    globalBudget.hourCount = 0;
    globalBudget.hourResetAt = nextHour();
    alertState.hour80Sent = false;
  }

  if (globalBudget.dayCount >= GLOBAL_DAY_LIMIT || globalBudget.hourCount >= GLOBAL_HOUR_LIMIT) {
    return {
      ok: false,
      dayRemaining: Math.max(GLOBAL_DAY_LIMIT - globalBudget.dayCount, 0),
      hourRemaining: Math.max(GLOBAL_HOUR_LIMIT - globalBudget.hourCount, 0)
    };
  }

  globalBudget.dayCount += 1;
  globalBudget.hourCount += 1;

  const hourRate = globalBudget.hourCount / GLOBAL_HOUR_LIMIT;
  const dayRate = globalBudget.dayCount / GLOBAL_DAY_LIMIT;

  if (hourRate >= 0.8 && !alertState.hour80Sent) {
    alertState.hour80Sent = true;
    maybeSendAlert("budget_hour_80", { usage: globalBudget.hourCount, limit: GLOBAL_HOUR_LIMIT });
  }

  if (dayRate >= 0.8 && !alertState.day80Sent) {
    alertState.day80Sent = true;
    maybeSendAlert("budget_day_80", { usage: globalBudget.dayCount, limit: GLOBAL_DAY_LIMIT });
  }

  return {
    ok: true,
    dayRemaining: Math.max(GLOBAL_DAY_LIMIT - globalBudget.dayCount, 0),
    hourRemaining: Math.max(GLOBAL_HOUR_LIMIT - globalBudget.hourCount, 0)
  };
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const normalizedOrigin = normalizeOriginValue(origin);
  if (!normalizedOrigin) return false;

  let protocol = req.socket.encrypted ? "https" : "http";
  if (isTrustedProxy(req)) {
    const protoHeader = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    if (protoHeader) protocol = protoHeader;
  }
  const requestOrigin = req.headers.host ? normalizeOriginValue(`${protocol}://${req.headers.host}`) : null;

  return normalizedOrigin === requestOrigin || ALLOWED_ORIGINS.has(normalizedOrigin);
}

function applySecurityHeaders(req, res, requestId) {
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    CONTENT_SECURITY_POLICY
  );

  if (req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

function applyApiCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

function sendJson(req, res, status, payload) {
  if (req.url && req.url.startsWith("/api/")) {
    applyApiCors(req, res);
  }

  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > limitBytes) {
        reject(new Error("payload_too_large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", () => reject(new Error("read_error")));
  });
}

function validateQuery(query) {
  const text = String(query || "").trim();
  if (!text) return { ok: false, message: "query is required" };
  if (text.length > 200) return { ok: false, message: "query too long" };
  if (/[\x00-\x1F\x7F]/.test(text)) return { ok: false, message: "invalid characters" };
  return { ok: true, text };
}

function lookupPatent(query) {
  const patentNumber = normalizePatentNumber(query);
  metrics.upstreamCalls += 1;
  return new Promise((resolve) => {
    setTimeout(() => {
      const patent = patentNumber.length >= 6 ? mockPatents[patentNumber] || pseudoPatentFromQuery(query, patentNumber) : pseudoPatentFromQuery(query, "");
      resolve(patent);
    }, 250);
  });
}

async function verifyTurnstileToken(token, clientIp) {
  if (!TURNSTILE_SECRET_KEY) return false;
  if (!token) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: clientIp
    });

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: controller.signal
    });

    if (!response.ok) return false;
    const result = await response.json();
    return Boolean(result.success);
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function getDiagnosis(query, requestId) {
  const normalized = normalizePatentNumber(query);
  const cacheKey = (normalized || query).toLowerCase();
  const cached = resultCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    metrics.cacheHit += 1;
    return {
      resultId: `cache_${hashValue(cacheKey).slice(0, 10)}`,
      patent: cached.patent,
      meta: {
        mode: "api",
        cacheHit: true,
        requestId
      }
    };
  }

  const budget = checkAndConsumeGlobalBudget();
  if (!budget.ok) {
    const error = new Error("global_budget_exceeded");
    error.code = "global_budget_exceeded";
    throw error;
  }

  metrics.cacheMiss += 1;

  let runner = inFlight.get(cacheKey);
  if (!runner) {
    runner = lookupPatent(query)
      .then((patent) => {
        resultCache.set(cacheKey, {
          patent,
          expiresAt: Date.now() + CACHE_TTL_MS
        });
        return patent;
      })
      .finally(() => {
        inFlight.delete(cacheKey);
      });
    inFlight.set(cacheKey, runner);
  }

  const patent = await Promise.race([
    runner,
    new Promise((_, reject) => setTimeout(() => reject(new Error("upstream_timeout")), REQUEST_TIMEOUT_MS))
  ]);

  return {
    resultId: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    patent,
    meta: {
      mode: "api",
      cacheHit: false,
      requestId
    }
  };
}

function incrementBlockedReason(reason) {
  metrics.blockedByReason[reason] = (metrics.blockedByReason[reason] || 0) + 1;
}

function logRequest(info) {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      ...info
    })
  );
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  applySecurityHeaders(req, res, requestId);

  if (req.url && req.url.startsWith("/api/")) {
    if (!isAllowedOrigin(req)) {
      metrics.errors4xx += 1;
      sendJson(req, res, 403, { requestId, message: "forbidden origin" });
      return;
    }

    if (EDGE_SHARED_SECRET && req.headers["x-edge-auth"] !== EDGE_SHARED_SECRET) {
      metrics.errors4xx += 1;
      sendJson(req, res, 403, { requestId, message: "edge auth required" });
      return;
    }

    if (req.method === "OPTIONS") {
      applyApiCors(req, res);
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Metrics-Key"
      });
      res.end();
      return;
    }
  }

  if (req.method === "GET" && req.url === "/api/metrics") {
    if (req.headers["x-metrics-key"] !== METRICS_API_KEY) {
      metrics.errors4xx += 1;
      sendJson(req, res, 403, { requestId, message: "forbidden" });
      return;
    }

    sendJson(req, res, 200, {
      requestId,
      metrics: {
        ...metrics,
        latencyP95Ms: p95(metrics.latencyMsSamples)
      },
      budget: {
        hour: { used: globalBudget.hourCount, limit: GLOBAL_HOUR_LIMIT, resetAt: new Date(globalBudget.hourResetAt).toISOString() },
        day: { used: globalBudget.dayCount, limit: GLOBAL_DAY_LIMIT, resetAt: new Date(globalBudget.dayResetAt).toISOString() }
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/diagnose") {
    metrics.diagnoseRequests += 1;

    const clientIp = extractClientIp(req);
    const visitorId = ensureVisitorCookie(req, res);
    const userKey = hashValue(`${normalizeIpForId(clientIp)}:${visitorId}`);

    let body;
    try {
      body = await readJsonBody(req, BODY_LIMIT_BYTES);
    } catch (error) {
      metrics.errors4xx += 1;
      if (error.message === "payload_too_large") {
        sendJson(req, res, 413, { requestId, message: "payload too large" });
      } else {
        sendJson(req, res, 400, { requestId, message: "invalid request body" });
      }
      return;
    }

    const validated = validateQuery(body.query);
    if (!validated.ok) {
      metrics.errors4xx += 1;
      sendJson(req, res, 400, { requestId, message: validated.message });
      return;
    }

    const captchaPassed = body.captchaToken ? await verifyTurnstileToken(String(body.captchaToken), clientIp) : false;
    const quota = checkAndConsumeUserQuota(userKey, captchaPassed);

    if (!quota.ok) {
      metrics.diagnoseBlocked += 1;
      metrics.errors4xx += 1;
      incrementBlockedReason(quota.reason);

      const response = {
        requestId,
        reason: quota.reason,
        retryAfterSeconds: quota.retryAfterSeconds,
        message: "quota exceeded"
      };

      if (quota.challenge && TURNSTILE_SITE_KEY) {
        response.captchaSiteKey = TURNSTILE_SITE_KEY;
      }

      sendJson(req, res, 429, response);
      logRequest({
        requestId,
        type: "quota_block",
        reason: quota.reason,
        user: userKey,
        ipHash: hashValue(normalizeIpForId(clientIp))
      });
      recordLatency(Date.now() - startedAt);
      return;
    }

    try {
      const diagnosis = await getDiagnosis(validated.text, requestId);
      metrics.diagnoseAllowed += 1;
      sendJson(req, res, 200, {
        requestId,
        ...diagnosis,
        quota: quota.quota
      });

      logRequest({
        requestId,
        type: "diagnose_success",
        user: userKey,
        ipHash: hashValue(normalizeIpForId(clientIp)),
        cacheHit: diagnosis.meta.cacheHit
      });
      recordLatency(Date.now() - startedAt);
      return;
    } catch (error) {
      if (error.code === "global_budget_exceeded") {
        metrics.errors5xx += 1;
        metrics.diagnoseBlocked += 1;
        incrementBlockedReason("global_budget_exceeded");
        sendJson(req, res, 503, {
          requestId,
          reason: "global_budget_exceeded",
          message: "service is in degraded mode"
        });
        recordLatency(Date.now() - startedAt);
        return;
      }

      if (error.message === "upstream_timeout") {
        metrics.errors5xx += 1;
        sendJson(req, res, 504, {
          requestId,
          message: "upstream timeout"
        });
        recordLatency(Date.now() - startedAt);
        return;
      }

      metrics.errors5xx += 1;
      sendJson(req, res, 500, {
        requestId,
        message: "diagnose failed"
      });
      recordLatency(Date.now() - startedAt);
      return;
    }
  }

  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const pathname = decodeURIComponent((urlPath || "").split("?")[0]);
  const filePath = path.join(publicDir, pathname);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  sendFile(res, filePath);
});

server.listen(port, () => {
  console.log(`Patent Value Check running at http://localhost:${port}`);
});

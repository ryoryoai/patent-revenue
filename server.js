require("dotenv").config();
const Sentry = require("./lib/sentry");
const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const {
  normalizeIpLiteral,
  normalizeOriginValue,
  parseOriginList,
  parseProxyList,
  resolveSecret
} = require("./lib/env");
const {
  readJsonBody,
  sendFile,
  sendJson
} = require("./lib/http-utils");
const { sendResultEmail, sendDetailedReportEmail, sendPatentInvalidEmail, sendErrorAlertEmail } = require("./lib/mailer");
const { lookupPatent } = require("./lib/patent-data");
const { researchPatent, PatentInvalidError } = require("./lib/patent-research");
const { fetchPatentStatus } = require("./lib/patent-api");
const { saveLead, savePatent, updateLeadStatus, findLeadByEmail, saveDetailedReportRequest, getSupabase } = require("./lib/supabase");
const { generateAndSaveToken, verifyAndGetData, saveRegistration } = require("./lib/detail-registration");
const {
  investigateAndRank,
  isV2Available,
  exportPatentsForAnalysis,
  saveAnalysisResult
} = require("./lib/v2-client");
const { summarizeSecret } = require("./lib/header-safety");
const { verifyAdminAuth } = require("./lib/admin-auth");

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
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: https://www.google-analytics.com; connect-src 'self' https://challenges.cloudflare.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.ingest.us.sentry.io; frame-src https://challenges.cloudflare.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function getAdminCsp() {
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://sukemwnslhkehatwvdqd.supabase.co; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
}

const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || "";
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";
const CAPTCHA_REQUIRED_TTL_MS = Number(process.env.CAPTCHA_REQUIRED_TTL_MS || 10 * 60_000);

const EDGE_SHARED_SECRET = (process.env.EDGE_SHARED_SECRET || "").trim();
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean);
const ERROR_ALERT_COOLDOWN_MS = Number(process.env.ERROR_ALERT_COOLDOWN_MS || 5 * 60_000);
const _alertSentAt = new Map();
const HASH_SECRET = resolveSecret("HASH_SECRET", "pvc-dev-secret", { isProduction });
const METRICS_API_KEY = resolveSecret("METRICS_API_KEY", "dev-metrics-key", { isProduction });
const ALLOWED_ORIGINS = parseOriginList(process.env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
const TRUSTED_PROXIES = parseProxyList(process.env.TRUSTED_PROXIES);

const userLimitStore = new Map();
const resultCache = new Map();
const inFlight = new Map();
const reportLimitStore = new Map();
const emailLimitStore = new Map();

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

function getDailyLimitState(store, key) {
  const now = Date.now();
  let state = store.get(key);
  if (!state || now >= state.resetAt) {
    state = { count: 0, resetAt: nextJstMidnight() };
    store.set(key, state);
  }
  return state;
}

// ── API エンドポイント共通ヘルパー ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function apiUserKey(req, res) {
  const clientIp = extractClientIp(req);
  const visitorId = ensureVisitorCookie(req, res);
  return hashValue(`${normalizeIpForId(clientIp)}:${visitorId}`);
}

function apiParseBody(req, multiplier = 1) {
  return readJsonBody(req, BODY_LIMIT_BYTES * multiplier);
}

function apiCheckEmail(raw) {
  const email = String(raw || "").trim();
  return EMAIL_RE.test(email) ? email : null;
}

function apiCheckLimit(store, userKey, limit) {
  const state = getDailyLimitState(store, userKey);
  return { allowed: state.count < limit, state };
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
  const now = Date.now();
  const message = {
    at: new Date(now).toISOString(),
    service: "patent-value-check",
    type,
    ...payload
  };

  // Webhook送信
  if (ALERT_WEBHOOK_URL) {
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
      (res) => { res.resume(); }
    );
    req.on("error", (error) => console.warn("alert_send_failed", error.message));
    req.write(data);
    req.end();
  }

  // メール送信（同一typeに対して5分間クールダウン）
  if (ADMIN_EMAILS.length > 0) {
    const lastSent = _alertSentAt.get(type) || 0;
    if (now - lastSent >= ERROR_ALERT_COOLDOWN_MS) {
      _alertSentAt.set(type, now);
      sendErrorAlertEmail({
        to: ADMIN_EMAILS,
        errorType: type,
        message: payload.message || payload.error || JSON.stringify(payload),
        requestId: payload.requestId,
        url: payload.url,
        timestamp: message.at
      }).catch(err => console.warn("[alert-email] send failed:", err.message));
    }
  }

  if (!ALERT_WEBHOOK_URL && ADMIN_EMAILS.length === 0) {
    console.warn("[alert]", JSON.stringify(message));
  }
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
  const isAdmin = (req.url || "").startsWith("/admin/") || (req.url || "").startsWith("/api/admin/");
  res.setHeader(
    "Content-Security-Policy",
    isAdmin ? getAdminCsp() : CONTENT_SECURITY_POLICY
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

function respondJson(req, res, status, payload) {
  if (status >= 500) {
    Sentry.captureEvent({
      message: payload.message || "server error",
      level: "error",
      extra: { status, url: req.url, method: req.method, requestId: payload.requestId },
    });
  }
  sendJson(req, res, status, payload, { applyCors: applyApiCors });
}

function validateQuery(query) {
  const text = String(query || "").trim();
  if (!text) return { ok: false, message: "query is required" };
  if (!/^\d{7}$/.test(text)) {
    return { ok: false, message: "登録済み特許の7桁の番号を入力してください。出願番号（特願〜）は対象外です。" };
  }
  return { ok: true, text };
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
  const cacheKey = query.toLowerCase();
  const cached = resultCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    metrics.cacheHit += 1;
    return {
      resultId: `cache_${hashValue(cacheKey).slice(0, 10)}`,
      patent: cached.patent,
      invalid: cached.invalid || false,
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

  // Google Patents による特許存在確認（必須ゲート）
  {
    let gpStatus;
    try {
      gpStatus = await fetchPatentStatus(query);
    } catch (error) {
      console.warn(`[diagnose] Google Patents status check failed: ${error.message}`);
      throw new Error("patent_lookup_failed");
    }

    if (!gpStatus.exists) {
      console.log(`[diagnose] patent ${query} not found on Google Patents`);
      const notFoundPatent = {
        id: query,
        title: `特許第${query}号`,
        applicant: "",
        applicantType: "",
        registrationDate: "",
        filingDate: "",
        category: "",
        status: "不明",
        officialUrl: `https://www.j-platpat.inpit.go.jp/`,
        metrics: {}
      };
      resultCache.set(cacheKey, { patent: notFoundPatent, invalid: true, expiresAt: Date.now() + CACHE_TTL_MS });
      return {
        resultId: `nf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        patent: notFoundPatent,
        invalid: true,
        notFound: true,
        meta: { mode: "api", cacheHit: false, requestId }
      };
    }

    if (!gpStatus.active && gpStatus.statusText) {
      console.log(`[diagnose] patent ${query} is invalid (${gpStatus.statusText}), skipping further lookup`);
      const invalidPatent = {
        id: query,
        title: `特許第${query}号`,
        applicant: "",
        applicantType: "",
        registrationDate: "",
        filingDate: "",
        category: "",
        status: gpStatus.statusText,
        officialUrl: `https://www.j-platpat.inpit.go.jp/`,
        metrics: {}
      };
      resultCache.set(cacheKey, { patent: invalidPatent, invalid: true, expiresAt: Date.now() + CACHE_TTL_MS });
      return {
        resultId: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        patent: invalidPatent,
        invalid: true,
        meta: { mode: "api", cacheHit: false, requestId }
      };
    }
  }

  let runner = inFlight.get(cacheKey);
  if (!runner) {
    metrics.upstreamCalls += 1;
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

  const rawPatent = await Promise.race([
    runner,
    new Promise((_, reject) => setTimeout(() => reject(new Error("upstream_timeout")), REQUEST_TIMEOUT_MS))
  ]);

  if (!rawPatent) {
    console.log(`[diagnose] patent ${query} not found via JPO API`);
    const notFoundPatent = {
      id: query,
      title: `特許第${query}号`,
      applicant: "",
      applicantType: "",
      registrationDate: "",
      filingDate: "",
      category: "",
      status: "不明",
      officialUrl: `https://www.j-platpat.inpit.go.jp/`,
      metrics: {}
    };
    resultCache.set(cacheKey, { patent: notFoundPatent, invalid: true, expiresAt: Date.now() + CACHE_TTL_MS });
    return {
      resultId: `nf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      patent: notFoundPatent,
      invalid: true,
      notFound: true,
      meta: { mode: "api", cacheHit: false, requestId }
    };
  }

  // _jpoRaw はサーバー内部用なのでクライアントには返さない
  const { _jpoRaw, ...patent } = rawPatent;

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

async function handler(req, res) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
  applySecurityHeaders(req, res, requestId);

  if (req.url && req.url.startsWith("/api/")) {
    if (!isAllowedOrigin(req)) {
      metrics.errors4xx += 1;
      respondJson(req, res, 403, { requestId, message: "forbidden origin" });
      return;
    }

    if (EDGE_SHARED_SECRET && req.headers["x-edge-auth"] !== EDGE_SHARED_SECRET) {
      metrics.errors4xx += 1;
      respondJson(req, res, 403, { requestId, message: "edge auth required" });
      return;
    }

    if (req.method === "OPTIONS") {
      applyApiCors(req, res);
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, GET, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Metrics-Key, Authorization"
      });
      res.end();
      return;
    }
  }

  if (req.method === "GET" && req.url === "/api/metrics") {
    const auth = await verifyAdminAuth(req);
    if (!auth.ok) {
      metrics.errors4xx += 1;
      respondJson(req, res, 403, { requestId, message: "forbidden" });
      return;
    }

    respondJson(req, res, 200, {
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

  // ─── 管理API 共通認証 ───
  if (req.url?.startsWith("/api/admin/")) {
   try {
    const auth = await verifyAdminAuth(req);
    if (!auth.ok) {
      metrics.errors4xx += 1;
      respondJson(req, res, 403, { requestId, message: "forbidden" });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      respondJson(req, res, 503, { requestId, message: "Supabase not configured" });
      return;
    }

    const adminUrl = new URL(req.url, `http://${req.headers.host}`);

    // サマリー統計
    if (req.method === "GET" && req.url === "/api/admin/stats") {
      const [leadsRes, regRes, inqRes] = await Promise.all([
        supabase.from("leads").select("*", { count: "exact", head: true }),
        supabase.from("detail_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("consultation_inquiries").select("*", { count: "exact", head: true }).eq("status", "new")
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const { count: todayCount } = await supabase
        .from("leads").select("*", { count: "exact", head: true }).gte("created_at", today);

      respondJson(req, res, 200, {
        requestId,
        totalLeads: leadsRes.count || 0,
        newToday: todayCount || 0,
        pendingRegistrations: regRes.count || 0,
        newInquiries: inqRes.count || 0
      });
      return;
    }

    // リード一覧
    if (req.method === "GET" && req.url?.startsWith("/api/admin/leads") && !req.url.includes("/api/admin/leads/")) {
      const status = adminUrl.searchParams.get("status") || null;
      const search = adminUrl.searchParams.get("search") || null;
      const limit = Math.min(Number(adminUrl.searchParams.get("limit") || 50), 200);
      const offset = Number(adminUrl.searchParams.get("offset") || 0);

      let query = supabase
        .from("leads")
        .select("id, name, company_name, email, status, source, query_input, admin_notes, created_at, updated_at, patents(patent_number, title), detail_registrations(id, type, status)")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);
      if (search) query = query.or(`name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%`);

      const { data: leads, error } = await query;
      if (error) { respondJson(req, res, 500, { requestId, message: "database error" }); return; }
      respondJson(req, res, 200, { requestId, leads, count: leads.length, offset, limit });
      return;
    }

    // リード詳細 / リード更新
    const leadsDetailMatch = req.url?.match(/^\/api\/admin\/leads\/([0-9a-f-]+)/);
    if (leadsDetailMatch) {
      const leadId = leadsDetailMatch[1];

      if (req.method === "GET") {
        const [leadRes, patentsRes, regsRes] = await Promise.all([
          supabase.from("leads").select("*").eq("id", leadId).single(),
          supabase.from("patents").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
          supabase.from("detail_registrations").select("*").eq("lead_id", leadId).order("created_at", { ascending: false })
        ]);
        if (leadRes.error) { respondJson(req, res, 404, { requestId, message: "lead not found" }); return; }
        respondJson(req, res, 200, { requestId, lead: leadRes.data, patents: patentsRes.data || [], registrations: regsRes.data || [] });
        return;
      }

      if (req.method === "PATCH") {
        let body;
        try { body = await readJsonBody(req, BODY_LIMIT_BYTES * 2); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }
        const updates = {};
        if (body.status) updates.status = body.status;
        if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
        if (Object.keys(updates).length === 0) { respondJson(req, res, 400, { requestId, message: "no fields to update" }); return; }
        const { error } = await supabase.from("leads").update(updates).eq("id", leadId);
        if (error) { respondJson(req, res, 500, { requestId, message: "update failed" }); return; }
        respondJson(req, res, 200, { requestId, message: "updated" });
        return;
      }

      if (req.method === "DELETE") {
        // CASCADE: patents, detail_registrations, tokens are auto-deleted
        const { error } = await supabase.from("leads").delete().eq("id", leadId);
        if (error) { respondJson(req, res, 500, { requestId, message: "delete failed" }); return; }
        respondJson(req, res, 200, { requestId, message: "deleted" });
        return;
      }
    }

    // 詳細登録一覧
    if (req.method === "GET" && req.url?.startsWith("/api/admin/detail-registrations") && !req.url.includes("/detail-registrations/")) {
      const status = adminUrl.searchParams.get("status") || null;
      const limit = Math.min(Number(adminUrl.searchParams.get("limit") || 50), 200);
      const offset = Number(adminUrl.searchParams.get("offset") || 0);
      let query = supabase
        .from("detail_registrations")
        .select("id, lead_id, patent_id, type, department, contact_name, phone, desired_price, support_method, status, admin_notes, created_at, updated_at")
        .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) { respondJson(req, res, 500, { requestId, message: "database error" }); return; }
      respondJson(req, res, 200, { requestId, registrations: data, count: data.length, offset, limit });
      return;
    }

    // 詳細登録ステータス更新
    const regMatch = req.url?.match(/^\/api\/admin\/detail-registrations\/([0-9a-f-]+)/);
    if (req.method === "PATCH" && regMatch) {
      let body;
      try { body = await readJsonBody(req, BODY_LIMIT_BYTES * 2); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }
      const updates = {};
      if (body.status) updates.status = body.status;
      if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
      const { error } = await supabase.from("detail_registrations").update(updates).eq("id", regMatch[1]);
      if (error) { respondJson(req, res, 500, { requestId, message: "update failed" }); return; }
      respondJson(req, res, 200, { requestId, message: "updated" });
      return;
    }

    // 問い合わせ一覧
    if (req.method === "GET" && req.url?.startsWith("/api/admin/consultation-inquiries") && !req.url.includes("/consultation-inquiries/")) {
      const status = adminUrl.searchParams.get("status") || null;
      const limit = Math.min(Number(adminUrl.searchParams.get("limit") || 50), 200);
      const offset = Number(adminUrl.searchParams.get("offset") || 0);
      let query = supabase
        .from("consultation_inquiries")
        .select("id, catalog_entry_id, name, company_name, email, phone, message, inquiry_type, status, admin_notes, created_at")
        .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) { respondJson(req, res, 500, { requestId, message: "database error" }); return; }
      respondJson(req, res, 200, { requestId, inquiries: data, count: data.length, offset, limit });
      return;
    }

    // 問い合わせステータス更新
    const inqMatch = req.url?.match(/^\/api\/admin\/consultation-inquiries\/([0-9a-f-]+)/);
    if (req.method === "PATCH" && inqMatch) {
      let body;
      try { body = await readJsonBody(req, BODY_LIMIT_BYTES * 2); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }
      const updates = {};
      if (body.status) updates.status = body.status;
      if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
      const { error } = await supabase.from("consultation_inquiries").update(updates).eq("id", inqMatch[1]);
      if (error) { respondJson(req, res, 500, { requestId, message: "update failed" }); return; }
      respondJson(req, res, 200, { requestId, message: "updated" });
      return;
    }

    // 特許リスト取得（既存）
    if (req.method === "GET" && req.url?.startsWith("/api/admin/patents")) {
      const status = adminUrl.searchParams.get("status") || null;
      const limit = Math.min(Number(adminUrl.searchParams.get("limit") || 100), 500);
      const offset = Number(adminUrl.searchParams.get("offset") || 0);

      let query = supabase
        .from("patents")
        .select("id, patent_number, normalized_number, title, category, applicant, ipc_codes, status, diagnosis_result, created_at, updated_at")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (status) query = query.eq("status", status);

      const { data: patents, error } = await query;
      if (error) {
        console.error("[admin/patents] Supabase error:", error.message);
        respondJson(req, res, 500, { requestId, message: "database error" });
        return;
      }
      respondJson(req, res, 200, { requestId, patents, count: patents.length, offset, limit });
      return;
    }

    // 侵害調査リストエクスポート（既存）
    if (req.method === "POST" && req.url === "/api/admin/export-patents") {
      let body;
      try { body = await readJsonBody(req, BODY_LIMIT_BYTES * 2); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }

      const format = String(body.format || "json").toLowerCase();
      const limit = Math.min(Number(body.limit || 100), 500);
      const status = body.status || "登録";

      const patents = await exportPatentsForAnalysis({ limit, status });
      if (patents === null) { respondJson(req, res, 503, { requestId, message: "Supabase not available or query failed" }); return; }

      if (format === "csv") {
        const headers = ["id", "patent_number", "normalized_number", "title", "category", "applicant", "ipc_codes"];
        const rows = patents.map((p) =>
          headers.map((h) => {
            const v = p[h];
            if (v === null || v === undefined) return "";
            const s = Array.isArray(v) ? v.join("|") : String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
          }).join(",")
        );
        const csv = [headers.join(","), ...rows].join("\n");
        res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="patents-export-${new Date().toISOString().slice(0, 10)}.csv"` });
        res.end(csv);
        return;
      }
      respondJson(req, res, 200, { requestId, patents, count: patents.length });
      return;
    }

    // phase2分析結果同期（既存）
    if (req.method === "POST" && req.url === "/api/admin/sync-analysis") {
      let body;
      try { body = await readJsonBody(req, BODY_LIMIT_BYTES * 4); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }

      const patentId = String(body.patent_id || "").trim();
      if (!patentId) { respondJson(req, res, 400, { requestId, message: "patent_id is required" }); return; }
      if (!body.result || typeof body.result !== "object") { respondJson(req, res, 400, { requestId, message: "result must be an object" }); return; }

      const saved = await saveAnalysisResult(patentId, body.result);
      if (saved === null) { respondJson(req, res, 503, { requestId, message: "Supabase not available" }); return; }
      if (!saved) { respondJson(req, res, 500, { requestId, message: "failed to save analysis result" }); return; }

      logRequest({ requestId, type: "admin_sync_analysis", patentId });
      respondJson(req, res, 200, { requestId, message: "analysis result saved", patentId });
      return;
    }

    // 未知の管理APIパス
    respondJson(req, res, 404, { requestId, message: "admin endpoint not found" });
    return;
   } catch (adminErr) {
    console.error("[admin] uncaught error:", adminErr);
    Sentry.captureException(adminErr, { extra: { requestId, url: req.url } });
    maybeSendAlert("admin_error", { requestId, url: req.url, message: adminErr.message, error: adminErr.stack?.split("\n").slice(0, 3).join(" ") });
    respondJson(req, res, 500, { requestId, message: "admin error", detail: String(adminErr?.message || adminErr) });
    return;
   }
  }

  // V2パイプラインで簡易評価（構成要件充足判定）を実行
  // 非同期: 調査開始→バックグラウンドでポーリング→完了時メール送信
  if (req.method === "POST" && req.url === "/api/evaluate") {
    let body;
    try {
      body = await readJsonBody(req, BODY_LIMIT_BYTES * 2);
    } catch (error) {
      respondJson(req, res, 400, { requestId, message: "invalid request body" });
      return;
    }

    const patentId = String(body.patentId || "").trim();
    if (!patentId) {
      respondJson(req, res, 400, { requestId, message: "patentId is required" });
      return;
    }

    const email = String(body.email || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      respondJson(req, res, 400, { requestId, message: "有効なメールアドレスを入力してください。" });
      return;
    }

    const name = String(body.name || "");

    // V2が利用可能かチェック
    const v2Ready = await isV2Available();
    if (!v2Ready) {
      respondJson(req, res, 503, { requestId, message: "評価サービスが現在利用できません。しばらくしてからお試しください。" });
      return;
    }

    try {
      const result = await investigateAndRank(patentId, {
        pipeline: body.pipeline || "C"
      });

      // 簡易評価メール送信
      await sendResultEmail({
        email,
        name,
        siteHost: process.env.SITE_HOST || "patent-value-analyzer.iprich.jp",
        reportData: {
          rank: result.rank,
          name
        }
      });

      logRequest({
        requestId,
        type: "v2_evaluate_complete",
        patentId,
        rank: result.rank,
        reason: result.reason,
        jobId: result.jobId
      });

      respondJson(req, res, 200, {
        requestId,
        message: "評価が完了しました。メールをご確認ください。",
        patentId
      });
    } catch (error) {
      console.error("[v2-evaluate] error:", error.message);
      logRequest({
        requestId,
        type: "v2_evaluate_error",
        patentId,
        error: error.message
      });
      respondJson(req, res, 500, {
        requestId,
        message: "評価処理に失敗しました。しばらくしてからお試しください。",
        patentId
      });
    }

    return;
  }

  // V2パイプラインのステータス確認
  if (req.method === "GET" && req.url === "/api/v2-status") {
    const available = await isV2Available();
    respondJson(req, res, 200, { requestId, v2Available: available });
    return;
  }

  // デバッグ: OpenAI API + JPO API接続テスト
  if (req.method === "GET" && req.url === "/api/debug-connectivity") {
    const debugAuth = await verifyAdminAuth(req);
    if (!debugAuth.ok) {
      respondJson(req, res, 403, { requestId, message: "forbidden" });
      return;
    }
    const results = {};
    // OpenAI test
    try {
      const { callOpenAiApi } = require("./lib/llm");
      const llmResult = await callOpenAiApi("Reply with exactly: OK", { maxTokens: 5 });
      results.openai = { ok: true, response: llmResult.slice(0, 50) };
    } catch (e) {
      results.openai = { ok: false, error: e.message };
    }
    // JPO test
    try {
      const { isPatentApiAvailable, fetchProgressSimple } = require("./lib/patent-api");
      results.jpo = { available: isPatentApiAvailable() };
      if (isPatentApiAvailable()) {
        const data = await fetchProgressSimple("2018169552");
        results.jpo.connected = !!data;
      }
    } catch (e) {
      results.jpo.error = e.message;
    }
    // Supabase test
    try {
      const { getSupabase } = require("./lib/supabase");
      const sb = getSupabase();
      results.supabase = { available: !!sb };
      if (sb) {
        const { count } = await sb.from("leads").select("*", { count: "exact", head: true });
        results.supabase.connected = true;
        results.supabase.leadsCount = count;
      }
    } catch (e) {
      results.supabase = { error: e.message };
    }
    results.env = {
      OPENAI_API_KEY: summarizeSecret(process.env.OPENAI_API_KEY),
      RESEND_API_KEY: summarizeSecret(process.env.RESEND_API_KEY),
      OPENAI_MODEL: process.env.OPENAI_MODEL || "(default gpt-5.4)",
      JPO_USERNAME: !!process.env.JPO_USERNAME,
      JPO_PASSWORD: !!process.env.JPO_PASSWORD,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      NODE_ENV: process.env.NODE_ENV
    };
    // PDF生成テスト
    try {
      const { generateReportPdf } = require("./lib/pdf-report");
      const pdfBuf = await generateReportPdf({ name: "test", patent: { id: "test", title: "test" }, scores: { total: 50 }, report: { summary: "test" } });
      results.pdf = { ok: true, size: pdfBuf.length };
    } catch (e) {
      results.pdf = { ok: false, error: e.message };
    }

    respondJson(req, res, 200, { requestId, ...results });
    return;
  }

  // 詳細レポート申請 (request-report.htmlから呼ばれる)
  // V2パイプラインで調査→詳細レポート生成→メール送信
  if (req.method === "POST" && req.url === "/api/request-detailed-report") {
    const userKey = apiUserKey(req, res);
    const { allowed, state: emailState } = apiCheckLimit(emailLimitStore, userKey, 3);
    if (!allowed) { respondJson(req, res, 429, { requestId, message: "1日あたりの上限（3回）に達しました。" }); return; }

    let body;
    try { body = await apiParseBody(req, 2); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }

    const email = apiCheckEmail(body.email);
    if (!email) { respondJson(req, res, 400, { requestId, message: "有効なメールアドレスを入力してください。" }); return; }

    const patentId = String(body.patentId || "").trim();
    if (!patentId) { respondJson(req, res, 400, { requestId, message: "特許番号を入力してください。" }); return; }

    const name = String(body.name || "");
    emailState.count += 1;

    try {
      console.log(`[request-detailed-report] start researchPatent: ${patentId}`);
      // 2層構成リサーチエンジンで包括的評価
      const result = await researchPatent(patentId, { name });
      console.log(`[request-detailed-report] researchPatent done: ${patentId} source=${result.source}`);

      // 詳細レポートメール送信 (PDF添付)
      console.log(`[request-detailed-report] start sendDetailedReportEmail: ${patentId}`);
      const pdfInfo = await sendDetailedReportEmail({
        email,
        name,
        reportData: {
          patent: result.patent,
          scores: result.scores,
          valueRange: result.valueRange,
          route: { title: result.scores.monetization >= 60 ? "ライセンス向き" : "調査強化推奨" },
          rank: result.rank,
          rankMessage: result.rankMessage,
          report: result.report,
          structured: result.structured
        }
      });
      console.log(`[request-detailed-report] sendDetailedReportEmail done: ${patentId}`, JSON.stringify(pdfInfo));

      // DB保存（非同期・非ブロッキング）
      findLeadByEmail(email).then(lead => {
        if (!lead) return;
        updateLeadStatus(lead.id, "detail_started");
        saveDetailedReportRequest({
          leadId: lead.id,
          patentId,
          rank: result.rank,
          source: result.source
        });
      }).catch(err => console.warn("[request-detailed-report] DB save failed:", err.message));

      logRequest({
        requestId,
        type: "request_detailed_report_complete",
        patentId,
        rank: result.rank,
        reportSource: result.source,
        category: result.royaltyRange.category
      });

      respondJson(req, res, 200, {
        requestId,
        message: "レポートを送信しました。メールをご確認ください。",
        patentId,
        _pdf: pdfInfo
      });
    } catch (error) {
      if (error instanceof PatentInvalidError) {
        emailState.count -= 1; // クオータを返却
        console.log(`[request-detailed-report] patent invalid: ${patentId} (${error.status})`);
        // ユーザーにメールで無効理由を通知
        try {
          await sendPatentInvalidEmail({ email, name, patentNumber: patentId, status: error.status });
        } catch (mailErr) {
          console.warn(`[request-detailed-report] failed to send invalid notice email: ${mailErr.message}`);
        }
        logRequest({
          requestId,
          type: "request_detailed_report_invalid",
          patentId,
          patentStatus: error.status,
          message: error.message
        });
        respondJson(req, res, 422, {
          requestId,
          code: "PATENT_INVALID",
          message: error.message,
          patentId
        });
      } else {
        console.error("[request-detailed-report] error:", error.message);
        if (error && error.stack) {
          console.error("[request-detailed-report] stack:", error.stack);
        }
        Sentry.captureException(error, { extra: { requestId, url: req.url, patentId } });
        maybeSendAlert("detailed_report_error", { requestId, url: req.url, message: error.message, error: error.stack?.split("\n").slice(0, 3).join(" ") });
        logRequest({
          requestId,
          type: "request_detailed_report_error",
          patentId,
          error: error.message
        });
        const apiKey = process.env.OPENAI_API_KEY || "";
        respondJson(req, res, 500, {
          requestId,
          message: "レポート生成に失敗しました。しばらくしてからお試しください。",
          patentId,
          _debug: error.message,
          _keyInfo: `len=${apiKey.length} first=${apiKey.slice(0,7)} last=${apiKey.slice(-4)} hasNewline=${apiKey.includes('\n')} hasReturn=${apiKey.includes('\r')}`
        });
      }
    }

    return;
  }

  if (req.method === "POST" && req.url === "/api/detailed-report") {
    const userKey = apiUserKey(req, res);
    const { allowed, state: reportState } = apiCheckLimit(reportLimitStore, userKey, 3);
    if (!allowed) { respondJson(req, res, 429, { requestId, message: "詳細レポートの1日あたりの上限（3回）に達しました。" }); return; }

    let body;
    try { body = await apiParseBody(req, 4); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }

    const patentId = body.patentId || body.patent?.id || "";
    if (!patentId) { respondJson(req, res, 400, { requestId, message: "patentId is required" }); return; }

    try {
      reportState.count += 1;
      const result = await researchPatent(patentId, { name: body.name || "" });
      respondJson(req, res, 200, { requestId, report: result.report, structured: result.structured, source: result.source });
      logRequest({ requestId, type: "detailed_report", user: userKey, source: result.source });
    } catch (error) {
      if (error instanceof PatentInvalidError) {
        reportState.count -= 1; // クオータを返却
        respondJson(req, res, 422, {
          requestId,
          code: "PATENT_INVALID",
          status: error.status,
          message: error.message,
          patent: error.patent ? { id: error.patent.id, title: error.patent.title, applicant: error.patent.applicant, status: error.patent.status } : null
        });
      } else {
        respondJson(req, res, 500, { requestId, message: "レポート生成に失敗しました。" });
      }
    }
    return;
  }

  // メール送信 (簡易/詳細を統合: reportType="detailed" でPDF添付版)
  // /api/send-detailed-report は互換エイリアス
  if (req.method === "POST" && (req.url === "/api/send-report" || req.url === "/api/send-detailed-report")) {
    const userKey = apiUserKey(req, res);
    const { allowed, state: emailState } = apiCheckLimit(emailLimitStore, userKey, 3);
    if (!allowed) { respondJson(req, res, 429, { requestId, message: "メール送信の1日あたりの上限（3通）に達しました。" }); return; }

    let body;
    try { body = await apiParseBody(req, 8); } catch { respondJson(req, res, 400, { requestId, message: "invalid request body" }); return; }

    const email = apiCheckEmail(body.email);
    if (!email) { respondJson(req, res, 400, { requestId, message: "有効なメールアドレスを入力してください。" }); return; }
    if (!body.reportData) { respondJson(req, res, 400, { requestId, message: "reportData is required" }); return; }

    const isDetailed = body.reportType === "detailed" || req.url === "/api/send-detailed-report";
    const name = String(body.name || "");

    try {
      emailState.count += 1;

      let result;
      if (isDetailed) {
        result = await sendDetailedReportEmail({ email, name, reportData: body.reportData });
      } else {
        // CTA リンク生成（リードIDがある場合）
        let tokenUrl;
        const leadIdForToken = String(body.leadId || "").trim();
        if (leadIdForToken) {
          try {
            const token = await generateAndSaveToken(leadIdForToken);
            const siteHost = process.env.SITE_HOST || "patent-value-analyzer.iprich.jp";
            tokenUrl = `https://${siteHost}/detail-registration.html?t=${token}`;
          } catch (tokenErr) {
            console.warn("[send-report] token generation failed:", tokenErr.message);
          }
        }
        result = await sendResultEmail({
          email, name,
          siteHost: process.env.SITE_HOST || "patent-value-analyzer.iprich.jp",
          reportData: body.reportData,
          tokenUrl
        });
      }

      const msg = isDetailed ? "詳細評価レポートメールを送信しました。" : "メールを送信しました。";
      respondJson(req, res, 200, { requestId, message: msg, emailId: result?.id });
      logRequest({ requestId, type: isDetailed ? "send_detailed_report" : "send_report", user: userKey });
    } catch (error) {
      console.error("[mailer] error:", error.message);
      respondJson(req, res, 500, { requestId, message: "メール送信に失敗しました。" });
    }
    return;
  }

  // 詳細登録: プリフィルデータ取得
  if (req.method === "GET" && req.url?.startsWith("/api/detail-registration")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("t") || "";

    if (!token) {
      respondJson(req, res, 400, { requestId, message: "token is required" });
      return;
    }

    try {
      const data = await verifyAndGetData(token);
      if (!data) {
        respondJson(req, res, 401, { requestId, message: "invalid or expired token" });
        return;
      }
      respondJson(req, res, 200, { requestId, lead: data.lead });
    } catch (err) {
      console.error("[detail-registration] GET error:", err.message);
      respondJson(req, res, 500, { requestId, message: "サーバーエラーが発生しました。" });
    }
    return;
  }

  // 詳細登録: データ保存
  if (req.method === "POST" && req.url === "/api/detail-registration") {
    let body;
    try {
      body = await readJsonBody(req, BODY_LIMIT_BYTES * 4);
    } catch (error) {
      respondJson(req, res, 400, { requestId, message: "invalid request body" });
      return;
    }

    const token = String(body.token || "").trim();
    if (!token) {
      respondJson(req, res, 400, { requestId, message: "token is required" });
      return;
    }

    const type = String(body.type || "").trim();
    if (!type) {
      respondJson(req, res, 400, { requestId, message: "type is required" });
      return;
    }

    try {
      const data = await verifyAndGetData(token);
      if (!data) {
        respondJson(req, res, 401, { requestId, message: "invalid or expired token" });
        return;
      }

      const result = await saveRegistration({
        tokenId: data.tokenId,
        leadId: data.leadId,
        type,
        fields: body.fields || {}
      });

      if (!result.success) {
        respondJson(req, res, 500, { requestId, message: result.message || "登録に失敗しました。" });
        return;
      }

      respondJson(req, res, 200, { requestId, message: "詳細情報を受け付けました。" });
      logRequest({ requestId, type: "detail_registration_saved", regType: type });
    } catch (err) {
      console.error("[detail-registration] POST error:", err.message);
      respondJson(req, res, 500, { requestId, message: "サーバーエラーが発生しました。" });
    }
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
        respondJson(req, res, 413, { requestId, message: "payload too large" });
      } else {
        respondJson(req, res, 400, { requestId, message: "invalid request body" });
      }
      return;
    }

    const validated = validateQuery(body.query);
    if (!validated.ok) {
      metrics.errors4xx += 1;
      respondJson(req, res, 400, { requestId, message: validated.message });
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

      respondJson(req, res, 429, response);
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

    // リード情報をDB保存（診断失敗時もリードは残す）
    const leadName = String(body.name || "").trim().slice(0, 100);
    const leadCompany = String(body.company || "").trim().slice(0, 100);
    const leadEmail = String(body.email || "").trim().slice(0, 200);
    const normalizedPatentNumber = validated.text;

    let leadId = null;
    if (leadEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) {
      const ts = body.trafficSource || {};
      const utmSource = String(ts.utm?.utm_source || "").slice(0, 100) || null;
      const source = utmSource || "patent-value-analyzer";
      const leadRecord = await saveLead({
        name: leadName,
        companyName: leadCompany,
        email: leadEmail,
        source,
        referrer: String(ts.referrer || "").slice(0, 500) || null,
        utmData: ts.utm || null,
        landingPage: String(ts.landingPage || "").slice(0, 200) || null,
        queryInput: String(body.query || "").slice(0, 200) || null
      });
      leadId = leadRecord?.id || null;
      logRequest({
        requestId,
        type: "lead_saved",
        leadId: leadId || "null",
        hasEmail: true
      });
    }

    try {
      const diagnosis = await getDiagnosis(validated.text, requestId);

      // 特許情報をDB保存（非同期・非ブロッキング）
      if (leadId) {
        savePatent({
          leadId,
          patentNumber: validated.text,
          normalizedNumber: normalizedPatentNumber,
          title: diagnosis.patent?.title || "",
          category: diagnosis.patent?.category || "",
          status: diagnosis.patent?.status || "",
          filingDate: diagnosis.patent?.filingDate || null,
          registrationDate: diagnosis.patent?.registrationDate || null
        }).then(() => {
          if (!diagnosis.invalid) {
            updateLeadStatus(leadId, "diagnosed");
          }
        }).catch((err) => {
          console.warn("[supabase] post-diagnose save failed:", err.message);
        });
      }

      metrics.diagnoseAllowed += 1;
      respondJson(req, res, 200, {
        requestId,
        ...diagnosis,
        quota: quota.quota,
        leadId: leadId || undefined
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
        respondJson(req, res, 503, {
          requestId,
          reason: "global_budget_exceeded",
          message: "service is in degraded mode"
        });
        recordLatency(Date.now() - startedAt);
        return;
      }

      if (error.message === "upstream_timeout") {
        metrics.errors5xx += 1;
        respondJson(req, res, 504, {
          requestId,
          message: "upstream timeout"
        });
        recordLatency(Date.now() - startedAt);
        return;
      }

      metrics.errors5xx += 1;
      Sentry.captureException(error, { extra: { requestId, url: req.url } });
      maybeSendAlert("diagnose_error", { requestId, url: req.url, message: error.message, error: error.stack?.split("\n").slice(0, 3).join(" ") });
      respondJson(req, res, 500, {
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
  } catch (err) {
    console.error("[handler] uncaught:", err);
    Sentry.captureException(err, { extra: { url: req.url, method: req.method } });
    maybeSendAlert("uncaught_error", { url: req.url, message: err.message, error: err.stack?.split("\n").slice(0, 5).join(" ") });
    if (!res.headersSent) {
      respondJson(req, res, 500, { message: "internal server error" });
    }
  }
}

// ローカル開発: listen / Vercel: export
if (!process.env.VERCEL) {
  const server = http.createServer(handler);
  server.listen(port, () => {
    console.log(`Patent Value Analyzer running at http://localhost:${port}`);
  });
}

module.exports = handler;

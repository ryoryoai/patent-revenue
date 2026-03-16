require("dotenv").config();
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
const { generateDetailedReport } = require("./lib/llm");
const { sendResultEmail } = require("./lib/mailer");
const { lookupPatent, normalizePatentNumber } = require("./lib/patent-data");

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

const EDGE_SHARED_SECRET = resolveSecret("EDGE_SHARED_SECRET", "", { isProduction });
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";
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

function respondJson(req, res, status, payload) {
  sendJson(req, res, status, payload, { applyCors: applyApiCors });
}

function validateQuery(query) {
  const text = String(query || "").trim();
  if (!text) return { ok: false, message: "query is required" };
  if (text.length > 200) return { ok: false, message: "query too long" };
  if (/[\x00-\x1F\x7F]/.test(text)) return { ok: false, message: "invalid characters" };
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

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
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

  if (req.method === "POST" && req.url === "/api/detailed-report") {
    const clientIp = extractClientIp(req);
    const visitorId = ensureVisitorCookie(req, res);
    const userKey = hashValue(`${normalizeIpForId(clientIp)}:${visitorId}`);

    const reportState = getDailyLimitState(reportLimitStore, userKey);
    if (reportState.count >= 3) {
      respondJson(req, res, 429, { requestId, message: "詳細レポートの1日あたりの上限（3回）に達しました。" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, BODY_LIMIT_BYTES * 4);
    } catch (error) {
      respondJson(req, res, 400, { requestId, message: "invalid request body" });
      return;
    }

    if (!body.patent || !body.scores) {
      respondJson(req, res, 400, { requestId, message: "patent and scores are required" });
      return;
    }

    try {
      reportState.count += 1;
      const result = await generateDetailedReport(body);
      respondJson(req, res, 200, { requestId, ...result });
      logRequest({ requestId, type: "detailed_report", user: userKey, source: result.source });
    } catch (error) {
      respondJson(req, res, 500, { requestId, message: "レポート生成に失敗しました。" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/send-report") {
    const clientIp = extractClientIp(req);
    const visitorId = ensureVisitorCookie(req, res);
    const userKey = hashValue(`${normalizeIpForId(clientIp)}:${visitorId}`);

    const emailState = getDailyLimitState(emailLimitStore, userKey);
    if (emailState.count >= 3) {
      respondJson(req, res, 429, { requestId, message: "メール送信の1日あたりの上限（3通）に達しました。" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, BODY_LIMIT_BYTES * 4);
    } catch (error) {
      respondJson(req, res, 400, { requestId, message: "invalid request body" });
      return;
    }

    const email = String(body.email || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      respondJson(req, res, 400, { requestId, message: "有効なメールアドレスを入力してください。" });
      return;
    }

    if (!body.reportData) {
      respondJson(req, res, 400, { requestId, message: "reportData is required" });
      return;
    }

    try {
      emailState.count += 1;
      const result = await sendResultEmail({
        email,
        name: String(body.name || ""),
        reportData: body.reportData
      });
      respondJson(req, res, 200, { requestId, message: "メールを送信しました。", emailId: result.id });
      logRequest({ requestId, type: "send_report", user: userKey });
    } catch (error) {
      console.error("[mailer] error:", error.message);
      respondJson(req, res, 500, { requestId, message: "メール送信に失敗しました。" });
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

    try {
      const diagnosis = await getDiagnosis(validated.text, requestId);
      metrics.diagnoseAllowed += 1;
      respondJson(req, res, 200, {
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
});

server.listen(port, () => {
  console.log(`Patent Value Check running at http://localhost:${port}`);
});

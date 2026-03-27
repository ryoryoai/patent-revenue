// --- Lightweight Sentry client-side error reporter ---
const _sentryDsn = "https://2223b10cea7848f2e9b5e291cba1fd86@o4510499822960640.ingest.us.sentry.io/4511115683037184";
function reportError(error, context = {}) {
  try {
    const url = new URL(_sentryDsn);
    const projectId = url.pathname.replace("/", "");
    const publicKey = url.username;
    const host = url.hostname;
    const eventId = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: context.level || "error",
      environment: location.hostname === "localhost" ? "development" : "production",
      transaction: context.action || location.pathname,
      tags: { action: context.action || "unknown", ...(context.tags || {}) },
      exception: error instanceof Error ? {
        values: [{ type: error.name, value: error.message, stacktrace: { frames: (error.stack || "").split("\n").slice(1, 8).map(l => ({ filename: l.trim(), function: "?" })).reverse() } }]
      } : undefined,
      message: error instanceof Error ? undefined : { formatted: String(error) },
      extra: { userAgent: navigator.userAgent, url: location.href, ...context },
      request: { url: location.href, headers: { "User-Agent": navigator.userAgent } },
    };
    const header = JSON.stringify({ event_id: eventId, dsn: _sentryDsn, sent_at: new Date().toISOString() });
    const itemHeader = JSON.stringify({ type: "event", length: 0 });
    const body = `${header}\n${itemHeader}\n${JSON.stringify(event)}`;
    fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7,sentry_client=patent-revenue-browser/1.0,sentry_key=${publicKey}` },
      keepalive: true
    }).catch(() => {});
  } catch { /* never block UI */ }
}
window.addEventListener("error", (e) => reportError(e.error || e.message, { action: "uncaught_error" }));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason || "unhandled rejection", { action: "unhandled_promise" }));

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

const benchmark = {
  "製造DX / AI": { citations: [3, 42], growth: [-5, 30], claims: [4, 20], family: [1, 10], players: [5, 35], density: [20, 90] },
  "エネルギー / 材料": { citations: [2, 32], growth: [-8, 22], claims: [3, 16], family: [1, 8], players: [4, 25], density: [18, 70] },
  "医療機器 / 画像解析": { citations: [3, 45], growth: [-3, 35], claims: [5, 24], family: [2, 12], players: [6, 38], density: [22, 88] },
  "通信 / IoT": { citations: [2, 38], growth: [-6, 28], claims: [4, 18], family: [1, 9], players: [5, 32], density: [20, 84] },
  ソフトウェア: { citations: [1, 34], growth: [-8, 26], claims: [3, 16], family: [1, 8], players: [5, 28], density: [20, 80] },
  default: { citations: [1, 32], growth: [-10, 24], claims: [3, 16], family: [1, 8], players: [4, 24], density: [15, 72] }
};

const useStatusFactor = {
  using: 1,
  planned: 0.92,
  not_using: 0.84,
  "": 0.88
};

const salesRangeMidpoint = {
  lt100m: 50_000_000,
  "100m_1b": 500_000_000,
  "1b_10b": 5_000_000_000,
  gt10b: 15_000_000_000,
  "": 180_000_000
};

const categoryRoyaltyRange = {
  "製造DX / AI": [0.012, 0.04],
  "エネルギー / 材料": [0.01, 0.035],
  "医療機器 / 画像解析": [0.015, 0.05],
  "通信 / IoT": [0.012, 0.04],
  ソフトウェア: [0.015, 0.055],
  default: [0.01, 0.04]
};

const diagnosisForm = document.getElementById("diagnosis-form");
const screenResult = document.getElementById("screen-result");
const scoreEl = document.getElementById("teaser-score");
const joinLink = document.getElementById("join-link");
const backToInputBtn = document.getElementById("back-to-input");
const systemMessage = document.getElementById("system-message");
const captchaBox = document.getElementById("captcha-box");
const captchaWidget = document.getElementById("captcha-widget");
const toggleOptions = document.getElementById("toggle-options");
const extraFields = document.getElementById("extra-fields");

let latestResult = null;
let captchaToken = "";
let captchaSiteKey = "";
let turnstileWidgetId = null;
let turnstileLoader = null;

if (toggleOptions && extraFields) {
  toggleOptions.addEventListener("click", () => {
    const isHidden = extraFields.classList.toggle("hidden");
    toggleOptions.textContent = isHidden ? "精度を上げる追加入力" : "追加入力を閉じる";
  });
}

function showSystemMessage(message, tone = "warn") {
  if (!systemMessage) return;
  systemMessage.classList.remove("hidden", "warn", "error");
  if (tone === "warn" || tone === "error") {
    systemMessage.classList.add(tone);
  }
  systemMessage.textContent = message;
}

function clearSystemMessage() {
  if (!systemMessage) return;
  systemMessage.classList.add("hidden");
  systemMessage.classList.remove("warn", "error");
  systemMessage.textContent = "";
}

function ensureTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileLoader) return turnstileLoader;

  turnstileLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile_load_failed"));
    document.head.appendChild(script);
  });

  return turnstileLoader;
}

function hideCaptchaChallenge() {
  if (!captchaBox) return;
  captchaBox.classList.add("hidden");
}

async function showCaptchaChallenge(siteKey) {
  if (!captchaBox || !captchaWidget || !siteKey) return;
  captchaBox.classList.remove("hidden");

  try {
    await ensureTurnstileScript();
  } catch (error) {
    showSystemMessage("CAPTCHAの読み込みに失敗しました。時間をおいて再試行してください。", "warn");
    return;
  }

  captchaSiteKey = siteKey;
  captchaWidget.replaceChildren();
  turnstileWidgetId = window.turnstile.render(captchaWidget, {
    sitekey: siteKey,
    theme: "light",
    callback: (token) => {
      captchaToken = token;
      showSystemMessage("追加認証が完了しました。もう一度診断を実行してください。", "warn");
    },
    "expired-callback": () => {
      captchaToken = "";
    }
  });
}

function trackEvent(name, payload = {}) {
  window.dataLayer = window.dataLayer || [];
  const event = {
    event: name,
    ts: new Date().toISOString(),
    ...payload
  };
  window.dataLayer.push(event);
  console.info("[event]", event);
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}



function percentile(value, min, max) {
  if (max <= min) return 50;
  return clamp(Math.round(((value - min) / (max - min)) * 100), 0, 100);
}

function remainingYearsFromFiling(filingDate) {
  const filing = new Date(filingDate);
  if (Number.isNaN(filing.getTime())) return 5;

  const expire = new Date(filing);
  expire.setFullYear(expire.getFullYear() + 20);
  const years = (expire.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365.25);
  return clamp(years, 0, 20);
}

function getCategoryBase(category) {
  return benchmark[category] || benchmark.default;
}

const rankMessages = {
  A: "ライセンス・売却できる可能性がとても高い",
  B: "ライセンス・売却できる可能性が高い",
  C: "ライセンス・売却できる可能性がある",
  D: "ライセンス・売却できる可能性が低い"
};

function getRank(scores, input) {
  const fullCoverage = scores.breadth >= 70 && scores.strength >= 60;
  const partialCoverage = scores.breadth >= 40;
  const salesOver100b = input.salesRange === "gt10b";
  const salesOver1b = input.salesRange === "100m_1b" || input.salesRange === "1b_10b" || input.salesRange === "gt10b";

  if (fullCoverage && salesOver100b) return "A";
  if (fullCoverage && salesOver1b) return "B";
  if (partialCoverage) return "C";
  return "D";
}

function resultId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

async function fetchPatentInfoFallback(query) {
  const cacheKey = `pvc_cache_${query}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.cachedAt < 24 * 60 * 60 * 1000) {
        return parsed.payload;
      }
    } catch (error) {
      console.warn("cache parse failed", error);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  const payload = patentNumber.length >= 6 ? mockPatents[patentNumber] || pseudoPatentFromQuery(query, patentNumber) : pseudoPatentFromQuery(query, "");
  const response = {
    patent: payload,
    meta: {
      mode: "client-fallback",
      cacheHit: false
    }
  };

  localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), payload: response }));
  return response;
}

function getTrafficSource() {
  const params = new URLSearchParams(window.location.search);
  const utm = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const val = params.get(key);
    if (val) utm[key] = val;
  }
  return {
    utm: Object.keys(utm).length > 0 ? utm : undefined,
    referrer: document.referrer || undefined,
    landingPage: window.location.pathname
  };
}

const _trafficSource = getTrafficSource();

async function fetchPatentInfo(query, challengeToken = "", leadFields = {}) {
  const body = JSON.stringify({
    query,
    captchaToken: challengeToken || undefined,
    name: leadFields.name || undefined,
    company: leadFields.company || undefined,
    email: leadFields.email || undefined,
    trafficSource: _trafficSource
  });
  let response;

  try {
    response = await fetch("/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body
    });
  } catch (error) {
    return fetchPatentInfoFallback(query);
  }

  if (response.ok) {
    return response.json();
  }

  if (response.status === 404 || response.status === 405) {
    return fetchPatentInfoFallback(query);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  const limitError = new Error(payload.message || "診断APIでエラーが発生しました。");
  limitError.status = response.status;
  limitError.payload = payload;
  throw limitError;
}

function computeScores(patent, input) {
  const base = getCategoryBase(patent.category);
  const metrics = patent.metrics;
  const filingYear = new Date(patent.filingDate).getFullYear();
  const ageFactor = clamp((new Date().getFullYear() - filingYear) / 12, 0.35, 1.2);

  const impactCitation = percentile(metrics.citations * ageFactor, base.citations[0], base.citations[1]);
  const impactGrowth = percentile(metrics.citationGrowth, base.growth[0], base.growth[1]);
  const impact = Math.round(impactCitation * 0.7 + impactGrowth * 0.3);

  const breadthClaims = percentile(metrics.claimCount, base.claims[0], base.claims[1]);
  const breadthFamily = percentile(metrics.familySize, base.family[0], base.family[1]);
  const breadth = Math.round(breadthClaims * 0.45 + breadthFamily * 0.35 + metrics.classRank * 0.2);

  const remain = remainingYearsFromFiling(patent.filingDate);
  const strengthTerm = percentile(remain, 3, 20);
  const strengthStatus = patent.status === "登録" ? 88 : 52;
  const strengthProsecution = percentile(48 - metrics.prosecutionMonths, 6, 36);
  const strength = Math.round(strengthTerm * 0.4 + strengthStatus * 0.3 + strengthProsecution * 0.3);

  const monetizationPlayers = percentile(metrics.marketPlayers, base.players[0], base.players[1]);
  const monetizationDensity = percentile(metrics.filingDensity, base.density[0], base.density[1]);
  const applicantBoost = patent.applicantType === "企業" ? 10 : patent.applicantType === "大学" ? 5 : 0;
  const monetizationRaw = monetizationPlayers * 0.45 + monetizationDensity * 0.45 + applicantBoost;
  const useFactor = useStatusFactor[input.useStatus || ""];
  const monetization = clamp(Math.round(monetizationRaw * useFactor), 0, 100);

  const total = Math.round(impact * 0.3 + breadth * 0.25 + strength * 0.25 + monetization * 0.2);

  return {
    total,
    rank: getRank({ breadth, strength, monetization, impact }, input),
    impact,
    breadth,
    strength,
    monetization
  };
}

function generateComment(scores) {
  if (scores.total >= 80) return "同分野内で優位な指標が多く、収益化打診の初動が取りやすい状態です。";
  if (scores.total >= 65) return "主要指標は良好です。用途整理と相手企業の選定で評価を伸ばせます。";
  if (scores.total >= 50) return "基礎評価は標準レンジです。根拠の補強で交渉力を上げられます。";
  return "公開情報だけでは評価が割れています。詳細調査で判断材料を増やす段階です。";
}

function generateRationales(scores) {
  const items = [
    { label: "影響度", val: scores.impact },
    { label: "権利の広さ", val: scores.breadth },
    { label: "実務上の強さ", val: scores.strength },
    { label: "収益化の近さ", val: scores.monetization }
  ];

  return items
    .sort((a, b) => b.val - a.val)
    .slice(0, 3)
    .map((item) => {
      if (item.val >= 75) return `${item.label}: 同分野・同年代で上位レンジ`;
      if (item.val >= 55) return `${item.label}: 平均よりやや優位`;
      return `${item.label}: 追加情報で評価が変動しやすい`;
    });
}

function yenRangeLabel(value) {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}億円`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 10_000).toLocaleString("ja-JP")}万円`;
  }
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function calcAnnuityFactor(years, discountRate) {
  if (discountRate <= 0) return years;
  const n = clamp(years, 1, 8);
  return (1 - 1 / Math.pow(1 + discountRate, n)) / discountRate;
}

function estimateValueRange(patent, scores, input) {
  const sales = salesRangeMidpoint[input.salesRange || ""];
  const contribution = Number(input.contribution || 0) || clamp((scores.monetization - 35) / 300, 0.06, 0.22);
  const royalty = categoryRoyaltyRange[patent.category] || categoryRoyaltyRange.default;
  const usableYears = clamp(Math.round(remainingYearsFromFiling(patent.filingDate)), 3, 7);
  const annuityFactor = calcAnnuityFactor(usableYears, 0.12);
  const statusFactor = useStatusFactor[input.useStatus || ""];

  const low = sales * royalty[0] * contribution * annuityFactor * statusFactor;
  const high = sales * royalty[1] * contribution * annuityFactor * statusFactor * 1.2;

  const unknownCount = [input.useStatus, input.salesRange, input.contribution].filter((v) => !v).length;
  const confidence = unknownCount >= 2 ? "低" : unknownCount === 1 ? "中" : "高";

  return {
    low: Math.max(low, 300_000),
    high: Math.max(high, 2_000_000),
    confidence,
    reason: unknownCount === 0 ? "主要入力が揃っているため、レンジ幅を抑えています。" : "未入力項目があるため、レンジを広めに提示しています。"
  };
}

function decideRoute(scores, input) {
  if (scores.monetization >= 70 && (input.useStatus === "using" || input.useStatus === "planned")) {
    return {
      title: "ライセンス向き",
      body: "用途が明確で収益化の近さが高く、買い手候補への打診設計と条件交渉が進めやすい状態です。"
    };
  }

  if (scores.strength >= 68 && scores.breadth >= 62) {
    return {
      title: "売却向き",
      body: "権利のまとまりがあり、譲渡時の説明材料を整理しやすい状態です。希望金額の妥当性を詰めるのが次の一手です。"
    };
  }

  return {
    title: "調査優先",
    body: "市場実装と相手企業の仮説を補強すると、売却・ライセンスのどちらが有利か判断しやすくなります。"
  };
}

function nextAction(route, valueRange) {
  if (route.title === "ライセンス向き") {
    return "登録後は、用途が近い企業を優先して打診リストを作成し、ロイヤルティ条件の初期案を作るのが効果的です。";
  }
  if (route.title === "売却向き") {
    return `希望金額はまず${yenRangeLabel((valueRange.low + valueRange.high) / 2)}前後を軸に置き、譲渡条件を整理して交渉に入るのが堅実です。`;
  }
  return "まずは実施状況・競合・代替技術の確認を追加し、診断精度を上げてから収益化手段を選ぶのが安全です。";
}

function buildJoinUrl(result) {
  const params = new URLSearchParams({
    source: "patent-value-check",
    patent_id: result.patent.id,
    result_id: result.resultId
  });
  return `https://patent-revenue.iprich.jp/?${params.toString()}#licence`;
}

function createNode(tagName, { className = "", text = "" } = {}) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function appendChildren(parent, children) {
  parent.replaceChildren(...children);
}

function createExternalLink(href, text) {
  const link = document.createElement("a");
  link.textContent = text;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  try {
    const url = new URL(String(href || ""));
    link.href = url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch (error) {
    link.href = "#";
  }

  return link;
}

function renderResult(result) {
  const score = result.scores;

  // カード内: 評価文言 + コメント
  appendChildren(scoreEl, [
    createNode("p", { className: "rank-message", text: rankMessages[score.rank] || "" }),
    createNode("p", { className: "score-comment", text: generateComment(score) })
  ]);

  // カード外: 判定基準テーブル + コメント
  const criteriaArea = document.getElementById("rank-criteria-area");
  if (criteriaArea) {
    const criteria = document.createElement("div");
    criteria.className = "rank-criteria";
    ["A", "B", "C", "D"].forEach(r => {
      const row = document.createElement("div");
      row.className = "rank-row" + (r === score.rank ? " rank-active" : "");
      const letter = createNode("span", { className: "rank-row-letter", text: r });
      const desc = createNode("span", { className: "rank-row-desc", text: rankMessages[r] });
      row.appendChild(letter);
      row.appendChild(desc);
      criteria.appendChild(row);
    });
    const comment = createNode("p", { className: "score-comment", text: generateComment(score) });
    criteriaArea.replaceChildren(criteria, comment);
  }
}



function showResultScreen() {
  screenResult.classList.remove("hidden");
  screenResult.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showInputScreen() {
  screenResult.classList.add("hidden");
  document.querySelector(".hero").scrollIntoView({ behavior: "smooth", block: "start" });
}

let _diagnosisInFlight = false;
diagnosisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (_diagnosisInFlight) return;
  _diagnosisInFlight = true;

  const leadName = document.getElementById("lead-name")?.value?.trim() || "";
  const leadCompany = document.getElementById("lead-company")?.value?.trim() || "";
  const leadEmail = document.getElementById("lead-email")?.value?.trim() || "";

  const fd = new FormData(diagnosisForm);
  const input = {
    query: String(fd.get("query") || "").trim(),
    useStatus: String(fd.get("useStatus") || ""),
    salesRange: String(fd.get("salesRange") || ""),
    contribution: String(fd.get("contribution") || "")
  };

  if (!input.query) {
    showSystemMessage("特許番号を入力してください。", "warn");
    _diagnosisInFlight = false;
    return;
  }
  if (!/^\d{7}$/.test(input.query)) {
    showSystemMessage("登録済み特許の7桁の番号を入力してください。出願番号（特願〜）は対象外です。", "warn");
    _diagnosisInFlight = false;
    return;
  }

  clearSystemMessage();
  const submitButton = diagnosisForm.querySelector("button[type='submit']");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.classList.add("btn-loading");

  // Labor Illusion: 段階的ステータス表示で信頼性向上（Harvard Business School, Buell & Norton 2011）
  const _MIN_DISPLAY_MS = 4000;
  const _statusSteps = [
    { at: 0, text: "データ照会中…" },
    { at: 1500, text: "公式データ取得中…" },
    { at: 3000, text: "AI分析中…" },
  ];
  let _stepIdx = 0;
  submitButton.textContent = _statusSteps[0].text;
  const _diagStart = Date.now();
  const _stepTimer = setInterval(() => {
    const elapsed = Date.now() - _diagStart;
    while (_stepIdx < _statusSteps.length - 1 && elapsed >= _statusSteps[_stepIdx + 1].at) _stepIdx++;
    submitButton.textContent = _statusSteps[_stepIdx].text;
  }, 200);

  trackEvent("diagnosis_start", { query_type: "number" });

  try {
    const diagnosis = await fetchPatentInfo(input.query, captchaToken, {
      name: leadName,
      company: leadCompany,
      email: leadEmail
    });
    const _elapsed = Date.now() - _diagStart;
    if (_elapsed < _MIN_DISPLAY_MS) await new Promise(r => setTimeout(r, _MIN_DISPLAY_MS - _elapsed));
    captchaToken = "";
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
    hideCaptchaChallenge();

    const patent = diagnosis.patent;

    // 無効特許の場合はスコア計算せずメッセージ表示
    if (diagnosis.invalid) {
      if (diagnosis.notFound) {
        showSystemMessage("この特許番号は見つかりませんでした。番号をご確認のうえ再度お試しください。", "warn");
        submitButton.classList.remove("btn-loading");
        submitButton.textContent = originalText;
        submitButton.disabled = false;
        return;
      }
      const statusMessages = {
        "消滅": "この特許は権利が消滅しています。有効な特許のみ診断できます。",
        "拒絶": "この特許出願は拒絶されています。有効な特許のみ診断できます。",
        "出願中": "この特許は出願中で、まだ登録されていません。登録済みの特許のみ診断できます。",
        "取下": "この特許出願は取り下げられています。有効な特許のみ診断できます。"
      };
      const msg = statusMessages[patent.status] || `この特許は有効ではありません（状態: ${patent.status || "不明"}）。`;
      showSystemMessage(msg, "warn");
      submitButton.classList.remove("btn-loading");
      submitButton.textContent = originalText;
      submitButton.disabled = false;
      return;
    }

    // サーバーがスコア・ランクを返していればそれを使う（LLM補完済み）
    // フォールバック: ローカル計算
    const scores = diagnosis.scores
      ? { ...diagnosis.scores, rank: diagnosis.rank || diagnosis.scores.rank || getRank(diagnosis.scores, input) }
      : computeScores(patent, input);
    const valueRange = estimateValueRange(patent, scores, input);
    const route = decideRoute(scores, input);

    latestResult = {
      resultId: diagnosis.resultId || resultId(),
      input,
      patent,
      scores,
      valueRange,
      route,
      meta: diagnosis.meta || {},
      leadId: diagnosis.leadId || null
    };

    renderResult(latestResult);
    showResultScreen();

    trackEvent("diagnosis_success", {
      result_id: latestResult.resultId,
      patent_id: patent.id,
      score: scores.total,
      rank: scores.rank,
      route: route.title
    });
  } catch (error) {
    console.error(error);
    reportError(error, { action: "diagnosis", status: error.status, query: input.query });
    if (error.status === 429) {
      if (error.payload?.reason === "captcha_required") {
        showSystemMessage("アクセス保護のため追加認証が必要です。CAPTCHAを完了後、再度診断してください。", "warn");
        trackEvent("captcha_required", { reason: error.payload?.reason });
        await showCaptchaChallenge(error.payload?.captchaSiteKey || captchaSiteKey);
      } else {
        const waitHint = error.payload?.retryAfterSeconds ? `約${error.payload.retryAfterSeconds}秒後` : "時間をおいて";
        showSystemMessage(`上限に達しました。${waitHint}に再試行してください。登録後は継続して詳細分析を進められます。`, "warn");
      }
      trackEvent("diagnosis_limited", { reason: error.payload?.reason || "rate_limited" });
    } else if (error.status === 503) {
      showSystemMessage("現在アクセスが集中しています。しばらくして再試行してください。", "warn");
    } else if (error.status === 403) {
      showSystemMessage("アクセス元が制限されています。ネットワーク管理者にお問い合わせください。", "error");
    } else {
      showSystemMessage("診断に失敗しました。時間をおいて再度お試しください。", "error");
    }
  } finally {
    clearInterval(_stepTimer);
    _diagnosisInFlight = false;
    submitButton.classList.remove("btn-loading");
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
});

if (joinLink) {
  joinLink.addEventListener("click", () => {
    if (!latestResult) return;
    trackEvent("cta_click_join_patentrevenue", {
      result_id: latestResult.resultId,
      patent_id: latestResult.patent.id
    });
  });
}

backToInputBtn.addEventListener("click", showInputScreen);

const detailedReportBtn = document.getElementById("detailed-report-btn");
if (detailedReportBtn) {
  detailedReportBtn.addEventListener("click", () => {
    const accordion = document.getElementById("registration-accordion");
    if (!accordion) return;

    if (accordion.classList.contains("hidden")) {
      // アコーディオン展開
      accordion.classList.remove("hidden");
      detailedReportBtn.textContent = "フォームを閉じる";
      detailedReportBtn.classList.remove("btn-primary");
      detailedReportBtn.classList.add("btn-ghost");

      // プリフィル
      const name = document.getElementById("lead-name")?.value || "";
      const company = document.getElementById("lead-company")?.value || "";
      const email = document.getElementById("lead-email")?.value || "";
      const patent = document.getElementById("query")?.value || "";

      document.getElementById("reg-prefill-name").textContent = name;
      document.getElementById("reg-prefill-company").textContent = company;
      document.getElementById("reg-prefill-email").textContent = email;
      document.getElementById("reg-prefill-patent").textContent = patent;

      accordion.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // アコーディオン折りたたみ
      accordion.classList.add("hidden");
      detailedReportBtn.textContent = "詳細レポートを申請する";
      detailedReportBtn.classList.add("btn-primary");
      detailedReportBtn.classList.remove("btn-ghost");
    }
  });
}

const regForm = document.getElementById("registration-form");
if (regForm) {
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const publishCheck = document.getElementById("reg-patent-publish-agree");
    if (publishCheck && !publishCheck.checked) {
      showSystemMessage("特許情報の公開への同意が必要です。", "warn");
      return;
    }

    const privacyCheck = document.getElementById("reg-privacy-agree");
    if (privacyCheck && !privacyCheck.checked) {
      showSystemMessage("プライバシーポリシーに同意してください。", "warn");
      return;
    }

    const submitBtn = document.getElementById("reg-submit-btn");
    const statusEl = document.getElementById("reg-status");
    submitBtn.disabled = true;
    submitBtn.classList.add("btn-loading");

    // Labor Illusion: 段階的ステータスで信頼性向上
    const _reportSteps = [
      { at: 0, text: "特許データを照会中…" },
      { at: 2000, text: "AIが詳細分析を実行中…" },
      { at: 5000, text: "評価レポートを生成中…" },
      { at: 10000, text: "PDFを作成中…" },
      { at: 20000, text: "もうしばらくお待ちください…" },
    ];
    let _rStepIdx = 0;
    const _rStart = Date.now();
    submitBtn.textContent = _reportSteps[0].text;
    const _rTimer = setInterval(() => {
      const elapsed = Date.now() - _rStart;
      while (_rStepIdx < _reportSteps.length - 1 && elapsed >= _reportSteps[_rStepIdx + 1].at) _rStepIdx++;
      submitBtn.textContent = _reportSteps[_rStepIdx].text;
    }, 300);

    const email = document.getElementById("lead-email")?.value?.trim() || "";
    const name = document.getElementById("lead-name")?.value?.trim() || "";
    const patentId = document.getElementById("query")?.value?.trim() || "";

    try {
      const _rElapsedAtFetch = Date.now();
      const res = await fetch("/api/request-detailed-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          name,
          patentId,
          department: document.getElementById("reg-department")?.value || "",
          phone: document.getElementById("reg-phone")?.value || "",
          supportMethod: document.getElementById("reg-support-method")?.value || "",
          desiredPrice: document.getElementById("reg-desired-price")?.value || ""
        })
      });

      const data = await res.json();
      const _rTotalElapsed = Date.now() - _rStart;
      if (_rTotalElapsed < 4000) await new Promise(r => setTimeout(r, 4000 - _rTotalElapsed));

      if (res.ok) {
        statusEl.className = "reg-status success";
        statusEl.textContent = data.message || "申請を受け付けました。メールでレポートをお届けします。";
        statusEl.classList.remove("hidden");
        regForm.style.display = "none";
        trackEvent("detailed_report_requested", { patent_id: patentId });
      } else {
        reportError(data.message || "detailed_report_api_error", { action: "detailed_report_response", status: res.status, patentId });
        statusEl.className = "reg-status error";
        statusEl.textContent = data.message || "申請に失敗しました。";
        statusEl.classList.remove("hidden");
      }
    } catch (err) {
      reportError(err, { action: "detailed_report", patentId });
      statusEl.className = "reg-status error";
      statusEl.textContent = "通信エラーが発生しました。";
      statusEl.classList.remove("hidden");
    } finally {
      clearInterval(_rTimer);
      submitBtn.classList.remove("btn-loading");
      submitBtn.disabled = false;
      submitBtn.textContent = "詳細レポートを申請する";
    }
  });
}

trackEvent("lp_view", { page: "home" });

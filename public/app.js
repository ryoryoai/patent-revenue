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
const summaryEl = document.getElementById("teaser-summary");
const valueEl = document.getElementById("teaser-value");
const routeEl = document.getElementById("teaser-route");
const nextEl = document.getElementById("teaser-next");
const reasonsEl = document.getElementById("teaser-reasons");
const gatedEl = document.getElementById("teaser-gated");
const joinLink = document.getElementById("join-link");
const reportSignupBtn = document.getElementById("report-signup");
const backToInputBtn = document.getElementById("back-to-input");
const ctaNote = document.getElementById("cta-note");
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

function normalizePatentNumber(input) {
  return String(input || "")
    .replace(/特許第/g, "")
    .replace(/号/g, "")
    .replace(/[\s-]/g, "")
    .replace(/[^0-9]/g, "");
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
  const patentNumber = normalizePatentNumber(query);
  const cacheKey = `pvc_cache_${patentNumber || query}`;
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

async function fetchPatentInfo(query, challengeToken = "") {
  const body = JSON.stringify({ query, captchaToken: challengeToken || undefined });
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
  const valueRange = result.valueRange;
  const route = result.route;
  const rationales = generateRationales(score);
  const next = nextAction(route, valueRange);
  appendChildren(scoreEl, [
    createNode("p", { className: "score-label", text: "Patent Value Score" }),
    createNode("p", { className: "score-main", text: String(score.total) }),
    createNode("p", { className: "rank", text: `ランク ${score.rank} / 信頼度 ${valueRange.confidence}` }),
    createNode("p", { className: "rank-message", text: rankMessages[score.rank] || "" })
  ]);

  const officialLinkRow = createNode("p", { className: "small" });
  officialLinkRow.appendChild(createExternalLink(result.patent.officialUrl, "J-PlatPatで確認"));
  appendChildren(summaryEl, [
    createNode("h3", { text: "診断サマリー" }),
    createNode("p", { className: "title", text: result.patent.title }),
    createNode("p", { text: generateComment(score) }),
    createNode("p", { className: "small", text: `特許ID: ${result.patent.id} / カテゴリ: ${result.patent.category}` }),
    createNode("p", { className: "small", text: `出願: ${result.patent.filingDate} / 登録: ${result.patent.registrationDate}` }),
    createNode("p", { className: "small", text: `応答: ${result.meta?.mode || "api"} / キャッシュ: ${result.meta?.cacheHit ? "hit" : "miss"}` }),
    officialLinkRow
  ]);

  appendChildren(valueEl, [
    createNode("h3", { text: "価値レンジ（概算）" }),
    createNode("p", { className: "title", text: `${yenRangeLabel(valueRange.low)} 〜 ${yenRangeLabel(valueRange.high)}` }),
    createNode("p", { text: valueRange.reason })
  ]);

  appendChildren(routeEl, [
    createNode("h3", { text: "向いている収益化手段" }),
    createNode("p", { className: "title", text: route.title }),
    createNode("p", { text: route.body })
  ]);

  appendChildren(nextEl, [
    createNode("h3", { text: "次の一手" }),
    createNode("p", { text: next })
  ]);

  const rationaleList = document.createElement("ul");
  rationales.forEach((text) => {
    rationaleList.appendChild(createNode("li", { text }));
  });
  appendChildren(reasonsEl, [
    createNode("h3", { text: "評価根拠（公開範囲）" }),
    rationaleList
  ]);

  const gatedList = createNode("div", { className: "gated-list" });
  [
    "・影響度の年次推移グラフ",
    "・候補企業リスト（用途一致順）",
    "・売却/ライセンス条件の比較表",
    "・交渉前チェックリスト"
  ].forEach((text) => {
    gatedList.appendChild(createNode("p", { text }));
  });
  appendChildren(gatedEl, [
    createNode("h3", { text: "会員向け詳細（非表示）" }),
    gatedList,
    createNode("p", { className: "small", text: "詳細はPatentRevenue登録後に確認できます。" })
  ]);

  joinLink.href = buildJoinUrl(result);
  ctaNote.textContent = "登録導線には source=patent-value-check と診断IDを付与します。";
}

async function fetchDetailedReport(result) {
  const reportBtn = document.getElementById("detailed-report-btn");
  const reportSection = document.getElementById("detailed-report");
  if (!reportBtn || !reportSection) return;

  reportBtn.disabled = true;
  reportBtn.textContent = "レポート生成中...";

  try {
    const response = await fetch("/api/detailed-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        patent: result.patent,
        scores: result.scores,
        input: result.input,
        valueRange: result.valueRange,
        route: result.route
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "レポート生成に失敗しました。");
    }

    const report = await response.json();
    renderDetailedReport(report, reportSection);
    reportSection.classList.remove("hidden");
    reportSection.scrollIntoView({ behavior: "smooth", block: "start" });
    trackEvent("detailed_report_generated", { result_id: result.resultId });
  } catch (error) {
    showSystemMessage(error.message || "詳細レポートの取得に失敗しました。", "error");
  } finally {
    reportBtn.disabled = false;
    reportBtn.textContent = "詳細レポートを生成";
  }
}

function renderDetailedReport(report, container) {
  const sections = [
    { title: "発明の概要", key: "summary" },
    { title: "強み・優位性", key: "strengths" },
    { title: "ライセンス可能分野", key: "licensableFields" },
    { title: "想定ロイヤルティ率", key: "royaltyRate" },
    { title: "ライセンス可能額の目安", key: "valueBracket" },
    { title: "収益化手段", key: "monetizationMethods" },
    { title: "次の一手", key: "nextSteps" }
  ];

  const children = [createNode("h3", { text: "詳細評価レポート" })];

  sections.forEach((sec) => {
    const content = report.report?.[sec.key] || report[sec.key] || "（データなし）";
    const card = createNode("div", { className: "report-section" });
    card.appendChild(createNode("h4", { text: sec.title }));
    const body = createNode("p");
    body.textContent = typeof content === "string" ? content : JSON.stringify(content);
    card.appendChild(body);
    children.push(card);
  });

  appendChildren(container, children);
}

async function sendReportEmail() {
  const emailInput = document.getElementById("report-email");
  const nameInput = document.getElementById("report-name");
  const privacyCheck = document.getElementById("privacy-agree");
  const sendBtn = document.getElementById("send-report-btn");

  if (!emailInput || !sendBtn) return;

  const email = emailInput.value.trim();
  const name = nameInput ? nameInput.value.trim() : "";

  if (!email) {
    showSystemMessage("メールアドレスを入力してください。", "warn");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showSystemMessage("有効なメールアドレスを入力してください。", "warn");
    return;
  }

  if (privacyCheck && !privacyCheck.checked) {
    showSystemMessage("プライバシーポリシーに同意してください。", "warn");
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = "送信中...";

  try {
    const response = await fetch("/api/send-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        name,
        resultId: latestResult?.resultId,
        reportData: {
          patent: latestResult?.patent,
          scores: latestResult?.scores,
          valueRange: latestResult?.valueRange,
          route: latestResult?.route,
          rank: latestResult?.scores?.rank,
          rankMessage: rankMessages[latestResult?.scores?.rank] || ""
        }
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "送信に失敗しました。");
    }

    showSystemMessage("診断結果をメールで送信しました。", "warn");
    trackEvent("report_email_sent", { result_id: latestResult?.resultId });
  } catch (error) {
    showSystemMessage(error.message || "メール送信に失敗しました。", "error");
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "結果をメールで受け取る";
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

diagnosisForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fd = new FormData(diagnosisForm);
  const input = {
    query: String(fd.get("query") || "").trim(),
    useStatus: String(fd.get("useStatus") || ""),
    salesRange: String(fd.get("salesRange") || ""),
    contribution: String(fd.get("contribution") || "")
  };

  if (!input.query) {
    showSystemMessage("特許番号・公開番号・キーワードを入力してください。", "warn");
    return;
  }

  clearSystemMessage();
  const submitButton = diagnosisForm.querySelector("button[type='submit']");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "診断中...";

  trackEvent("diagnosis_start", {
    query_type: normalizePatentNumber(input.query).length >= 6 ? "number" : "keyword"
  });

  try {
    const diagnosis = await fetchPatentInfo(input.query, captchaToken);
    captchaToken = "";
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
    hideCaptchaChallenge();

    const patent = diagnosis.patent;

    // 無効特許の場合はスコア計算せずメッセージ表示
    if (diagnosis.invalid) {
      const statusMessages = {
        "消滅": "この特許は権利が消滅しています。有効な特許のみ診断できます。",
        "拒絶": "この特許出願は拒絶されています。有効な特許のみ診断できます。",
        "出願中": "この特許は出願中で、まだ登録されていません。登録済みの特許のみ診断できます。",
        "取下": "この特許出願は取り下げられています。有効な特許のみ診断できます。"
      };
      const msg = statusMessages[patent.status] || `この特許は有効ではありません（状態: ${patent.status || "不明"}）。`;
      showSystemMessage(msg, "warn");
      submitButton.textContent = originalText;
      submitButton.disabled = false;
      return;
    }

    const scores = computeScores(patent, input);
    const valueRange = estimateValueRange(patent, scores, input);
    const route = decideRoute(scores, input);

    latestResult = {
      resultId: diagnosis.resultId || resultId(),
      input,
      patent,
      scores,
      valueRange,
      route,
      meta: diagnosis.meta || {}
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
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
});

joinLink.addEventListener("click", () => {
  if (!latestResult) return;
  trackEvent("cta_click_join_patentrevenue", {
    result_id: latestResult.resultId,
    patent_id: latestResult.patent.id
  });
  trackEvent("signup_start", {
    result_id: latestResult.resultId,
    patent_id: latestResult.patent.id
  });
});

reportSignupBtn.addEventListener("click", () => {
  if (!latestResult) return;
  trackEvent("signup_complete", {
    result_id: latestResult.resultId,
    patent_id: latestResult.patent.id,
    source: "demo-report"
  });
  window.alert("signup_complete を記録しました（デモ）。");
});

backToInputBtn.addEventListener("click", showInputScreen);

const detailedReportBtn = document.getElementById("detailed-report-btn");
if (detailedReportBtn) {
  detailedReportBtn.addEventListener("click", () => {
    if (latestResult) fetchDetailedReport(latestResult);
  });
}

const sendReportBtn = document.getElementById("send-report-btn");
if (sendReportBtn) {
  sendReportBtn.addEventListener("click", sendReportEmail);
}

trackEvent("lp_view", { page: "home" });

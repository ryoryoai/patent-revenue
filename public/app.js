const heroCopies = [
  {
    title: "その特許、放置したままではもったいない。",
    lead: "特許番号だけで、価値レンジと収益化の次の一手を最短60秒で概算。まずは経営判断に必要な入口を作ります。"
  },
  {
    title: "眠っている特許を、売れる・貸せる資産へ。",
    lead: "国内特許に対応。個人情報不要で、価値の目安と進め方を先に確認できます。"
  },
  {
    title: "特許の価値、まずは数字で。",
    lead: "概算の診断票を先に提示し、詳細な買い手探索と実務支援は登録後に進められます。"
  }
];

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
const screenInput = document.getElementById("screen-input");
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
const heroTitle = document.getElementById("hero-title");
const heroLead = document.getElementById("hero-lead");

let latestResult = null;
let selectedCopyIndex = 0;
let captchaToken = "";
let captchaSiteKey = "";
let turnstileWidgetId = null;
let turnstileLoader = null;

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
  captchaWidget.innerHTML = "";
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
    copy_variant: selectedCopyIndex + 1,
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

function getRank(score) {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
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
    rank: getRank(total),
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

function renderResult(result) {
  const score = result.scores;
  const valueRange = result.valueRange;
  const route = result.route;
  const rationales = generateRationales(score);
  const next = nextAction(route, valueRange);

  scoreEl.innerHTML = `
    <p class="score-label">Patent Value Score</p>
    <p class="score-main">${score.total}</p>
    <p class="rank">ランク ${score.rank} / 信頼度 ${valueRange.confidence}</p>
  `;

  summaryEl.innerHTML = `
    <h3>診断サマリー</h3>
    <p class="title">${result.patent.title}</p>
    <p>${generateComment(score)}</p>
    <p class="small">特許ID: ${result.patent.id} / カテゴリ: ${result.patent.category}</p>
    <p class="small">出願: ${result.patent.filingDate} / 登録: ${result.patent.registrationDate}</p>
    <p class="small">応答: ${result.meta?.mode || "api"} / キャッシュ: ${result.meta?.cacheHit ? "hit" : "miss"}</p>
    <p class="small"><a href="${result.patent.officialUrl}" target="_blank" rel="noopener noreferrer">J-PlatPatで確認</a></p>
  `;

  valueEl.innerHTML = `
    <h3>価値レンジ（概算）</h3>
    <p class="title">${yenRangeLabel(valueRange.low)} 〜 ${yenRangeLabel(valueRange.high)}</p>
    <p>${valueRange.reason}</p>
  `;

  routeEl.innerHTML = `
    <h3>向いている収益化手段</h3>
    <p class="title">${route.title}</p>
    <p>${route.body}</p>
  `;

  nextEl.innerHTML = `
    <h3>次の一手</h3>
    <p>${next}</p>
  `;

  reasonsEl.innerHTML = `
    <h3>評価根拠（公開範囲）</h3>
    <ul>${rationales.map((text) => `<li>${text}</li>`).join("")}</ul>
  `;

  gatedEl.innerHTML = `
    <h3>会員向け詳細（非表示）</h3>
    <div class="gated-list">
      <p>・影響度の年次推移グラフ</p>
      <p>・候補企業リスト（用途一致順）</p>
      <p>・売却/ライセンス条件の比較表</p>
      <p>・交渉前チェックリスト</p>
    </div>
    <p class="small">詳細はPatentRevenue登録後に確認できます。</p>
  `;

  joinLink.href = buildJoinUrl(result);
  ctaNote.textContent = "登録導線には source=patent-value-check と診断IDを付与します。";
}

function showResultScreen() {
  screenResult.classList.remove("hidden");
  screenResult.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showInputScreen() {
  screenResult.classList.add("hidden");
  screenInput.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyHeroCopy(index) {
  const i = clamp(index, 0, heroCopies.length - 1);
  selectedCopyIndex = i;
  const copy = heroCopies[i];
  heroTitle.textContent = copy.title;
  heroLead.textContent = copy.lead;

  document.querySelectorAll(".copy-btn").forEach((button) => {
    const isActive = Number(button.getAttribute("data-copy")) === i;
    button.classList.toggle("active", isActive);
  });
}

document.querySelectorAll(".copy-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const index = Number(button.getAttribute("data-copy") || 0);
    applyHeroCopy(index);
    trackEvent("hero_copy_change", { to: index + 1 });
  });
});

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

applyHeroCopy(0);
trackEvent("lp_view", { page: "home" });

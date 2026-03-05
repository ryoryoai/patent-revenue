const variants = {
  current: {
    label: "Current",
    eyebrow: "Patent Value Check",
    heroTitle: "あなたの特許の価値を、すぐに診断します",
    heroLead: "公開情報をもとに、Patent Value Scoreと評価根拠を提示。詳細分析と収益化ルートはPatentRevenueで確認できます。",
    badges: ["無料", "30秒目安", "公開情報のみ参照"],
    inputTitle: "無料診断を開始",
    inputLead: "特許番号・公開番号・キーワードのいずれかを入力してください。",
    diagnoseButton: "価値を診断する",
    resultLead: "まずは主要指標のみ公開します。詳細分析と収益化導線は会員向けです。",
    joinText: "PatentRevenueで詳細分析と収益化ルートを見る",
    ctaNote: "登録導線には `source=patent-value-check` などの計測パラメータを付与します。",
    caution: "このスコアは公開情報にもとづく目安で、取引価格や成約を保証するものではありません。法的助言を目的とするものではありません。"
  },
  a: {
    label: "A",
    eyebrow: "A案 / クリーン＆プロ",
    heroTitle: "特許価値の健康診断を、説明可能な形で。",
    heroLead: "診断機関のように、透明性と再現性を重視。登録前に要点を提示し、詳細は会員画面で深掘りします。",
    badges: ["説明可能", "守秘配慮", "専門家連携"],
    inputTitle: "診断入力（最小構成）",
    inputLead: "入力は最小限。判断に必要な情報だけ追加して精度を段階的に上げます。",
    diagnoseButton: "スコアを診断する",
    resultLead: "ティザーでは重要指標のみ提示。詳細内訳は会員向けで確認できます。",
    joinText: "PatentRevenueで詳細分析を確認する",
    ctaNote: "信頼性の高い評価フローに接続します。source/result_idを引き継ぎます。",
    caution: "本診断は概算です。個別事情（権利範囲、市場実装、交渉条件）により評価は変動します。"
  },
  b: {
    label: "B",
    eyebrow: "B案 / キャッシュ化訴求",
    heroTitle: "眠っている特許を、次の売上機会へ。",
    heroLead: "維持費だけ払っている特許を資産として見直す入口です。まずは価値レンジと打ち手の方向性を可視化します。",
    badges: ["資産化視点", "意思決定を高速化", "無料トライアル"],
    inputTitle: "特許資産チェックを開始",
    inputLead: "特許番号かキーワードを入れるだけ。経営判断に使える初期判断を返します。",
    diagnoseButton: "資産価値をチェック",
    resultLead: "まずは価値の手触りを提示。収益化ルートは登録後に具体化します。",
    joinText: "PatentRevenueで買い手探索を始める",
    ctaNote: "流入計測付きで登録導線に接続します（source=patent-value-check）。",
    caution: "本表示は意思決定の補助情報です。価格・成約・法的結果を保証するものではありません。"
  }
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

const diagnosisForm = document.getElementById("diagnosis-form");
const screenInput = document.getElementById("screen-input");
const screenResult = document.getElementById("screen-result");
const scoreEl = document.getElementById("teaser-score");
const summaryEl = document.getElementById("teaser-summary");
const reasonsEl = document.getElementById("teaser-reasons");
const gatedEl = document.getElementById("teaser-gated");
const joinLink = document.getElementById("join-link");
const reportSignupBtn = document.getElementById("report-signup");
const backToInputBtn = document.getElementById("back-to-input");

const heroEyebrow = document.getElementById("hero-eyebrow");
const heroTitle = document.getElementById("hero-title");
const heroLead = document.getElementById("hero-lead");
const badge1 = document.getElementById("badge-1");
const badge2 = document.getElementById("badge-2");
const badge3 = document.getElementById("badge-3");
const inputTitle = document.getElementById("input-title");
const inputLead = document.getElementById("input-lead");
const diagnoseBtn = document.getElementById("diagnose-btn");
const resultLead = document.getElementById("result-lead");
const ctaNote = document.getElementById("cta-note");
const cautionText = document.getElementById("caution-text");

let latestResult = null;
let currentVariant = "current";

function trackEvent(name, payload = {}) {
  window.dataLayer = window.dataLayer || [];
  const event = {
    event: name,
    ts: new Date().toISOString(),
    variant: currentVariant,
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

async function fetchPatentInfo(query) {
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
  localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), payload }));
  return payload;
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
    { key: "impact", label: "影響度", val: scores.impact },
    { key: "breadth", label: "権利の広さ", val: scores.breadth },
    { key: "strength", label: "実務上の強さ", val: scores.strength },
    { key: "monetization", label: "収益化の近さ", val: scores.monetization }
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

function buildJoinUrl(result) {
  const params = new URLSearchParams({
    source: "patent-value-check",
    patent_id: result.patent.id,
    result_id: result.resultId,
    variant: currentVariant
  });
  return `https://patent-revenue.iprich.jp/?${params.toString()}#licence`;
}

function renderResult(result) {
  const score = result.scores;
  const rationales = generateRationales(score);

  scoreEl.innerHTML = `
    <p class="score-label">Patent Value Score</p>
    <p class="score-main">${score.total}</p>
    <p class="rank">ランク ${score.rank}</p>
  `;

  summaryEl.innerHTML = `
    <h3>所見</h3>
    <p class="title">${result.patent.title}</p>
    <p>${generateComment(score)}</p>
    <p class="small">特許ID: ${result.patent.id} / カテゴリ: ${result.patent.category}</p>
    <p class="small"><a href="${result.patent.officialUrl}" target="_blank" rel="noopener noreferrer">J-PlatPatで確認</a></p>
  `;

  reasonsEl.innerHTML = `
    <h3>評価根拠（見出し）</h3>
    <ul>${rationales.map((text) => `<li>${text}</li>`).join("")}</ul>
  `;

  gatedEl.innerHTML = `
    <h3>会員向け詳細（非表示）</h3>
    <div class="gated-list">
      <p>・引用推移チャート</p>
      <p>・関連企業リスト（上位20社）</p>
      <p>・想定収益化ルート（売却/ライセンス）</p>
      <p>・案件化優先順位</p>
    </div>
    <p class="small">詳細はPatentRevenue会員向け画面で確認できます。</p>
  `;

  joinLink.href = buildJoinUrl(result);
}

function showResultScreen() {
  screenInput.classList.add("hidden");
  screenResult.classList.remove("hidden");
  screenResult.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showInputScreen() {
  screenResult.classList.add("hidden");
  screenInput.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyVariant(variantKey) {
  const key = variants[variantKey] ? variantKey : "current";
  currentVariant = key;
  const setting = variants[key];

  document.body.dataset.variant = key;
  heroEyebrow.textContent = setting.eyebrow;
  heroTitle.textContent = setting.heroTitle;
  heroLead.textContent = setting.heroLead;
  badge1.textContent = setting.badges[0];
  badge2.textContent = setting.badges[1];
  badge3.textContent = setting.badges[2];
  inputTitle.textContent = setting.inputTitle;
  inputLead.textContent = setting.inputLead;
  diagnoseBtn.textContent = setting.diagnoseButton;
  resultLead.textContent = setting.resultLead;
  joinLink.textContent = setting.joinText;
  ctaNote.textContent = setting.ctaNote;
  cautionText.textContent = setting.caution;

  document.querySelectorAll(".variant-card").forEach((card) => {
    card.classList.toggle("active", card.getAttribute("data-variant-card") === key);
  });

  if (latestResult) {
    renderResult(latestResult);
  }
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
    window.alert("特許番号・公開番号・キーワードを入力してください。");
    return;
  }

  const submitButton = diagnosisForm.querySelector("button[type='submit']");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "診断中...";

  trackEvent("diagnosis_start", {
    query_type: normalizePatentNumber(input.query).length >= 6 ? "number" : "keyword"
  });

  try {
    const patent = await fetchPatentInfo(input.query);
    const scores = computeScores(patent, input);

    latestResult = {
      resultId: resultId(),
      input,
      patent,
      scores
    };

    renderResult(latestResult);
    showResultScreen();

    trackEvent("diagnosis_success", {
      result_id: latestResult.resultId,
      patent_id: patent.id,
      score: scores.total,
      rank: scores.rank
    });
  } catch (error) {
    console.error(error);
    window.alert("診断に失敗しました。時間をおいて再度お試しください。");
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

document.querySelectorAll(".variant-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.getAttribute("data-variant") || "current";
    applyVariant(key);
    trackEvent("variant_change", { to: key });
  });
});

const initialVariant = new URLSearchParams(window.location.search).get("design") || "current";
applyVariant(initialVariant);
trackEvent("lp_view", { page: "home" });

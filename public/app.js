const mockPatents = {
  "7091234": {
    title: "製造ライン異常検知システム",
    applicant: "株式会社ミライファクトリー",
    registrationDate: "2022-11-15",
    filingDate: "2019-02-14",
    category: "製造DX / AI",
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/"
  },
  "6810455": {
    title: "高効率熱交換モジュール",
    applicant: "東都エネルギー株式会社",
    registrationDate: "2021-06-30",
    filingDate: "2017-08-08",
    category: "エネルギー / 材料",
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/"
  },
  "7420901": {
    title: "マルチモーダル医療画像解析装置",
    applicant: "メディコアテック株式会社",
    registrationDate: "2024-03-22",
    filingDate: "2021-10-03",
    category: "医療機器 / 画像解析",
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/"
  }
};

const categoryRoyalty = {
  "製造DX / AI": [0.012, 0.045],
  "エネルギー / 材料": [0.01, 0.035],
  "医療機器 / 画像解析": [0.02, 0.06],
  "通信 / IoT": [0.012, 0.04],
  "ソフトウェア": [0.01, 0.05],
  default: [0.01, 0.04]
};

const salesRangeMap = {
  lt100m: { min: 30_000_000, max: 100_000_000, label: "〜1億円" },
  "100m_1b": { min: 100_000_000, max: 1_000_000_000, label: "1億円〜10億円" },
  "1b_10b": { min: 1_000_000_000, max: 10_000_000_000, label: "10億円〜100億円" },
  gt10b: { min: 10_000_000_000, max: 30_000_000_000, label: "100億円以上" },
  default: { min: 10_000_000, max: 50_000_000, label: "未選択" }
};

const useStatusLabel = {
  using: "現在使っている",
  planned: "これから使う予定",
  not_using: "使っていない",
  "": "未選択"
};

const supportMap = {
  license: "license",
  sale: "sale",
  both: "both",
  infringement: "infringement"
};

const diagnosisForm = document.getElementById("diagnosis-form");
const registerForm = document.getElementById("register-form");

const screenInput = document.getElementById("screen-input");
const screenResult = document.getElementById("screen-result");
const screenRegister = document.getElementById("screen-register");

const summaryEl = document.getElementById("patent-summary");
const estimateEl = document.getElementById("value-estimate");
const scoreEl = document.getElementById("score-breakdown");
const actionEl = document.getElementById("next-action");
const registerResultEl = document.getElementById("register-result");

const toRegisterBtn = document.getElementById("to-register");
const backToInputBtn = document.getElementById("back-to-input");

let latestDiagnosis = null;

function normalizePatentNumber(input) {
  return (input || "")
    .replace(/特許第/g, "")
    .replace(/号/g, "")
    .replace(/[\s-]/g, "")
    .replace(/[^0-9]/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function currency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(dateString) {
  if (!dateString) return "不明";
  const dt = new Date(dateString);
  if (Number.isNaN(dt.getTime())) return "不明";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(dt);
}

function pseudoPatent(number) {
  const n = Number(number.slice(-4)) || 1234;
  const categories = ["通信 / IoT", "ソフトウェア", "製造DX / AI", "エネルギー / 材料"];
  const category = categories[n % categories.length];
  const filingYear = 2010 + (n % 14);
  const filingMonth = ((n % 12) + 1).toString().padStart(2, "0");
  const filingDay = ((n % 27) + 1).toString().padStart(2, "0");

  return {
    title: `特許第${number}号（自動取得サンプル）`,
    applicant: "取得元未連携（モック）",
    registrationDate: `${filingYear + 2}-${filingMonth}-${filingDay}`,
    filingDate: `${filingYear}-${filingMonth}-${filingDay}`,
    category,
    status: "登録",
    officialUrl: "https://www.j-platpat.inpit.go.jp/"
  };
}

async function fetchPatentInfo(normalizedNumber) {
  await new Promise((resolve) => setTimeout(resolve, 450));
  return mockPatents[normalizedNumber] || pseudoPatent(normalizedNumber);
}

function remainingYearsFromFiling(filingDate) {
  const filing = new Date(filingDate);
  if (Number.isNaN(filing.getTime())) return 5;

  const expire = new Date(filing);
  expire.setFullYear(expire.getFullYear() + 20);

  const now = new Date();
  const remainMs = expire.getTime() - now.getTime();
  const years = remainMs / (1000 * 60 * 60 * 24 * 365.25);
  return clamp(years, 0, 20);
}

function annuityFactor(rate, years) {
  return (1 - Math.pow(1 + rate, -years)) / rate;
}

function computeScores(patent, input) {
  const remainingYears = remainingYearsFromFiling(patent.filingDate);
  const rightsFromTerm = (remainingYears / 20) * 65;
  const rightsFromStatus = patent.status === "登録" ? 20 : 8;
  const rightsFromBreadth = (Number(patent.category.length % 10) / 10) * 15;
  const rightsScore = clamp(Math.round(rightsFromTerm + rightsFromStatus + rightsFromBreadth), 0, 100);

  const sales = salesRangeMap[input.salesRange] || salesRangeMap.default;
  const logScale = clamp(Math.log10(sales.max) - 6.5, 0, 5);
  const marketFromSales = (logScale / 5) * 70;
  const marketFromCategory = patent.category.includes("医療") ? 25 : 18;
  const marketScore = clamp(Math.round(marketFromSales + marketFromCategory), 0, 100);

  const useScoreMap = {
    using: 80,
    planned: 68,
    not_using: 55,
    "": 50
  };
  const inputCompleteness = [input.useStatus, input.salesRange, input.contribution].filter(Boolean).length;
  const tradability = clamp(useScoreMap[input.useStatus || ""] + inputCompleteness * 6, 0, 100);

  const total = Math.round(rightsScore * 0.4 + marketScore * 0.35 + tradability * 0.25);

  return {
    total,
    rights: rightsScore,
    market: marketScore,
    tradability
  };
}

function computeEstimate(patent, input, scores) {
  const sales = salesRangeMap[input.salesRange] || salesRangeMap.default;
  const contribution = Number(input.contribution || 0.1);
  const royalty = categoryRoyalty[patent.category] || categoryRoyalty.default;

  const remaining = remainingYearsFromFiling(patent.filingDate);
  const years = clamp(Math.round(remaining), 3, 7);

  const useRisk = input.useStatus === "not_using" ? 0.85 : 1;
  const confidencePenalty = scores.total < 60 ? 0.85 : 1;

  const lowAnnual = sales.min * royalty[0] * contribution * 0.8;
  const highAnnual = sales.max * royalty[1] * contribution * 1.15;

  const lowPv = lowAnnual * annuityFactor(0.22, years) * useRisk * confidencePenalty;
  const highPv = highAnnual * annuityFactor(0.15, years) * useRisk;

  const roundedLow = Math.round(lowPv / 10000) * 10000;
  const roundedHigh = Math.max(roundedLow + 100000, Math.round(highPv / 10000) * 10000);
  const mid = Math.round(((roundedLow + roundedHigh) / 2) / 10000) * 10000;

  let confidence = "低";
  if (scores.total >= 70) confidence = "高";
  else if (scores.total >= 55) confidence = "中";

  const reasons = [];
  if (!input.salesRange) reasons.push("売上レンジ未入力のため、レンジ幅が広くなっています。");
  if (!input.contribution) reasons.push("寄与度が未入力のため、標準値10%で計算しています。");
  if (!input.useStatus) reasons.push("実施状況が未入力のため、取引可能性を保守的に評価しています。");
  if (reasons.length === 0) reasons.push("主要3項目が入力されているため、推定の信頼性は相対的に高めです。");

  return {
    low: roundedLow,
    high: roundedHigh,
    mid,
    confidence,
    years,
    reasons
  };
}

function recommendAction(scores, input) {
  if (input.useStatus === "using" && scores.market >= 60) {
    return {
      type: "license",
      title: "ライセンス向き",
      reasons: ["実施実績があり、導入先への説明がしやすい", "市場性スコアが高く、複数社提案に向く"]
    };
  }

  if (input.useStatus === "not_using" && scores.rights >= 60) {
    return {
      type: "sale",
      title: "売却向き",
      reasons: ["自社未活用のため、譲渡での早期現金化と相性が良い", "権利スコアが一定以上で買い手に提示しやすい"]
    };
  }

  if (scores.rights >= 75 && scores.market >= 70) {
    return {
      type: "both",
      title: "売却 + ライセンス併用向き",
      reasons: ["権利と市場のバランスが良く、複線で打診可能", "条件比較で期待値を最大化しやすい"]
    };
  }

  return {
    type: "infringement",
    title: "侵害発見支援も検討",
    reasons: ["追加調査で実施企業を特定すると価値が上がる可能性", "取引前に用途整理を進めると成約率が上がる"]
  };
}

function renderDiagnosis(diagnosis) {
  const { patent, estimate, scores, action, input } = diagnosis;
  const officialLabel = patent.officialUrl.includes("j-platpat") ? "J-PlatPatで確認" : "公式ソースを確認";

  summaryEl.innerHTML = `
    <h3>特許要約</h3>
    <p class="title">${patent.title}</p>
    <p>特許番号: <strong>特許第${diagnosis.normalizedPatentNumber}号</strong></p>
    <p>出願人: ${patent.applicant}</p>
    <p>登録日: ${formatDate(patent.registrationDate)}</p>
    <p>カテゴリ: ${patent.category}</p>
    <p class="source"><a href="${patent.officialUrl}" target="_blank" rel="noopener noreferrer">${officialLabel}</a></p>
  `;

  estimateEl.innerHTML = `
    <h3>価値レンジ（概算）</h3>
    <p class="range">${currency(estimate.low)} 〜 ${currency(estimate.high)}</p>
    <p>信頼度: <strong>${estimate.confidence}</strong> / 想定評価期間: ${estimate.years}年</p>
    <ul>
      ${estimate.reasons.map((r) => `<li>${r}</li>`).join("")}
    </ul>
    <p class="small">算出式(簡易): 売上 × ロイヤルティ率 × 寄与度 を割引現在価値化</p>
  `;

  scoreEl.innerHTML = `
    <h3>スコア（0〜100）</h3>
    <p class="score-main">総合 ${scores.total}</p>
    <p>権利の強さ: ${scores.rights}</p>
    <p>市場性: ${scores.market}</p>
    <p>取引しやすさ: ${scores.tradability}</p>
    <p class="small">入力状態: 実施状況「${useStatusLabel[input.useStatus || ""]}」 / 売上「${(salesRangeMap[input.salesRange] || salesRangeMap.default).label}」</p>
  `;

  actionEl.innerHTML = `
    <h3>次の一手</h3>
    <p class="title">${action.title}</p>
    <ul>
      ${action.reasons.map((r) => `<li>${r}</li>`).join("")}
    </ul>
    <p class="small">登録・相談は無料、成約時に成功報酬15%（Patent Value Check想定）</p>
  `;
}

function fillRegisterForm(diagnosis) {
  const { patent, estimate, action, normalizedPatentNumber } = diagnosis;

  document.getElementById("reg-patent-number").value = `特許第${normalizedPatentNumber}号`;
  document.getElementById("reg-title").value = patent.title;
  document.getElementById("reg-category").value = patent.category;
  document.getElementById("reg-support").value = supportMap[action.type] || "both";
  document.getElementById("reg-price").value = estimate.mid;
  document.getElementById("reg-note").value = `診断結果: ${currency(estimate.low)}〜${currency(estimate.high)} / 信頼度 ${estimate.confidence}`;

  const buttons = document.querySelectorAll("[data-price-preset]");
  buttons.forEach((btn) => {
    btn.onclick = () => {
      const preset = btn.getAttribute("data-price-preset");
      const priceInput = document.getElementById("reg-price");
      if (preset === "low") priceInput.value = estimate.low;
      if (preset === "mid") priceInput.value = estimate.mid;
      if (preset === "high") priceInput.value = estimate.high;
    };
  });
}

function show(screen) {
  [screenInput, screenResult, screenRegister].forEach((node) => node.classList.add("hidden"));
  screen.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

diagnosisForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fd = new FormData(diagnosisForm);
  const input = {
    patentNumber: String(fd.get("patentNumber") || "").trim(),
    useStatus: String(fd.get("useStatus") || ""),
    salesRange: String(fd.get("salesRange") || ""),
    contribution: String(fd.get("contribution") || "")
  };

  const normalizedPatentNumber = normalizePatentNumber(input.patentNumber);

  if (normalizedPatentNumber.length < 6) {
    window.alert("特許番号は6桁以上で入力してください（例: 特許第7091234号）");
    return;
  }

  const submitButton = diagnosisForm.querySelector("button[type='submit']");
  const originalText = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "診断中...";

  try {
    const patent = await fetchPatentInfo(normalizedPatentNumber);
    const scores = computeScores(patent, input);
    const estimate = computeEstimate(patent, input, scores);
    const action = recommendAction(scores, input);

    latestDiagnosis = {
      input,
      normalizedPatentNumber,
      patent,
      scores,
      estimate,
      action
    };

    renderDiagnosis(latestDiagnosis);
    show(screenResult);
  } catch (error) {
    console.error(error);
    window.alert("診断中にエラーが発生しました。時間をおいて再度お試しください。");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
});

backToInputBtn.addEventListener("click", () => {
  show(screenInput);
});

toRegisterBtn.addEventListener("click", () => {
  if (!latestDiagnosis) return;
  fillRegisterForm(latestDiagnosis);
  registerResultEl.classList.add("hidden");
  show(screenRegister);
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fd = new FormData(registerForm);
  const payload = Object.fromEntries(fd.entries());

  registerResultEl.classList.remove("hidden");
  registerResultEl.innerHTML = `
    <h3>仮登録を受け付けました（デモ）</h3>
    <p>実運用ではこの内容を連携先の登録API/フォームへ送信します。</p>
    <pre>${JSON.stringify(payload, null, 2)}</pre>
  `;

  registerResultEl.scrollIntoView({ behavior: "smooth", block: "center" });
});

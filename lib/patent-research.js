/**
 * 2層構成 特許リサーチ・評価エンジン
 *
 * 1層目: 文献解析層 — JPO API + LLMで「発明の概要」「強み」「ライセンス可能分野」を生成
 * 2層目: 事業化評価層 — 料率推定、収益法による可能額4区分、収益化手段スコアリング、次の一手
 *
 * 出力:
 *   result.report     — PDF/メール向け後方互換テキスト
 *   result.structured  — 構造化出力 (confidence/evidence/basis付き)
 */
const { fetchComprehensiveData, isPatentApiAvailable } = require("./patent-api");
const { callOpenAiApi, lookupPatentWithLlm } = require("./llm");

// ══════════════════════════════════════════════
// 定数テーブル
// ══════════════════════════════════════════════

// ── 業界別ベースレンジ ──
const INDUSTRY_BASE_RANGE = {
  "製造DX / AI": [0.012, 0.04],
  "エネルギー / 材料": [0.01, 0.035],
  "医療機器 / 画像解析": [0.015, 0.05],
  "通信 / IoT": [0.012, 0.04],
  "ソフトウェア": [0.015, 0.055],
  default: [0.01, 0.04]
};

// ── 業界別市場規模データ (日本市場, 円) ──
const INDUSTRY_MARKET_DATA = {
  "ソフトウェア": {
    marketSizeJpy: 13_000_000_000_000,
    addressableRatio: 0.0008,
    adoptionProbability: 0.15
  },
  "製造DX / AI": {
    marketSizeJpy: 3_500_000_000_000,
    addressableRatio: 0.001,
    adoptionProbability: 0.12
  },
  "エネルギー / 材料": {
    marketSizeJpy: 18_000_000_000_000,
    addressableRatio: 0.0003,
    adoptionProbability: 0.10
  },
  "医療機器 / 画像解析": {
    marketSizeJpy: 3_200_000_000_000,
    addressableRatio: 0.001,
    adoptionProbability: 0.12
  },
  "通信 / IoT": {
    marketSizeJpy: 15_000_000_000_000,
    addressableRatio: 0.0005,
    adoptionProbability: 0.12
  }
};

// ── カテゴリ別ライセンス可能分野 ──
const CATEGORY_FIELDS = {
  "ソフトウェア": [
    { field: "情報処理・IT", baseScore: 0.80, keywords: /プログラム|情報処理|データ|アルゴリズム/i },
    { field: "SaaS・クラウドサービス", baseScore: 0.55, keywords: /クラウド|サーバ|ネットワーク|配信/i },
    { field: "組込みシステム", baseScore: 0.40, keywords: /組込|制御|ファームウェア|マイコン/i },
    { field: "金融・フィンテック", baseScore: 0.30, keywords: /金融|決済|取引|ブロックチェーン/i }
  ],
  "製造DX / AI": [
    { field: "製造業", baseScore: 0.80, keywords: /製造|加工|組立|生産/i },
    { field: "ロボティクス・FA", baseScore: 0.65, keywords: /ロボット|自動化|ＦＡ|アーム/i },
    { field: "品質検査・計測", baseScore: 0.55, keywords: /検査|計測|品質|測定/i },
    { field: "物流・サプライチェーン", baseScore: 0.35, keywords: /物流|搬送|倉庫|配送/i }
  ],
  "エネルギー / 材料": [
    { field: "エネルギー・電力", baseScore: 0.80, keywords: /電池|太陽|発電|蓄電|エネルギー/i },
    { field: "化学・素材", baseScore: 0.65, keywords: /材料|化合物|触媒|樹脂|合金/i },
    { field: "環境・リサイクル", baseScore: 0.45, keywords: /環境|リサイクル|廃棄|浄化/i },
    { field: "建設・インフラ", baseScore: 0.35, keywords: /建築|構造|コンクリート|土木/i }
  ],
  "医療機器 / 画像解析": [
    { field: "医療機器メーカー", baseScore: 0.80, keywords: /医療|診断|治療|手術|内視鏡/i },
    { field: "画像処理・AI診断", baseScore: 0.65, keywords: /画像|解析|検出|認識|ＡＩ/i },
    { field: "ヘルスケアIT", baseScore: 0.50, keywords: /電子カルテ|遠隔|モニタリング|健康/i },
    { field: "製薬・バイオ", baseScore: 0.35, keywords: /薬|バイオ|抗体|遺伝子/i }
  ],
  "通信 / IoT": [
    { field: "通信機器・インフラ", baseScore: 0.80, keywords: /通信|基地局|アンテナ|無線/i },
    { field: "IoT・センサ", baseScore: 0.65, keywords: /センサ|IoT|モニタリング|計測/i },
    { field: "自動車・モビリティ", baseScore: 0.45, keywords: /車両|自動運転|ナビ|車載/i },
    { field: "スマートホーム", baseScore: 0.30, keywords: /家電|住宅|照明|空調/i }
  ]
};

// ── 強みの評価軸 ──
const STRENGTH_AXES = [
  { key: "cost", label: "コスト削減", keywords: /コスト|低減|安価|削減|節約/i },
  { key: "speed", label: "速度・効率", keywords: /高速|効率|迅速|短縮|リアルタイム/i },
  { key: "accuracy", label: "精度向上", keywords: /精度|正確|高精度|誤差|分解能/i },
  { key: "durability", label: "耐久性", keywords: /耐久|長寿命|劣化|信頼性|堅牢/i },
  { key: "safety", label: "安全性", keywords: /安全|保護|防止|リスク|事故/i },
  { key: "scalability", label: "量産性・拡張性", keywords: /量産|拡張|スケール|大規模|汎用/i },
  { key: "compatibility", label: "互換性", keywords: /互換|標準|接続|インターフェース|対応/i },
  { key: "energy", label: "省エネルギー", keywords: /省エネ|低消費|電力|エコ|環境負荷/i }
];

// ── IPC→カテゴリ マッピング ──
const IPC_CATEGORY_MAP = {
  G06: "ソフトウェア",
  G10: "通信 / IoT",
  H04: "通信 / IoT",
  H01: "エネルギー / 材料",
  H02: "エネルギー / 材料",
  B25: "製造DX / AI",
  B23: "製造DX / AI",
  A61: "医療機器 / 画像解析",
  G16: "医療機器 / 画像解析",
  C01: "エネルギー / 材料",
  C08: "エネルギー / 材料"
};

/**
 * 特許番号からIPC分類を使ってカテゴリを推定する
 */
function inferCategory(patent) {
  if (patent.category) return patent.category;

  const ipc = patent.ipcClassification || patent._jpoRaw?.ipcClassification || "";
  if (ipc) {
    const prefix = ipc.slice(0, 3).toUpperCase();
    for (const [key, cat] of Object.entries(IPC_CATEGORY_MAP)) {
      if (prefix.startsWith(key)) return cat;
    }
  }

  const title = (patent.title || "").toLowerCase();
  if (/ai|機械学習|深層学習|ニューラル|推論/.test(title)) return "製造DX / AI";
  if (/通信|ネットワーク|無線|iot|センサ/.test(title)) return "通信 / IoT";
  if (/医療|診断|画像|mri|ct/.test(title)) return "医療機器 / 画像解析";
  if (/電池|太陽|材料|触媒|エネルギー/.test(title)) return "エネルギー / 材料";
  if (/プログラム|ソフト|アプリ|処理装置|情報処理/.test(title)) return "ソフトウェア";

  return "ソフトウェア";
}

// ══════════════════════════════════════════════
// LLMによる不足メトリクス補完
// ══════════════════════════════════════════════

/**
 * JPO実データをもとにLLMで不足メトリクスを推定する
 */
async function enrichMetricsWithLlm(patent) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_API_KEY || OPENAI_API_KEY === "sk-xxx") return;

  let claimsSection = "";
  if (patent.claimsText) {
    const claimsPreview = patent.claimsText.length > 1500
      ? patent.claimsText.slice(0, 1500) + "…（以下省略）"
      : patent.claimsText;
    claimsSection = `\n## 請求項テキスト (Google Patents取得)\n${claimsPreview}\n`;
  }

  const prompt = `あなたは特許分析の専門家です。以下のJPO公式データ${patent.claimsText ? "および請求項テキスト" : ""}に基づき、不足している5つのメトリクスを推定してJSON形式で出力してください。

## JPO実データ
- 発明の名称: ${patent.title}
- IPC分類: ${patent.ipcClassification || "-"}
- 出願人: ${patent.applicant}（${patent.applicantType}）
- 推定カテゴリ: ${patent.category}
- 請求項数: ${patent.metrics?.claimCount || 0}
- 被引用文献数: ${patent.metrics?.citations || 0}
- 残存年数: ${patent.remainingYears ? patent.remainingYears.toFixed(1) + "年" : "不明"}
- ステータス: ${patent.status}
- 出願日: ${patent.filingDate}
${claimsSection}
## 推定対象
1. **marketPlayers** (3-40): この技術分野で活動する主要企業の推定数。
2. **filingDensity** (10-90): この技術分野の出願密度。高い=活発。
3. **citationGrowth** (-10〜30): 引用の成長トレンド。
4. **familySize** (1-12): 推定パテントファミリーサイズ。
5. **classRank** (0-100): 同IPC分類内でのランク。高い=上位。

## 出力形式
{ "marketPlayers": 数値, "filingDensity": 数値, "citationGrowth": 数値, "familySize": 数値, "classRank": 数値 }

JSONのみ出力。数値はすべて整数。`;

  try {
    const rawText = await callOpenAiApi(prompt, { model: "gpt-5.4", maxTokens: 256 });
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const estimated = JSON.parse(jsonMatch[0]);
    if (!patent.metrics) patent.metrics = {};

    const clamp = (val, min, max) => Math.max(min, Math.min(max, Math.round(Number(val))));

    if (estimated.marketPlayers != null) patent.metrics.marketPlayers = clamp(estimated.marketPlayers, 0, 100);
    if (estimated.filingDensity != null) patent.metrics.filingDensity = clamp(estimated.filingDensity, 0, 100);
    if (estimated.citationGrowth != null) patent.metrics.citationGrowth = clamp(estimated.citationGrowth, -20, 50);
    if (estimated.familySize != null) patent.metrics.familySize = clamp(estimated.familySize, 0, 20);
    if (estimated.classRank != null) patent.metrics.classRank = clamp(estimated.classRank, 0, 100);

    console.log(`[research] LLM enriched metrics: marketPlayers=${patent.metrics.marketPlayers}, filingDensity=${patent.metrics.filingDensity}, citationGrowth=${patent.metrics.citationGrowth}, familySize=${patent.metrics.familySize}, classRank=${patent.metrics.classRank}`);
  } catch (error) {
    console.warn("[research] LLM metrics enrichment failed, using defaults:", error.message);
  }
}

// ══════════════════════════════════════════════
// 2層目: 事業化評価層 — ルールベースの品質評価
// ══════════════════════════════════════════════

function scoreLegalStatus(patent) {
  if (patent.status === "登録") return 1.0;
  if (patent.status === "出願中") return 0.5;
  if (patent.status === "消滅") return 0.1;
  return 0.3;
}

function scoreRemainingTerm(patent) {
  const years = patent.remainingYears || 0;
  if (years >= 15) return 1.0;
  if (years >= 10) return 0.8;
  if (years >= 5) return 0.5;
  if (years >= 2) return 0.3;
  return 0.1;
}

function scoreClaimStrength(patent) {
  const claims = patent.metrics?.claimCount || 0;
  if (claims >= 15) return 1.0;
  if (claims >= 10) return 0.8;
  if (claims >= 5) return 0.6;
  if (claims >= 1) return 0.4;
  return 0.2;
}

function scoreExperimentalEvidence(patent) {
  const citations = patent.metrics?.citations || 0;
  if (citations >= 10) return 1.0;
  if (citations >= 5) return 0.7;
  if (citations >= 2) return 0.5;
  if (citations >= 1) return 0.3;
  return 0.2;
}

function scoreDesignAroundDifficulty(patent) {
  const claims = patent.metrics?.claimCount || 0;
  const family = patent.metrics?.familySize || 0;
  const combined = claims * 0.6 + family * 4;
  if (combined >= 20) return 1.0;
  if (combined >= 12) return 0.7;
  if (combined >= 5) return 0.5;
  return 0.3;
}

function scoreMarketFit(patent) {
  const players = patent.metrics?.marketPlayers || 0;
  const density = patent.metrics?.filingDensity || 50;
  if (players >= 20 && density >= 60) return 1.0;
  if (players >= 10) return 0.7;
  if (players >= 5) return 0.5;
  return 0.3;
}

/**
 * 品質補正係数
 * quality_multiplier = 0.6 + 0.8 × (weighted sum of 6 factors)
 */
function computeQualityMultiplier(patent) {
  const legal = scoreLegalStatus(patent);
  const term = scoreRemainingTerm(patent);
  const claim = scoreClaimStrength(patent);
  const evidence = scoreExperimentalEvidence(patent);
  const designAround = scoreDesignAroundDifficulty(patent);
  const market = scoreMarketFit(patent);

  const weightedSum =
    0.25 * legal +
    0.20 * term +
    0.20 * claim +
    0.15 * evidence +
    0.10 * designAround +
    0.10 * market;

  return {
    multiplier: 0.6 + 0.8 * weightedSum,
    factors: { legal, term, claim, evidence, designAround, market }
  };
}

function computeRoyaltyRange(patent) {
  const category = inferCategory(patent);
  const baseRange = INDUSTRY_BASE_RANGE[category] || INDUSTRY_BASE_RANGE.default;
  const { multiplier, factors } = computeQualityMultiplier(patent);

  return {
    low: baseRange[0] * multiplier,
    high: baseRange[1] * multiplier,
    category,
    multiplier,
    factors
  };
}

// ── 収益法によるライセンス可能額の推定 ──

/**
 * 収益法 (relief-from-royalty) で可能額を推定し4区分に分類する
 *
 * license_value = target_sales × addressable_ratio × adoption_prob
 *                 × midpoint(royalty_rate) × exclusivity × enforceability
 *                 × remaining_years_factor
 */
function computeValueBracketRevenue(royaltyRange, patent) {
  const category = royaltyRange.category;
  const marketData = INDUSTRY_MARKET_DATA[category] || INDUSTRY_MARKET_DATA["ソフトウェア"];
  const midRate = (royaltyRange.low + royaltyRange.high) / 2;
  const remaining = patent.remainingYears || 0;

  // 独占性係数: ファミリーサイズと設計回避困難度に基づく
  const family = patent.metrics?.familySize || 0;
  const claims = patent.metrics?.claimCount || 0;
  const exclusivityFactor = Math.min(1.5, 0.5 + family * 0.08 + claims * 0.03);

  // 権利執行可能性: 法的状態と請求項の強さに基づく
  const legalScore = scoreLegalStatus(patent);
  const claimScore = scoreClaimStrength(patent);
  const enforceabilityFactor = 0.3 + 0.7 * (legalScore * 0.6 + claimScore * 0.4);

  // 残存年数ファクター: 将来収益の現在価値的な補正 (割引率5%)
  const discountRate = 0.05;
  const yearsToUse = Math.min(remaining, 15);
  const remainingYearsFactor = yearsToUse > 0
    ? (1 - Math.pow(1 + discountRate, -yearsToUse)) / discountRate / yearsToUse * yearsToUse
    : 0;

  const annualValue =
    marketData.marketSizeJpy *
    marketData.addressableRatio *
    marketData.adoptionProbability *
    midRate *
    exclusivityFactor *
    enforceabilityFactor;

  const totalValue = annualValue * remainingYearsFactor;

  let bracket, reason;
  if (totalValue >= 1_000_000_000) {
    bracket = "10億円以上";
    reason = `${category}分野の市場規模（約${Math.round(marketData.marketSizeJpy / 1_000_000_000_000)}兆円）に対し、技術的優位性が高く広い権利範囲を持つため、大規模なライセンス収益が見込まれます。推定ライセンス総額は約${Math.round(totalValue / 100_000_000)}億円です。`;
  } else if (totalValue >= 100_000_000) {
    bracket = "1億円以上 10億円未満";
    reason = `${category}分野において一定の技術的強みと市場適合性があり、複数のライセンス先からの収益が見込まれます。推定ライセンス総額は約${Math.round(totalValue / 10_000_000) / 10}億円です。`;
  } else if (totalValue >= 10_000_000) {
    bracket = "1,000万円以上 1億円未満";
    reason = `限定的な市場セグメントでの活用可能性があり、特定企業へのライセンスによる収益が期待できます。推定ライセンス総額は約${Math.round(totalValue / 1_000_000)}百万円です。`;
  } else {
    bracket = "1,000万円未満";
    reason = "権利範囲や残存年数に課題があり、収益化には追加的な戦略が必要です。";
  }

  return {
    bracket,
    reason,
    estimatedValue: Math.round(totalValue),
    method: "revenue",
    components: {
      marketSizeJpy: marketData.marketSizeJpy,
      addressableRatio: marketData.addressableRatio,
      adoptionProbability: marketData.adoptionProbability,
      midRoyaltyRate: midRate,
      exclusivityFactor: Math.round(exclusivityFactor * 1000) / 1000,
      enforceabilityFactor: Math.round(enforceabilityFactor * 1000) / 1000,
      remainingYearsFactor: Math.round(remainingYearsFactor * 100) / 100,
      annualValue: Math.round(annualValue),
      yearsUsed: yearsToUse
    }
  };
}

// ── ライセンス可能分野のスコアリング ──

/**
 * カテゴリ + タイトル/請求項キーワードでフィールド別スコアを算出
 */
function scoreLicenseableFields(patent, royaltyRange) {
  const category = royaltyRange.category;
  const fields = CATEGORY_FIELDS[category] || CATEGORY_FIELDS["ソフトウェア"];
  const text = [
    patent.title || "",
    patent.claimsText || "",
    patent.descriptionText || "",
    patent.ipcClassification || ""
  ].join(" ");

  return fields.map(({ field, baseScore, keywords }) => {
    let score = baseScore;
    // キーワードマッチでスコア加算
    if (keywords.test(text)) {
      score = Math.min(0.95, score + 0.15);
    }
    // IPC分類が複数ある場合にスコア加算
    if (patent.ipcCodes && patent.ipcCodes.length > 2) {
      score = Math.min(0.95, score + 0.05);
    }

    const reason = keywords.test(text)
      ? `${field}に関連する技術用語が明細書に含まれ、IPC分類${patent.ipcClassification || "-"}と整合`
      : `${category}分野の関連領域として推定`;

    return {
      field,
      score: Math.round(score * 100) / 100,
      reason
    };
  }).sort((a, b) => b.score - a.score);
}

// ── 強みの軸評価 ──

/**
 * 明細書テキストからルールベースで強みの軸を判定する
 * LLMの回答がある場合はそちらで上書きされる
 */
function evaluateStrengthAxes(patent) {
  const text = [
    patent.title || "",
    patent.claimsText || "",
    patent.descriptionText || ""
  ].join(" ");

  return STRENGTH_AXES.map(({ key, label, keywords }) => {
    const hasMatch = keywords.test(text);
    // 数値表現の有無をチェック (比較例・実施例の根拠)
    const hasNumericEvidence = hasMatch && /\d+[%％倍]|比較例|実施例\d/.test(text);

    let level, confidence;
    if (hasNumericEvidence) {
      level = "高";
      confidence = 0.80;
    } else if (hasMatch) {
      level = "中";
      confidence = 0.55;
    } else {
      level = null;
      confidence = 0;
    }

    return level ? {
      axis: label,
      level,
      basis: hasNumericEvidence
        ? `明細書に数値的根拠あり（比較例/実施例）`
        : `明細書に関連する記述あり（推測）`,
      confidence: Math.round(confidence * 100) / 100,
      hasEvidence: hasNumericEvidence
    } : null;
  }).filter(Boolean);
}

// ── 収益化手段の数値スコアリング ──

/**
 * 各収益化手段を0-1のスコアで評価する
 */
function scoreMonetizationMethods(patent, royaltyRange) {
  const legal = scoreLegalStatus(patent);
  const claims = patent.metrics?.claimCount || 0;
  const remaining = patent.remainingYears || 0;
  const citations = patent.metrics?.citations || 0;
  const family = patent.metrics?.familySize || 0;
  const players = patent.metrics?.marketPlayers || 0;

  const methods = [
    {
      type: "ライセンス",
      score: Math.min(0.95, legal * 0.3 + Math.min(1, remaining / 15) * 0.25 + Math.min(1, players / 20) * 0.25 + Math.min(1, claims / 10) * 0.2),
      reason: legal >= 0.8 && remaining >= 5
        ? `権利が有効（残存${remaining.toFixed(1)}年）で市場プレイヤーも${players}社あり、ライセンス付与が最も有望です。`
        : `ライセンス付与の可能性を検討する価値があります。`
    },
    {
      type: "売却",
      score: Math.min(0.95, legal * 0.35 + Math.min(1, claims / 15) * 0.3 + Math.min(1, family / 5) * 0.2 + Math.min(1, citations / 10) * 0.15),
      reason: legal >= 0.8 && claims >= 5
        ? `請求項${claims}件と有効な権利状態により、売却も有力な選択肢です。`
        : `売却よりもライセンスを優先することを推奨します。`
    },
    {
      type: "製品・サービス化",
      score: Math.min(0.95, Math.min(1, remaining / 15) * 0.35 + Math.min(1, claims / 10) * 0.25 + legal * 0.2 + Math.min(1, players / 20) * 0.2),
      reason: remaining >= 10
        ? `残存年数が長く、製品・サービス化による直接的な収益化も検討できます。`
        : `製品化の検討にあたっては市場調査が必要です。`
    },
    {
      type: "共同開発・事業",
      score: Math.min(0.95, Math.min(1, claims / 10) * 0.3 + Math.min(1, remaining / 15) * 0.25 + Math.min(1, players / 20) * 0.25 + Math.min(1, family / 5) * 0.2),
      reason: claims >= 5
        ? `請求項の広さを活かした共同開発が有望です。`
        : `共同開発パートナーの探索から始めることを推奨します。`
    },
    {
      type: "訴訟",
      // 訴訟は条件が揃わない限り低く抑える
      score: Math.min(0.75,
        (citations >= 5 ? 0.15 : 0) +
        (claims >= 10 ? 0.15 : 0) +
        (legal >= 1.0 ? 0.15 : 0) +
        (family >= 3 ? 0.10 : 0) +
        (players >= 15 ? 0.10 : 0)
      ),
      reason: citations >= 5 && claims >= 10 && legal >= 1.0
        ? `一定の条件が揃っていますが、訴訟による権利行使はコストとリスクを慎重に評価する必要があります。`
        : `訴訟リスクとコストを慎重に評価する必要があります。専門家への相談を推奨します。`
    }
  ];

  // スコア順にソート
  return methods
    .map(m => ({ ...m, score: Math.round(m.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

// ── 動的な次の一手 ──

/**
 * 上位の収益化手段に連動して推奨アクションを生成する
 */
function computeNextActions(monetizationMethods, patent) {
  const topMethod = monetizationMethods[0]?.type;
  const category = patent.category || "ソフトウェア";

  // アクション候補プール
  const actionPool = {
    "ライセンス": [
      { action: "ライセンス候補先の探索", priority: 1, reason: `${category}分野で${patent.title || "当該技術"}に関連する技術を利用している企業のリストアップから始めてください。` },
      { action: "ライセンスオファーレターの送付", priority: 2, reason: "候補先が特定できたら、特許の概要と提案条件をまとめたオファーレターを作成・送付してください。" },
      { action: "弁理士・弁護士への相談", priority: 3, reason: "権利範囲の確認と交渉戦略の策定について、特許に詳しい弁理士または弁護士にご相談ください。" }
    ],
    "売却": [
      { action: "譲渡候補先の探索", priority: 1, reason: "特許売買プラットフォームや知財取引業者を通じて、買い手候補を探索してください。" },
      { action: "知財取引業者・弁理士への相談", priority: 2, reason: "譲渡価格の査定と交渉について専門家にご相談ください。" },
      { action: "特許ポートフォリオの整理", priority: 3, reason: "関連特許がある場合はパッケージ化して売却することで価値を高められます。" }
    ],
    "製品・サービス化": [
      { action: "市場調査・事業計画の策定", priority: 1, reason: "製品・サービス化の事業性を検討するため、市場調査と事業計画を策定してください。" },
      { action: "開発業者への相談", priority: 2, reason: "技術的な実現可能性と開発コストについて開発業者にご相談ください。" },
      { action: "資金調達・パートナー探索", priority: 3, reason: "事業化に必要な資金やパートナーの獲得を検討してください。" }
    ],
    "共同開発・事業": [
      { action: "共同開発パートナーの探索", priority: 1, reason: "オープンイノベーションプログラムや技術展示会を通じてパートナーを探索してください。" },
      { action: "オープンイノベーションの提案", priority: 2, reason: "技術の応用範囲を広げるため、複数企業とのオープンイノベーションを提案してください。" },
      { action: "弁理士・弁護士への相談", priority: 3, reason: "共同開発契約の条件設計について専門家にご相談ください。" }
    ],
    "訴訟": [
      { action: "侵害調査の実施", priority: 1, reason: "クレームチャートを作成し、侵害の蓋然性を確認してください。" },
      { action: "弁護士（知財訴訟専門）への相談", priority: 2, reason: "訴訟のコスト・リスク・期待利益について知財訴訟専門の弁護士にご相談ください。" },
      { action: "和解・ライセンス交渉の検討", priority: 3, reason: "訴訟前に和解やライセンス交渉で解決できないか検討してください。" }
    ]
  };

  const primary = actionPool[topMethod] || actionPool["ライセンス"];

  // 上位2つの方法のアクションを組み合わせ (重複除去)
  const secondMethod = monetizationMethods[1]?.type;
  const secondary = secondMethod && secondMethod !== topMethod
    ? (actionPool[secondMethod] || []).slice(0, 1)
    : [];

  const allActions = [...primary];
  for (const act of secondary) {
    if (!allActions.find(a => a.action === act.action)) {
      allActions.push({ ...act, priority: allActions.length + 1 });
    }
  }

  return allActions.slice(0, 4);
}

// ── 総合スコアとランク ──

function computeScoresAndRank(patent, royaltyRange) {
  const { factors } = computeQualityMultiplier(patent);

  const scores = {
    impact: Math.round(factors.evidence * 100),
    breadth: Math.round((factors.claim * 0.6 + factors.designAround * 0.4) * 100),
    strength: Math.round(factors.legal * 100),
    monetization: Math.round((factors.market * 0.5 + factors.term * 0.5) * 100)
  };
  scores.total = Math.round((scores.impact + scores.breadth + scores.strength + scores.monetization) / 4);

  let rank;
  if (scores.total >= 75) rank = "A";
  else if (scores.total >= 55) rank = "B";
  else if (scores.total >= 35) rank = "C";
  else rank = "D";

  return { scores, rank };
}

// ══════════════════════════════════════════════
// 1層目: 文献解析層 — LLMによる構造化分析
// ══════════════════════════════════════════════

/**
 * 構造化出力を要求するLLMプロンプト
 */
function buildStructuredResearchPrompt(patent, ruleResults) {
  const { royaltyRange: rr, valueBracket, scores, monetizationMethods, licenseableFields } = ruleResults;

  let fullTextSection = "";
  if (patent.claimsText || patent.descriptionText) {
    fullTextSection = "\n## 公報全文テキスト (Google Patents取得)\n";
    if (patent.claimsText) {
      const preview = patent.claimsText.length > 3000
        ? patent.claimsText.slice(0, 3000) + "…（以下省略）"
        : patent.claimsText;
      fullTextSection += `### 請求項\n${preview}\n\n`;
    }
    if (patent.descriptionText) {
      fullTextSection += `### 発明の詳細な説明（冒頭）\n${patent.descriptionText}\n\n`;
    }
  }

  const fieldsText = licenseableFields.map(f => `${f.field}(${f.score})`).join(", ");
  const methodsText = monetizationMethods.map(m => `${m.type}(${m.score})`).join(", ");

  return `あなたは特許評価の専門家です。以下のJPO公式データ${patent.claimsText ? "および公報全文テキスト" : ""}に基づき、構造化された評価レポートをJSON形式で出力してください。

${patent.claimsText || patent.descriptionText ? "**重要**: 公報全文テキストが提供されています。発明の具体的な技術内容を正確に把握し、請求項に記載された技術用語・構成要素を使用してください。推測ではなく根拠に基づいてください。\n" : ""}
## 特許データ (JPO API取得)
- 発明の名称: ${patent.title}
- 特許番号/登録番号: ${patent.registrationNumber || patent.id}
- 出願番号: ${patent.applicationNumber || "-"}
- 出願人: ${patent.applicant}（${patent.applicantType}）
- 出願日: ${patent.filingDate}
- 登録日: ${patent.registrationDate}
- 権利満了日: ${patent.expireDate || "-"}
- 残存年数: ${patent.remainingYears ? patent.remainingYears + "年" : "不明"}
- ステータス: ${patent.status}
- 請求項数: ${patent.metrics?.claimCount || "不明"}
- 被引用文献数: ${patent.metrics?.citations || 0}
- IPC分類: ${patent.ipcClassification || "-"}
- 推定カテゴリ: ${rr.category}
- 年金支払い状況: ${patent.lastPaymentYear ? patent.lastPaymentYear + "年目まで支払い済" : "不明"}
- 権利者: ${(patent.rightHolders || []).join("、") || patent.applicant}
${fullTextSection}
## 算出済み評価値 (ルールエンジン)
- ロイヤルティ率: ${(rr.low * 100).toFixed(2)}% 〜 ${(rr.high * 100).toFixed(2)}%
- 可能額区分: ${valueBracket.bracket} (推定${Math.round(valueBracket.estimatedValue / 10_000).toLocaleString()}万円)
- 総合スコア: ${scores.total}/100
- 対象分野: ${fieldsText}
- 収益化手段: ${methodsText}

## 出力形式 (JSON)
以下の構造化JSONを出力してください。

{
  "summary": {
    "text": "発明の概要を300字程度で記述。タイトル・分類・請求項から発明の要点を要約。",
    "confidence": "0.0-1.0の数値。請求項テキストがある場合は高め、タイトルのみの場合は低め。",
    "evidence": ["概要の根拠となるソース。例: '請求項1', '[0003]-[0008]', 'IPC分類A61B' など"]
  },
  "strengths": [
    {
      "axis": "軸名 (コスト削減/速度・効率/精度向上/耐久性/安全性/量産性・拡張性/互換性/省エネルギー のいずれか)",
      "level": "高/中/低",
      "basis": "根拠の説明。数値実施例があれば具体的に引用。",
      "hasEvidence": true
    }
  ],
  "licensableFieldsComment": "ライセンス可能分野について補足コメント（1-2文）",
  "royaltyRate": "ロイヤルティ率 ${(rr.low * 100).toFixed(2)}%-${(rr.high * 100).toFixed(2)}% の技術的根拠の説明",
  "valueBracketReason": "ライセンス可能額の区分 '${valueBracket.bracket}' を選んだ根拠（2-3文。市場規模と技術優位性に基づく）",
  "monetizationComments": {
    "license": "ライセンスの具体的な推奨理由（1-2文）",
    "sale": "売却の具体的な推奨理由（1-2文）",
    "litigation": "訴訟の具体的な判断（慎重に。1-2文）",
    "productization": "製品化の具体的な推奨理由（1-2文）",
    "jointDevelopment": "共同開発の具体的な推奨理由（1-2文）"
  }
}

JSONのみ出力し、他のテキストは含めないでください。
strengthsは2-4項目、請求項テキストから判断できる軸のみ含めてください。
金額は必ず「推定レンジ」として表示してください。
訴訟の推奨は慎重に行ってください。`;
}

/**
 * LLM応答をパースして構造化データに変換する
 */
function parseStructuredLlmResponse(rawReport) {
  // summary が文字列の場合（旧形式互換）
  if (typeof rawReport.summary === "string") {
    return {
      summary: { text: rawReport.summary, confidence: 0.5, evidence: [] },
      strengths: rawReport.strengths
        ? (typeof rawReport.strengths === "string"
          ? [{ axis: "総合", level: "中", basis: rawReport.strengths, hasEvidence: false, confidence: 0.5 }]
          : rawReport.strengths)
        : [],
      licensableFieldsComment: rawReport.licensableFields || rawReport.licensableFieldsComment || "",
      royaltyRate: rawReport.royaltyRate || "",
      valueBracketReason: rawReport.valueBracketReason || "",
      monetizationComments: rawReport.monetizationComments || rawReport.monetizationMethods || {}
    };
  }

  return {
    summary: rawReport.summary || { text: "", confidence: 0, evidence: [] },
    strengths: Array.isArray(rawReport.strengths) ? rawReport.strengths : [],
    licensableFieldsComment: rawReport.licensableFieldsComment || "",
    royaltyRate: rawReport.royaltyRate || "",
    valueBracketReason: rawReport.valueBracketReason || "",
    monetizationComments: rawReport.monetizationComments || {}
  };
}

/**
 * フォールバック: LLMなしで構造化レポートを生成
 */
function generateStructuredFallback(patent, ruleResults) {
  const { royaltyRange: rr, valueBracket, monetizationMethods } = ruleResults;
  const claims = patent.metrics?.claimCount || 0;
  const remaining = patent.remainingYears || 0;

  return {
    summary: {
      text: `${patent.title}は、${rr.category}分野の特許です。${patent.filingDate}に出願され、${patent.applicant}が保有しています。登録番号${patent.registrationNumber || patent.id}、請求項数${claims}件、残存年数約${remaining.toFixed(1)}年の特許権です。`,
      confidence: 0.40,
      evidence: ["JPO API書誌情報"]
    },
    strengths: evaluateStrengthAxes(patent),
    licensableFieldsComment: `${rr.category}分野および関連する周辺技術領域でのライセンス機会があります。`,
    royaltyRate: `${rr.category}分野の標準的なロイヤルティ率として、売上の${(rr.low * 100).toFixed(2)}%〜${(rr.high * 100).toFixed(2)}%が想定されます。`,
    valueBracketReason: valueBracket.reason,
    monetizationComments: {
      license: monetizationMethods.find(m => m.type === "ライセンス")?.reason || "",
      sale: monetizationMethods.find(m => m.type === "売却")?.reason || "",
      litigation: monetizationMethods.find(m => m.type === "訴訟")?.reason || "",
      productization: monetizationMethods.find(m => m.type === "製品・サービス化")?.reason || "",
      jointDevelopment: monetizationMethods.find(m => m.type === "共同開発・事業")?.reason || ""
    }
  };
}

// ── 出力組み立て ──

/**
 * 構造化データからPDF/メール向け後方互換テキストを生成する
 */
function assembleBackwardCompatReport(llmResult, ruleResults) {
  const { monetizationMethods, nextActions, licenseableFields } = ruleResults;
  const mc = llmResult.monetizationComments || {};

  // strengthsをテキストに変換
  const strengthsText = llmResult.strengths.length > 0
    ? llmResult.strengths.map(s => `【${s.axis}：${s.level}】${s.basis}`).join("\n")
    : "明細書のテキストから自動解析できる強みの情報が不足しています。";

  // fieldsをテキストに変換
  const fieldsText = licenseableFields.length > 0
    ? licenseableFields
      .filter(f => f.score >= 0.4)
      .map(f => `・${f.field}（適合度: ${Math.round(f.score * 100)}%）`)
      .join("\n")
    + (llmResult.licensableFieldsComment ? `\n\n${llmResult.licensableFieldsComment}` : "")
    : llmResult.licensableFieldsComment || "";

  // nextStepsを後方互換形式に変換
  const nextSteps = {};
  const stepKeys = ["candidateSearch", "offerLetter", "legalConsultation", "developerConsultation", "openInnovation"];
  for (let i = 0; i < nextActions.length && i < stepKeys.length; i++) {
    nextSteps[stepKeys[i]] = nextActions[i].reason;
  }
  // 埋まっていないキーはデフォルト
  for (const key of stepKeys) {
    if (!nextSteps[key]) nextSteps[key] = "現時点では他の手段を優先することを推奨します。";
  }

  // monetizationMethodsを後方互換形式に変換
  const monetizationMethodsCompat = {};
  for (const m of monetizationMethods) {
    const key = {
      "ライセンス": "license",
      "売却": "sale",
      "訴訟": "litigation",
      "製品・サービス化": "productization",
      "共同開発・事業": "jointDevelopment"
    }[m.type];
    if (key) {
      monetizationMethodsCompat[key] = mc[key] || m.reason;
    }
  }

  return {
    summary: typeof llmResult.summary === "object" ? llmResult.summary.text : llmResult.summary,
    strengths: strengthsText,
    licensableFields: fieldsText,
    royaltyRate: llmResult.royaltyRate,
    valueBracket: ruleResults.valueBracket.bracket,
    valueBracketReason: llmResult.valueBracketReason || ruleResults.valueBracket.reason,
    monetizationMethods: monetizationMethodsCompat,
    nextSteps
  };
}

// ══════════════════════════════════════════════
// メインオーケストレーター
// ══════════════════════════════════════════════

/**
 * 特許番号から2層構成で包括的な評価レポートを生成する
 *
 * @param {string} patentNumber - 特許番号（登録番号 or 出願番号）
 * @param {object} [options] - { name }
 * @returns {Promise<object>} { patent, scores, rank, royaltyRange, valueBracket, report, structured, source }
 */
async function researchPatent(patentNumber, options = {}) {
  // ── Step 1: 特許データ取得 ──
  let patent = null;

  if (isPatentApiAvailable()) {
    patent = await fetchComprehensiveData(patentNumber);
    if (patent) {
      console.log(`[research] JPO API data acquired for ${patentNumber}: "${patent.title}"`);
    }
  }

  if (!patent) {
    console.log(`[research] falling back to LLM lookup for ${patentNumber}`);
    patent = await lookupPatentWithLlm(patentNumber, patentNumber);
    if (!patent) {
      throw new Error(`特許情報を取得できませんでした: ${patentNumber}`);
    }
  }

  patent.category = inferCategory(patent);

  // ── Step 1.5: LLMによる不足メトリクス補完 ──
  await enrichMetricsWithLlm(patent);

  // ── Step 2: 事業化評価層 (ルールベース) ──
  const royaltyRange = computeRoyaltyRange(patent);
  const { scores, rank } = computeScoresAndRank(patent, royaltyRange);
  const valueBracket = computeValueBracketRevenue(royaltyRange, patent);
  const licenseableFields = scoreLicenseableFields(patent, royaltyRange);
  const monetizationMethods = scoreMonetizationMethods(patent, royaltyRange);
  const nextActions = computeNextActions(monetizationMethods, patent);
  const strengthAxes = evaluateStrengthAxes(patent);

  const ruleResults = {
    royaltyRange,
    scores,
    rank,
    valueBracket,
    licenseableFields,
    monetizationMethods,
    nextActions,
    strengthAxes
  };

  // ── Step 3: 文献解析層 (LLM) ──
  let llmResult;
  let source = "fallback";

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  if (OPENAI_API_KEY && OPENAI_API_KEY !== "sk-xxx") {
    try {
      const prompt = buildStructuredResearchPrompt(patent, ruleResults);
      const OPENAI_DETAIL_MODEL = process.env.OPENAI_DETAIL_MODEL || "gpt-5.4";
      const rawText = await callOpenAiApi(prompt, { model: OPENAI_DETAIL_MODEL, maxTokens: 4096 });
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const rawReport = JSON.parse(jsonMatch[0]);
        llmResult = parseStructuredLlmResponse(rawReport);
        source = "llm";
      }
    } catch (error) {
      console.warn("[research] LLM analysis failed:", error.message);
    }
  }

  if (!llmResult) {
    llmResult = generateStructuredFallback(patent, ruleResults);
    source = "fallback";
  }

  // LLMの strengths がルールベースより充実していればマージ
  if (llmResult.strengths.length > 0) {
    // LLMの結果を優先、ルールベースで見つかった軸で LLM が返していないものを補完
    const llmAxes = new Set(llmResult.strengths.map(s => s.axis));
    for (const ruleStrength of strengthAxes) {
      if (!llmAxes.has(ruleStrength.axis)) {
        llmResult.strengths.push(ruleStrength);
      }
    }
  } else {
    llmResult.strengths = strengthAxes;
  }

  // ── Step 4: 結果をまとめる ──
  const { _jpoRaw, _registrationInfo, _citations, claimsText, descriptionText, ...cleanPatent } = patent;

  // 後方互換 report (PDF/メール向け)
  const report = assembleBackwardCompatReport(llmResult, ruleResults);

  // 構造化出力
  const structured = {
    normalizedId: {
      application: patent.applicationNumber || null,
      publication: patent.publicationNumber || null,
      patent: patent.registrationNumber || patent.id || null
    },
    inventionSummary: llmResult.summary,
    strengths: llmResult.strengths,
    licenseableFields,
    royaltyRateEstimate: [{
      field: royaltyRange.category,
      range: `${(royaltyRange.low * 100).toFixed(2)}% - ${(royaltyRange.high * 100).toFixed(2)}%`,
      basis: "業界ベースレンジ × 品質補正係数"
    }],
    licenseValueEstimate: {
      band: valueBracket.bracket,
      estimatedValue: valueBracket.estimatedValue,
      method: "revenue",
      components: valueBracket.components
    },
    monetizationMethods,
    nextActions
  };

  const valueRange = {
    low: Math.round(royaltyRange.low * 1_000_000_000),
    high: Math.round(royaltyRange.high * 1_000_000_000),
    confidence: scores.total >= 70 ? "高" : scores.total >= 50 ? "中" : "低"
  };

  const rankMessage = {
    A: "ライセンス・売却できる可能性がとても高い",
    B: "ライセンス・売却できる可能性が高い",
    C: "ライセンス・売却できる可能性がある",
    D: "ライセンス・売却できる可能性が低い"
  }[rank] || "";

  return {
    patent: cleanPatent,
    scores: { ...scores, rank },
    rank,
    rankMessage,
    royaltyRange: {
      low: royaltyRange.low,
      high: royaltyRange.high,
      category: royaltyRange.category,
      multiplier: royaltyRange.multiplier
    },
    valueBracket: valueBracket.bracket,
    valueRange,
    report,
    structured,
    source,
    name: options.name || ""
  };
}

module.exports = { researchPatent, inferCategory, computeRoyaltyRange, computeScoresAndRank };

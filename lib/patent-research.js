/**
 * 2層構成 特許リサーチ・評価エンジン
 *
 * 1層目: 文献解析層 — JPO API + LLMで「発明の概要」「強み」「ライセンス可能分野」を生成
 * 2層目: 事業化評価層 — 料率推定、可能額4区分、収益化手段スコアリング、次の一手
 */
const { fetchComprehensiveData, isPatentApiAvailable } = require("./patent-api");
const { callOpenAiApi, lookupPatentWithLlm } = require("./llm");

// ── 業界別ベースレンジ ──
const INDUSTRY_BASE_RANGE = {
  "製造DX / AI": [0.012, 0.04],
  "エネルギー / 材料": [0.01, 0.035],
  "医療機器 / 画像解析": [0.015, 0.05],
  "通信 / IoT": [0.012, 0.04],
  "ソフトウェア": [0.015, 0.055],
  default: [0.01, 0.04]
};

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

  // IPC分類から推定
  const ipc = patent.ipcClassification || patent._jpoRaw?.ipcClassification || "";
  if (ipc) {
    const prefix = ipc.slice(0, 3).toUpperCase();
    for (const [key, cat] of Object.entries(IPC_CATEGORY_MAP)) {
      if (prefix.startsWith(key)) return cat;
    }
  }

  // タイトルから推定
  const title = (patent.title || "").toLowerCase();
  if (/ai|機械学習|深層学習|ニューラル|推論/.test(title)) return "製造DX / AI";
  if (/通信|ネットワーク|無線|iot|センサ/.test(title)) return "通信 / IoT";
  if (/医療|診断|画像|mri|ct/.test(title)) return "医療機器 / 画像解析";
  if (/電池|太陽|材料|触媒|エネルギー/.test(title)) return "エネルギー / 材料";
  if (/プログラム|ソフト|アプリ|処理装置|情報処理/.test(title)) return "ソフトウェア";

  return "ソフトウェア";
}

// ══════════════════════════════════════════════
// 2層目: 事業化評価層 — ルールベースの品質評価
// ══════════════════════════════════════════════

/**
 * 権利状態スコア (0-1)
 */
function scoreLegalStatus(patent) {
  if (patent.status === "登録") return 1.0;
  if (patent.status === "出願中") return 0.5;
  if (patent.status === "消滅") return 0.1;
  return 0.3;
}

/**
 * 残存年数スコア (0-1)
 */
function scoreRemainingTerm(patent) {
  const years = patent.remainingYears || 0;
  if (years >= 15) return 1.0;
  if (years >= 10) return 0.8;
  if (years >= 5) return 0.5;
  if (years >= 2) return 0.3;
  return 0.1;
}

/**
 * 請求項の強さスコア (0-1)
 */
function scoreClaimStrength(patent) {
  const claims = patent.metrics?.claimCount || 0;
  if (claims >= 15) return 1.0;
  if (claims >= 10) return 0.8;
  if (claims >= 5) return 0.6;
  if (claims >= 1) return 0.4;
  return 0.2;
}

/**
 * 実験的根拠スコア (0-1) — 引用数ベース
 */
function scoreExperimentalEvidence(patent) {
  const citations = patent.metrics?.citations || 0;
  if (citations >= 10) return 1.0;
  if (citations >= 5) return 0.7;
  if (citations >= 2) return 0.5;
  if (citations >= 1) return 0.3;
  return 0.2;
}

/**
 * 設計回避困難度スコア (0-1) — 請求項数+ファミリーサイズから推定
 */
function scoreDesignAroundDifficulty(patent) {
  const claims = patent.metrics?.claimCount || 0;
  const family = patent.metrics?.familySize || 0;
  const combined = claims * 0.6 + family * 4;
  if (combined >= 20) return 1.0;
  if (combined >= 12) return 0.7;
  if (combined >= 5) return 0.5;
  return 0.3;
}

/**
 * 市場適合性スコア (0-1)
 */
function scoreMarketFit(patent) {
  const players = patent.metrics?.marketPlayers || 0;
  const density = patent.metrics?.filingDensity || 50;
  if (players >= 20 && density >= 60) return 1.0;
  if (players >= 10) return 0.7;
  if (players >= 5) return 0.5;
  return 0.3;
}

/**
 * 品質補正係数を計算する
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

/**
 * ロイヤルティ料率レンジを算出する
 */
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

/**
 * 可能額4区分を判定する
 */
function computeValueBracket(royaltyRange, patent) {
  // 簡易収益法: target_sales × addressable_ratio × rate × exclusivity
  // 市場規模は推定が困難なのでスコアベースで区分
  const midRate = (royaltyRange.low + royaltyRange.high) / 2;
  const claims = patent.metrics?.claimCount || 0;
  const remaining = patent.remainingYears || 0;
  const citations = patent.metrics?.citations || 0;
  const players = patent.metrics?.marketPlayers || 0;

  // 総合スコア (0-100)
  const score =
    Math.min(100, claims * 5) * 0.2 +
    Math.min(100, remaining * 5) * 0.25 +
    Math.min(100, citations * 10) * 0.2 +
    Math.min(100, players * 5) * 0.15 +
    (midRate / 0.04) * 100 * 0.2;

  let bracket, reason;
  if (score >= 75) {
    bracket = "10億円以上";
    reason = "技術的優位性が高く、広い権利範囲と長い残存年数を持ち、大規模市場での高いライセンス収益が期待できます。";
  } else if (score >= 50) {
    bracket = "1億円以上 10億円未満";
    reason = "一定の技術的強みと市場適合性があり、複数のライセンス先からの収益が見込まれます。";
  } else if (score >= 25) {
    bracket = "1,000万円以上 1億円未満";
    reason = "限定的な市場での活用可能性があり、特定の企業へのライセンスによる収益が期待できます。";
  } else {
    bracket = "1,000万円未満";
    reason = "権利範囲や市場適合性に課題があり、収益化には追加的な戦略が必要です。";
  }

  return { bracket, reason, score };
}

/**
 * 収益化手段スコアリング
 */
function scoreMonetizationMethods(patent, royaltyRange) {
  const legal = scoreLegalStatus(patent);
  const claims = patent.metrics?.claimCount || 0;
  const remaining = patent.remainingYears || 0;
  const citations = patent.metrics?.citations || 0;

  return {
    license: legal >= 0.8 && remaining >= 5 ? "high" : legal >= 0.5 ? "medium" : "low",
    sale: legal >= 0.8 && claims >= 5 ? "high" : "medium",
    litigation: citations >= 5 && claims >= 10 ? "medium" : "low",
    productization: remaining >= 10 ? "high" : remaining >= 5 ? "medium" : "low",
    jointDevelopment: claims >= 5 ? "high" : "medium"
  };
}

/**
 * 総合スコアとランクを算出する
 */
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
// 1層目: 文献解析層 — LLMによる詳細分析
// ══════════════════════════════════════════════

/**
 * JPO実データをLLMプロンプトに変換して詳細レポートを生成する
 */
function buildResearchPrompt(patent, royaltyRange, valueBracket, scores) {
  const rr = royaltyRange;
  return `あなたは特許評価の専門家です。以下のJPO公式データに基づき、詳細評価レポートをJSON形式で出力してください。

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

## 算出済み評価値
- 品質補正係数: ${rr.multiplier.toFixed(3)}
- ロイヤルティ率レンジ: ${(rr.low * 100).toFixed(2)}% 〜 ${(rr.high * 100).toFixed(2)}%
- 可能額区分: ${valueBracket.bracket}
- 総合スコア: ${scores.total}/100 (ランク ${scores.rank || "-"})
- 影響度: ${scores.impact}/100, 権利の広さ: ${scores.breadth}/100, 実務上の強さ: ${scores.strength}/100, 収益化の近さ: ${scores.monetization}/100

## 出力形式
以下のJSON形式で出力してください。各項目は日本語で記述し、JPOデータから読み取れる事実に基づいて推論してください。

{
  "summary": "発明の概要（タイトル・分類・出願人の情報から発明の要点を300文字程度で推測して要約。「結論」「根拠」「信頼度」を含む）",
  "strengths": "発明の強み・優位性（請求項数、引用文献、残存年数、権利状態などの実データから技術的優位性を分析）",
  "licensableFields": "ライセンス可能な産業・技術分野（IPC分類とカテゴリから活用が期待される分野を推測。箇条書きで3〜5分野）",
  "royaltyRate": "想定されるライセンス料率（算出済みの${(rr.low * 100).toFixed(2)}%〜${(rr.high * 100).toFixed(2)}%をベースに、技術分野ごとの説明を付与）",
  "valueBracket": "${valueBracket.bracket}",
  "valueBracketReason": "ライセンス可能額の区分を選んだ根拠（2〜3文。算出済みスコアとデータに基づく）",
  "monetizationMethods": {
    "license": "ライセンスの適性と推奨理由（1〜2文）",
    "sale": "売却の適性と推奨理由（1〜2文）",
    "litigation": "訴訟の適性と推奨理由（1〜2文。慎重に）",
    "productization": "製品・サービス化の適性と推奨理由（1〜2文）",
    "jointDevelopment": "他社との共同開発・事業の適性と推奨理由（1〜2文）"
  },
  "nextSteps": {
    "candidateSearch": "ライセンス・売却候補先の探索（具体的な推奨アクション1〜2文）",
    "offerLetter": "ライセンスオファーレターの送付（具体的な推奨アクション1〜2文）",
    "legalConsultation": "弁理士又は弁護士への相談（具体的な推奨アクション1〜2文）",
    "developerConsultation": "開発業者への相談（具体的な推奨アクション1〜2文）",
    "openInnovation": "オープンイノベーションの提案（具体的な推奨アクション1〜2文）"
  }
}

JSONのみ出力し、他のテキストは含めないでください。
金額は必ず「推定レンジ」として表示してください。
訴訟の推奨は慎重に行い、文献データだけでは断定しないでください。`;
}

/**
 * フォールバック: LLMなしでルールベースのレポートを生成
 */
function generateFallbackReport(patent, royaltyRange, valueBracket, monetizationScores) {
  const rr = royaltyRange;
  const claims = patent.metrics?.claimCount || 0;
  const remaining = patent.remainingYears || 0;
  const citations = patent.metrics?.citations || 0;

  return {
    summary: `${patent.title}は、${rr.category}分野の特許です。${patent.filingDate}に出願され、${patent.applicant}が保有しています。登録番号${patent.registrationNumber || patent.id}、請求項数${claims}件、残存年数約${remaining.toFixed(1)}年の特許権です。`,
    strengths: remaining >= 10
      ? `残存年数が${remaining.toFixed(1)}年と長く、長期的な権利行使が可能です。請求項${claims}件で${claims >= 10 ? "広い" : "基本的な"}権利範囲を確保しています。`
      : `請求項${claims}件で${claims >= 10 ? "広い" : "基本的な"}権利範囲を確保しています。残存年数は${remaining.toFixed(1)}年です。`,
    licensableFields: `${rr.category}分野および関連する周辺技術領域でのライセンス機会があります。`,
    royaltyRate: `${rr.category}分野の標準的なロイヤルティ率として、売上の${(rr.low * 100).toFixed(2)}%〜${(rr.high * 100).toFixed(2)}%が想定されます。`,
    valueBracket: valueBracket.bracket,
    valueBracketReason: valueBracket.reason,
    monetizationMethods: {
      license: monetizationScores.license === "high" ? "権利が有効で残存年数も十分あり、ライセンス付与による収益化が最も有望です。" : "ライセンス付与の可能性を検討する価値があります。",
      sale: monetizationScores.sale === "high" ? "十分な請求項数と有効な権利状態により、売却も有力な選択肢です。" : "売却よりもライセンスを優先することを推奨します。",
      litigation: "訴訟による権利行使はコストとリスクを慎重に評価する必要があります。専門家への相談を推奨します。",
      productization: monetizationScores.productization === "high" ? "残存年数が長く、製品・サービス化による直接的な収益化も検討できます。" : "製品化の検討にあたっては市場調査が必要です。",
      jointDevelopment: monetizationScores.jointDevelopment === "high" ? "請求項の広さを活かした共同開発が有望です。" : "共同開発パートナーの探索から始めることを推奨します。"
    },
    nextSteps: {
      candidateSearch: `${rr.category}分野で${patent.title}に関連する技術を利用している企業のリストアップから始め、候補先を特定してください。`,
      offerLetter: "候補先が特定できたら、特許の概要と提案条件をまとめたオファーレターを作成・送付してください。",
      legalConsultation: "権利範囲の確認と交渉戦略の策定について、特許に詳しい弁理士または弁護士にご相談ください。",
      developerConsultation: "製品・サービス化を検討する場合、技術的な実現可能性について開発業者にご相談ください。",
      openInnovation: "技術の応用範囲を広げるため、オープンイノベーションプログラムへの参加を検討してください。"
    }
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
 * @returns {Promise<object>} { patent, scores, rank, royaltyRange, valueBracket, report, source }
 */
async function researchPatent(patentNumber, options = {}) {
  // ── Step 1: 特許データ取得 ──
  let patent = null;

  // JPO APIから取得を試行
  if (isPatentApiAvailable()) {
    patent = await fetchComprehensiveData(patentNumber);
    if (patent) {
      console.log(`[research] JPO API data acquired for ${patentNumber}: "${patent.title}"`);
    }
  }

  // JPO APIが使えない場合はLLMで推定
  if (!patent) {
    console.log(`[research] falling back to LLM lookup for ${patentNumber}`);
    patent = await lookupPatentWithLlm(patentNumber, patentNumber);
    if (!patent) {
      throw new Error(`特許情報を取得できませんでした: ${patentNumber}`);
    }
  }

  // カテゴリ推定
  patent.category = inferCategory(patent);

  // ── Step 2: 事業化評価層 (ルールベース) ──
  const royaltyRange = computeRoyaltyRange(patent);
  const { scores, rank } = computeScoresAndRank(patent, royaltyRange);
  const valueBracket = computeValueBracket(royaltyRange, patent);
  const monetizationScores = scoreMonetizationMethods(patent, royaltyRange);

  // ── Step 3: 文献解析層 (LLM) ──
  let report;
  let source = "fallback";

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  if (OPENAI_API_KEY && OPENAI_API_KEY !== "sk-xxx") {
    try {
      const prompt = buildResearchPrompt(patent, royaltyRange, valueBracket, scores);
      const OPENAI_DETAIL_MODEL = process.env.OPENAI_DETAIL_MODEL || "gpt-5.4";
      const rawText = await callOpenAiApi(prompt, { model: OPENAI_DETAIL_MODEL, maxTokens: 4096 });
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        report = JSON.parse(jsonMatch[0]);
        source = "llm";
      }
    } catch (error) {
      console.warn("[research] LLM analysis failed:", error.message);
    }
  }

  if (!report) {
    report = generateFallbackReport(patent, royaltyRange, valueBracket, monetizationScores);
    source = "fallback";
  }

  // ── Step 4: 結果をまとめる ──
  // _jpoRaw等の内部データはクライアントに送信しない
  const { _jpoRaw, _registrationInfo, _citations, ...cleanPatent } = patent;

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
    source,
    name: options.name || ""
  };
}

module.exports = { researchPatent, inferCategory, computeRoyaltyRange, computeScoresAndRank };

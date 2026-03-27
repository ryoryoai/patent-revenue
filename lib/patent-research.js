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
const {
  inferCategory,
  computeRoyaltyRange,
  computeScoresAndRank,
  computeValueBracketRevenue,
  scoreLicenseableFields,
  scoreMonetizationMethods,
  computeNextActions,
  evaluateStrengthAxes
} = require("./patent-research/scoring");

// ── 特許無効エラー ──
class PatentInvalidError extends Error {
  constructor(patentNumber, status, patent) {
    const messages = {
      "消滅": `この特許（${patentNumber}）は権利が消滅しています。`,
      "拒絶": `この特許出願（${patentNumber}）は拒絶されています。`,
      "出願中": `この特許（${patentNumber}）は出願中で、まだ登録されていません。`,
      "取下": `この特許出願（${patentNumber}）は取り下げられています。`
    };
    super(messages[status] || `この特許（${patentNumber}）は有効ではありません（状態: ${status}）。`);
    this.name = "PatentInvalidError";
    this.code = "PATENT_INVALID";
    this.status = status;
    this.patentNumber = patentNumber;
    this.patent = patent;
  }
}

// ══════════════════════════════════════════════
// 定数テーブル・スコアリング関数は以下に移動済み
// lib/patent-research/constants.js
// lib/patent-research/scoring.js
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// LLMによる不足メトリクス補完
// ══════════════════════════════════════════════

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

  return `あなたは特許の収益化評価を専門とする知財コンサルタントです。以下のJPO公式データ${patent.claimsText ? "および公報全文テキスト" : ""}に基づき、構造化された評価レポートをJSON形式で出力してください。

## 読解の方針（重要）
**必ず「請求項→明細書」の順で読んでください。**
1. まず請求項1（独立クレーム）を読み、**実際に権利として押さえている範囲**を特定する。発明の説明全体よりも、権利範囲のほうが収益化では重要。
2. 次に明細書を読み、請求項の技術的背景・効果・実施例を補強する。
3. 技術の説明を**事業価値に翻訳**する。例：「追加センサが不要」→「部品点数削減・コスト低減」、「推定値を比較・補正」→「診断の頑健性・誤判定低減」。
4. 各評価項目について、**事実（公報に記載）と推定（推論）を明確に区別**してください。

${patent.claimsText || patent.descriptionText ? "**公報全文テキストが提供されています。**\n- 請求項1の構成要素を正確に特定し、権利範囲の広さを評価してください\n- 明細書中の実施例・比較例の具体的な数値を引用してください\n- 推測ではなく、テキスト中の根拠を段落番号付きで参照してください\n" : ""}
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
- 全IPCコード: ${(patent.ipcCodes || []).join(", ") || "-"}
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

## 分析指示

### A. 発明の概要
- 請求項1の構成要素を分解し、発明の本質（何が新しいか）を明確にしてください
- 出願日の技術水準を踏まえ、当時の技術的課題と解決手段の関係を説明してください
- 300〜500字程度

### B. 強み分析
- 請求項に記載された構成要素と明細書の効果記載から、技術的優位性を評価してください
- 数値データ（効率xx%向上、コストxx%削減等）があれば段落番号とともに具体的に引用してください
- 「推測」と「実証」を明確に区別してください

### C. 請求項スコープ分析 (claimScopeAnalysis)
- 独立クレームの広さ（構成要素の抽象度）を評価してください
- 権利範囲が広い＝構成要素が少なく抽象的、狭い＝構成要素が多く具体的
- 設計回避（Design-around）の容易さを評価してください。代替構成が容易に思いつくか？
- 各従属項がどの程度権利を強化しているかを簡潔に評価

### D. ライセンス料率の根拠
- ルールエンジンが算出した ${(rr.low * 100).toFixed(2)}%-${(rr.high * 100).toFixed(2)}% を踏まえ、技術的根拠を説明
- 対象分野ごとにライセンス料率が異なる場合は、分野別に推定レンジを提示してください
  例: 「車載ECU向け: 0.3-0.8%」「産業機器向け: 0.8-1.5%」
- **売上基準の明示**: 料率の分母が「完成品（完成車等）売上」か「部品・モジュール売上」かを明示してください。部品レベルの発明は完成品売上をベースにすると料率が過大になります
- 料率が業界標準と比べて高い/低い理由を説明
- **単独特許の割引**: ポートフォリオではなく単独特許であることを考慮し、相場からの割引理由を明記

### E. 収益化手段の評価
- 各手段について具体的な推奨理由を記述
- ライセンス先として想定される具体的な企業名や業界セグメントを挙げてください（推定でも可）
- **実施立証の難易度**を各手段で考慮してください。制御ロジック・アルゴリズム系は侵害立証が困難（ブラックボックス化）、構造物・機械系は比較的容易
- 訴訟は条件が揃わない限り推奨しないでください。特に侵害立証が困難な場合は明記

### F. 海外ファミリー・権利拡張
- 出願人の規模や技術分野から、海外出願の可能性を推定してください
- 海外ファミリーがある場合のライセンス価値への影響を記述

## 出力形式 (JSON)
{
  "summary": {
    "text": "発明の概要（300-500字）。請求項1の構成要素を分解し、技術的課題と解決手段を明確に。出願時の技術水準との比較も含める。",
    "confidence": 0.0-1.0,
    "evidence": ["概要の根拠。'請求項1', '[0003]-[0008]', 'IPC分類' 等"]
  },
  "strengths": [
    {
      "axis": "軸名 (コスト削減/速度・効率/精度向上/耐久性/安全性/量産性・拡張性/互換性/省エネルギー のいずれか)",
      "level": "高/中/低",
      "basis": "根拠。数値があれば段落番号と共に引用。例: '[0045]比較例対比で効率15%向上'",
      "hasEvidence": true
    }
  ],
  "claimScopeAnalysis": {
    "breadth": "広い/標準/狭い",
    "independentClaimElements": 0,
    "designAroundRisk": "高/中/低（高=回避容易）",
    "designAroundReason": "設計回避の容易さの理由（1-2文）",
    "dependentClaimsValue": "従属項による権利強化の評価（1文）"
  },
  "licensableFieldsComment": "ライセンス可能分野の補足。具体的なターゲット業界・企業セグメントを含む",
  "royaltyRate": "料率の技術的根拠の説明。業界標準との比較を含む",
  "perVerticalRates": [
    { "vertical": "対象業界名", "range": "x.x%-y.y%", "reason": "この業界での料率の根拠" }
  ],
  "valueBracketReason": "可能額区分 '${valueBracket.bracket}' の根拠（2-3文。市場規模×技術優位性）",
  "monetizationComments": {
    "license": "ライセンスの推奨理由。具体的なターゲット企業・セグメントを含む",
    "sale": "売却の推奨理由。買い手候補のタイプを含む",
    "litigation": "訴訟の判断（慎重に）。侵害立証の難易度を含む",
    "productization": "製品化の推奨理由。実現可能性を含む",
    "jointDevelopment": "共同開発の推奨理由。パートナー候補のタイプを含む"
  },
  "overseasFamilyAssessment": {
    "likelihood": "高/中/低（海外出願の可能性）",
    "reason": "判断の根拠（1-2文）",
    "valueImpact": "海外ファミリーがある場合の価値への影響（1文）"
  }
}

JSONのみ出力。他のテキストは含めない。
strengthsは2-5項目、テキストから判断できる軸のみ。
perVerticalRatesは1-3業界。
金額は「推定レンジ」として表示。`;
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
      claimScopeAnalysis: rawReport.claimScopeAnalysis || null,
      licensableFieldsComment: rawReport.licensableFields || rawReport.licensableFieldsComment || "",
      royaltyRate: rawReport.royaltyRate || "",
      perVerticalRates: Array.isArray(rawReport.perVerticalRates) ? rawReport.perVerticalRates : [],
      valueBracketReason: rawReport.valueBracketReason || "",
      monetizationComments: rawReport.monetizationComments || rawReport.monetizationMethods || {},
      overseasFamilyAssessment: rawReport.overseasFamilyAssessment || null
    };
  }

  return {
    summary: rawReport.summary || { text: "", confidence: 0, evidence: [] },
    strengths: Array.isArray(rawReport.strengths) ? rawReport.strengths : [],
    claimScopeAnalysis: rawReport.claimScopeAnalysis || null,
    licensableFieldsComment: rawReport.licensableFieldsComment || "",
    royaltyRate: rawReport.royaltyRate || "",
    perVerticalRates: Array.isArray(rawReport.perVerticalRates) ? rawReport.perVerticalRates : [],
    valueBracketReason: rawReport.valueBracketReason || "",
    monetizationComments: rawReport.monetizationComments || {},
    overseasFamilyAssessment: rawReport.overseasFamilyAssessment || null
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

  // 料率テキスト: 分野別料率があれば付加
  let royaltyRateText = llmResult.royaltyRate;
  if (llmResult.perVerticalRates && llmResult.perVerticalRates.length > 0) {
    const verticalLines = llmResult.perVerticalRates
      .map(v => `・${v.vertical}: ${v.range}（${v.reason}）`)
      .join("\n");
    royaltyRateText += `\n\n【分野別ライセンス料率】\n${verticalLines}`;
  }

  // 請求項スコープ分析テキスト
  let claimScopeText = "";
  if (llmResult.claimScopeAnalysis) {
    const cs = llmResult.claimScopeAnalysis;
    claimScopeText = `権利範囲: ${cs.breadth || "-"}（独立クレーム構成要素: ${cs.independentClaimElements || "-"}個）\n設計回避リスク: ${cs.designAroundRisk || "-"}　${cs.designAroundReason || ""}\n${cs.dependentClaimsValue || ""}`;
  }

  // 海外ファミリー評価テキスト
  let overseasText = "";
  if (llmResult.overseasFamilyAssessment) {
    const oa = llmResult.overseasFamilyAssessment;
    overseasText = `海外出願可能性: ${oa.likelihood || "-"}\n${oa.reason || ""}\n${oa.valueImpact || ""}`;
  }

  return {
    summary: typeof llmResult.summary === "object" ? llmResult.summary.text : llmResult.summary,
    strengths: strengthsText,
    licensableFields: fieldsText,
    royaltyRate: royaltyRateText,
    valueBracket: ruleResults.valueBracket.bracket,
    valueBracketReason: llmResult.valueBracketReason || ruleResults.valueBracket.reason,
    claimScope: claimScopeText,
    overseasFamily: overseasText,
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
  // ── Step 1: 特許データ取得 (有効性チェック付き) ──
  let patent = null;

  if (isPatentApiAvailable()) {
    try {
      patent = await fetchComprehensiveData(patentNumber, { throwOnInvalid: true });
    } catch (error) {
      if (error.code === "PATENT_INVALID") {
        throw new PatentInvalidError(patentNumber, error.patentStatus, error.patent);
      }
      // JPO APIのネットワークエラー等はフォールバックに進む
      console.warn(`[research] JPO API error for ${patentNumber}, falling back to LLM:`, error.message);
    }
    if (patent) {
      console.log(`[research] JPO API data acquired for ${patentNumber}: "${patent.title}"`);
    }
  }

  if (!patent) {
    console.log(`[research] falling back to LLM lookup for ${patentNumber}`);
    try {
      patent = await lookupPatentWithLlm(patentNumber, patentNumber);
    } catch (llmErr) {
      console.error(`[research] LLM lookup failed for ${patentNumber}:`, llmErr.message);
      throw new Error(`特許情報を取得できませんでした: ${patentNumber} (LLM: ${llmErr.message})`);
    }
    if (!patent) {
      throw new Error(`特許情報を取得できませんでした: ${patentNumber} (LLM returned null, OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY})`);
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
    claimScopeAnalysis: llmResult.claimScopeAnalysis || null,
    licenseableFields,
    royaltyRateEstimate: [{
      field: royaltyRange.category,
      range: `${(royaltyRange.low * 100).toFixed(2)}% - ${(royaltyRange.high * 100).toFixed(2)}%`,
      basis: "業界ベースレンジ × 品質補正係数"
    }],
    perVerticalRates: llmResult.perVerticalRates || [],
    licenseValueEstimate: {
      band: valueBracket.bracket,
      estimatedValue: valueBracket.estimatedValue,
      method: "revenue",
      components: valueBracket.components
    },
    monetizationMethods,
    nextActions,
    overseasFamilyAssessment: llmResult.overseasFamilyAssessment || null
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

module.exports = { researchPatent, inferCategory, computeRoyaltyRange, computeScoresAndRank, PatentInvalidError };

const https = require("https");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000);

const categoryRoyaltyRange = {
  "製造DX / AI": [0.012, 0.04],
  "エネルギー / 材料": [0.01, 0.035],
  "医療機器 / 画像解析": [0.015, 0.05],
  "通信 / IoT": [0.012, 0.04],
  ソフトウェア: [0.015, 0.055],
  default: [0.01, 0.04]
};

function buildPrompt(data) {
  const { patent, scores, input, valueRange, route } = data;
  const royalty = categoryRoyaltyRange[patent.category] || categoryRoyaltyRange.default;

  return `あなたは特許評価の専門家です。以下の特許データに基づき、詳細評価レポートをJSON形式で出力してください。

## 特許データ
- タイトル: ${patent.title}
- カテゴリ: ${patent.category}
- 出願日: ${patent.filingDate}
- 登録日: ${patent.registrationDate}
- 出願人: ${patent.applicant}（${patent.applicantType}）
- ステータス: ${patent.status}

## 評価スコア
- 影響度: ${scores.impact}/100
- 権利の広さ: ${scores.breadth}/100
- 実務上の強さ: ${scores.strength}/100
- 収益化の近さ: ${scores.monetization}/100
- 総合: ${scores.total}/100
- ランク: ${scores.rank}

## 入力情報
- 実施状況: ${input.useStatus || "未選択"}
- 売上レンジ: ${input.salesRange || "未選択"}
- 寄与度: ${input.contribution || "未選択"}

## メトリクス
- 被引用数: ${patent.metrics.citations}
- 引用成長率: ${patent.metrics.citationGrowth}
- 請求項数: ${patent.metrics.claimCount}
- ファミリーサイズ: ${patent.metrics.familySize}
- 分類ランク: ${patent.metrics.classRank}
- 市場プレイヤー数: ${patent.metrics.marketPlayers}
- 出願密度: ${patent.metrics.filingDensity}

## 推定価値
- レンジ: ${Math.round(valueRange.low).toLocaleString()}円 〜 ${Math.round(valueRange.high).toLocaleString()}円
- 収益化手段: ${route.title}
- カテゴリ別ロイヤルティ率: ${(royalty[0] * 100).toFixed(1)}% 〜 ${(royalty[1] * 100).toFixed(1)}%

## 出力形式
以下のJSON形式で出力してください。各項目は日本語で記述してください。

{
  "summary": "発明の概要（300文字程度）",
  "strengths": "強み・優位性の説明",
  "licensableFields": "ライセンス可能な産業・技術分野のリスト",
  "royaltyRate": "想定ロイヤルティ率（売上の◯%〜◯%の形式）",
  "valueBracket": "ライセンス可能額の目安（1000万未満/1000万〜1億/1億〜10億/10億以上の4区分から選択し説明）",
  "monetizationMethods": "推奨する収益化手段（ライセンス/売却/訴訟/製品化/共同開発から2〜3個推薦）",
  "nextSteps": "次の一手（具体的なアクション2〜3個を推薦）"
}

JSONのみ出力し、他のテキストは含めないでください。`;
}

function callOpenAiApi(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 2048,
      messages: [
        { role: "system", content: "あなたは特許評価の専門家です。指示に従いJSON形式で回答してください。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("llm_timeout"));
    }, LLM_TIMEOUT_MS);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(parsed.error?.message || `OpenAI API error: ${res.statusCode}`));
            return;
          }
          const text = parsed.choices?.[0]?.message?.content || "";
          resolve(text);
        } catch (error) {
          reject(new Error("llm_parse_error"));
        }
      });
    });

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    req.write(body);
    req.end();
  });
}

function generateDetailedReportFallback(data) {
  const { patent, scores, valueRange, route } = data;
  const royalty = categoryRoyaltyRange[patent.category] || categoryRoyaltyRange.default;

  let valueBracket = "1000万円未満";
  const midValue = (valueRange.low + valueRange.high) / 2;
  if (midValue >= 1_000_000_000) valueBracket = "10億円以上";
  else if (midValue >= 100_000_000) valueBracket = "1億円〜10億円";
  else if (midValue >= 10_000_000) valueBracket = "1000万円〜1億円";

  const methods = [];
  if (scores.monetization >= 60) methods.push("ライセンス");
  if (scores.strength >= 60 && scores.breadth >= 60) methods.push("売却");
  if (scores.impact >= 70) methods.push("共同開発");
  if (methods.length === 0) methods.push("調査・分析強化");

  return {
    summary: `${patent.title}は、${patent.category}分野の特許です。${patent.filingDate}に出願され、${patent.applicant}が保有しています。総合評価スコアは${scores.total}点（ランク${scores.rank}）で、${route.title}が推奨される収益化手段です。`,
    strengths: scores.impact >= 70
      ? `被引用数が同分野内で上位に位置し、技術的影響力が高い特許です。請求項数${patent.metrics.claimCount}件、ファミリーサイズ${patent.metrics.familySize}により権利範囲が広く確保されています。`
      : `${patent.category}分野において標準的な権利範囲を有しています。請求項数${patent.metrics.claimCount}件で基本的な権利保護がなされています。`,
    licensableFields: `${patent.category}分野および関連する周辺技術領域。市場プレイヤー数${patent.metrics.marketPlayers}社が活動する市場でのライセンス機会があります。`,
    royaltyRate: `売上の${(royalty[0] * 100).toFixed(1)}%〜${(royalty[1] * 100).toFixed(1)}%`,
    valueBracket,
    monetizationMethods: methods.join("、"),
    nextSteps: route.title === "ライセンス向き"
      ? "1. 用途が近い企業のリストアップ、2. ロイヤルティ条件の初期案作成、3. 打診先への初回コンタクト"
      : route.title === "売却向き"
        ? "1. 譲渡条件の整理、2. 希望金額の設定、3. 買い手候補への打診"
        : "1. 実施状況の詳細調査、2. 競合技術・代替技術の分析、3. 収益化手段の再評価"
  };
}

async function generateDetailedReport(data) {
  if (!OPENAI_API_KEY) {
    return { report: generateDetailedReportFallback(data), source: "fallback" };
  }

  try {
    const prompt = buildPrompt(data);
    const rawText = await callOpenAiApi(prompt);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { report: generateDetailedReportFallback(data), source: "fallback" };
    }
    const report = JSON.parse(jsonMatch[0]);
    return { report, source: "llm" };
  } catch (error) {
    console.warn("[llm] fallback due to:", error.message);
    return { report: generateDetailedReportFallback(data), source: "fallback" };
  }
}

module.exports = { generateDetailedReport };

const https = require("https");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const OPENAI_DETAIL_MODEL = process.env.OPENAI_DETAIL_MODEL || "gpt-5.4";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000);

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
  "summary": "発明の概要（特許明細書等のデータから推測し、発明の要点を300文字程度で要約）",
  "strengths": "発明の強み・優位性（明細書の記載内容から技術的な優位性を推測）",
  "licensableFields": "ライセンス可能な産業・技術分野（明細書の記載内容から活用が期待される分野を推測。箇条書きで3〜5分野）",
  "royaltyRate": "想定されるライセンス料率（技術分野ごとに、売上の◯%〜◯%という形式で大まかに算出）",
  "valueBracket": "ライセンス可能額の目安（以下の4区分から該当するものを1つ選択: '1,000万円未満' / '1,000万円以上 1億円未満' / '1億円以上 10億円未満' / '10億円以上'）",
  "valueBracketReason": "ライセンス可能額の区分を選んだ根拠（2〜3文）",
  "monetizationMethods": {
    "license": "ライセンスの適性と推奨理由（1〜2文）",
    "sale": "売却の適性と推奨理由（1〜2文）",
    "litigation": "訴訟の適性と推奨理由（1〜2文）",
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

JSONのみ出力し、他のテキストは含めないでください。`;
}

function callOpenAiApi(prompt, { model, maxTokens } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model || OPENAI_MODEL,
      max_completion_tokens: maxTokens || 2048,
      messages: [
        { role: "system", content: "あなたは特許評価の専門家です。指示に従いJSON形式で回答してください。" },
        { role: "user", content: prompt }
      ],
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

  return {
    summary: `${patent.title}は、${patent.category}分野の特許です。${patent.filingDate}に出願され、${patent.applicant}が保有しています。総合評価スコアは${scores.total}点（ランク${scores.rank}）で、${route.title}が推奨される収益化手段です。`,
    strengths: scores.impact >= 70
      ? `被引用数が同分野内で上位に位置し、技術的影響力が高い特許です。請求項数${patent.metrics.claimCount}件、ファミリーサイズ${patent.metrics.familySize}により権利範囲が広く確保されています。`
      : `${patent.category}分野において標準的な権利範囲を有しています。請求項数${patent.metrics.claimCount}件で基本的な権利保護がなされています。`,
    licensableFields: `${patent.category}分野および関連する周辺技術領域。市場プレイヤー数${patent.metrics.marketPlayers}社が活動する市場でのライセンス機会があります。`,
    royaltyRate: `売上の${(royalty[0] * 100).toFixed(1)}%〜${(royalty[1] * 100).toFixed(1)}%`,
    valueBracket,
    valueBracketReason: `総合評価スコア${scores.total}点、推定価値レンジ${Math.round(valueRange.low).toLocaleString()}円〜${Math.round(valueRange.high).toLocaleString()}円に基づく。`,
    monetizationMethods: {
      license: scores.monetization >= 60 ? "ライセンス付与による収益化が有望です。" : "ライセンス付与の可能性を検討する価値があります。",
      sale: scores.strength >= 60 ? "権利の強さを活かした売却が検討できます。" : "現時点での売却よりも権利強化を優先することを推奨します。",
      litigation: scores.impact >= 70 ? "技術的影響力が高く、訴訟による権利行使も選択肢になります。" : "訴訟リスクとコストを慎重に評価する必要があります。",
      productization: "自社での製品・サービス化による直接的な収益化を検討できます。",
      jointDevelopment: scores.breadth >= 60 ? "権利範囲の広さを活かした共同開発が有望です。" : "共同開発パートナーの探索から始めることを推奨します。"
    },
    nextSteps: {
      candidateSearch: "関連技術を利用している企業のリストアップから始め、ライセンス・売却の候補先を特定してください。",
      offerLetter: "候補先が特定できたら、特許の概要と提案条件をまとめたオファーレターを作成・送付してください。",
      legalConsultation: "権利範囲の確認と交渉戦略の策定について、特許に詳しい弁理士または弁護士にご相談ください。",
      developerConsultation: "製品・サービス化を検討する場合、技術的な実現可能性について開発業者にご相談ください。",
      openInnovation: "技術の応用範囲を広げるため、オープンイノベーションプログラムへの参加を検討してください。"
    }
  };
}

async function generateDetailedReport(data) {
  if (!OPENAI_API_KEY) {
    return { report: generateDetailedReportFallback(data), source: "fallback" };
  }

  try {
    const prompt = buildPrompt(data);
    const rawText = await callOpenAiApi(prompt, { model: OPENAI_DETAIL_MODEL, maxTokens: 4096 });
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

/**
 * 特許番号またはキーワードからOpenAIで特許情報+メトリクスを推定する
 */
async function lookupPatentWithLlm(query, patentNumber) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === "sk-xxx") return null;

  const isNumber = patentNumber && patentNumber.length >= 6;
  const prompt = isNumber
    ? `日本の特許番号「${patentNumber}」（出願番号または登録番号）について、あなたの知識に基づき以下のJSON形式で情報を推定してください。
正確な情報がわからない場合は、番号の特徴や技術分野から合理的に推定してください。`
    : `「${query}」というキーワードに最も関連する日本の代表的な特許技術について、以下のJSON形式で情報を推定してください。`;

  const fullPrompt = `${prompt}

カテゴリは以下のいずれかから選択: "製造DX / AI", "エネルギー / 材料", "医療機器 / 画像解析", "通信 / IoT", "ソフトウェア"
applicantTypeは: "企業", "大学", "個人" のいずれか

{
  "id": "特許番号または出願番号",
  "title": "発明の名称",
  "applicant": "出願人名",
  "applicantType": "企業/大学/個人",
  "registrationDate": "YYYY-MM-DD",
  "filingDate": "YYYY-MM-DD",
  "category": "カテゴリ",
  "status": "登録/出願中/拒絶/消滅",
  "metrics": {
    "citations": "被引用数(0-50の整数)",
    "citationGrowth": "直近の引用成長率(-10〜30の整数)",
    "claimCount": "請求項数(1-25の整数)",
    "familySize": "パテントファミリーサイズ(1-12の整数)",
    "classRank": "同分類内でのランク(0-100)",
    "marketPlayers": "関連市場のプレイヤー数(3-40の整数)",
    "filingDensity": "技術分野の出願密度(10-90)",
    "prosecutionMonths": "出願から登録までの月数(6-48の整数)"
  }
}

JSONのみ出力し、他のテキストは含めないでください。数値はすべて数値型で出力してください。`;

  try {
    const rawText = await callOpenAiApi(fullPrompt);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[0]);

    // 必須フィールドの検証
    if (!data.title || !data.metrics) return null;

    return {
      id: String(data.id || patentNumber || query),
      title: data.title,
      applicant: data.applicant || "",
      applicantType: data.applicantType || "企業",
      registrationDate: data.registrationDate || "",
      filingDate: data.filingDate || "",
      category: data.category || "ソフトウェア",
      status: data.status || "登録",
      officialUrl: `https://www.j-platpat.inpit.go.jp/`,
      metrics: {
        citations: Number(data.metrics.citations) || 0,
        citationGrowth: Number(data.metrics.citationGrowth) || 0,
        claimCount: Number(data.metrics.claimCount) || 0,
        familySize: Number(data.metrics.familySize) || 0,
        classRank: Number(data.metrics.classRank) || 50,
        marketPlayers: Number(data.metrics.marketPlayers) || 0,
        filingDensity: Number(data.metrics.filingDensity) || 50,
        prosecutionMonths: Number(data.metrics.prosecutionMonths) || 0
      },
      source: "llm"
    };
  } catch (error) {
    console.warn("[llm] patent lookup failed:", error.message);
    return null;
  }
}

module.exports = { generateDetailedReport, callOpenAiApi, lookupPatentWithLlm };

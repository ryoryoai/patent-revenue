const { sanitizeHeaderValue } = require("./header-safety");

const OPENAI_API_KEY = sanitizeHeaderValue(process.env.OPENAI_API_KEY || "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000);

async function callOpenAiApi(prompt, { model, maxTokens } = {}) {
  console.log("[llm] callOpenAiApi using fetch (v2)");
  const body = JSON.stringify({
    model: model || OPENAI_MODEL,
    max_completion_tokens: maxTokens || 2048,
    messages: [
      { role: "system", content: "あなたは特許評価の専門家です。指示に従いJSON形式で回答してください。" },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" }
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body,
      signal: controller.signal
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || `OpenAI API error: ${res.status}`);
    }

    const text = data.choices?.[0]?.message?.content || "";
    // U+FFFD 除去 (PDF文字化け対策)
    return text.replace(/\uFFFD/g, "");
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("llm_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 特許番号またはキーワードからOpenAIで特許情報+メトリクスを推定する
 */
async function lookupPatentWithLlm(query, patentNumber) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY === "sk-xxx") return null;

  const isNumber = patentNumber && patentNumber.length >= 6;
  if (!isNumber) return null;
  const prompt = `日本の特許番号「${patentNumber}」（出願番号または登録番号）について、あなたの知識に基づき以下のJSON形式で情報を推定してください。
正確な情報がわからない場合は、番号の特徴や技術分野から合理的に推定してください。`;

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

module.exports = { callOpenAiApi, lookupPatentWithLlm };

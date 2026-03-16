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

function normalizePatentNumber(input) {
  return String(input || "")
    .replace(/特許第/g, "")
    .replace(/号/g, "")
    .replace(/[\s-]/g, "")
    .replace(/[^0-9]/g, "");
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
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

async function lookupPatent(query, { delayMs = 250 } = {}) {
  const patentNumber = normalizePatentNumber(query);
  const { lookupPatentWithLlm } = require("./llm");

  // 1. OpenAI (GPT-5) で特許情報+メトリクスを推定
  try {
    const result = await lookupPatentWithLlm(query, patentNumber);
    if (result) {
      console.log("[patent-data] LLM lookup success:", result.title);
      return result;
    }
  } catch (error) {
    console.warn("[patent-data] LLM lookup failed:", error.message);
  }

  // 2. フォールバック: モックデータ
  return new Promise((resolve) => {
    setTimeout(() => {
      const patent = patentNumber.length >= 6
        ? mockPatents[patentNumber] || pseudoPatentFromQuery(query, patentNumber)
        : pseudoPatentFromQuery(query, "");
      resolve(patent);
    }, delayMs);
  });
}

module.exports = {
  lookupPatent,
  normalizePatentNumber
};

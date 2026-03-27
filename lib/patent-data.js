const { fetchComprehensiveData } = require("./patent-api");

async function lookupPatent(query) {
  // JPO API で実データを取得（Google Patentsで存在確認済みの前提）
  try {
    const result = await fetchComprehensiveData(query);
    if (result) {
      console.log("[patent-data] JPO API lookup success:", result.title);
      return result;
    }
  } catch (error) {
    // PATENT_INVALID エラーはそのまま投げる
    if (error.code === "PATENT_INVALID") throw error;
    console.warn("[patent-data] JPO API lookup failed:", error.message);
  }

  return null;
}

module.exports = {
  lookupPatent
};

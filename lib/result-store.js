/**
 * テスト結果のファイルベース永続化
 *
 * data/results/ に特許番号ごとのJSONファイルを保存。
 * 同一特許の再実行時は履歴として追記し、スコア変動を追跡可能。
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data", "results");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(patentNumber) {
  // ファイル名に使えない文字を除去
  const safe = String(patentNumber).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

/**
 * researchPatent の結果を保存する
 *
 * @param {string} patentNumber
 * @param {object} result - researchPatent() の戻り値
 * @returns {{ file: string, runIndex: number }}
 */
function saveResult(patentNumber, result) {
  ensureDir();
  const fp = filePath(patentNumber);

  let existing = { patentNumber, runs: [] };
  if (fs.existsSync(fp)) {
    try {
      existing = JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      // 壊れていたら上書き
    }
  }

  const run = {
    timestamp: new Date().toISOString(),
    scores: result.scores,
    rank: result.rank,
    rankMessage: result.rankMessage,
    valueBracket: result.valueBracket,
    valueRange: result.valueRange,
    royaltyRange: result.royaltyRange,
    metrics: result.patent?.metrics || {},
    source: result.source,
    title: result.patent?.title || ""
  };

  existing.runs.push(run);
  fs.writeFileSync(fp, JSON.stringify(existing, null, 2), "utf-8");

  return { file: fp, runIndex: existing.runs.length - 1 };
}

/**
 * 保存済み結果を読み込む
 *
 * @param {string} patentNumber
 * @returns {object|null}
 */
function loadResult(patentNumber) {
  const fp = filePath(patentNumber);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * 全保存済み結果のサマリーを返す
 *
 * @returns {Array<{ patentNumber: string, latestRun: object, runCount: number }>}
 */
function listResults() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8"));
      const latest = data.runs[data.runs.length - 1];
      return {
        patentNumber: data.patentNumber,
        runCount: data.runs.length,
        latestRun: latest
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

module.exports = { saveResult, loadResult, listResults, DATA_DIR };

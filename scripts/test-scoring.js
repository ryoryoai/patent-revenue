#!/usr/bin/env node
/**
 * スコアリングテスト — 結果をdata/results/に保存
 *
 * Usage:
 *   node scripts/test-scoring.js                  # 全件実行
 *   node scripts/test-scoring.js 6466025          # 1件指定
 *   node scripts/test-scoring.js --list            # 保存済み結果一覧
 *   node scripts/test-scoring.js --compare 6466025 # 過去のランとスコア比較
 */
require("dotenv").config();
const { researchPatent } = require("../lib/patent-research");
const { saveResult, loadResult, listResults } = require("../lib/result-store");

const DEFAULT_PATENTS = ["6466025", "5765727", "7012381", "6855083", "4514768", "6208773"];

async function runOne(patentNumber) {
  const start = Date.now();
  const result = await researchPatent(patentNumber, { name: "test" });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const { file, runIndex } = saveResult(patentNumber, result);
  const m = result.patent?.metrics || {};

  console.log(
    `${patentNumber} | ${(result.patent?.title || "").slice(0, 20).padEnd(20)} ` +
    `| score=${String(result.scores.total).padStart(3)} rank=${result.rank} ` +
    `| mktP=${String(m.marketPlayers ?? "-").padStart(2)} fDen=${String(m.filingDensity ?? "-").padStart(2)} ` +
    `cGrw=${String(m.citationGrowth ?? "-").padStart(3)} fSiz=${String(m.familySize ?? "-").padStart(2)} ` +
    `cRnk=${String(m.classRank ?? "-").padStart(3)} ` +
    `| ${result.valueBracket} | ${elapsed}s [run#${runIndex}]`
  );
  return result;
}

function showList() {
  const results = listResults();
  if (results.length === 0) {
    console.log("保存済み結果なし");
    return;
  }
  console.log("=== 保存済み結果 ===");
  console.log("特許番号     | runs | 最新スコア | ランク | 可能額区分");
  console.log("-------------|------|-----------|--------|----------");
  for (const r of results) {
    const l = r.latestRun;
    console.log(
      `${r.patentNumber.padEnd(13)}| ${String(r.runCount).padStart(4)} | ` +
      `${String(l.scores?.total ?? "-").padStart(9)} | ${(l.rank || "-").padStart(6)} | ${l.valueBracket || "-"}`
    );
  }
}

function showCompare(patentNumber) {
  const data = loadResult(patentNumber);
  if (!data) {
    console.log(`${patentNumber}: 結果なし`);
    return;
  }
  console.log(`=== ${patentNumber} スコア履歴 (${data.runs.length} runs) ===`);
  console.log("timestamp                 | score | rank | valueBracket          | mktP fDen cGrw fSiz cRnk");
  console.log("--------------------------|-------|------|-----------------------|-------------------------");
  for (const run of data.runs) {
    const m = run.metrics || {};
    console.log(
      `${run.timestamp.slice(0, 19).padEnd(26)}| ${String(run.scores?.total ?? "-").padStart(5)} | ` +
      `${(run.rank || "-").padStart(4)} | ${(run.valueBracket || "-").padEnd(21)} | ` +
      `${String(m.marketPlayers ?? "-").padStart(4)} ${String(m.filingDensity ?? "-").padStart(4)} ` +
      `${String(m.citationGrowth ?? "-").padStart(4)} ${String(m.familySize ?? "-").padStart(4)} ${String(m.classRank ?? "-").padStart(4)}`
    );
  }
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    showList();
    return;
  }

  if (args.includes("--compare")) {
    const idx = args.indexOf("--compare");
    const pn = args[idx + 1];
    if (!pn) {
      console.log("Usage: --compare <特許番号>");
      return;
    }
    showCompare(pn);
    return;
  }

  const patents = args.length > 0 ? args : DEFAULT_PATENTS;

  console.log(`=== スコアリングテスト (${patents.length}件) ===`);
  const ranks = {};
  for (const pn of patents) {
    try {
      const r = await runOne(pn);
      ranks[r.rank] = (ranks[r.rank] || 0) + 1;
    } catch (err) {
      console.log(`${pn} | ERROR: ${err.message}`);
    }
  }

  console.log("\n=== ランク分布 ===");
  for (const [rank, count] of Object.entries(ranks).sort()) {
    console.log(`  ${rank}: ${count}件`);
  }
})();

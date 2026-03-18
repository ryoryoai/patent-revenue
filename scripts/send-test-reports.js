#!/usr/bin/env node
/**
 * テスト結果をもとに詳細レポートメールを送信する
 *
 * Usage:
 *   node scripts/send-test-reports.js <email>
 *   node scripts/send-test-reports.js <email> 6466025 5765727   # 特定の特許のみ
 */
require("dotenv").config();
const { researchPatent } = require("../lib/patent-research");
const { sendDetailedReportEmail } = require("../lib/mailer");
const { saveResult } = require("../lib/result-store");

const DEFAULT_PATENTS = ["6466025", "5765727", "7012381", "6855083", "4514768", "6208773"];

const args = process.argv.slice(2);
const email = args[0];
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/send-test-reports.js <email> [patent1 patent2 ...]");
  process.exit(1);
}

const patents = args.length > 1 ? args.slice(1) : DEFAULT_PATENTS;

(async () => {
  console.log(`送信先: ${email}`);
  console.log(`対象: ${patents.length}件\n`);

  let sent = 0;
  for (const pn of patents) {
    try {
      console.log(`[${pn}] researching...`);
      const result = await researchPatent(pn, { name: "テスト" });
      saveResult(pn, result);

      console.log(`[${pn}] score=${result.scores.total} rank=${result.rank} | sending...`);

      const emailResult = await sendDetailedReportEmail({
        email,
        name: "テスト",
        reportData: {
          patent: result.patent,
          scores: result.scores,
          valueRange: result.valueRange,
          route: { title: result.scores.monetization >= 60 ? "ライセンス向き" : "調査強化推奨" },
          rank: result.rank,
          rankMessage: result.rankMessage,
          report: result.report,
          structured: result.structured
        }
      });

      console.log(`[${pn}] sent! id=${emailResult.id}\n`);
      sent++;
    } catch (err) {
      console.error(`[${pn}] ERROR: ${err.message}\n`);
    }
  }
  console.log(`=== 完了: ${sent}/${patents.length}件送信 ===`);
})();

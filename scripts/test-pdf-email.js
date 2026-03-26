#!/usr/bin/env node
/**
 * PDF生成 + メール送信テスト
 * 保存済みの特許1件でフルフローを実行し、指定メールアドレスにPDF付きレポートを送信する
 */
require("dotenv/config");
const { researchPatent } = require("../lib/patent-research");
const { sendDetailedReportEmail } = require("../lib/mailer");

const EMAIL = process.argv[2] || "rswt1018@gmail.com";
const PATENT = process.argv[3] || "7012381"; // 調湿装置及び調湿方法 (rank A)

(async () => {
  console.log(`=== PDF + メール送信テスト ===`);
  console.log(`特許番号: ${PATENT}`);
  console.log(`送信先: ${EMAIL}`);
  console.log();

  const result = await researchPatent(PATENT);
  console.log(`\nスコア: ${result.scores.total} (${result.rank})`);
  console.log(`評価額: ${result.valueBracket}`);

  const res = await sendDetailedReportEmail({
    email: EMAIL,
    name: "テストユーザー",
    reportData: result
  });

  console.log(`\nメール送信結果:`, res);
  console.log(`完了`);
})();

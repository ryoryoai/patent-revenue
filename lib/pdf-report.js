/**
 * PDF詳細評価レポート生成
 * Puppeteer (HTML→PDF) + @sparticuz/chromium-min でVercel対応
 *
 * structured データがある場合はリッチ表示 (強み軸、分野スコア、収益化順位)
 * ない場合は従来のフラットテキスト表示
 */
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium-min");

const CHROMIUM_PACK_URL =
  "https://github.com/nicholasgasior/chromium/releases/download/v143.0.0/chromium-v143.0.0-pack.tar";

async function getBrowser() {
  if (process.env.VERCEL) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: chromium.headless,
    });
  }
  return puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
}

/**
 * 詳細評価レポートPDFをBufferとして生成
 * @param {object} data - { patent, scores, rank, rankMessage, report, structured, name }
 * @returns {Promise<Buffer>}
 */
async function generateReportPdf(data) {
  const html = buildReportHtml(data);

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
    // Google Fontsの読み込み完了を待つ (最大10秒、失敗してもフォールバックフォントで続行)
    await page.evaluate(() =>
      Promise.race([
        document.fonts.ready,
        new Promise(resolve => setTimeout(resolve, 10000))
      ])
    );
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) await browser.close();
  }
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildReportHtml(data) {
  const { patent, report, structured, name, scores, rank } = data;
  const date = new Date().toLocaleDateString("ja-JP");

  let sections = "";
  if (report) {
    // 1. 発明の概要
    let summaryContent = `<p>${esc(report.summary)}</p>`;
    sections += sectionHtml("1. 発明の概要", summaryContent);

    // 2. 発明の強み・優位性
    if (structured?.strengths?.length > 0) {
      const strengthRows = structured.strengths.map(s => {
        const levelColor = s.level === "高" ? "#2d7d46" : s.level === "中" ? "#b8860b" : "#888";
        const evidenceTag = s.hasEvidence
          ? '<span class="tag tag-evidence">実証</span>'
          : '<span class="tag tag-infer">推測</span>';
        return `<tr>
          <td class="label">${esc(s.axis)}</td>
          <td style="color:${levelColor};font-weight:700;">${esc(s.level)}</td>
          <td>${esc(s.basis)} ${evidenceTag}</td>
        </tr>`;
      }).join("");
      sections += sectionHtml("2. 発明の強み・優位性",
        `<table class="report-table"><tr><td class="label" style="width:20%">評価軸</td><td style="width:10%">レベル</td><td>根拠</td></tr>${strengthRows}</table>`
      );
    } else {
      sections += sectionHtml("2. 発明の強み・優位性", `<p>${esc(report.strengths)}</p>`);
    }

    // 3. ライセンス可能な産業・技術分野
    if (structured?.licenseableFields?.length > 0) {
      const fieldRows = structured.licenseableFields
        .filter(f => f.score >= 0.3)
        .map(f => {
          const pct = Math.round(f.score * 100);
          const barWidth = Math.max(5, pct);
          return `<tr>
            <td class="label">${esc(f.field)}</td>
            <td>
              <div class="score-bar-bg"><div class="score-bar" style="width:${barWidth}%"></div></div>
              <span class="score-text">${pct}%</span>
            </td>
            <td>${esc(f.reason)}</td>
          </tr>`;
        }).join("");
      let fieldComment = "";
      if (report.licensableFields && report.licensableFields.includes("\n\n")) {
        fieldComment = `<p style="margin-top:8px;">${esc(report.licensableFields.split("\n\n").pop())}</p>`;
      }
      sections += sectionHtml("3. ライセンス可能な産業・技術分野",
        `<table class="report-table"><tr><td class="label" style="width:25%">分野</td><td style="width:30%">適合度</td><td>理由</td></tr>${fieldRows}</table>${fieldComment}`
      );
    } else {
      sections += sectionHtml("3. ライセンス可能な産業・技術分野", `<p>${esc(report.licensableFields)}</p>`);
    }

    // 4. 想定されるライセンス料率
    let royaltyContent = `<p>${esc(report.royaltyRate)}</p>`;
    if (structured?.perVerticalRates?.length > 0) {
      const rateRows = structured.perVerticalRates.map(v =>
        `<tr><td class="label">${esc(v.vertical)}</td><td style="font-weight:700;">${esc(v.range)}</td><td>${esc(v.reason)}</td></tr>`
      ).join("");
      royaltyContent += `<table class="report-table" style="margin-top:8px"><tr><td class="label" style="width:25%">対象分野</td><td style="width:20%">料率</td><td>根拠</td></tr>${rateRows}</table>`;
    }
    sections += sectionHtml("4. 想定されるライセンス料率", royaltyContent);


    // 6. ライセンス可能額の目安
    let valueBracketContent = `<p class="bold">【${esc(report.valueBracket)}】</p>`;
    if (report.valueBracketReason) {
      valueBracketContent += `<p>${esc(report.valueBracketReason)}</p>`;
    }
    sections += sectionHtml("6. ライセンス可能額の目安", valueBracketContent);

    // 7. 収益化手段
    if (structured?.monetizationMethods?.length > 0) {
      const methodRows = structured.monetizationMethods.map((m, i) => {
        const key = { "ライセンス": "license", "売却": "sale", "訴訟": "litigation", "製品・サービス化": "productization", "共同開発・事業": "jointDevelopment" }[m.type];
        const comment = report.monetizationMethods?.[key] || m.reason;
        const rankBadge = i === 0 ? ' <span class="tag tag-top">推奨</span>' : "";
        return `<tr>
          <td class="label">${esc(m.type)}${rankBadge}</td>
          <td style="text-align:center;font-weight:700;">${Math.round(m.score * 100)}点</td>
          <td>${esc(comment)}</td>
        </tr>`;
      }).join("");
      sections += sectionHtml("7. 収益化手段（スコア順）",
        `<table class="report-table"><tr><td class="label" style="width:25%">手段</td><td style="width:12%">スコア</td><td>評価</td></tr>${methodRows}</table>`
      );
    } else {
      const methods = report.monetizationMethods;
      if (typeof methods === "object" && methods !== null) {
        sections += sectionHtml("7. 収益化手段", tableHtml([
          ["ライセンス", methods.license],
          ["売却", methods.sale],
          ["訴訟", methods.litigation],
          ["製品・サービス化", methods.productization],
          ["他社との共同開発・事業", methods.jointDevelopment]
        ]));
      }
    }


    // 9. 次の一手
    if (structured?.nextActions?.length > 0) {
      const actionRows = structured.nextActions.map((a, i) => {
        return `<tr>
          <td class="label" style="text-align:center;width:15%">優先${i + 1}</td>
          <td style="font-weight:700;width:30%">${esc(a.action)}</td>
          <td>${esc(a.reason)}</td>
        </tr>`;
      }).join("");
      sections += sectionHtml("9. 次の一手（推奨アクション）",
        `<table class="report-table">${actionRows}</table>`
      );
    } else {
      const steps = report.nextSteps;
      if (typeof steps === "object" && steps !== null) {
        sections += sectionHtml("9. 次の一手（推奨アクション）", tableHtml([
          ["ライセンス・売却候補先の探索", steps.candidateSearch],
          ["ライセンスオファーレターの送付", steps.offerLetter],
          ["弁理士又は弁護士への相談", steps.legalConsultation],
          ["開発業者への相談", steps.developerConsultation],
          ["オープンイノベーションの提案", steps.openInnovation]
        ]));
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif;
    color: #333;
    font-size: 10pt;
    line-height: 1.7;
  }

  .header {
    background: #33478e;
    padding: 18px 40px;
    color: #fff;
  }
  .header h1 { font-size: 18pt; font-weight: 700; letter-spacing: 0.05em; }
  .header .sub { font-size: 9pt; color: rgba(255,255,255,0.7); margin-top: 2px; }

  .content { padding: 24px 40px 40px; }

  .meta { text-align: right; color: #666; font-size: 9pt; margin-bottom: 8px; }
  .greeting { font-size: 12pt; font-weight: 700; margin-bottom: 4px; }
  .patent-info { color: #666; font-size: 10pt; margin-bottom: 6px; }

  .section { margin-top: 20px; break-inside: avoid; }
  .section-title {
    font-size: 13pt;
    font-weight: 700;
    color: #33478e;
    padding-bottom: 6px;
    border-bottom: 2px solid #33478e;
    margin-bottom: 10px;
  }
  .section p { margin-bottom: 8px; line-height: 1.8; }
  .section .bold { font-weight: 700; }

  .confidence {
    font-size: 8pt;
    color: #888;
    margin-top: 4px;
  }

  .tag {
    display: inline-block;
    font-size: 7pt;
    padding: 1px 6px;
    border-radius: 3px;
    margin-left: 4px;
    vertical-align: middle;
  }
  .tag-evidence { background: #e8f5e9; color: #2e7d32; }
  .tag-infer { background: #fff3e0; color: #e65100; }
  .tag-top { background: #33478e; color: #fff; }

  .score-bar-bg {
    display: inline-block;
    width: 80px;
    height: 10px;
    background: #e8ecf5;
    border-radius: 5px;
    vertical-align: middle;
  }
  .score-bar {
    height: 100%;
    background: #33478e;
    border-radius: 5px;
  }
  .score-text {
    font-size: 8pt;
    color: #33478e;
    font-weight: 700;
    margin-left: 4px;
    vertical-align: middle;
  }

  table.report-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  table.report-table td {
    border: 1px solid #ccc;
    padding: 8px 10px;
    vertical-align: top;
    font-size: 9pt;
    line-height: 1.7;
  }
  table.report-table td.label {
    background: #f0f3fa;
    font-weight: 700;
    width: 32%;
  }

  .footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid #ccc;
    text-align: center;
    color: #666;
    font-size: 8pt;
  }
  .footer p { margin-bottom: 4px; }
</style>
</head>
<body>

<div class="header">
  <h1>PatentRevenue</h1>
  <div class="sub">特許詳細評価レポート</div>
</div>

<div class="content">
  <div class="meta">発行日: ${esc(date)}</div>
  ${name ? `<div class="greeting">${esc(name)} 様</div>` : ""}
  ${patent?.title ? `<div class="patent-info">対象特許: ${esc(patent.title)}</div>` : ""}
  ${patent?.id ? `<div class="patent-info">特許番号: ${esc(patent.id)}</div>` : ""}

  ${sections}

  <div class="footer">
    <p>本レポートはAIによる推定に基づく参考情報です。法的助言や投資判断の根拠として使用する前に、専門家にご相談ください。</p>
    <p>&copy; PatentRevenue - 特許を収益に変える</p>
  </div>
</div>

</body>
</html>`;
}

function sectionHtml(title, content) {
  return `<div class="section">
  <div class="section-title">${esc(title)}</div>
  ${content}
</div>`;
}

function tableHtml(rows) {
  const trs = rows.map(([label, value]) =>
    `<tr><td class="label">${esc(label)}</td><td>${esc(value || "-")}</td></tr>`
  ).join("");
  return `<table class="report-table">${trs}</table>`;
}

module.exports = { generateReportPdf };

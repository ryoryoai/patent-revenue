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
  "https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar";

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

const PAGE_MARGIN = { top: "28mm", bottom: "20mm", left: "20mm", right: "20mm" };

/**
 * 詳細評価レポートPDFをBufferとして生成
 */
async function generateReportPdf(data) {
  const html = buildReportHtml(data);
  const patentNum = data.patent?.id || "";

  let browser;
  try {
    browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    } catch {
      // Google Fonts timeout fallback
      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
    }
    await page.evaluate(() => document.fonts.ready);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      margin: PAGE_MARGIN,
      headerTemplate: `
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:0 12mm;border-bottom:1px solid #d0d5e8;">
          <span style="font-size:7px;font-weight:700;color:#33478e;letter-spacing:0.08em;">PatentRevenue</span>
          <span style="font-size:7px;color:#8890aa;">特許詳細評価レポート${patentNum ? " | 特許" + patentNum : ""}</span>
        </div>`,
      footerTemplate: `
        <div style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:0 12mm;">
          <span style="font-size:7px;color:#aaa;">Confidential</span>
          <span style="font-size:7px;color:#999;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
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
    sections += sectionHtml("1. 発明の概要", `<p>${esc(report.summary)}</p>`);

    // 2. 発明の強み・優位性
    if (structured?.strengths?.length > 0) {
      const strengthRows = structured.strengths.map(s => {
        const levelColor = s.level === "高" ? "#2d7d46" : s.level === "中" ? "#b8860b" : "#888";
        const evidenceTag = s.hasEvidence
          ? '<span class="tag tag-evidence">実証</span>'
          : '<span class="tag tag-infer">推測</span>';
        return `<tr>
          <td class="td-label">${esc(s.axis)}</td>
          <td style="color:${levelColor};font-weight:700;">${esc(s.level)}</td>
          <td>${esc(s.basis)} ${evidenceTag}</td>
        </tr>`;
      }).join("");
      sections += sectionHtml("2. 発明の強み・優位性",
        `<table class="tbl"><thead><tr><th style="width:20%">評価軸</th><th style="width:10%">レベル</th><th>根拠</th></tr></thead><tbody>${strengthRows}</tbody></table>`
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
            <td class="td-label">${esc(f.field)}</td>
            <td>
              <div class="bar-bg"><div class="bar-fill" style="width:${barWidth}%"></div></div>
              <span class="bar-text">${pct}%</span>
            </td>
            <td>${esc(f.reason)}</td>
          </tr>`;
        }).join("");
      let fieldComment = "";
      if (report.licensableFields && report.licensableFields.includes("\n\n")) {
        fieldComment = `<p style="margin-top:8px;">${esc(report.licensableFields.split("\n\n").pop())}</p>`;
      }
      sections += sectionHtml("3. ライセンス可能な産業・技術分野",
        `<table class="tbl"><thead><tr><th style="width:25%">分野</th><th style="width:30%">適合度</th><th>理由</th></tr></thead><tbody>${fieldRows}</tbody></table>${fieldComment}`
      );
    } else {
      sections += sectionHtml("3. ライセンス可能な産業・技術分野", `<p>${esc(report.licensableFields)}</p>`);
    }

    // 4. 想定されるライセンス料率
    let royaltyContent = `<p>${esc(report.royaltyRate)}</p>`;
    if (structured?.perVerticalRates?.length > 0) {
      const rateRows = structured.perVerticalRates.map(v =>
        `<tr><td class="td-label">${esc(v.vertical)}</td><td style="font-weight:700;">${esc(v.range)}</td><td>${esc(v.reason)}</td></tr>`
      ).join("");
      royaltyContent += `<table class="tbl" style="margin-top:8px"><thead><tr><th style="width:25%">対象分野</th><th style="width:20%">料率</th><th>根拠</th></tr></thead><tbody>${rateRows}</tbody></table>`;
    }
    sections += sectionHtml("4. 想定されるライセンス料率", royaltyContent);

    // 6. ライセンス可能額の目安
    let valueBracketContent = `<div class="highlight-box"><span class="highlight-value">${esc(report.valueBracket)}</span></div>`;
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
          <td class="td-label">${esc(m.type)}${rankBadge}</td>
          <td style="text-align:center;font-weight:700;">${Math.round(m.score * 100)}点</td>
          <td>${esc(comment)}</td>
        </tr>`;
      }).join("");
      const hasLitigation = structured.monetizationMethods.some(m => m.type === "訴訟");
      const litigationWarning = hasLitigation ? `
        <div class="warn-box">
          <p class="warn-title">⚠ 訴訟に関する重要な注意</p>
          <p class="warn-body">本レポートにおける訴訟に関する評価は、法的助言には該当しません。訴訟の成否は個別の事実関係・証拠・裁判管轄等に大きく依存するため、訴訟を検討される場合は必ず知的財産法に精通した弁護士にご相談ください。本レポートの記載内容を根拠とした訴訟提起またはその他の法的手続きにより生じた損害について、当社は一切の責任を負いません。</p>
        </div>` : "";
      sections += sectionHtml("7. 収益化手段（スコア順）",
        `<table class="tbl"><thead><tr><th style="width:25%">手段</th><th style="width:12%">スコア</th><th>評価</th></tr></thead><tbody>${methodRows}</tbody></table>${litigationWarning}`
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
          <td class="td-label" style="text-align:center;width:15%">優先${i + 1}</td>
          <td style="font-weight:700;width:30%">${esc(a.action)}</td>
          <td>${esc(a.reason)}</td>
        </tr>`;
      }).join("");
      sections += sectionHtml("9. 次の一手（推奨アクション）",
        `<table class="tbl"><tbody>${actionRows}</tbody></table>`
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
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;700&display=swap" rel="stylesheet">
<style>
  @page { margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif;
    color: #2a2a2a;
    font-size: 9.5pt;
    line-height: 1.75;
    -webkit-print-color-adjust: exact;
  }

  /* ===== Cover Header (page 1 only) ===== */
  .cover {
    background: linear-gradient(135deg, #2b3d7e 0%, #3d54a3 100%);
    color: #fff;
    padding: 32px 0 24px;
    margin: -28mm -20mm 0 -20mm;
    padding-left: 40px;
    padding-right: 40px;
  }
  .cover h1 {
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    margin-bottom: 2px;
  }
  .cover .sub {
    font-size: 9pt;
    color: rgba(255,255,255,0.65);
    font-weight: 300;
  }
  .cover .accent-line {
    width: 48px;
    height: 3px;
    background: rgba(255,255,255,0.4);
    border-radius: 2px;
    margin-top: 12px;
  }

  /* ===== Meta Block ===== */
  .meta-block {
    margin-top: 20px;
    margin-bottom: 24px;
    padding: 16px 20px;
    background: #f6f7fb;
    border-radius: 6px;
    border-left: 4px solid #33478e;
  }
  .meta-block .greeting {
    font-size: 12pt;
    font-weight: 700;
    color: #2b3d7e;
    margin-bottom: 6px;
  }
  .meta-block .detail {
    font-size: 9pt;
    color: #555;
    line-height: 1.8;
  }
  .meta-block .detail span { margin-right: 16px; }
  .meta-date {
    text-align: right;
    font-size: 8.5pt;
    color: #999;
    margin-top: 12px;
  }

  /* ===== Sections ===== */
  .section {
    margin-top: 26px;
    break-inside: avoid;
  }
  .section-title {
    font-size: 12pt;
    font-weight: 700;
    color: #2b3d7e;
    padding-bottom: 5px;
    border-bottom: 2px solid #33478e;
    margin-bottom: 10px;
    break-after: avoid;
  }
  .section p {
    margin-bottom: 8px;
    line-height: 1.85;
    text-align: justify;
  }

  /* ===== Tables ===== */
  .tbl {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6px;
    font-size: 9pt;
    break-inside: avoid;
  }
  .tbl thead th {
    background: #33478e;
    color: #fff;
    font-weight: 700;
    font-size: 8.5pt;
    padding: 7px 10px;
    text-align: left;
    border: none;
  }
  .tbl tbody td {
    border-bottom: 1px solid #dee2ed;
    padding: 9px 10px;
    vertical-align: top;
    line-height: 1.7;
  }
  .tbl tbody tr:last-child td { border-bottom: 2px solid #33478e; }
  .tbl tbody tr:nth-child(even) td { background: #f8f9fc; }
  .td-label {
    font-weight: 700;
    color: #333;
    background: #f0f2f8 !important;
  }

  /* ===== Tags ===== */
  .tag {
    display: inline-block;
    font-size: 7pt;
    padding: 1px 7px;
    border-radius: 3px;
    margin-left: 4px;
    vertical-align: middle;
    font-weight: 700;
  }
  .tag-evidence { background: #e8f5e9; color: #2e7d32; }
  .tag-infer { background: #fff3e0; color: #e65100; }
  .tag-top { background: #33478e; color: #fff; }

  /* ===== Score Bars ===== */
  .bar-bg {
    display: inline-block;
    width: 80px;
    height: 10px;
    background: #e4e8f2;
    border-radius: 5px;
    vertical-align: middle;
  }
  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #3d54a3, #33478e);
    border-radius: 5px;
  }
  .bar-text {
    font-size: 8pt;
    color: #33478e;
    font-weight: 700;
    margin-left: 6px;
    vertical-align: middle;
  }

  /* ===== Highlight Box (value bracket) ===== */
  .highlight-box {
    background: linear-gradient(135deg, #f0f2f8 0%, #e8ecf5 100%);
    border: 1px solid #c8d0e8;
    border-radius: 6px;
    padding: 14px 20px;
    text-align: center;
    margin: 8px 0;
  }
  .highlight-value {
    font-size: 14pt;
    font-weight: 700;
    color: #2b3d7e;
    letter-spacing: 0.04em;
  }

  /* ===== Warning Box ===== */
  .warn-box {
    margin-top: 12px;
    padding: 10px 14px;
    background: #fffaf0;
    border: 1px solid #e8a838;
    border-left: 4px solid #d4760a;
    border-radius: 4px;
  }
  .warn-title { margin: 0; font-size: 8pt; font-weight: 700; color: #b85c00; }
  .warn-body { margin: 4px 0 0; font-size: 8pt; color: #7a4a00; line-height: 1.6; }

  /* ===== Footer Disclaimer ===== */
  .doc-footer {
    margin-top: 36px;
    padding-top: 14px;
    border-top: 1px solid #d0d5e8;
    text-align: center;
    color: #888;
    font-size: 7.5pt;
    line-height: 1.7;
  }
  .doc-footer .copy {
    margin-top: 6px;
    font-size: 8pt;
    color: #33478e;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>

<div class="cover">
  <h1>PatentRevenue</h1>
  <div class="sub">特許詳細評価レポート</div>
  <div class="accent-line"></div>
</div>

<div class="meta-date">発行日: ${esc(date)}</div>

<div class="meta-block">
  ${name ? `<div class="greeting">${esc(name)} 様</div>` : ""}
  <div class="detail">
    ${patent?.title ? `<span>対象特許: ${esc(patent.title)}</span>` : ""}
    ${patent?.id ? `<span>特許番号: ${esc(patent.id)}</span>` : ""}
    ${rank ? `<span>総合ランク: ${esc(rank)}</span>` : ""}
  </div>
</div>

${sections}

<div class="doc-footer">
  <p>本レポートはAIによる推定に基づく参考情報であり、法的助言、投資助言、価格保証のいずれにも該当しません。<br>訴訟を含む法的手続きの判断や投資判断の根拠として使用しないでください。意思決定にあたっては、必ず専門家にご相談ください。</p>
  <p class="copy">&copy; PatentRevenue - 特許を収益に変える</p>
</div>

</body>
</html>`;
}

function sectionHtml(title, content) {
  return `<div class="section">
  <div class="section-title">${title}</div>
  ${content}
</div>`;
}

function tableHtml(rows) {
  const trs = rows.map(([label, value]) =>
    `<tr><td class="td-label">${esc(label)}</td><td>${esc(value || "-")}</td></tr>`
  ).join("");
  return `<table class="tbl"><tbody>${trs}</tbody></table>`;
}

module.exports = { generateReportPdf };

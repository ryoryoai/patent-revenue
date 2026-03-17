/**
 * PDF詳細評価レポート生成
 * pdfkitを使用してA4 PDFを生成する
 */
const PDFDocument = require("pdfkit");
const path = require("path");

// 日本語フォント（Noto Sans JP）のパス
const FONT_REGULAR = path.join(__dirname, "../fonts/NotoSansJP-Regular.otf");
const FONT_BOLD = path.join(__dirname, "../fonts/NotoSansJP-Bold.otf");

const BRAND_COLOR = "#33478e";
const TEXT_COLOR = "#333333";
const SUB_COLOR = "#666666";
const BORDER_COLOR = "#cccccc";

/**
 * 詳細評価レポートPDFをBufferとして生成
 * @param {object} data - { patent, scores, rank, rankMessage, report, name }
 * @returns {Promise<Buffer>}
 */
function generateReportPdf(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `特許詳細評価レポート - ${data.patent?.title || ""}`,
          Author: "PatentRevenue",
          Subject: "特許詳細評価レポート"
        }
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // フォント登録
      doc.registerFont("NotoSans", FONT_REGULAR);
      doc.registerFont("NotoSansBold", FONT_BOLD);

      const { patent, scores, rank, report, name } = data;
      const pageWidth = doc.page.width - 100; // margins

      // ── ヘッダー ──
      doc.rect(0, 0, doc.page.width, 70).fill(BRAND_COLOR);
      doc.font("NotoSansBold").fontSize(18).fillColor("#ffffff")
        .text("PatentRevenue", 50, 20);
      doc.font("NotoSans").fontSize(9).fillColor("rgba(255,255,255,0.7)")
        .text("特許詳細評価レポート", 50, 45);
      doc.fillColor(TEXT_COLOR);

      let y = 90;

      // ── 宛名・日付 ──
      doc.font("NotoSans").fontSize(10).fillColor(SUB_COLOR);
      doc.text(`発行日: ${new Date().toLocaleDateString("ja-JP")}`, 50, y, { align: "right", width: pageWidth });
      y += 20;
      if (name) {
        doc.font("NotoSansBold").fontSize(12).fillColor(TEXT_COLOR);
        doc.text(`${name} 様`, 50, y);
        y += 24;
      }

      // ── 特許情報 ──
      y = drawSectionTitle(doc, "特許情報", 50, y, pageWidth);
      const patentInfo = [
        ["発明の名称", patent?.title || "-"],
        ["特許番号", patent?.id || "-"],
        ["出願人", patent?.applicant || "-"],
        ["出願日", patent?.filingDate || "-"],
        ["登録日", patent?.registrationDate || "-"],
        ["ステータス", patent?.status || "-"]
      ];
      y = drawTable(doc, patentInfo, 50, y, pageWidth);
      y += 10;

      // ── 総合評価 ──
      y = drawSectionTitle(doc, "総合評価", 50, y, pageWidth);
      doc.font("NotoSansBold").fontSize(28).fillColor(BRAND_COLOR);
      doc.text(`ランク ${rank || "-"}`, 50, y, { align: "center", width: pageWidth });
      y += 40;

      if (scores) {
        const scoreData = [
          ["影響度", `${scores.impact}/100`],
          ["権利の広さ", `${scores.breadth}/100`],
          ["実務上の強さ", `${scores.strength}/100`],
          ["収益化の近さ", `${scores.monetization}/100`],
          ["総合スコア", `${scores.total}/100`]
        ];
        y = drawTable(doc, scoreData, 50, y, pageWidth);
        y += 10;
      }

      // ── 7項目のレポートセクション ──
      if (report) {
        // 1. 発明の概要
        y = checkPageBreak(doc, y, 80);
        y = drawSectionTitle(doc, "1. 発明の概要", 50, y, pageWidth);
        y = drawParagraph(doc, report.summary, 50, y, pageWidth);

        // 2. 発明の強み・優位性
        y = checkPageBreak(doc, y, 80);
        y = drawSectionTitle(doc, "2. 発明の強み・優位性", 50, y, pageWidth);
        y = drawParagraph(doc, report.strengths, 50, y, pageWidth);

        // 3. ライセンス可能な産業・技術分野
        y = checkPageBreak(doc, y, 80);
        y = drawSectionTitle(doc, "3. ライセンス可能な産業・技術分野", 50, y, pageWidth);
        y = drawParagraph(doc, report.licensableFields, 50, y, pageWidth);

        // 4. 想定されるライセンス料率
        y = checkPageBreak(doc, y, 80);
        y = drawSectionTitle(doc, "4. 想定されるライセンス料率", 50, y, pageWidth);
        y = drawParagraph(doc, report.royaltyRate, 50, y, pageWidth);

        // 5. ライセンス可能額の目安
        y = checkPageBreak(doc, y, 80);
        y = drawSectionTitle(doc, "5. ライセンス可能額の目安", 50, y, pageWidth);
        const bracketText = typeof report.valueBracket === "string" ? report.valueBracket : "-";
        const bracketReason = report.valueBracketReason || "";
        y = drawParagraph(doc, `【${bracketText}】`, 50, y, pageWidth, true);
        if (bracketReason) {
          y = drawParagraph(doc, bracketReason, 50, y, pageWidth);
        }

        // 6. 収益化手段
        y = checkPageBreak(doc, y, 120);
        y = drawSectionTitle(doc, "6. 収益化手段", 50, y, pageWidth);
        const methods = report.monetizationMethods;
        if (typeof methods === "object" && methods !== null) {
          const methodItems = [
            ["ライセンス", methods.license],
            ["売却", methods.sale],
            ["訴訟", methods.litigation],
            ["製品・サービス化", methods.productization],
            ["他社との共同開発・事業", methods.jointDevelopment]
          ];
          y = drawTable(doc, methodItems, 50, y, pageWidth);
        } else {
          y = drawParagraph(doc, String(methods || "-"), 50, y, pageWidth);
        }

        // 7. 次の一手（推奨アクション）
        y = checkPageBreak(doc, y, 120);
        y = drawSectionTitle(doc, "7. 次の一手（推奨アクション）", 50, y, pageWidth);
        const steps = report.nextSteps;
        if (typeof steps === "object" && steps !== null) {
          const stepItems = [
            ["ライセンス・売却候補先の探索", steps.candidateSearch],
            ["ライセンスオファーレターの送付", steps.offerLetter],
            ["弁理士又は弁護士への相談", steps.legalConsultation],
            ["開発業者への相談", steps.developerConsultation],
            ["オープンイノベーションの提案", steps.openInnovation]
          ];
          y = drawTable(doc, stepItems, 50, y, pageWidth);
        } else {
          y = drawParagraph(doc, String(steps || "-"), 50, y, pageWidth);
        }
      }

      // ── フッター ──
      y = checkPageBreak(doc, y, 60);
      y += 20;
      doc.moveTo(50, y).lineTo(50 + pageWidth, y).strokeColor(BORDER_COLOR).stroke();
      y += 10;
      doc.font("NotoSans").fontSize(8).fillColor(SUB_COLOR);
      doc.text(
        "本レポートはAIによる推定に基づく参考情報です。法的助言や投資判断の根拠として使用する前に、専門家にご相談ください。",
        50, y, { width: pageWidth, align: "center" }
      );
      y += 20;
      doc.text("© PatentRevenue - 知財を収益に変える", 50, y, { width: pageWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── ヘルパー関数 ──

function drawSectionTitle(doc, title, x, y, width) {
  doc.font("NotoSansBold").fontSize(13).fillColor(BRAND_COLOR);
  doc.text(title, x, y, { width });
  y += 20;
  doc.moveTo(x, y).lineTo(x + width, y).strokeColor(BRAND_COLOR).lineWidth(1.5).stroke();
  doc.lineWidth(1);
  return y + 8;
}

function drawParagraph(doc, text, x, y, width, bold) {
  doc.font(bold ? "NotoSansBold" : "NotoSans").fontSize(10).fillColor(TEXT_COLOR);
  doc.text(String(text || "-"), x, y, { width, lineGap: 4 });
  return doc.y + 12;
}

function drawTable(doc, rows, x, y, width) {
  const labelWidth = Math.min(180, width * 0.35);
  const valueWidth = width - labelWidth;

  for (const [label, value] of rows) {
    const estimatedHeight = Math.max(
      doc.font("NotoSansBold").fontSize(9).heightOfString(label, { width: labelWidth - 10 }),
      doc.font("NotoSans").fontSize(9).heightOfString(String(value || "-"), { width: valueWidth - 10 })
    );
    y = checkPageBreak(doc, y, estimatedHeight + 16);

    doc.rect(x, y, labelWidth, estimatedHeight + 12).fill("#f0f3fa");
    doc.rect(x + labelWidth, y, valueWidth, estimatedHeight + 12).fill("#ffffff");
    doc.rect(x, y, width, estimatedHeight + 12).strokeColor(BORDER_COLOR).stroke();

    doc.font("NotoSansBold").fontSize(9).fillColor(TEXT_COLOR);
    doc.text(label, x + 6, y + 6, { width: labelWidth - 12 });

    doc.font("NotoSans").fontSize(9).fillColor(TEXT_COLOR);
    doc.text(String(value || "-"), x + labelWidth + 6, y + 6, { width: valueWidth - 12 });

    y += estimatedHeight + 12;
  }
  return y + 4;
}

function checkPageBreak(doc, y, requiredHeight) {
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  if (y + requiredHeight > pageBottom) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

module.exports = { generateReportPdf };

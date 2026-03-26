const https = require("https");
const { sanitizeHeaderValue } = require("./header-safety");

const RESEND_API_KEY = sanitizeHeaderValue(process.env.RESEND_API_KEY || "");
const MAIL_FROM = process.env.MAIL_FROM || "noreply@patent-revenue.iprich.jp";

const SITE_HOST = process.env.SITE_HOST || "patent-value-analyzer.iprich.jp";

function buildResultEmailHtml(data) {
  const { rank, name, tokenUrl, siteHost = SITE_HOST } = data;

  const rankLabels = {
    A: "ライセンス・売却できる可能性がとても高い",
    B: "ライセンス・売却できる可能性が高い",
    C: "ライセンス・売却できる可能性がある",
    D: "ライセンス・売却できる可能性が低い"
  };

  const currentRankLabel = rankLabels[rank] || rankLabels.C;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>特許の簡易評価結果</title>
</head>
<body style="margin:0;padding:0;background:#dee7f9;font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;-webkit-font-smoothing:antialiased;">

<!-- Header -->
<div style="background:#33478e;padding:20px 0;text-align:center;">
  <table align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    <tr>
      <td style="padding:0 24px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">PatentRevenue</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.04em;">特許を収益に変える</p>
      </td>
    </tr>
  </table>
</div>

<!-- Main Content -->
<div style="max-width:600px;margin:0 auto;padding:24px 16px 40px;">

  <!-- Greeting -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.8;">${name ? `${name} 様` : "お客様"}</p>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.8;">特許売買・ライセンスプラットフォーム「PatentRevenue」をご利用いただき、誠にありがとうございます。</p>
    <p style="margin:8px 0 0;font-size:14px;color:#555;line-height:1.8;">ご入力いただいた情報に基づき、特許の簡易評価を行いました。結果は以下の通りです。</p>
  </div>

  <!-- Patent Value Score -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <h2 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#33478e;text-align:center;">Patent Value Score</h2>

    <div style="background:linear-gradient(155deg,#ffffff 0%,#e8f0fe 50%,#d8ffff 100%);border-radius:8px;border:1px solid rgba(51,71,142,0.2);padding:28px 24px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;font-size:18px;font-weight:700;color:#33478e;line-height:1.6;">${currentRankLabel}</p>
    </div>

    <p style="margin:0;font-size:13px;color:#6b7a99;line-height:1.7;text-align:center;">詳細な分析結果は「詳細評価レポート」でご確認いただけます。</p>
  </div>

  <!-- Next Steps -->
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;">
    <h2 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#33478e;">詳細評価レポートのご案内</h2>
    <p style="margin:0 0 12px;font-size:14px;color:#555;line-height:1.8;">お客様の特許について、AIが以下の観点からさらに詳しく分析した「詳細評価レポート」をご用意できます。</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
      <tr><td style="padding:6px 0;font-size:14px;color:#33478e;">&#10003; ライセンス可能額の目安</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#33478e;">&#10003; 想定ライセンス先の分析</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#33478e;">&#10003; 特許の強み・市場性の評価</td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#33478e;">&#10003; 収益化に向けた具体的なアドバイス</td></tr>
    </table>
    <p style="margin:0;font-size:14px;color:#555;line-height:1.8;">診断結果ページの「詳細レポートを申請する」ボタンから、追加情報を入力してお申し込みください。</p>
  </div>

  <!-- Detail Registration CTA -->
  ${tokenUrl ? `
  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:28px 24px;margin-bottom:16px;text-align:center;">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#33478e;">詳細登録はこちら</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#555;line-height:1.8;">売却・ライセンスの詳細情報を登録すると、AIによる詳細評価レポートを受け取れます。</p>
    <a href="${tokenUrl}" style="display:inline-block;padding:12px 32px;background:#33478e;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:700;">詳細を登録する</a>
    <p style="margin:12px 0 0;font-size:12px;color:#9aa3c0;">このリンクは7日間有効です。</p>
  </div>
  ` : ""}

  <!-- Disclaimer -->
  <div style="background:#f5f6fa;border-radius:8px;padding:16px 20px;margin-bottom:16px;border-left:3px solid #33478e;">
    <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.7;">本診断は公開情報にもとづく概算です。取引価格や成約を保証するものではありません。</p>
  </div>

</div>

<!-- Footer -->
<div style="background:#1f266b;padding:28px 16px;text-align:center;">
  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">PatentRevenue</p>
  <p style="margin:0 0 12px;font-size:11px;color:rgba(255,255,255,0.6);">特許を収益に変える</p>
  <table align="center" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:0 10px;"><a href="https://patent-revenue.iprich.jp/" style="font-size:12px;color:rgba(255,255,255,0.7);text-decoration:none;">サービス概要</a></td>
      <td style="padding:0 10px;border-left:1px solid rgba(255,255,255,0.2);"><a href="https://${siteHost}/privacy.html" style="font-size:12px;color:rgba(255,255,255,0.7);text-decoration:none;">プライバシーポリシー</a></td>
    </tr>
  </table>
  <p style="margin:16px 0 0;font-size:11px;color:rgba(255,255,255,0.4);">
    このメールは PatentRevenue の簡易評価結果送信リクエストにより送信されました。<br />
    &copy; ${new Date().getFullYear()} IP Rich Co.,Ltd.
  </p>
</div>

</body>
</html>`;
}

function buildDetailedReportEmailHtml(data) {
  const displayName = data.name || "お客様";
  const siteHost = data.siteHost || SITE_HOST;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>特許の詳細評価レポートのご送付</title>
</head>
<body style="margin:0;padding:0;background:#dee7f9;font-family:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;-webkit-font-smoothing:antialiased;">

<!-- Header -->
<div style="background:#33478e;padding:20px 0;text-align:center;">
  <table align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
    <tr>
      <td style="padding:0 24px;">
        <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">PatentRevenue</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.04em;">特許を収益に変える</p>
      </td>
    </tr>
  </table>
</div>

<!-- Main Content -->
<div style="max-width:600px;margin:0 auto;padding:24px 16px 40px;">

  <div style="background:#ffffff;border-radius:8px;border:1px solid rgba(51,71,142,0.15);box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:32px 28px;margin-bottom:16px;">

    <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.8;">${displayName} 様</p>

    <p style="margin:0 0 8px;font-size:14px;color:#555;line-height:2.0;">PatentRevenueへの特許登録、および詳細評価へのお申し込みをいただき、誠にありがとうございます。</p>

    <p style="margin:0 0 28px;font-size:14px;color:#555;line-height:2.0;">ご依頼いただいておりました詳細評価レポートが完成いたしましたので、本メールに添付して送付いたします。</p>

    <div style="background:#f5f6fa;border-radius:6px;padding:18px 22px;margin:0 0 28px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#33478e;">■ 送付内容</p>
      <p style="margin:0;font-size:14px;color:#333;line-height:1.8;">詳細評価レポート（PDF形式）</p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#555;line-height:2.0;">本レポートが、${displayName} 様の保有される特許資産の有効活用の一助となれば幸いです。</p>

    <p style="margin:0 0 28px;font-size:14px;color:#555;line-height:2.0;">今後ともPatentRevenueをよろしくお願い申し上げます。</p>

    <div style="border-top:1px solid #e8ecf5;padding-top:16px;">
      <p style="margin:0;font-size:12px;color:#6b7a99;line-height:1.8;">※本レポートの内容についての具体的なご質問やご相談には対応できない場合がございますので予めご了承下さい。</p>
    </div>

    <div style="background:#fff8f0;border-radius:6px;padding:14px 18px;margin:20px 0 0;border-left:3px solid #d4760a;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#b85c00;">重要なお知らせ</p>
      <p style="margin:0;font-size:12px;color:#7a4a00;line-height:1.8;">添付レポートはAIによる分析に基づく参考情報です。法的助言や投資助言には該当しません。特に訴訟を含む法的手続きの検討にあたっては、必ず専門の弁護士にご相談ください。レポートの内容に基づく意思決定により生じた損害について、当社は責任を負いかねます。<a href="https://${siteHost}/terms.html" style="color:#33478e;">利用規約</a>もあわせてご確認ください。</p>
    </div>

  </div>

</div>

<!-- Footer -->
<div style="background:#1f266b;padding:28px 16px;text-align:center;">
  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">PatentRevenue</p>
  <p style="margin:0 0 12px;font-size:11px;color:rgba(255,255,255,0.6);">特許を収益に変える</p>
  <p style="margin:16px 0 0;font-size:11px;color:rgba(255,255,255,0.4);">
    &copy; ${new Date().getFullYear()} IP Rich Co.,Ltd.
  </p>
</div>

</body>
</html>`;
}

function sendEmail({ to, subject, html, attachments }) {
  if (!RESEND_API_KEY) {
    console.warn("[mailer] RESEND_API_KEY not set, skipping email send");
    return Promise.resolve({ id: "dev-skip", message: "No API key configured" });
  }

  return new Promise((resolve, reject) => {
    const payload = {
      from: MAIL_FROM,
      to: [to],
      subject,
      html
    };
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }
    const body = JSON.stringify(payload);

    const options = {
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("email_timeout"));
    }, 10000);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || `Resend API error: ${res.statusCode}`));
          }
        } catch (error) {
          reject(new Error("email_parse_error"));
        }
      });
    });

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    req.write(body);
    req.end();
  });
}

async function sendResultEmail({ email, name, reportData, tokenUrl, siteHost }) {
  const html = buildResultEmailHtml({ ...reportData, name, tokenUrl, siteHost });
  const subject = "【PatentRevenue】特許の簡易評価結果のお知らせ";
  return sendEmail({ to: email, subject, html });
}

async function sendDetailedReportEmail({ email, name, reportData }) {
  const dataWithName = { ...reportData, name };
  const html = buildDetailedReportEmailHtml(dataWithName);
  const subject = "【PatentRevenue】特許の詳細評価レポートのご送付";

  // PDF生成・添付
  let attachments;
  let pdfInfo = { generated: false };
  try {
    const { generateReportPdf } = require("./pdf-report");
    const pdfBuffer = await generateReportPdf(dataWithName);
    const patentId = reportData.patent?.id || "report";
    attachments = [{
      filename: `PatentRevenue_詳細評価レポート_${patentId}.pdf`,
      content: pdfBuffer.toString("base64")
    }];
    pdfInfo = { generated: true, size: pdfBuffer.length };
    console.log(`[mailer] PDF generated: ${pdfBuffer.length} bytes`);
  } catch (err) {
    pdfInfo = { generated: false, error: err.message };
    console.error("[mailer] PDF generation failed, sending without attachment:", err.message, err.stack?.split("\n").slice(0, 3).join(" "));
  }

  await sendEmail({ to: email, subject, html, attachments });
  return pdfInfo;
}

async function sendPatentInvalidEmail({ email, name, patentNumber, status }) {
  const statusMessages = {
    "消滅": "権利が消滅しています",
    "拒絶": "出願が拒絶されています",
    "出願中": "出願中で、まだ登録されていません",
    "取下": "出願が取り下げられています"
  };
  const statusDesc = statusMessages[status] || `有効ではありません（状態: ${status}）`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">特許評価レポートについて</h2>
      <p>${name ? `${name} 様` : "お客様"}</p>
      <p>ご依頼いただいた特許（<strong>${patentNumber}</strong>）について確認いたしました。</p>
      <p>この特許は<strong>${statusDesc}</strong>ため、詳細評価レポートを作成することができませんでした。</p>
      <p>有効な特許（登録済み）の番号をご確認の上、再度お申し込みください。</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">&copy; 2026 IP Rich Co.,Ltd. — PatentRevenue</p>
    </div>
  `;
  const subject = "【PatentRevenue】特許評価レポートについてのご連絡";
  return sendEmail({ to: email, subject, html });
}

module.exports = { sendResultEmail, sendDetailedReportEmail, sendPatentInvalidEmail };

const https = require("https");

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "noreply@patent-revenue.iprich.jp";

function yenLabel(value) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億円`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ja-JP")}万円`;
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function buildResultEmailHtml(data) {
  const { patent, scores, valueRange, route, rank, rankMessage } = data;

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f8f9fb;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:32px 20px;">
  <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:28px;">
    <p style="margin:0 0 4px;font-size:12px;color:#8892a0;letter-spacing:0.04em;">Patent Value Check</p>
    <h1 style="margin:0 0 20px;font-size:24px;color:#1a3550;">特許の簡易評価結果</h1>

    <div style="background:linear-gradient(155deg,#fff 0%,#f0f7f5 100%);border-radius:8px;padding:20px;margin-bottom:20px;">
      <p style="margin:0;font-size:12px;color:#8892a0;">総合スコア</p>
      <p style="margin:4px 0;font-size:42px;font-weight:700;color:#1a3550;line-height:1;">${scores.total}</p>
      <p style="margin:0;font-size:15px;font-weight:700;">ランク ${rank}</p>
      <p style="margin:4px 0 0;font-size:14px;color:#5a6577;">${rankMessage}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#5a6577;">特許</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${patent.title} (${patent.id})</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#5a6577;">価値レンジ</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${yenLabel(valueRange.low)} 〜 ${yenLabel(valueRange.high)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#5a6577;">収益化手段</td>
        <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-weight:600;">${route.title}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#5a6577;">信頼度</td>
        <td style="padding:10px 0;font-weight:600;">${valueRange.confidence}</td>
      </tr>
    </table>

    <div style="margin-top:24px;padding:16px;background:#f8f9fb;border-radius:8px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;">次のステップ</p>
      <p style="margin:0;font-size:13px;color:#5a6577;">詳細な買い手探索・交渉支援は、PatentRevenueへの登録後に進められます。</p>
      <a href="https://patent-revenue.iprich.jp/#licence" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#1a3550;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">登録して詳細を確認</a>
    </div>
  </div>

  <p style="margin:24px 0 0;text-align:center;font-size:11px;color:#8892a0;">
    このメールは Patent Value Check の診断結果送信リクエストにより送信されました。<br />
    <a href="https://patent-revenue.iprich.jp/privacy" style="color:#0d7367;">プライバシーポリシー</a>
  </p>
</div>
</body>
</html>`;
}

function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn("[mailer] RESEND_API_KEY not set, skipping email send");
    return Promise.resolve({ id: "dev-skip", message: "No API key configured" });
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject,
      html
    });

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

async function sendResultEmail({ email, name, reportData }) {
  const html = buildResultEmailHtml(reportData);
  const subject = "【PatentRevenue】特許の簡易評価結果のお知らせ";
  return sendEmail({ to: email, subject, html });
}

module.exports = { sendResultEmail };

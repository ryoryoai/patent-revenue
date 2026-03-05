# Edge / WAF Checklist (Cloudflare想定)

## 1) APIをWAF配下に限定
- Public endpoint: `/api/*`
- Origin direct accessは遮断（Firewall + private network/allowlist）
- Edgeからのみ `x-edge-auth` ヘッダを注入
  - App側 `EDGE_SHARED_SECRET` と一致しない場合は `403`

## 2) DDoS / Bot 基本設定
- Managed WAF rules: SQLi, XSS, RCE, LFI/RFI 有効
- Rate limit rules:
  - `/api/diagnose` に IP ベース制限
  - Bot score が低いトラフィックはチャレンジ
- Country/ASN ベースの必要最小限ブロック

## 3) HTTPS / HSTS
- Always Use HTTPS: ON
- HSTS: max-age >= 31536000, includeSubDomains, preload
- TLS minimum version を固定

## 4) 監視 / アラート
- WAF blocked requests
- Rate-limited requests
- Origin 5xx ratio
- App metrics (`/api/metrics`) の閾値:
  - hour/day budget >= 80%
  - p95 latency > 3000ms

## 5) 運用ルール
- `EDGE_SHARED_SECRET`, `METRICS_API_KEY`, `TURNSTILE_SECRET_KEY` をSecrets管理
- Rotation policy: 90日ごと
- Incident対応: request_id で WAFログとアプリログ突合

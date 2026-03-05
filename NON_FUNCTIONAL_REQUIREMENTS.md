# Patent Value Check Non-Functional Requirements (MVP)

## Scope
- Cost protection for diagnosis API
- Abuse prevention and attack resistance
- Minimum observability

## Quantitative Limits
- Anonymous quota: 5 requests / 24h per identifier (`IP or /64 + cookie`)
- Burst interval: 1 request / 15 seconds per identifier
- Per-minute burst: max 3 requests / 60 seconds
- Cooldown: 5 minutes after burst violation
- Request body limit: 4KB (`POST /api/diagnose`)
- Query limit: 1..200 chars, control chars rejected
- Cache TTL: 30 days for normalized query key
- Global budget: 3,000 external lookups/day, 500/hour (env configurable)

## Security Controls
- API behind origin check (same host or allowed origin)
- Strict input validation (whitelist-like constraints)
- Security headers:
  - `Content-Security-Policy`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
- Visitor cookie flags: `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS

## Resilience Controls
- In-flight deduplication: one upstream lookup per normalized key
- Timeout on upstream simulation: 4.5s (configurable)
- Graceful degradation:
  - `429` for quota/rate limit
  - `503` for global budget exceeded
  - UI surfaces retry guidance + registration CTA

## Observability
- `X-Request-Id` for every response
- Structured logs with:
  - `requestId`
  - event type (`diagnose_success`, `quota_block`)
  - hashed user/ip identifiers
  - cache hit flag

## Frontend Event Tracking
- `lp_view`
- `diagnosis_start`
- `diagnosis_success`
- `diagnosis_limited`
- `cta_click_join_patentrevenue`
- `signup_start`
- `signup_complete`

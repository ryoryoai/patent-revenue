# Brand Config Rule

All brand-related strings must come from `lib/brand-config.js`. Never hardcode them.

## Covered values

`siteName`, `brandName`, `companyName`, `companyNameEn`, `tagline`, `domain`,
`serviceDomain`, `landingDomain`, `contact.email`, `contact.support`,
`legal.privacyUrl`, `legal.termsUrl`

## Usage

```js
const brand = require('../lib/brand-config');
// brand.siteName → 'Patent Value Analyzer'
// brand.tagline  → '特許を収益に変える'
// brand.companyNameEn → 'IP Rich Co., Ltd.'
```

In HTML templates or email HTML, pass config values as template variables — do not
inline literal brand strings.

## Rules

- **New pages / components**: import from `lib/brand-config.js` for any brand text.
- **Email templates**: receive brand values via function parameters, not hardcoded.
- **PDF reports**: same as email templates.
- **Rebranding**: change only `lib/brand-config.js`; all consumers update automatically.

## Review check

Flag any of these as a brand-config violation:
- Literal `Patent Value Analyzer`, `PatentRevenue`, `特許を収益に変える`, `IP Rich Co.,Ltd.`
  appearing outside `lib/brand-config.js`
- Hardcoded `privacy@iprich.jp` or `support@iprich.jp` in source files
- Hardcoded `/privacy.html`, `/terms.html` paths in JS (HTML nav links are OK)

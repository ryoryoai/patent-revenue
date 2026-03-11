function resolveSecret(name, devDefault, { isProduction }) {
  const configured = String(process.env[name] || "").trim();
  if (configured) return configured;
  if (isProduction) {
    throw new Error(`${name} must be set when NODE_ENV=production`);
  }
  console.warn(`[config] ${name} is not set. Using development default.`);
  return devDefault;
}

function normalizeOriginValue(value) {
  try {
    return new URL(String(value)).origin;
  } catch (error) {
    return null;
  }
}

function parseOriginList(raw, defaults = []) {
  const values = [...defaults, ...String(raw || "").split(",")]
    .map((value) => value.trim())
    .filter(Boolean);

  const normalized = new Set();
  values.forEach((value) => {
    const origin = normalizeOriginValue(value);
    if (origin) {
      normalized.add(origin);
    } else {
      console.warn(`[config] ignoring invalid origin: ${value}`);
    }
  });
  return normalized;
}

function normalizeIpLiteral(value) {
  return String(value || "").trim().replace(/^::ffff:/, "");
}

function parseProxyList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => normalizeIpLiteral(value))
    .filter(Boolean);
}

module.exports = {
  normalizeIpLiteral,
  normalizeOriginValue,
  parseOriginList,
  parseProxyList,
  resolveSecret
};

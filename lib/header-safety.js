"use strict";

function sanitizeHeaderValue(value) {
  return String(value || "").replace(/[\x00-\x1f\x7f\u0080-\u009f\ufeff]/g, "").trim();
}

function hasInvalidHeaderChars(value) {
  return /[\x00-\x1f\x7f\u0080-\u009f\ufeff]/.test(String(value || ""));
}

function summarizeSecret(value, visiblePrefix = 7, visibleSuffix = 4) {
  const raw = String(value || "");
  const sanitized = sanitizeHeaderValue(raw);
  return {
    present: raw.length > 0,
    len: raw.length,
    first: sanitized.slice(0, visiblePrefix),
    last: sanitized.slice(-visibleSuffix),
    hasNewline: raw.includes("\n"),
    hasReturn: raw.includes("\r"),
    hasInvalidHeaderChars: hasInvalidHeaderChars(raw),
    changedBySanitize: raw !== sanitized
  };
}

module.exports = {
  sanitizeHeaderValue,
  hasInvalidHeaderChars,
  summarizeSecret
};

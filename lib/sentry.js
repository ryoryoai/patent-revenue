const Sentry = require("@sentry/node");

const dsn = process.env.SENTRY_DSN || "";

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request && event.request.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    },
  });
  console.log("[sentry] initialized");
} else {
  console.log("[sentry] SENTRY_DSN not set, skipping");
}

module.exports = Sentry;

/**
 * Vercel Serverless Function エントリポイント
 * server.js の HTTP handler をそのまま re-export する
 */
const server = require("../server");

module.exports = server;

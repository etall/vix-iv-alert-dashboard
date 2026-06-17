const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WATCHLIST = [
  "NVDA",
  "TSLA",
  "TQQQ",
  "QQQ",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "AMD",
];

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function parseWatchlist(value) {
  if (!value) return DEFAULT_WATCHLIST;
  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function loadConfig() {
  loadDotEnv();
  return {
    port: envNumber("PORT", 8787),
    dataProvider: (process.env.DATA_PROVIDER || "demo").toLowerCase(),
    watchlist: parseWatchlist(process.env.WATCHLIST),
    pollMs: envNumber("POLL_SECONDS", 60) * 1000,
    thresholds: {
      vixBuyMax: envNumber("VIX_BUY_MAX", 17),
      vixSellMin: envNumber("VIX_SELL_MIN", 20),
      vixRiskOff: envNumber("VIX_RISK_OFF", 24),
      ivBuyPercentileMax: envNumber("IV_BUY_PERCENTILE_MAX", 35),
      ivSellPercentileMin: envNumber("IV_SELL_PERCENTILE_MIN", 70),
      ivSpikePoints: envNumber("IV_SPIKE_POINTS", 4),
      ivCrushPoints: envNumber("IV_CRUSH_POINTS", -3),
    },
    tradier: {
      token: process.env.TRADIER_TOKEN || "",
      baseUrl: process.env.TRADIER_BASE_URL || "https://api.tradier.com/v1",
      vixSymbol: process.env.TRADIER_VIX_SYMBOL || "VIX",
      optionMonths: envNumber("TRADIER_OPTION_MONTHS", 1),
    },
    publicProvider: {
      userAgent: process.env.PUBLIC_USER_AGENT || "Mozilla/5.0",
    },
    email: {
      host: process.env.SMTP_HOST || "",
      port: envNumber("SMTP_PORT", 465),
      ssl: envBool("SMTP_SSL", true),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.ALERT_FROM || process.env.SMTP_USER || "",
      to: process.env.ALERT_TO || "",
      cooldownMs: envNumber("ALERT_COOLDOWN_MINUTES", 90) * 60 * 1000,
    },
  };
}

module.exports = { loadConfig };

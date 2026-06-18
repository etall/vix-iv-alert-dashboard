const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./src/config");
const { createProvider } = require("./src/dataProvider");
const { buildSignals } = require("./src/alertEngine");
const { SmtpClient } = require("./src/emailer");

const config = loadConfig();
const provider = createProvider(config);
const emailer = new SmtpClient(config);

let latest = null;
let previous = null;
let status = {
  provider: config.dataProvider,
  emailConfigured: emailer.isConfigured(),
  lastPollAt: null,
  lastEmailAt: null,
  lastError: null,
};
const history = [];
const sentAlerts = new Map();

function json(res, data, code = 200) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data, null, 2));
}

function shouldSend(alert) {
  const key = `${alert.symbol}:${alert.setup}`;
  const last = sentAlerts.get(key) || 0;
  return Date.now() - last > config.email.cooldownMs;
}

function rememberSent(alert) {
  sentAlerts.set(`${alert.symbol}:${alert.setup}`, Date.now());
}

function buildAlertEmail(alerts, snapshot) {
  const subject = `VIX/IV机会提醒: ${alerts.map((item) => `${item.symbol} ${item.setup}`).join(", ")}`;
  const lines = [
    `更新时间: ${new Date(snapshot.updatedAt).toLocaleString("zh-CN", { timeZone: "America/Los_Angeles" })} PT`,
    `VIX: ${snapshot.vix.value.toFixed(2)} (${snapshot.regime.label})`,
    "",
    "触发标的:",
    ...alerts.map((item) => [
      `${item.symbol}: ${item.setup === "sell-premium" ? "卖方候选" : "买方候选"}`,
      `价格: ${item.price}`,
      `30天IV: ${(item.iv30 * 100).toFixed(1)}%`,
      `IV百分位: ${Math.round(item.ivPercentile)}`,
      `触发原因: ${item.reason}`,
      `策略提示: ${item.strategy}`,
    ].join("\n")),
    "",
    "提醒: 这是波动率和结构信号，不是自动下单指令。开仓前复核期权链bid/ask、财报窗口、宏观事件和账户风险。",
  ];
  return { subject, text: lines.join("\n\n") };
}

async function poll() {
  try {
    const raw = await provider.getSnapshot();
    const enriched = buildSignals(raw, previous, config.thresholds);
    previous = raw;
    latest = enriched;
    status.lastPollAt = new Date().toISOString();
    status.lastError = null;

    history.push({
      timestamp: enriched.updatedAt,
      vix: enriched.vix.value,
      alerts: enriched.alerts.length,
      symbols: enriched.symbols.map((item) => ({
        symbol: item.symbol,
        iv30: item.iv30,
        ivPercentile: item.ivPercentile,
      })),
    });
    while (history.length > 240) history.shift();

    const emailAlerts = enriched.alerts.filter(shouldSend).slice(0, 5);
    if (emailAlerts.length && emailer.isConfigured()) {
      const message = buildAlertEmail(emailAlerts, enriched);
      console.log('[Server] Attempting to send email alert...');
      const result = await emailer.send(message);
      if (result.sent) {
        emailAlerts.forEach(rememberSent);
        status.lastEmailAt = new Date().toISOString();
        console.log('[Server] Email sent successfully');
      } else {
        status.lastError = result.reason || 'Email was not sent.';
        console.error('[Server] Email failed:', result);
      }
    }
  } catch (error) {
    status.lastError = error.message;
  }
}

function serveStatic(req, res) {
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(__dirname, "public", safe);
  if (!fullPath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(fullPath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(fullPath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/snapshot") return json(res, latest || { loading: true, status });
  if (req.url === "/api/history") return json(res, history);
  if (req.url === "/api/status") return json(res, { ...status, thresholds: config.thresholds, watchlist: config.watchlist });
  if (req.url === "/api/test-email" && req.method === "POST") {
    console.log('[Server] Test email request received');
    return emailer
      .send({
        subject: "VIX/IV Alert Dashboard 测试邮件",
        text: "如果你收到这封邮件，说明SMTP配置可用。",
      })
      .then((result) => {
        console.log('[Server] Test email result:', result);
        return json(res, result);
      })
      .catch((error) => {
        console.error('[Server] Test email error:', error);
        return json(res, { sent: false, error: error.message, details: error.stack }, 500);
      });
  }
  return serveStatic(req, res);
});

poll();
setInterval(poll, config.pollMs);

server.listen(config.port, () => {
  console.log(`VIX/IV dashboard running at http://localhost:${config.port}`);
});

const $ = (selector) => document.querySelector(selector);

function fmtPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtTime(value) {
  if (!value) return "等待同步";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function setupLabel(setup) {
  if (setup === "sell-premium") return "卖方候选";
  if (setup === "buy-debit") return "买方候选";
  return "观察";
}

function drawChart(points) {
  const svg = $("#vixChart");
  svg.innerHTML = "";
  if (!points.length) return;

  const width = 640;
  const height = 180;
  const pad = 18;
  const values = points.map((point) => point.vix);
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const scaleX = (index) => pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
  const scaleY = (value) => height - pad - ((value - min) / Math.max(max - min, 1)) * (height - pad * 2);
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"} ${scaleX(index)} ${scaleY(value)}`).join(" ");

  const grid = [15, 20, 25].map((level) => {
    const y = scaleY(level);
    return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="#dfe3ea" stroke-dasharray="4 5" />
      <text x="${width - pad}" y="${y - 5}" text-anchor="end" fill="#68707d" font-size="11">${level}</text>`;
  }).join("");

  svg.innerHTML = `
    ${grid}
    <path d="${path}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" />
    <circle cx="${scaleX(values.length - 1)}" cy="${scaleY(values.at(-1))}" r="5" fill="#0f766e" />
  `;
}

function renderSnapshot(data) {
  if (data.loading) return;
  $("#provider").textContent = data.provider;
  $("#updated").textContent = fmtTime(data.updatedAt);
  $("#vixValue").textContent = data.vix.value.toFixed(2);
  $("#regime").textContent = data.regime.label;
  $("#regime").className = `badge ${data.regime.tone}`;
  $("#regimeNote").textContent = data.regime.note;
  $("#alertCount").textContent = `${data.alerts.length} 个触发`;

  $("#alerts").innerHTML = data.alerts.length
    ? data.alerts.map((item) => `
      <article class="alert">
        <strong>${item.symbol} · ${setupLabel(item.setup)}</strong>
        <p>${item.reason}</p>
        <p>${item.strategy}</p>
      </article>
    `).join("")
    : `<article class="alert"><strong>暂无开仓触发</strong><p>当前波动率环境没有达到买方或卖方阈值，继续等待更干净的赔率。</p></article>`;

  $("#rows").innerHTML = data.symbols.map((item) => `
    <tr>
      <td><strong>${item.symbol}</strong></td>
      <td>${item.price ? item.price.toFixed(2) : "--"}</td>
      <td>${fmtPct(item.iv30)}</td>
      <td>${Math.round(item.ivPercentile)}</td>
      <td>${item.ivChangePoints > 0 ? "+" : ""}${item.ivChangePoints.toFixed(2)} vol</td>
      <td><span class="setup ${item.setup}">${setupLabel(item.setup)}</span></td>
      <td>${item.strategy}</td>
    </tr>
  `).join("");
}

async function refresh() {
  const [snapshot, history, status] = await Promise.all([
    fetch("/api/snapshot").then((response) => response.json()),
    fetch("/api/history").then((response) => response.json()),
    fetch("/api/status").then((response) => response.json()),
  ]);
  renderSnapshot(snapshot);
  drawChart(history);
  $("#statusText").textContent = [
    `数据源: ${status.provider}`,
    `邮件: ${status.emailConfigured ? "已配置" : "未配置"}`,
    status.lastEmailAt ? `上次邮件: ${fmtTime(status.lastEmailAt)}` : "尚未发送邮件",
    status.lastError ? `错误: ${status.lastError}` : "",
  ].filter(Boolean).join(" · ");
}

$("#testEmail").addEventListener("click", async () => {
  $("#testEmail").textContent = "发送中";
  try {
    const result = await fetch("/api/test-email", { method: "POST" }).then((response) => response.json());
    $("#testEmail").textContent = result.sent ? "已发送" : "发送失败";
  } catch {
    $("#testEmail").textContent = "发送失败";
  }
  setTimeout(() => { $("#testEmail").textContent = "发送测试邮件"; }, 1800);
});

refresh();
setInterval(refresh, 5000);

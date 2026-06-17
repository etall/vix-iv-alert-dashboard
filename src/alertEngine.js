function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreSignal(parts) {
  return clamp(Math.round(parts.reduce((sum, item) => sum + item, 0)), 0, 100);
}

function assessMarketRegime(vix, thresholds) {
  if (vix >= thresholds.vixRiskOff) {
    return {
      label: "Risk-off",
      tone: "danger",
      note: "VIX above risk-off threshold; premium is richer but tail risk is elevated.",
    };
  }
  if (vix >= thresholds.vixSellMin) {
    return {
      label: "Premium rich",
      tone: "warning",
      note: "VIX is high enough to favor defined-risk premium selling after price stabilizes.",
    };
  }
  if (vix <= thresholds.vixBuyMax) {
    return {
      label: "Calm tape",
      tone: "calm",
      note: "VIX is low; debit spreads can be cleaner than naked long options.",
    };
  }
  return {
    label: "Neutral",
    tone: "neutral",
    note: "VIX sits in the middle; prefer stock-specific setups over broad vol bets.",
  };
}

function buildSignals(snapshot, previous, thresholds) {
  const regime = assessMarketRegime(snapshot.vix.value, thresholds);
  const alerts = [];
  const rows = snapshot.symbols.map((item) => {
    const prior = previous?.symbols?.find((entry) => entry.symbol === item.symbol);
    const ivChange = prior ? (item.iv30 - prior.iv30) * 100 : item.ivChangePoints || 0;
    const ivPercentile = item.ivPercentile;
    const isRiskOff = snapshot.vix.value >= thresholds.vixRiskOff;

    const sellScore = scoreSignal([
      snapshot.vix.value >= thresholds.vixSellMin ? 30 : 0,
      ivPercentile >= thresholds.ivSellPercentileMin ? 35 : 0,
      ivChange >= thresholds.ivSpikePoints ? 20 : 0,
      item.liquidity === "high" ? 10 : 4,
      isRiskOff ? -30 : 0,
    ]);

    const buyScore = scoreSignal([
      snapshot.vix.value <= thresholds.vixBuyMax ? 30 : 0,
      ivPercentile <= thresholds.ivBuyPercentileMax ? 35 : 0,
      ivChange <= thresholds.ivSpikePoints ? 15 : 0,
      item.trend === "up" ? 10 : 0,
      isRiskOff ? -25 : 0,
    ]);

    let setup = "watch";
    let reason = "No clean volatility edge yet.";
    let strategy = "Wait for price confirmation or a better IV percentile.";
    let priority = Math.max(sellScore, buyScore);

    if (sellScore >= 65) {
      setup = "sell-premium";
      reason = `IV percentile ${Math.round(ivPercentile)} with VIX ${snapshot.vix.value.toFixed(1)}.`;
      strategy = item.symbol === "TQQQ"
        ? "Favor defined-risk put credit spreads; avoid naked short premium."
        : "Favor defined-risk credit spreads or cash-secured puts only after trend stabilizes.";
    } else if (buyScore >= 65) {
      setup = "buy-debit";
      reason = `Low IV percentile ${Math.round(ivPercentile)} while VIX is contained.`;
      strategy = "Favor debit call/put spreads over naked options to reduce theta and IV sensitivity.";
    }

    const enriched = {
      ...item,
      ivChangePoints: Number(ivChange.toFixed(2)),
      setup,
      reason,
      strategy,
      priority,
      sellScore,
      buyScore,
    };

    if (setup !== "watch") alerts.push(enriched);
    return enriched;
  });

  return {
    ...snapshot,
    regime,
    symbols: rows.sort((a, b) => b.priority - a.priority),
    alerts: alerts.sort((a, b) => b.priority - a.priority),
  };
}

module.exports = { buildSignals, assessMarketRegime };

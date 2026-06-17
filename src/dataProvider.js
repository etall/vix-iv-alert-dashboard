const BASE_IV = {
  NVDA: 0.36,
  TSLA: 0.44,
  TQQQ: 0.68,
  QQQ: 0.23,
  AAPL: 0.22,
  MSFT: 0.3,
  AMZN: 0.3,
  GOOGL: 0.3,
  META: 0.33,
  AMD: 0.7,
};

const BASE_PRICE = {
  NVDA: 212,
  TSLA: 406,
  TQQQ: 82,
  QQQ: 738,
  AAPL: 198,
  MSFT: 395,
  AMZN: 246,
  GOOGL: 360,
  META: 600,
  AMD: 174,
};

function randomWalk(seed, scale) {
  return Math.sin(seed / 3) * scale + Math.cos(seed / 7) * scale * 0.55;
}

class DemoProvider {
  constructor(config) {
    this.config = config;
    this.tick = 0;
  }

  async getSnapshot() {
    this.tick += 1;
    const now = new Date();
    const vix = 17.4 + randomWalk(this.tick, 2.8);

    return {
      provider: "demo",
      updatedAt: now.toISOString(),
      vix: {
        symbol: "VIX",
        value: Number(vix.toFixed(2)),
        change: Number(randomWalk(this.tick + 4, 0.9).toFixed(2)),
      },
      symbols: this.config.watchlist.map((symbol, index) => {
        const baseIv = BASE_IV[symbol] || 0.35;
        const basePrice = BASE_PRICE[symbol] || 100;
        const drift = randomWalk(this.tick + index * 2, 0.04);
        const iv30 = Math.max(0.12, baseIv + drift);
        const ivPercentile = Math.max(5, Math.min(98, 48 + randomWalk(this.tick + index * 5, 34)));
        const price = basePrice * (1 + randomWalk(this.tick + index, 0.035));

        return {
          symbol,
          price: Number(price.toFixed(2)),
          iv30: Number(iv30.toFixed(4)),
          ivPercentile: Number(ivPercentile.toFixed(0)),
          ivRank: Number(Math.max(1, Math.min(99, ivPercentile + randomWalk(index + this.tick, 9))).toFixed(0)),
          ivChangePoints: Number(randomWalk(this.tick + index * 3, 4.5).toFixed(2)),
          liquidity: ["NVDA", "TSLA", "TQQQ", "QQQ", "AAPL", "MSFT", "AMZN", "GOOGL", "META"].includes(symbol) ? "high" : "medium",
          trend: randomWalk(this.tick + index, 1) > -0.15 ? "up" : "down",
          nextEvent: symbol === "NVDA" ? "Earnings window outside next 30d" : "Check earnings calendar",
        };
      }),
    };
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

function nearestMonthlyExpiration(monthsAhead = 1) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + monthsAhead);
  date.setUTCDate(1);
  while (date.getUTCDay() !== 5) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

class TradierProvider {
  constructor(config) {
    this.config = config;
    if (!config.tradier.token) {
      throw new Error("TRADIER_TOKEN is required when DATA_PROVIDER=tradier.");
    }
  }

  headers() {
    return {
      Authorization: `Bearer ${this.config.tradier.token}`,
      Accept: "application/json",
    };
  }

  async getQuotes(symbols) {
    const url = `${this.config.tradier.baseUrl}/markets/quotes?symbols=${encodeURIComponent(symbols.join(","))}`;
    const data = await fetchJson(url, { headers: this.headers() });
    const quotes = data.quotes?.quote || [];
    return Array.isArray(quotes) ? quotes : [quotes];
  }

  async getOptionMetrics(symbol) {
    const expiration = nearestMonthlyExpiration(this.config.tradier.optionMonths);
    const url = `${this.config.tradier.baseUrl}/markets/options/chains?symbol=${symbol}&expiration=${expiration}&greeks=true`;
    const data = await fetchJson(url, { headers: this.headers() });
    const options = data.options?.option || [];
    const chain = Array.isArray(options) ? options : [options];
    const usable = chain.filter((option) => Number.isFinite(Number(option.greeks?.mid_iv)));
    if (!usable.length) {
      return { iv30: null, ivPercentile: null, ivRank: null };
    }
    const mid = usable.reduce((sum, option) => sum + Number(option.greeks.mid_iv), 0) / usable.length;
    return {
      iv30: Number(mid.toFixed(4)),
      ivPercentile: null,
      ivRank: null,
    };
  }

  async getSnapshot() {
    const symbols = [...this.config.watchlist, this.config.tradier.vixSymbol];
    const quotes = await this.getQuotes(symbols);
    const quoteMap = new Map(quotes.map((quote) => [String(quote.symbol).toUpperCase(), quote]));
    const vixQuote = quoteMap.get(this.config.tradier.vixSymbol.toUpperCase());

    const rows = [];
    for (const symbol of this.config.watchlist) {
      const quote = quoteMap.get(symbol);
      const metrics = await this.getOptionMetrics(symbol);
      rows.push({
        symbol,
        price: Number(quote?.last || quote?.close || 0),
        iv30: metrics.iv30 || 0,
        ivPercentile: metrics.ivPercentile ?? 50,
        ivRank: metrics.ivRank ?? 50,
        ivChangePoints: 0,
        liquidity: "high",
        trend: Number(quote?.change_percentage || 0) >= 0 ? "up" : "down",
        nextEvent: "Check earnings calendar",
      });
    }

    return {
      provider: "tradier",
      updatedAt: new Date().toISOString(),
      vix: {
        symbol: "VIX",
        value: Number(vixQuote?.last || vixQuote?.close || 0),
        change: Number(vixQuote?.change || 0),
      },
      symbols: rows,
    };
  }
}

function toYahooSymbol(symbol) {
  return symbol === "VIX" ? "^VIX" : symbol;
}

function nearestTargetExpiration(expirations, targetDays = 30) {
  const nowSeconds = Date.now() / 1000;
  let best = expirations[0];
  let bestDistance = Infinity;
  for (const expiration of expirations) {
    const days = (expiration - nowSeconds) / 86400;
    const distance = Math.abs(days - targetDays);
    if (days > 5 && distance < bestDistance) {
      best = expiration;
      bestDistance = distance;
    }
  }
  return best;
}

function estimatePercentile(symbol, iv30) {
  const ranges = {
    NVDA: [0.25, 0.65],
    TSLA: [0.35, 0.9],
    TQQQ: [0.45, 1.15],
    QQQ: [0.14, 0.42],
    AAPL: [0.16, 0.45],
    MSFT: [0.18, 0.48],
    AMZN: [0.22, 0.55],
    GOOGL: [0.2, 0.55],
    META: [0.24, 0.65],
    AMD: [0.38, 1.05],
  };
  const [low, high] = ranges[symbol] || [0.2, 0.7];
  return Math.max(1, Math.min(99, Math.round(((iv30 - low) / (high - low)) * 100)));
}

function pickAtmIv(chain, price) {
  const options = [...(chain.calls || []), ...(chain.puts || [])]
    .filter((option) => Number.isFinite(option.strike) && Number.isFinite(option.impliedVolatility));
  if (!options.length || !price) return null;
  options.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const nearest = options.slice(0, 8);
  const iv = nearest.reduce((sum, option) => sum + option.impliedVolatility, 0) / nearest.length;
  return Number(iv.toFixed(4));
}

class PublicProvider {
  constructor(config) {
    this.config = config;
  }

  headers() {
    return {
      "User-Agent": this.config.publicProvider.userAgent,
      Accept: "application/json,text/plain,*/*",
    };
  }

  async getChart(symbol) {
    const yahooSymbol = encodeURIComponent(toYahooSymbol(symbol));
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=5d&interval=1d`;
    const data = await fetchJson(url, { headers: this.headers() });
    const result = data.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const closes = quote?.close?.filter((value) => Number.isFinite(value)) || [];
    const last = result?.meta?.regularMarketPrice || closes.at(-1) || 0;
    const prev = closes.length > 1 ? closes.at(-2) : last;
    return {
      symbol,
      last: Number(last),
      change: Number(last - prev),
      changePct: prev ? Number(((last - prev) / prev) * 100) : 0,
    };
  }

  async getOptionIv(symbol, price) {
    const firstUrl = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
    const first = await fetchJson(firstUrl, { headers: this.headers() });
    const expirations = first.optionChain?.result?.[0]?.expirationDates || [];
    const expiration = nearestTargetExpiration(expirations, 30);
    const url = expiration
      ? `${firstUrl}?date=${expiration}`
      : firstUrl;
    const data = expiration === expirations[0] || !expiration
      ? first
      : await fetchJson(url, { headers: this.headers() });
    const result = data.optionChain?.result?.[0];
    const chain = result?.options?.[0] || {};
    const iv30 = pickAtmIv(chain, price);
    if (!iv30) throw new Error(`No usable IV data for ${symbol}`);
    return iv30;
  }

  async getSnapshot() {
    const [vixQuote, ...quotes] = await Promise.all([
      this.getChart("VIX"),
      ...this.config.watchlist.map((symbol) => this.getChart(symbol)),
    ]);

    const symbols = [];
    for (const quote of quotes) {
      let iv30 = 0;
      let sourceNote = "Yahoo options ATM IV estimate";
      try {
        iv30 = await this.getOptionIv(quote.symbol, quote.last);
      } catch (error) {
        iv30 = BASE_IV[quote.symbol] || 0.35;
        sourceNote = `Fallback IV baseline: ${error.message}`;
      }
      symbols.push({
        symbol: quote.symbol,
        price: Number(quote.last.toFixed(2)),
        iv30,
        ivPercentile: estimatePercentile(quote.symbol, iv30),
        ivRank: estimatePercentile(quote.symbol, iv30),
        ivChangePoints: 0,
        liquidity: ["NVDA", "TSLA", "TQQQ", "QQQ", "AAPL", "MSFT", "AMZN", "GOOGL", "META"].includes(quote.symbol) ? "high" : "medium",
        trend: quote.changePct >= 0 ? "up" : "down",
        nextEvent: sourceNote,
      });
    }

    return {
      provider: "public",
      updatedAt: new Date().toISOString(),
      vix: {
        symbol: "VIX",
        value: Number(vixQuote.last.toFixed(2)),
        change: Number(vixQuote.change.toFixed(2)),
      },
      symbols,
    };
  }
}

function createProvider(config) {
  if (config.dataProvider === "tradier") return new TradierProvider(config);
  if (config.dataProvider === "public") return new PublicProvider(config);
  return new DemoProvider(config);
}

module.exports = { createProvider };

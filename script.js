/**
 * Financial News Terminal — LED Wall Dashboard
 */

(function () {
  'use strict';

  const LEFT_SYMBOLS  = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'JPM'];
  const RIGHT_SYMBOLS = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'JPM'];
  const TICKER_SYMBOLS = ['AAPL', 'TSLA', 'NVDA', 'META', 'AMZN', 'MSFT', 'BTCUSD', 'SPX', 'NDX'];
  const CRYPTO_IDS = [
    { id: 'bitcoin',  symbol: 'BTC', name: 'Bitcoin' },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
    { id: 'solana',   symbol: 'SOL', name: 'Solana' },
  ];
  const REFRESH_INTERVAL = 30000;
  const CHART_INTERVAL   = 2000;

  const LIVE_CHANNELS = {
    bloomberg: { name: 'BLOOMBERG TELEVISION', id: 'iEpJwprnDdg' },
    cnbc:      { name: 'CNBC BUSINESS',        id: '9NyxcX3rhQs' },
    reuters:   { name: 'REUTERS LIVE',         id: 'w6xfb8LiczQ' },
    sky:       { name: 'SKY NEWS',             id: '9Auq9mYxFEE' },
  };

  let stockData = {};
  let cryptoData = {};
  let chartInstance = null;
  let chartPoints = [];
  let chartBaseValue = 5234.18;
  let usingMockData = false;
  let idxVIX = 18.42;
  let idxDXY = 104.28;
  let refreshTimer, chartTimer, clockTimer, socialTimer;

  const MOCK_BASE = {
    NVDA: 875.28, AAPL: 178.52, TSLA: 248.91, MSFT: 415.67,
    AMZN: 186.34, META: 505.75, GOOGL: 175.23, JPM: 198.45,
    BTCUSD: 67420, SPX: 5234.18, NDX: 18250.5,
  };

  // ─── Mock ────────────────────────────────────────────────────
  function randomChange(base, vol = 0.018) {
    const change = (Math.random() - 0.48) * base * vol;
    const price  = base + change;
    const pct    = (change / base) * 100;
    return { price: +price.toFixed(2), change: +change.toFixed(2), changePct: +pct.toFixed(2) };
  }

  function generateMockStocks() {
    const data = {};
    [...new Set([...LEFT_SYMBOLS, ...TICKER_SYMBOLS])].forEach((sym) => {
      const base = stockData[sym]?.price || MOCK_BASE[sym] || 100 + Math.random() * 300;
      data[sym] = { symbol: sym, ...randomChange(base) };
    });
    return data;
  }

  function generateMockCrypto() {
    const bases = { bitcoin: 67420, ethereum: 3520, solana: 142.5 };
    const data = {};
    CRYPTO_IDS.forEach(({ id }) => {
      const base = cryptoData[id]?.price || bases[id];
      const r = randomChange(base, 0.012);
      data[id] = { price: r.price, changePct: r.changePct };
    });
    return data;
  }

  // ─── API ─────────────────────────────────────────────────────
  async function fetchWithTimeout(url, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(res.status);
      return res.json();
    } catch (e) { clearTimeout(t); throw e; }
  }

  async function fetchCrypto() {
    try {
      const ids = CRYPTO_IDS.map((c) => c.id).join(',');
      const json = await fetchWithTimeout(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
      );
      const data = {};
      CRYPTO_IDS.forEach(({ id }) => {
        if (json[id]) data[id] = { price: json[id].usd, changePct: +(json[id].usd_24h_change || 0).toFixed(2) };
      });
      return data;
    } catch { return null; }
  }

  async function fetchYahooQuote(symbol) {
    try {
      const ySym = symbol === 'BTCUSD' ? 'BTC-USD' : symbol === 'SPX' ? '%5EGSPC' : symbol === 'NDX' ? '%5ENDX' : symbol;
      const json = await fetchWithTimeout(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ySym}?interval=1d&range=1d`, 6000
      );
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta) throw new Error('no data');
      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose || meta.previousClose;
      const change = price - prev;
      return { symbol, price: +price.toFixed(2), change: +change.toFixed(2), changePct: +((change / prev) * 100).toFixed(2) };
    } catch { return null; }
  }

  async function fetchStocks() {
    const syms = [...new Set([...LEFT_SYMBOLS, ...TICKER_SYMBOLS])];
    const results = await Promise.all(syms.map(fetchYahooQuote));
    const data = {};
    let ok = 0;
    results.forEach((r) => { if (r) { data[r.symbol] = r; ok++; } });
    return ok > 0 ? data : null;
  }

  // ─── Formatters ──────────────────────────────────────────────
  function fmtPrice(p, sym) {
    if (p > 9999 || sym === 'BTCUSD') return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return p.toFixed(2);
  }
  function fmtChg(pct) { return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'; }
  function cls(v) { return v >= 0 ? 'positive' : 'negative'; }

  // ─── Boot ────────────────────────────────────────────────────
  function bootSequence() {
    const steps = [
      { pct: 20, msg: 'Linking broadcast stream…' },
      { pct: 45, msg: 'Authenticating data feed…' },
      { pct: 70, msg: 'Loading equity symbols…' },
      { pct: 90, msg: 'Calibrating indices…' },
      { pct: 100, msg: 'System online.' },
    ];
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        if (i < steps.length) {
          document.getElementById('bootProgress').style.width = steps[i].pct + '%';
          document.getElementById('bootStatus').textContent = steps[i].msg;
          i++; setTimeout(tick, 380);
        } else {
          setTimeout(() => {
            document.getElementById('bootScreen').classList.add('hidden');
            document.getElementById('app').classList.add('ready');
            resolve();
          }, 400);
        }
      };
      tick();
    });
  }

  // ─── Clocks & Market Status ─────────────────────────────────
  function getMarketStatus() {
    const ny = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = ny.getDay(), t = ny.getHours() * 60 + ny.getMinutes();
    if (day === 0 || day === 6) return { cls: 'closed', label: 'CLOSED' };
    if (t >= 570 && t < 960)  return { cls: 'open',   label: 'OPEN' };
    if ((t >= 240 && t < 570) || (t >= 960 && t < 1200)) return { cls: 'pre', label: 'EXTENDED' };
    return { cls: 'closed', label: 'CLOSED' };
  }

  function updateClocks() {
    const now = new Date();
    document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const zones = { clockNY: 'America/New_York', clockLondon: 'Europe/London', clockDubai: 'Asia/Dubai', clockMumbai: 'Asia/Kolkata' };
    Object.entries(zones).forEach(([id, tz]) => {
      document.getElementById(id).textContent = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
    });
    const ms = getMarketStatus();
    const el = document.getElementById('marketStatus');
    el.className = 'market-badge ' + ms.cls;
    el.textContent = ms.label;

    const rf = document.getElementById('rightFooterTime');
    if (rf) rf.textContent = 'REFRESH ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function updateIndexPills() {
    const spx = chartBaseValue;
    const spxChg = chartPoints.length > 1
      ? ((chartPoints.at(-1).y - chartPoints[0].y) / chartPoints[0].y) * 100
      : 0;
    idxVIX = +(idxVIX + (Math.random() - 0.5) * 0.3).toFixed(2);
    idxDXY = +(idxDXY + (Math.random() - 0.48) * 0.08).toFixed(2);

    const setIdx = (id, val, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = typeof val === 'number' ? val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : val;
      el.className = 'idx-v ' + (cls || '');
    };

    setIdx('idxSPX', spx, cls(spxChg));
    setIdx('idxVIX', idxVIX, idxVIX > 20 ? 'negative' : 'positive');
    setIdx('idxDXY', idxDXY, cls(idxDXY - 104.28));
  }

  // ─── Live TV Channel Switch ──────────────────────────────────
  function initChannelSwitcher() {
    document.querySelectorAll('.ch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.channel;
        const ch  = LIVE_CHANNELS[key];
        if (!ch) return;
        document.querySelectorAll('.ch-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('channelName').textContent = ch.name;
        document.getElementById('liveStream').src =
          `https://www.youtube.com/embed/${ch.id}?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1`;
      });
    });
  }

  // ─── Render Side Stock Lists ─────────────────────────────────
  function renderStockRow(d) {
    return `<li class="stock-row">
      <span class="sym">${d.symbol}</span>
      <span class="price">${fmtPrice(d.price, d.symbol)}</span>
      <span class="chg ${cls(d.changePct)}">${fmtChg(d.changePct)}</span>
    </li>`;
  }

  function renderSideStocks() {
    const left  = document.getElementById('leftStockList');
    const right = document.getElementById('rightStockList');
    left.innerHTML  = LEFT_SYMBOLS.map((s) => stockData[s] ? renderStockRow(stockData[s]) : '').join('');
    right.innerHTML = RIGHT_SYMBOLS.map((s) => stockData[s] ? renderStockRow(stockData[s]) : '').join('');
  }

  function renderCrypto() {
    const el = document.getElementById('cryptoBlock');
    el.innerHTML = CRYPTO_IDS.map(({ id, symbol }) => {
      const d = cryptoData[id];
      if (!d) return '';
      return `<div class="crypto-row">
        <span class="c-sym">${symbol}</span>
        <span class="c-price">$${fmtPrice(d.price, symbol)}</span>
        <span class="c-chg ${cls(d.changePct)}">${fmtChg(d.changePct)}</span>
      </div>`;
    }).join('');
  }

  // ─── Market Ticker ───────────────────────────────────────────
  function renderMarketTicker() {
    const extra = [
      { symbol: 'S&P 500', price: chartBaseValue, changePct: ((chartPoints.at(-1)?.y || chartBaseValue) - (chartPoints[0]?.y || chartBaseValue)) / (chartPoints[0]?.y || chartBaseValue) * 100 },
      { symbol: 'NASDAQ', price: 18250, changePct: 0.42 },
    ];
    const items = [...TICKER_SYMBOLS.map((s) => stockData[s]).filter(Boolean), ...extra];
    const html = items.map((d) => `
      <span class="ticker-item">
        <span class="sym">${d.symbol}</span>
        <span class="px">${typeof d.price === 'number' ? '$' + fmtPrice(d.price, d.symbol) : d.price}</span>
        <span class="chg ${cls(d.changePct)}">${fmtChg(d.changePct)}</span>
      </span>`).join('');
    document.getElementById('marketTicker').innerHTML = html + html;
  }

  // ─── News Tickers ────────────────────────────────────────────
  const HEADLINES = [
    { tag: 'breaking', text: 'U.S. FINAL NEWS REACTIONS — Markets digest latest policy announcements' },
    { tag: 'forex',    text: 'EUR/USD holds above 1.0850 as ECB signals cautious rate path' },
    { tag: 'political',text: 'White House press briefing triggers immediate futures volatility' },
    { tag: 'breaking', text: 'FED MINUTES RELEASE — Traders reposition ahead of key data' },
    { tag: 'forex',    text: 'USD/JPY approaches 158 as BoJ maintains ultra-loose policy stance' },
    { tag: 'breaking', text: 'S&P 500 FUTURES RISE 0.4% IN PRE-MARKET TRADING SESSION' },
    { tag: 'political',text: 'Congressional hearing on tech regulation sends NASDAQ lower' },
    { tag: 'forex',    text: 'GBP/USD rallies on stronger-than-expected UK services PMI data' },
    { tag: 'breaking', text: 'OIL PRICES SURGE 2% ON MIDDLE EAST SUPPLY DISRUPTION FEARS' },
    { tag: 'breaking', text: 'NVIDIA LEADS SEMICONDUCTOR RALLY AS AI DEMAND ACCELERATES' },
  ];

  const WORLD_NEWS = [
    'एशियाई बाजार मजबूत खुले — निक्केई 1.2% ऊपर, हैंग सेंग 0.8% बढ़त पर',
    'European markets mixed: DAX +0.3%, FTSE 100 -0.1%, CAC 40 flat',
    'China PMI data beats expectations — manufacturing sector expands for 3rd month',
    'Middle East tensions keep gold near record highs at $2,385/oz',
    'Japan Nikkei 225 hits 34-year high on weak yen, strong exports data',
    'India Sensex gains 280 points led by IT and banking stocks',
    'Oil breaches $85/barrel — OPEC+ meeting in focus this week',
    'Bitcoin ETF weekly inflows surpass $500M milestone for first time',
    'UK inflation falls to 2.3% — BoE rate cut expectations rise',
    'Global bond yields stabilize after volatile overnight session',
  ];

  const X_ACCOUNTS = ['@realDonaldTrump', '@AzadWorld', '@Bloomberg', '@CNBC', '@Reuters', '@WSJ', '@FinancialTimes'];
  const X_TWEETS = [
    'Markets reacting sharply to latest policy statement — futures up 0.6%',
    'BREAKING: Major tech earnings beat sends NASDAQ to session highs',
    'Forex alert: Dollar index drops below 104 as rate cut bets increase',
    'Oil surges on supply concerns — energy stocks leading S&P gainers',
    'Fed officials signal patience on rate cuts — bond yields climb',
    'Bitcoin breaks key resistance at $67,000 — crypto stocks rally',
    'European markets open higher following strong Asia session',
    'Treasury Secretary comments move currency markets in early trade',
    'Semiconductor stocks surge on AI chip demand forecast upgrade',
    'Housing data beats estimates — builder stocks jump in pre-market',
  ];

  let socialIndex = 0;

  function renderHeadlineNews() {
    const html = HEADLINES.map((h) =>
      `<span class="news-item headline-item"><span class="tag ${h.tag}">${h.tag.toUpperCase()}</span>${h.text}</span>`
    ).join('');
    document.getElementById('headlineNews').innerHTML = html + html;
  }

  function renderWorldNews() {
    const html = WORLD_NEWS.map((t) => `<span class="news-item">${t}</span>`).join('');
    document.getElementById('worldNews').innerHTML = html + html;
  }

  function renderSocialTicker() {
    const items = X_TWEETS.map((text, i) => {
      const handle = X_ACCOUNTS[i % X_ACCOUNTS.length];
      return `<span class="social-item">
        <span class="heart">♥</span>
        <span class="handle">${handle}</span>
        <span class="tweet-text">${text}</span>
      </span>`;
    }).join('');
    document.getElementById('socialTicker').innerHTML = items + items;
  }

  function rotateSocial() {
    socialIndex = (socialIndex + 1) % X_TWEETS.length;
    const handle = X_ACCOUNTS[socialIndex % X_ACCOUNTS.length];
    const text   = X_TWEETS[socialIndex];
    const track  = document.getElementById('socialTicker');
    const newItem = document.createElement('span');
    newItem.className = 'social-item';
    newItem.innerHTML = `<span class="heart">♥</span><span class="handle">${handle}</span><span class="tweet-text">${text}</span>`;
    track.prepend(newItem);
  }

  // ─── Chart.js mini overlay ─────────────────────────────────────
  function initChart() {
    const ctx = document.getElementById('marketChart').getContext('2d');
    const now = Date.now();
    chartPoints = Array.from({ length: 30 }, (_, i) => ({
      x: now - (30 - i) * 3000,
      y: chartBaseValue + (Math.random() - 0.5) * 15,
    }));
    const grad = ctx.createLinearGradient(0, 0, 0, 60);
    grad.addColorStop(0, 'rgba(0,200,255,0.3)');
    grad.addColorStop(1, 'rgba(0,200,255,0)');
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { datasets: [{ data: chartPoints, borderColor: '#00c8ff', backgroundColor: grad, borderWidth: 1.5, fill: true, tension: 0.4, pointRadius: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
    updateChartHeader();
  }

  function updateChartPoint() {
    const last = chartPoints.at(-1)?.y || chartBaseValue;
    const newVal = +(last + (Math.random() - 0.48) * 3).toFixed(2);
    chartPoints.push({ x: Date.now(), y: newVal });
    if (chartPoints.length > 40) chartPoints.shift();
    chartBaseValue = newVal;
    chartInstance.data.datasets[0].data = [...chartPoints];
    chartInstance.update('none');
    updateChartHeader();
    updateIndexPills();
  }

  function updateChartHeader() {
    const last  = chartPoints.at(-1)?.y || chartBaseValue;
    const first = chartPoints[0]?.y || chartBaseValue;
    const chg   = last - first;
    const pct   = (chg / first) * 100;
    document.getElementById('chartValue').textContent = last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const el = document.getElementById('chartChange');
    el.textContent = fmtChg(pct);
    el.className = cls(pct);
  }

  // ─── Data Refresh ────────────────────────────────────────────
  async function refreshData() {
    const [stocks, crypto] = await Promise.all([fetchStocks(), fetchCrypto()]);
    if (stocks) { stockData = { ...stockData, ...stocks }; usingMockData = false; }
    else { stockData = generateMockStocks(); usingMockData = true; }
    if (crypto) { cryptoData = crypto; }
    else { cryptoData = generateMockCrypto(); if (!stocks) usingMockData = true; }
    document.getElementById('dataSource').textContent = usingMockData ? 'DEMO MODE' : 'STREAMLINE';
    const lu = document.getElementById('lastUpdate');
    if (lu) lu.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    renderSideStocks();
    renderCrypto();
    renderMarketTicker();
    updateIndexPills();
  }

  // ─── Timers ──────────────────────────────────────────────────
  function startTimers() {
    clockTimer  = setInterval(updateClocks, 1000);
    refreshTimer = setInterval(refreshData, REFRESH_INTERVAL);
    chartTimer  = setInterval(updateChartPoint, CHART_INTERVAL);
    socialTimer = setInterval(rotateSocial, 10000);
  }

  function stopTimers() {
    [clockTimer, refreshTimer, chartTimer, socialTimer].forEach((t) => t && clearInterval(t));
  }

  // ─── Init ────────────────────────────────────────────────────
  async function init() {
    stockData  = generateMockStocks();
    cryptoData = generateMockCrypto();
    await bootSequence();
    updateClocks();
    renderSideStocks();
    renderCrypto();
    renderMarketTicker();
    renderHeadlineNews();
    renderWorldNews();
    renderSocialTicker();
    initChannelSwitcher();
    initChart();
    updateIndexPills();
    startTimers();
    refreshData();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('beforeunload', stopTimers);
})();

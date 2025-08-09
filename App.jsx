import React, { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, CartesianGrid, ReferenceLine, RadialBarChart, RadialBar } from "recharts";

// ---------- Helpers ----------
const avg = (nums) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
const stdev = (nums) => {
  const m = avg(nums);
  return Math.sqrt(avg(nums.map(v => (v - m) ** 2)) || 0);
};
const sma = (arr, period) => arr.map((_, i) => i + 1 < period ? null : avg(arr.slice(i + 1 - period, i + 1)));
const ema = (arr, period) => {
  const k = 2 / (period + 1);
  let prev = null;
  return arr.map((v, i) => {
    if (i === 0) { prev = v; return v; }
    prev = (v - prev) * k + prev;
    return prev;
  });
};
const rsi = (closes, period = 14) => {
  if (closes.length <= period) return Array(closes.length).fill(null);
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }
  const rsis = Array(period).fill(null);
  let avgGain = avg(gains.slice(0, period));
  let avgLoss = avg(losses.slice(0, period));
  rsis.push(100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)));
  for (let i = period + 1; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    rsis.push(100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)));
  }
  return rsis;
};
const macd = (closes, fast = 12, slow = 26, signal = 9) => {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
};
const zscore = (value, values) => {
  const s = stdev(values);
  if (!isFinite(s) || s === 0) return 0;
  const m = avg(values);
  return (value - m) / s;
};
const computeDirectionProbability = (closes) => {
  if (closes.length < 60) return { up: 0.5, down: 0.5, score: 0 };
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsiArr = rsi(closes, 14);
  const { histogram } = macd(closes, 12, 26, 9);
  const rsiLast = rsiArr[rsiArr.length - 1] ?? 50;
  const rsiTilt = (rsiLast - 50) / 50;
  const sma20Last = sma20[sma20.length - 1] ?? closes.at(-1);
  const sma50Last = sma50[sma50.length - 1] ?? closes.at(-1);
  const maTrend = ((sma20Last - sma50Last) / ((sma50Last || 1))) * 0.5;
  const histSlice = histogram.slice(-30).filter(Number.isFinite);
  const histLast = histogram[histogram.length - 1] ?? 0;
  const momentum = Math.tanh(zscore(histLast, histSlice) / 2);
  const score = 0.45 * rsiTilt + 0.35 * maTrend + 0.20 * momentum;
  const up = 1 / (1 + Math.exp(-3 * score));
  const down = 1 - up;
  return { up, down, score };
};
function computeLevels(points, window = 5, tolerancePct = 0.004) {
  const levels = [];
  if (points.length < window * 2 + 1) return levels;
  const closes = points.map(p => p.close);
  for (let i = window; i < closes.length - window; i++) {
    const seg = closes.slice(i - window, i + window + 1);
    const c = closes[i];
    if (c === Math.max(...seg) || c === Math.min(...seg)) {
      const tol = c * tolerancePct;
      const found = levels.find(l => Math.abs(l.price - c) <= tol);
      if (found) found.hits += 1; else levels.push({ price: c, hits: 1 });
    }
  }
  return levels.sort((a, b) => b.hits - a.hits).slice(0, 8);
}
function projectOneHour(closes) {
  const prob = computeDirectionProbability(closes);
  if (closes.length < 30) return { pct: 0, target: closes.at(-1) || 0, prob };
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const sigma = stdev(rets.slice(-24));
  const tilt = prob.up - prob.down;
  const expectedPct = tilt * (sigma * 0.8);
  const last = closes.at(-1);
  const target = last * (1 + expectedPct);
  return { pct: expectedPct, target, prob };
}
function calcSignal(series, closes) {
  if (series.length < 60) return { side: "NEUTRAL", longPct: 50, shortPct: 50, entry: null, sl: null, tp: null, reason: "Not enough data" };
  const { up, down } = computeDirectionProbability(closes);
  const last = series.at(-1).close;
  const sr = computeLevels(series, 6, 0.004);
  const nearestAbove = sr.map(l=>l.price).filter(p=>p>last).sort((a,b)=>a-b)[0] ?? null;
  const nearestBelow = sr.map(l=>l.price).filter(p=>p<last).sort((a,b)=>b-a)[0] ?? null;
  const longBias = up > 0.55;
  const shortBias = down > 0.55;
  if (longBias) {
    const entry = nearestAbove ? nearestAbove * 1.0005 : last;
    const sl = nearestBelow ? Math.min(nearestBelow, entry*0.992) : entry*0.992;
    const tp = entry * 1.015;
    return { side: "LONG", longPct: Math.round(up*100), shortPct: Math.round(down*100), entry, sl, tp, reason: "Up bias + breakout of nearest resistance" };
  }
  if (shortBias) {
    const entry = nearestBelow ? nearestBelow * 0.9995 : last;
    const sl = nearestAbove ? Math.max(nearestAbove, entry*1.008) : entry*1.008;
    const tp = entry * 0.985;
    return { side: "SHORT", longPct: Math.round(up*100), shortPct: Math.round(down*100), entry, sl, tp, reason: "Down bias + breakdown of nearest support" };
  }
  return { side: "NEUTRAL", longPct: Math.round(up*100), shortPct: Math.round(down*100), entry: null, sl: null, tp: null, reason: "No edge > 55%" };
}
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
async function fetchMarket(rangeDays, vs) {
  const url = `${COINGECKO_BASE}/coins/ripple/market_chart?vs_currency=${vs}&days=${rangeDays}&interval=${rangeDays > 1 ? "hourly" : "minutely"}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Market fetch failed: ${res.status}`);
  const json = await res.json();
  const prices = json.prices;
  return prices.map(([t, p]) => ({ time: new Date(t), close: p }));
}
async function fetchFundamentals() {
  const url = `${COINGECKO_BASE}/coins/ripple?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fundamentals fetch failed: ${res.status}`);
  const j = await res.json();
  return {
    name: j.name,
    symbol: (j.symbol||'xrp').toUpperCase(),
    marketCap: j.market_data?.market_cap?.usd,
    volume24h: j.market_data?.total_volume?.usd,
    circulating: j.market_data?.circulating_supply,
    totalSupply: j.market_data?.total_supply,
    price: j.market_data?.current_price?.usd,
    priceChange24h: j.market_data?.price_change_percentage_24h,
  };
}
function fmt(n) { if (n == null || !Number.isFinite(n)) return "—"; if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); return n.toLocaleString(undefined, { maximumFractionDigits: 6 }); }
function fmtNum(n) { if (n == null || !Number.isFinite(n)) return "—"; return n.toLocaleString(); }
function fmtPct(n) { if (n == null || !Number.isFinite(n)) return "—"; const s = (n / 100).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 2 }); return s; }
function shortTime(t) { const d = new Date(t); return Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", hour: "2-digit" }).format(d); }
function requestNotificationPermission() { if (!("Notification" in window)) return; if (Notification.permission === "granted") return; Notification.requestPermission?.(); }
function saveLocal(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function loadLocal(key, def=null) { try { const v = JSON.parse(localStorage.getItem(key)||"null"); return v ?? def; } catch { return def; } }

export default function App() {
  const [days, setDays] = useState(30);
  const [vs, setVs] = useState("usd");
  const [exchange, setExchange] = useState("BINANCE");
  const [symbol, setSymbol] = useState("XRPUSDT");
  const [series, setSeries] = useState([]);
  const [fund, setFund] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [tvTF, setTvTF] = useState("60");
  const wsRef = useRef(null);

  // Telegram settings
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [backendEnabled, setBackendEnabled] = useState(false);
  const [backendUrl, setBackendUrl] = useState("");

  const closes = useMemo(() => series.map(d => d.close), [series]);
  const sma20Arr = useMemo(() => sma(closes, 20), [closes]);
  const sma50Arr = useMemo(() => sma(closes, 50), [closes]);
  const rsiArr = useMemo(() => rsi(closes, 14), [closes]);
  const macdObj = useMemo(() => macd(closes, 12, 26, 9), [closes]);
  const prob = useMemo(() => computeDirectionProbability(closes), [closes]);
  const levels = useMemo(() => computeLevels(series, 6, 0.004), [series]);
  const projection = useMemo(() => projectOneHour(closes), [closes]);
  const signal = useMemo(() => calcSignal(series, closes), [series, closes]);

  const [position, setPosition] = useState(null);

  const data = useMemo(() => series.map((d, i) => ({
    time: d.time,
    close: d.close,
    sma20: sma20Arr[i],
    sma50: sma50Arr[i],
    rsi: rsiArr[i],
    macd: macdObj.macdLine[i],
    signal: macdObj.signalLine[i],
    hist: macdObj.histogram[i],
  })), [series, sma20Arr, sma50Arr, rsiArr, macdObj]);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [mkt, f] = await Promise.all([ fetchMarket(days, vs), fetchFundamentals() ]);
      setSeries(mkt);
      setFund(f);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(()=>{ load(); }, [days, vs]);

  // Local storage for Telegram settings
  useEffect(()=>{
    const saved = loadLocal("xrp_tg");
    if (saved) {
      setTgEnabled(!!saved.enabled);
      setTgToken(saved.token||"");
      setTgChatId(saved.chat||"");
      setBackendEnabled(!!saved.backendEnabled);
      setBackendUrl(saved.backendUrl||"");
    }
  }, []);
  useEffect(()=>{
    saveLocal("xrp_tg", { enabled: tgEnabled, token: tgToken, chat: tgChatId, backendEnabled, backendUrl });
  }, [tgEnabled, tgToken, tgChatId, backendEnabled, backendUrl]);

  // Real-time via Binance
  useEffect(() => {
    if (vs !== "usd") { if (wsRef.current) { wsRef.current.close(); wsRef.current = null; } return; }
    try {
      const ws = new WebSocket("wss://stream.binance.com:9443/ws/xrpusdt@trade");
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const px = parseFloat(msg.p);
        if (!Number.isFinite(px)) return;
        setSeries(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, close: px };
          return updated;
        });
      };
      return () => { try { ws.close(); } catch {} wsRef.current = null; };
    } catch {}
  }, [vs]);

  // Auto-exit
  useEffect(() => {
    if (!position || series.length === 0) return;
    const price = series.at(-1).close;
    if (position.tp && ((position.side === "LONG" && price >= position.tp) || (position.side === "SHORT" && price <= position.tp))) {
      notify(`Take Profit hit @ ${fmt(price)}`);
      setPosition(null);
      return;
    }
    if (position.sl && ((position.side === "LONG" && price <= position.sl) || (position.side === "SHORT" && price >= position.sl))) {
      notify(`Stop Loss hit @ ${fmt(price)}`);
      setPosition(null);
      return;
    }
    const lastRsi = rsiArr.at(-1) ?? 50;
    const lastHist = macdObj.histogram.at(-1) ?? 0;
    const prevHist = macdObj.histogram.at(-2) ?? lastHist;
    const fading = Math.sign(prevHist) !== Math.sign(lastHist) || Math.abs(lastHist) < Math.abs(prevHist)*0.5;
    if (position.side === "LONG" && lastRsi > 70 && fading) { notify("Exit (overbought + momentum fade)"); setPosition(null); }
    if (position.side === "SHORT" && lastRsi < 30 && fading) { notify("Exit (oversold + momentum fade)"); setPosition(null); }
  }, [series, position, rsiArr, macdObj]);

  const enterPosition = (side) => {
    if (side === "LONG" && signal.side !== "LONG") return;
    if (side === "SHORT" && signal.side !== "SHORT") return;
    const pos = { side, entry: signal.entry ?? series.at(-1)?.close, sl: signal.sl ?? undefined, tp: signal.tp ?? undefined, openedAt: new Date() };
    setPosition(pos);
    notify(`${side} opened @ ${fmt(pos.entry)} | SL ${fmt(pos.sl)} | TP ${fmt(pos.tp)}`);
  };
  const closePosition = () => { if (!position) return; notify(`Position closed @ ${fmt(series.at(-1)?.close)} (${position.side})`); setPosition(null); };

  return (
    <div className="min-h-screen">
      {/* Projection box */}
      <div className="fixed right-4 top-4 z-30">
        <div className="bg-[#0f172a]/90 backdrop-blur border border-[#1f2937] rounded-2xl px-4 py-3 shadow-lg">
          <div className="text-[11px] uppercase tracking-wide muted">1h Projection</div>
          <div className="flex items-end gap-2 mt-1">
            <div className={"text-xl font-semibold " + (projection.pct>=0?"text-emerald-400":"text-rose-400")}>{(projection.pct*100).toFixed(2)}%</div>
            <div className="text-sm">→ {fmt(projection.target)} {vs.toUpperCase()}</div>
          </div>
          <div className="mt-1 text-[11px] muted">Tilt: {(projection.prob.up*100).toFixed(1)}% up / {(projection.prob.down*100).toFixed(1)}% down</div>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur bg-[#0b1220]/70 border-b border-[#1f2937]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="https://cryptologos.cc/logos/xrp-xrp-logo.png?v=033" alt="XRP" className="w-8 h-8"/>
          <h1 className="text-xl sm:text-2xl font-semibold">XRP Online Analysis</h1>
          <div className="ml-auto flex items-center gap-2">
            <select className="input" value={days} onChange={e=>setDays(Number(e.target.value))}>
              <option value="1">1D</option><option value="7">7D</option><option value="30">30D</option><option value="90">90D</option><option value="180">180D</option><option value="365">1Y</option>
            </select>
            <select className="input" value={vs} onChange={e=>setVs(e.target.value)}>
              <option value="usd">USD (real-time)</option><option value="eur">EUR</option><option value="uah">UAH</option><option value="btc">BTC</option>
            </select>
            <select className="input" value={tvTF} onChange={e=>setTvTF(e.target.value)}>
              <option value="1">1m</option><option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="D">1D</option>
            </select>
            <select className="input" value={exchange} onChange={e=>setExchange(e.target.value)}>
              <option>BINANCE</option><option>BYBIT</option><option>KUCOIN</option><option>BITFINEX</option>
            </select>
            <select className="input" value={symbol} onChange={e=>setSymbol(e.target.value)}>
              <option>XRPUSDT</option><option>XRPUSD</option><option>XRPEUR</option>
            </select>
            <button onClick={load} className="btn">Refresh</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 grid gap-6">
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">TradingView Chart – {exchange}:{symbol}</div>
              <div className="text-xs muted">TF: {tvTF}</div>
            </div>
            <div className="h-[420px]">
              <TradingViewAdvancedChart symbol={`${exchange}:${symbol}`} interval={tvTF} theme="dark" studies={["MASimple@tv-basicstudies","MACD@tv-basicstudies","RSI@tv-basicstudies"]}/>
            </div>
            <div className="mt-2 text-[11px] muted">Indicators rendered by TradingView. Programmatic values are computed in-browser.</div>
          </div>

          <div className="card p-4">
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div className="text-2xl font-semibold">{fund?.symbol || "XRP"} / {vs.toUpperCase()}</div>
              {fund && <div className="text-sm muted">Price: {fmt(fund.price)} ({fmtPct(fund.priceChange24h)} 24h)</div>}
              <div className="ml-auto text-sm">
                <span className="muted mr-2">Signal:</span>
                {signal.side === "LONG" && <span className="text-emerald-400 font-semibold">LONG {signal.longPct}%</span>}
                {signal.side === "SHORT" && <span className="text-rose-400 font-semibold">SHORT {signal.shortPct}%</span>}
                {signal.side === "NEUTRAL" && <span className="">NEUTRAL ({signal.longPct}% / {signal.shortPct}%)</span>}
              </div>
            </div>
            <div className="h-[340px]">
              <ResponsiveContainer>
                <AreaChart data={data} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.4}/>
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#0f172a" strokeDasharray="3 3"/>
                  <XAxis dataKey="time" tickFormatter={(t) => shortTime(t)} stroke="#94a3b8"/>
                  <YAxis domain={["auto", "auto"]} stroke="#94a3b8"/>
                  <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid #1f2937" }} labelFormatter={(l) => new Date(l).toLocaleString()} formatter={(v) => fmt(v)}/>
                  <Area type="monotone" dataKey="close" stroke="#34d399" fill="url(#g)" strokeWidth={2}/>
                  <Line type="monotone" dataKey="sma20" stroke="#60a5fa" dot={false} strokeWidth={1.5} name="SMA 20" />
                  <Line type="monotone" dataKey="sma50" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="SMA 50" />
                  {levels.map((lvl, idx) => (
                    <ReferenceLine key={idx} y={lvl.price} stroke="#64748b" strokeDasharray="6 6" label={{ value: `S/R ${idx+1} (${lvl.hits})`, fill: "#94a3b8", fontSize: 10, position: "right" }} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* Entry/SL/TP */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-[#0b1220] rounded-xl border border-[#1f2937] p-3">
                <div className="muted text-[11px] uppercase">Entry</div>
                <div className="mt-1">{signal.entry ? fmt(signal.entry) : "—"}</div>
              </div>
              <div className="bg-[#0b1220] rounded-xl border border-[#1f2937] p-3">
                <div className="muted text-[11px] uppercase">Stop Loss</div>
                <div className="mt-1">{signal.sl ? fmt(signal.sl) : "—"}</div>
              </div>
              <div className="bg-[#0b1220] rounded-xl border border-[#1f2937] p-3">
                <div className="muted text-[11px] uppercase">Take Profit</div>
                <div className="mt-1">{signal.tp ? fmt(signal.tp) : "—"}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button disabled={signal.side!=="LONG"} onClick={()=>enterPosition("LONG")} className="btn">Enter Long</button>
              <button disabled={signal.side!=="SHORT"} onClick={()=>enterPosition("SHORT")} className="btn" style={{background:"#ef4444"}}>Enter Short</button>
              <button disabled={!position} onClick={closePosition} className="btn" style={{background:"#374151"}}>Close</button>
              {position && <div className="text-xs muted ml-2">Open {position.side} @ {fmt(position.entry)} | SL {fmt(position.sl)} | TP {fmt(position.tp)}</div>}
            </div>
            <div className="mt-2 text-xs muted">Reason: {signal.reason}</div>
          </div>
        </div>

        {/* Right column */}
        <div className="grid gap-6">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold">Direction Probability (toy model)</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <RadialGauge value={prob.up} label="Up" />
              <RadialGauge value={prob.down} label="Down" />
            </div>
            <div className="mt-3 text-xs muted">
              Computed from RSI tilt, SMA20 vs SMA50 slope, and MACD histogram momentum. Educational only, not financial advice.
            </div>
          </div>

          <div className="card p-3">
            <div className="font-semibold mb-2">TradingView – Technical Analysis Summary</div>
            <div className="h-[280px]">
              <TradingViewTAWidget symbol={symbol} exchange={exchange}/>
            </div>
            <div className="mt-2 text-[11px] muted">We do not read these values programmatically here.</div>
          </div>

          <div className="card p-4">
            <div className="mb-3 font-semibold">Fundamentals</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Market Cap (USD)" value={fmt(fund?.marketCap)} />
              <Metric label="24h Volume (USD)" value={fmt(fund?.volume24h)} />
              <Metric label="Circulating" value={fmtNum(fund?.circulating)} />
              <Metric label="Total Supply" value={fmtNum(fund?.totalSupply)} />
            </div>
            <div className="mt-3 text-xs muted">Sources: CoinGecko (market/fundamentals), Binance WS (USD real‑time), TradingView widgets.</div>
          </div>

          <div className="card p-4">
            <div className="mb-2 font-semibold">Levels & Alerts</div>
            <div className="overflow-hidden rounded-xl border border-[#1f2937]">
              <table className="w-full text-sm">
                <thead className="bg-[#0b1220] muted text-xs">
                  <tr><th className="text-left px-3 py-2">Level</th><th className="text-left px-3 py-2">Hits</th><th className="text-left px-3 py-2">Type</th></tr>
                </thead>
                <tbody>
                  {levels.map((l, i)=>{
                    const last = series.at(-1)?.close ?? 0;
                    const type = l.price < last ? "Support" : "Resistance";
                    return <tr key={i} className="border-t border-[#1f2937]"><td className="px-3 py-2">{fmt(l.price)}</td><td className="px-3 py-2">{l.hits}</td><td className="px-3 py-2">{type}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <button onClick={()=>requestNotificationPermission()} className="btn" style={{background:"#374151"}}>Enable browser alerts</button>
              <div className="text-xs muted">Alerts on nearest S/R cross + position events.</div>
            </div>

            {/* Telegram */}
            <div className="mt-4 space-y-2">
              <div className="text-[11px] uppercase tracking-wide muted">Telegram Alerts</div>
              <div className="grid gap-2">
                <div className="bg-[#0b1220] rounded-lg border border-[#1f2937] p-3">
                  <div className="text-xs font-medium mb-2">Secure mode (via your backend)</div>
                  <input value={backendUrl} onChange={e=>setBackendUrl(e.target.value)} type="url" placeholder="https://your-domain.com/api/telegram" className="w-full input mb-2"/>
                  <div className="flex items-center gap-2">
                    <button onClick={()=>setBackendEnabled(v=>!v)} className="btn">{backendEnabled?"Backend ON":"Backend OFF"}</button>
                    <button onClick={()=>notifyTelegram("Test: XRP alerts via backend ✔")} className="btn" style={{background:"#374151"}}>Send Test</button>
                  </div>
                  <div className="text-xs muted mt-2">Рекомендуется. Токен хранится на сервере. Этот URL принимает POST {"{ text }"}.</div>
                </div>

                <div className="bg-[#0b1220] rounded-lg border border-[#1f2937] p-3">
                  <div className="text-xs font-medium mb-2">Direct mode (browser → Telegram API)</div>
                  <input value={tgToken} onChange={e=>setTgToken(e.target.value)} type="password" placeholder="Bot Token (stored locally)" className="w-full input mb-2"/>
                  <input value={tgChatId} onChange={e=>setTgChatId(e.target.value)} type="text" placeholder="Chat ID (@username or numeric id)" className="w-full input mb-2"/>
                  <div className="flex items-center gap-2">
                    <button onClick={()=>setTgEnabled(v=>!v)} className="btn">{tgEnabled?"Telegram ON":"Telegram OFF"}</button>
                    <button onClick={()=>notifyTelegram("Test: XRP alerts are connected ✔")} className="btn" style={{background:"#374151"}}>Send Test</button>
                  </div>
                  <div className="text-xs muted mt-2">Менее безопасно: токен хранится в браузере.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 pb-10 text-xs muted">
        <div className="mt-4">Data: CoinGecko (historical & fundamentals). Real‑time: Binance XRPUSDT WebSocket (USD only). Indicators & signals computed client‑side. TradingView used for charts & TA summary. © {new Date().getFullYear()} – For education only.</div>
      </footer>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="bg-[#0b1220] rounded-xl border border-[#1f2937] p-3">
      <div className="text-[11px] uppercase tracking-wide muted">{label}</div>
      <div className="mt-1 font-medium">{value ?? "—"}</div>
    </div>
  );
}
function RadialGauge({ value, label }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  const data = [{ name: label, value: pct * 100, fill: pct >= 0.5 ? "#34d399" : "#f87171" }];
  return (
    <div className="w-full h-[160px]">
      <ResponsiveContainer>
        <RadialBarChart innerRadius="60%" outerRadius="100%" startAngle={180} endAngle={0} data={data}>
          <RadialBar minAngle={15} background clockWise dataKey="value" />
          <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" fill="#e5e7eb" fontSize="20" fontWeight="600">
            {(pct * 100).toFixed(1)}%
          </text>
          <text x="50%" y="75%" textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="12">
            {label}
          </text>
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}
function TradingViewAdvancedChart({ symbol, interval, theme = "dark", studies = [] }) {
  const containerRef = React.useRef(null);
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme,
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      withdateranges: true,
      save_image: false,
      studies,
      details: false,
      hotlist: false,
      calendar: false,
      hide_volume: false,
    });
    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container__widget";
    containerRef.current.appendChild(wrapper);
    containerRef.current.appendChild(script);
    return () => { if (containerRef.current) containerRef.current.innerHTML = ""; };
  }, [symbol, interval, theme, JSON.stringify(studies)]);
  return <div className="tradingview-widget-container w-full h-full" ref={containerRef} />;
}
function TradingViewTAWidget({ symbol, exchange }) {
  const containerRef = React.useRef(null);
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      interval: "1h",
      width: "100%",
      isTransparent: true,
      height: 250,
      symbol: `${exchange}:${symbol}`,
      showIntervalTabs: true,
      displayMode: "single",
      locale: "en",
      colorTheme: "dark"
    });
    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container__widget";
    containerRef.current.appendChild(wrapper);
    containerRef.current.appendChild(script);
    return () => { if (containerRef.current) containerRef.current.innerHTML = ""; };
  }, [symbol, exchange]);
  return <div className="tradingview-widget-container w-full h-full" ref={containerRef} />;
}
function notify(text) {
  try { if (("Notification" in window) && Notification.permission === "granted") new Notification(text); } catch {}
  try { notifyTelegram(text); } catch {}
}
async function notifyTelegram(text) {
  const saved = JSON.parse(localStorage.getItem("xrp_tg") || "null") || {};
  const backendUrl = saved?.backendUrl;
  const backendOn = !!saved?.backendEnabled && typeof backendUrl === 'string' && backendUrl.length > 0;
  if (backendOn) {
    try {
      await fetch(backendUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      return;
    } catch {}
  }
  const useEnabled = saved?.enabled;
  const useToken = saved?.token;
  const useChat = saved?.chat;
  if (!useEnabled || !useToken || !useChat) return;
  try {
    await fetch(`https://api.telegram.org/bot${useToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: useChat, text }) });
  } catch {}
}

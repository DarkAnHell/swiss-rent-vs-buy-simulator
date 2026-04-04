/**
 * Web Worker — receives batches of param combos, runs simulate() on each,
 * and posts back AGGREGATED stats instead of individual results.
 *
 * This keeps memory O(T × fields) instead of O(N × T × fields),
 * allowing 600k+ scenarios without OOM.
 */

import { simulate, clampParams, validateParams, breakeven } from "./model.js";

const PROGRESS_INTERVAL = 1000; // report progress every N sims

// Fields we aggregate per-year across all 4 strategies
const SERIES_GROUPS = [
  "networth", "total_cash_out", "net_cashflow", "invest",
];

const STRATEGIES = ["_rent", "_buy", "_buy_let_trigger", "_buy_let_immediate"];

// Number of histogram bins for end-delta distribution
const HIST_BINS = 40;

/**
 * Create a fresh per-year accumulator for one series.
 * Tracks count, sum (for mean), min, max per year slot.
 */
function makeSeriesAcc(T) {
  return {
    count: new Int32Array(T + 1),
    sum:   new Float64Array(T + 1),
    min:   new Float64Array(T + 1).fill(Infinity),
    max:   new Float64Array(T + 1).fill(-Infinity),
  };
}

function updateSeriesAcc(acc, data, T) {
  for (let t = 0; t <= T; t++) {
    const v = data[t];
    if (v !== undefined && !isNaN(v) && isFinite(v)) {
      acc.count[t]++;
      acc.sum[t] += v;
      if (v < acc.min[t]) acc.min[t] = v;
      if (v > acc.max[t]) acc.max[t] = v;
    }
  }
}

function mergeableSeriesAcc(acc, T) {
  return {
    count: Array.from(acc.count),
    sum:   Array.from(acc.sum),
    min:   Array.from(acc.min),
    max:   Array.from(acc.max),
  };
}

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type !== "run") return;

  const {
    combos,
    baseValues,
    sweepIndices,
    paramFieldNames,
    intFields,
    boolFields,
    strFields,
    T: horizonYears,
  } = msg;

  const intSet = new Set(intFields);
  const boolSet = new Set(boolFields);
  const strSet = new Set(strFields);
  const T = horizonYears;

  // Per-year accumulators for each series × strategy
  const seriesAccs = {};
  for (const group of SERIES_GROUPS) {
    for (const strat of STRATEGIES) {
      seriesAccs[group + strat] = makeSeriesAcc(T);
    }
  }

  // Delta (buy - rent) per year accumulator
  const deltaAcc = makeSeriesAcc(T);

  // Buy-win count per year (for win-share chart)
  const buyWinCount = new Int32Array(T + 1);

  // Summary scalars
  let totalCount = 0;
  let deltaSum = 0;
  let deltaMin = Infinity;
  let deltaMax = -Infinity;
  let buyWinsTotal = 0;
  let beSum = 0;
  let beCount = 0;

  // Histogram: we'll collect all diffs in a compact typed array
  // then bin them at the end (uses ~5 bytes per sim, so 600k = 3 MB)
  // Actually, even that is a lot. Use a two-pass approach:
  // first pass: find min/max of diffs. But we only have one pass.
  // Solution: use an adaptive histogram with wide initial range,
  // or just collect diffs as Float32Array (600k × 4 bytes = 2.4 MB — fine).
  const diffs = new Float32Array(combos.length);

  let progressCount = 0;

  try {
    for (let ci = 0; ci < combos.length; ci++) {
      const combo = combos[ci];
      const vals = baseValues.slice(); // faster than spread
      for (let si = 0; si < sweepIndices.length; si++) {
        vals[sweepIndices[si]] = combo[si];
      }

      const p = {};
      for (let i = 0; i < paramFieldNames.length; i++) {
        const name = paramFieldNames[i];
        let v = vals[i];
        if (intSet.has(name)) v = Math.round(v);
        else if (boolSet.has(name)) v = !!v;
        else if (strSet.has(name)) v = String(v);
        p[name] = v;
      }

      const cp = clampParams(p);
      validateParams(cp);
      const tr = simulate(cp);
      const infl = Math.pow(1 + cp.inflation_rate, T);
      const diff = (tr.networth_buy[T] - tr.networth_rent[T]) / infl;
      const be = breakeven(tr);

      // Accumulate per-year series stats
      for (const group of SERIES_GROUPS) {
        for (const strat of STRATEGIES) {
          const key = group + strat;
          updateSeriesAcc(seriesAccs[key], tr[key], T);
        }
      }

      // Delta per year (guard against NaN/Infinity from rogue simulations)
      for (let t = 0; t <= T; t++) {
        const d = tr.networth_buy[t] - tr.networth_rent[t];
        if (isFinite(d)) {
          deltaAcc.count[t]++;
          deltaAcc.sum[t] += d;
          if (d < deltaAcc.min[t]) deltaAcc.min[t] = d;
          if (d > deltaAcc.max[t]) deltaAcc.max[t] = d;
          if (d >= 0) buyWinCount[t]++;
        }
      }

      // Summary (guard against NaN/Infinity)
      totalCount++;
      if (isFinite(diff)) {
        deltaSum += diff;
        if (diff < deltaMin) deltaMin = diff;
        if (diff > deltaMax) deltaMax = diff;
        if (diff >= 0) buyWinsTotal++;
        diffs[ci] = diff;
      } else {
        diffs[ci] = 0;
      }
      if (be >= 0) { beSum += be; beCount++; }

      progressCount++;
      if (progressCount >= PROGRESS_INTERVAL) {
        self.postMessage({ type: "progress", count: progressCount });
        progressCount = 0;
      }
    }

    if (progressCount > 0) {
      self.postMessage({ type: "progress", count: progressCount });
    }

    // Build histogram bins from collected diffs
    const histMin = deltaMin;
    const histMax = deltaMax;
    const nBins = HIST_BINS;
    const binWidth = (histMax - histMin) / nBins || 1;
    const histBins = new Int32Array(nBins);
    for (let i = 0; i < diffs.length; i++) {
      const idx = Math.min(nBins - 1, Math.floor((diffs[i] - histMin) / binWidth));
      histBins[idx]++;
    }

    // Serialize accumulators
    const seriesData = {};
    for (const key of Object.keys(seriesAccs)) {
      seriesData[key] = mergeableSeriesAcc(seriesAccs[key], T);
    }

    self.postMessage({
      type: "done",
      agg: {
        T,
        totalCount,
        seriesData,
        deltaAcc: mergeableSeriesAcc(deltaAcc, T),
        buyWinCount: Array.from(buyWinCount),
        deltaSum,
        deltaMin,
        deltaMax,
        buyWinsTotal,
        beSum,
        beCount,
        histBins: Array.from(histBins),
        histMin,
        histMax,
        histBinWidth: binWidth,
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};

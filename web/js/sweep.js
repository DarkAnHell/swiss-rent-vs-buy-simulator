/**
 * Sweep engine — builds the cartesian-product grid from range specs and
 * dispatches simulation batches to Web Workers.
 *
 * Workers return AGGREGATED stats (not individual results) to keep memory
 * O(T × fields) instead of O(N × T × fields).
 */

import { expandSpec, splitConfig, applyCantonProfile } from "./config.js";

// ---- Grid helpers ----

export function buildSweepGrid(sweepConfig) {
  const keys = Object.keys(sweepConfig);
  const valueLists = keys.map((k) => expandSpec(k, sweepConfig[k]));
  return { keys, valueLists };
}

export function totalCombinations(sweepConfig) {
  const { valueLists } = buildSweepGrid(sweepConfig);
  return valueLists.reduce((acc, v) => acc * v.length, 1);
}

function cartesianProduct(arrays) {
  if (arrays.length === 0) return [[]];
  const result = [];
  const stack = [{ depth: 0, combo: [] }];
  while (stack.length > 0) {
    const { depth, combo } = stack.pop();
    if (depth === arrays.length) {
      result.push(combo);
      continue;
    }
    const arr = arrays[depth];
    for (let i = arr.length - 1; i >= 0; i--) {
      stack.push({ depth: depth + 1, combo: [...combo, arr[i]] });
    }
  }
  return result;
}

// ---- Param field metadata ----

const PARAM_FIELD_NAMES = [
  "years", "current_age", "retirement_age",
  "liquid_assets", "market_return", "stock_crash_pct", "stock_crash_interval_years",
  "inflation_rate", "investment_tax_drag_rate", "wealth_tax_rate",
  "income_working_annual", "retirement_income_annual",
  "non_housing_expenses_working", "non_housing_expenses_retired",
  "retirement_oneoff_cost",
  "rent_insurance_annual", "rent_deposit_months", "rent_deposit_interest_rate", "moving_cost",
  "purchase_price", "rent_monthly", "rent_growth", "home_price_growth",
  "rent_out_monthly_multiplier", "rent_out_vacancy_rate", "rent_out_management_fee_rate",
  "rent_out_other_costs", "rent_out_income_tax_rate",
  "second_home_rent_monthly", "second_home_rent_multiplier", "second_home_rent_deposit_months",
  "rent_out_trigger_liquidity_threshold",
  "housing_crash_pct", "housing_crash_interval_years",
  "maintenance_rate", "other_owner_costs", "property_tax_rate", "property_tax_assessment_pct",
  "annual_net_tax_impact",
  "cash_downpayment", "pillar2_used", "family_help",
  "mortgage_fixed_share", "mortgage_fixed_rate", "mortgage_fixed_years",
  "mortgage_variable_rate_initial", "mortgage_variable_rate_long", "mortgage_variable_adjust_years",
  "mortgage_refix_rate", "mortgage_refix_years",
  "amort_years", "target_ltv", "upfront_mortgage_fees",
  "pillar2_start", "pillar2_contrib", "pillar2_rate", "pillar2_withdrawal_tax_rate",
  "stop_pillar2_contrib_at_retirement", "pillar2_annuitize_at_retirement", "pillar2_conversion_rate",
  "buying_cost_pct", "buying_cost_fixed", "property_transfer_tax_rate",
  "selling_cost_pct", "selling_cost_fixed",
  "capex_rate", "capex_interval_years", "capex_first_year",
  "imputed_rent_pct", "maintenance_deduction_pct_of_imputed", "mortgage_interest_deductible_pct",
  "marginal_tax_rate", "cap_gains_tax_rate_base", "cap_gains_schedule_key", "cap_gains_tax",
];

const PARAM_INDEX = Object.fromEntries(PARAM_FIELD_NAMES.map((n, i) => [n, i]));

const INT_FIELDS = new Set([
  "years", "amort_years", "mortgage_fixed_years", "mortgage_variable_adjust_years",
  "stock_crash_interval_years", "housing_crash_interval_years", "mortgage_refix_years",
  "capex_interval_years", "capex_first_year",
]);

const BOOL_FIELDS = new Set([
  "stop_pillar2_contrib_at_retirement", "pillar2_annuitize_at_retirement",
]);

const STR_FIELDS = new Set(["cap_gains_schedule_key"]);

function buildBaseValues(base, sweepKeys, valueLists) {
  const sweepDefaults = {};
  sweepKeys.forEach((k, i) => { sweepDefaults[k] = valueLists[i][0]; });
  return PARAM_FIELD_NAMES.map((name) =>
    name in base ? base[name] : (name in sweepDefaults ? sweepDefaults[name] : 0)
  );
}

// ---- Aggregate merging ----

function mergeSeriesAcc(a, b, T) {
  const out = {
    count: new Array(T + 1),
    sum:   new Array(T + 1),
    min:   new Array(T + 1),
    max:   new Array(T + 1),
  };
  for (let t = 0; t <= T; t++) {
    out.count[t] = a.count[t] + b.count[t];
    out.sum[t]   = a.sum[t]   + b.sum[t];
    out.min[t]   = Math.min(a.min[t], b.min[t]);
    out.max[t]   = Math.max(a.max[t], b.max[t]);
  }
  return out;
}

/**
 * Merge two worker aggregates into one.
 */
function mergeAggregates(a, b) {
  const T = a.T;
  const merged = {
    T,
    totalCount: a.totalCount + b.totalCount,
    seriesData: {},
    deltaAcc: mergeSeriesAcc(a.deltaAcc, b.deltaAcc, T),
    buyWinCount: a.buyWinCount.map((v, i) => v + b.buyWinCount[i]),
    deltaSum: a.deltaSum + b.deltaSum,
    deltaMin: Math.min(a.deltaMin, b.deltaMin),
    deltaMax: Math.max(a.deltaMax, b.deltaMax),
    buyWinsTotal: a.buyWinsTotal + b.buyWinsTotal,
    beSum: a.beSum + b.beSum,
    beCount: a.beCount + b.beCount,
    // Histogram: merge by re-binning into unified range
    histBins: null,
    histMin: Math.min(a.histMin, b.histMin),
    histMax: Math.max(a.histMax, b.histMax),
    histBinWidth: 0,
  };

  // Merge series accumulators
  for (const key of Object.keys(a.seriesData)) {
    merged.seriesData[key] = mergeSeriesAcc(a.seriesData[key], b.seriesData[key], T);
  }

  // Merge histograms: re-bin both into the unified [histMin, histMax] range
  const nBins = a.histBins.length;
  const binWidth = (merged.histMax - merged.histMin) / nBins || 1;
  merged.histBinWidth = binWidth;
  const bins = new Array(nBins).fill(0);

  // Re-bin a's histogram
  for (let i = 0; i < nBins; i++) {
    if (a.histBins[i] > 0) {
      const midA = a.histMin + (i + 0.5) * a.histBinWidth;
      const newIdx = Math.min(nBins - 1, Math.max(0, Math.floor((midA - merged.histMin) / binWidth)));
      bins[newIdx] += a.histBins[i];
    }
  }
  // Re-bin b's histogram
  for (let i = 0; i < nBins; i++) {
    if (b.histBins[i] > 0) {
      const midB = b.histMin + (i + 0.5) * b.histBinWidth;
      const newIdx = Math.min(nBins - 1, Math.max(0, Math.floor((midB - merged.histMin) / binWidth)));
      bins[newIdx] += b.histBins[i];
    }
  }
  merged.histBins = bins;

  return merged;
}

// ---- Main sweep runner ----

/**
 * Run the sweep using Web Workers for parallelism.
 * Returns aggregated stats, NOT individual results.
 *
 * @param {Object} config - full config object (fixed + range values)
 * @param {string} canton - canton code or ""
 * @param {function} onProgress - callback(completed, total)
 * @param {number} numWorkers - worker count
 * @returns {Promise<{agg: Object, base: Object, sweep: Object, total: number}>}
 */
export async function runSweep(config, canton, onProgress, numWorkers) {
  const merged = applyCantonProfile(config, canton);
  const { base, sweep } = splitConfig(merged);

  // Determine T (horizon years) from base config
  const T = Math.round(base.years || 60);

  const sweepKeys = Object.keys(sweep);
  if (sweepKeys.length === 0) {
    // Single run — no sweep, run inline and wrap as aggregate
    const { simulate, clampParams, validateParams, breakeven } = await import("./model.js");
    const p = {};
    for (const name of PARAM_FIELD_NAMES) {
      p[name] = name in base ? base[name] : 0;
    }
    const cp = clampParams(p);
    validateParams(cp);
    const tr = simulate(cp);
    const infl = Math.pow(1 + cp.inflation_rate, cp.years);
    const diff = (tr.networth_buy[cp.years] - tr.networth_rent[cp.years]) / infl;
    const be = breakeven(tr);
    if (onProgress) onProgress(1, 1);

    // Wrap single result as an aggregate
    const agg = buildSingleResultAggregate(tr, diff, be, cp.years);
    return { agg, base, sweep, total: 1 };
  }

  const { keys, valueLists } = buildSweepGrid(sweep);
  const combos = cartesianProduct(valueLists);
  const total = combos.length;
  const sweepIndices = keys.map((k) => PARAM_INDEX[k]);
  const baseValues = buildBaseValues(base, keys, valueLists);

  numWorkers = numWorkers || Math.min(navigator.hardwareConcurrency || 4, total);
  const chunkSize = Math.max(1, Math.ceil(total / numWorkers));

  const chunks = [];
  for (let i = 0; i < total; i += chunkSize) {
    chunks.push(combos.slice(i, i + chunkSize));
  }

  let completed = 0;
  const workerAggs = [];

  const workerPromises = chunks.map((chunk) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker("js/worker.js", { type: "module" });

      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "progress") {
          completed += m.count;
          if (onProgress) onProgress(completed, total);
        } else if (m.type === "done") {
          workerAggs.push(m.agg);
          worker.terminate();
          resolve();
        } else if (m.type === "error") {
          worker.terminate();
          reject(new Error(m.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      worker.postMessage({
        type: "run",
        combos: chunk,
        baseValues,
        sweepIndices,
        paramFieldNames: PARAM_FIELD_NAMES,
        intFields: [...INT_FIELDS],
        boolFields: [...BOOL_FIELDS],
        strFields: [...STR_FIELDS],
        T,
      });
    });
  });

  await Promise.all(workerPromises);

  // Merge all worker aggregates
  let finalAgg = workerAggs[0];
  for (let i = 1; i < workerAggs.length; i++) {
    finalAgg = mergeAggregates(finalAgg, workerAggs[i]);
  }

  return { agg: finalAgg, base, sweep, total };
}

// ---- Helper: wrap single run as aggregate ----

function buildSingleResultAggregate(tr, diff, be, T) {
  const SERIES_GROUPS = ["networth", "total_cash_out", "net_cashflow", "invest"];
  const STRATEGIES = ["_rent", "_buy", "_buy_let_trigger", "_buy_let_immediate"];

  const seriesData = {};
  for (const group of SERIES_GROUPS) {
    for (const strat of STRATEGIES) {
      const key = group + strat;
      const data = tr[key];
      const count = new Array(T + 1).fill(1);
      const sum = Array.from(data);
      const min = Array.from(data);
      const max = Array.from(data);
      seriesData[key] = { count, sum, min, max };
    }
  }

  const deltaAcc = {
    count: new Array(T + 1).fill(1),
    sum: new Array(T + 1),
    min: new Array(T + 1),
    max: new Array(T + 1),
  };
  const buyWinCount = new Array(T + 1).fill(0);
  for (let t = 0; t <= T; t++) {
    const d = tr.networth_buy[t] - tr.networth_rent[t];
    deltaAcc.sum[t] = d;
    deltaAcc.min[t] = d;
    deltaAcc.max[t] = d;
    if (d >= 0) buyWinCount[t] = 1;
  }

  return {
    T,
    totalCount: 1,
    seriesData,
    deltaAcc,
    buyWinCount,
    deltaSum: diff,
    deltaMin: diff,
    deltaMax: diff,
    buyWinsTotal: diff >= 0 ? 1 : 0,
    beSum: be >= 0 ? be : 0,
    beCount: be >= 0 ? 1 : 0,
    histBins: [1, ...new Array(39).fill(0)],
    histMin: diff,
    histMax: diff,
    histBinWidth: 1,
  };
}

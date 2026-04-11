/**
 * App controller — wires config UI to sweep engine to chart rendering.
 */

import { DEFAULT_CONFIG, CANTON_PROFILES, lin, log, choices, expandSpec } from "./config.js";
import { runSweep, totalCombinations } from "./sweep.js";
import { splitConfig, applyCantonProfile } from "./config.js";
import {
  renderAllCharts,
  renderSummary,
  destroyAllCharts,
  downloadChart,
  setStrategyEnabled,
  setBandsEnabled,
  getVisibility,
} from "./charts.js";
import { t, setLang, applyTranslations } from "./i18n.js";

// ---- Tooltip copy ----

const TOOLTIPS = {
  // Horizon
  years:            "Total simulation horizon in years. Both renting and buying paths run for this long. Typical: 20–60.",
  current_age:      "Your age today. Determines how many working years remain before retirement.",
  retirement_age:   "Age at which income switches to retirement income. Swiss statutory age: 65.",

  // Starting Assets
  liquid_assets:              "Cash and investable assets today, excluding Pillar 2. Starting portfolio for both strategies.",
  inflation_rate:             "Annual general price inflation. Used to deflate end values. Enter as decimal (e.g. 0.02 = 2%). Typical CH: 1–3%.",
  investment_tax_drag_rate:   "Annual return drag from taxes on dividends/interest (e.g. withholding tax). Decimal. Typical: 0–0.5%.",
  wealth_tax_rate:            "Annual cantonal wealth tax on net financial assets. Decimal. Typical CH: 0–0.3%. Often set by canton preset.",

  // Household Cash Flow
  income_working_annual:          "Gross annual household income while working. CHF/year.",
  retirement_income_annual:       "Annual retirement income from AHV + other pensions (excluding Pillar 2 if annuitized). CHF/year. Currently, the minimum old-age pension for a single person is CHF 1,260 per month, and the maximum pension, CHF 2,520.",
  non_housing_expenses_working:   "All non-housing annual costs while working (food, transport, insurance, etc.). CHF/year.",
  non_housing_expenses_retired:   "All non-housing annual costs in retirement. CHF/year.",
  retirement_oneoff_cost:         "One-time cost at the moment of retirement (e.g. moving, health setup). CHF.",
  stop_pillar2_contrib_at_retirement: "If checked, Pillar 2 contributions stop at retirement age (standard practice in CH).",

  // Rent Costs
  rent_monthly:               "Monthly rent for the alternative rented apartment. CHF/month.",
  rent_insurance_annual:      "Annual renter's liability insurance (Haftpflichtversicherung). Typical CH: CHF 200–1000.",
  rent_deposit_months:        "Security deposit in months of rent (locked capital, earns no return). Swiss max: 3 months.",
  rent_deposit_interest_rate: "Interest rate earned on the security deposit while locked. Typically ~0% in CH.",
  moving_cost:                "One-time moving/transition cost. CHF.",

  // Macro Drivers
  market_return:                "Annual nominal return on invested liquid assets. Decimal (e.g. 0.07 = 7%). Historical global equities: ~7–8%.",
  home_price_growth:            "Annual nominal appreciation of the purchased property. Decimal. Historical CH: ~2–4%.",
  rent_growth:                  "Annual rate of rent increase. Decimal. Linked to Swiss reference interest rate; historically ~1–3%.",
  stock_crash_pct:              "Portfolio value lost in a stock crash. Decimal (e.g. 0.40 = 40% crash). Portfolio then recovers at market_return.",
  stock_crash_interval_years:   "Average years between stock crashes. E.g. 10 = one crash per decade.",
  housing_crash_pct:            "Property value lost in a housing crash. Decimal. Swiss housing is historically less volatile than equities.",
  housing_crash_interval_years: "Average years between housing crashes. E.g. 20 = one crash per 20 years.",

  // Property & Owner Costs
  purchase_price:                        "Total purchase price of the property. CHF.",
  maintenance_rate:                      "Annual routine maintenance as % of property value. Decimal. Rule of thumb: 1% (0.01) per year.",
  other_owner_costs:                     "Other fixed annual ownership costs (HOA fees, heating system, etc.). CHF/year.",
  property_tax_rate:                     "Annual property tax (Liegenschaftssteuer) rate on assessed value. Auto-set by canton preset. Most cantons: 0–0.3‰.",
  property_tax_assessment_pct:           "Fraction of market value used as the property tax base (Steuerwert). Typically 60–80%.",
  annual_net_tax_impact:                 "Catch-all annual tax adjustment for ownership not modelled elsewhere. CHF/year (negative = benefit, positive = extra cost).",
  maintenance_deduction_pct_of_imputed:  "Swiss deduction for maintenance costs as % of imputed rent. Decimal. Canton-specific: typically 10–20%.",
  mortgage_interest_deductible_pct:      "Fraction of mortgage interest deductible from income. Decimal. Usually 1.0 (100%) in Switzerland.",

  // Mortgage
  mortgage_fixed_years:           "Term length of the initial fixed-rate mortgage tranche. Typical CH: 5–15 years.",
  mortgage_fixed_rate:            "Annual interest rate on the fixed mortgage tranche. Decimal (e.g. 0.015 = 1.5%).",
  mortgage_fixed_share:           "Fraction of the total mortgage on the fixed tranche. The rest is variable (SARON-linked). Decimal (e.g. 0.6 = 60% fixed).",
  mortgage_variable_rate_initial: "Initial rate on the variable (SARON) tranche. Decimal. SARON rate + bank margin.",
  mortgage_variable_rate_long:    "Long-run assumed rate on the variable tranche after resets. Decimal. Conservative assumption for stress-testing.",
  mortgage_variable_adjust_years: "Years between variable rate resets. Typically 1–3 years.",
  mortgage_refix_rate:            "Rate assumed when the fixed tranche is renewed after its term expires. Decimal.",
  mortgage_refix_years:           "Length of each fixed-rate renewal period. Typical: 5–10 years.",
  amort_years:                    "Years over which the mortgage is amortized to reach target LTV. Swiss law: must reach 65% LTV within 15 years.",
  target_ltv:                     "Target loan-to-value ratio; amortization stops here. Swiss regulatory minimum: 0.65 (65%).",
  upfront_mortgage_fees:          "One-time fees at mortgage origination (notary, land register, etc.). CHF.",

  // Taxes
  imputed_rent_pct:          "Swiss imputed rent (Eigenmietwert) as % of market rent added to taxable income. Canton-specific; typically 60–70%. Auto-set by canton preset.",
  marginal_tax_rate:         "Your marginal income tax rate (federal + cantonal + municipal combined). Decimal. Used for mortgage interest shield and imputed rent.",
  cap_gains_tax_rate_base:   "Starting capital gains tax rate before holding-period discounts. Auto-set by canton preset. Decimal.",
  cap_gains_tax:             "Override: flat capital gains tax in CHF. Set to 0 to let the model compute from rate × schedule.",

  // Pillar 2
  pillar2_start:                   "Your current Pillar 2 (BVG/LPP) pension fund balance. CHF. Check your latest pension certificate.",
  pillar2_contrib:                 "Total annual Pillar 2 contributions (employee + employer share). CHF/year.",
  pillar2_rate:                    "Annual interest rate credited by your Pillar 2 fund. BVG legal minimum: 1% (0.01).",
  pillar2_withdrawal_tax_rate:     "Tax rate on Pillar 2 lump-sum withdrawal (e.g. for home purchase). Decimal. Typical CH: 5–10% (special reduced rate).",
  pillar2_annuitize_at_retirement: "If checked, Pillar 2 balance converts to a monthly annuity at retirement instead of staying as liquid capital.",
  pillar2_conversion_rate:         "Annual pension as % of Pillar 2 capital at retirement. BVG minimum rate: 6.8% (0.068).",

  // Pillar 3a
  pillar3a_start:                   "Your current Pillar 3a (tied pension) account balance. CHF. Check your latest bank/insurance statement.",
  pillar3a_contrib:                 "Annual Pillar 3a contribution. CHF/year. 2025 max for employees with P2: CHF 7,258; without P2: CHF 36,288.",
  pillar3a_rate:                    "Annual interest/return rate on your Pillar 3a account. Decimal. Bank 3a: ~0.5–1%; fund-based 3a: higher but volatile.",
  pillar3a_used:                    "Pillar 3a capital withdrawn for the home down payment. CHF. Reduces your 3a balance. Must be repaid if property is sold.",
  pillar3a_withdrawal_tax_rate:     "Tax rate on Pillar 3a lump-sum withdrawal. Decimal. Similar to P2 withdrawal tax, typically 5–10%. Varies by canton.",
  pillar3a_tax_deduction_rate:      "Effective tax savings rate from P3a contribution deductions. Decimal. E.g. 0.25 means each CHF contributed saves 0.25 CHF in taxes. Set to 0 to ignore.",
  stop_pillar3a_contrib_at_retirement: "If checked, Pillar 3a contributions stop at retirement age. 3a accounts must be withdrawn by age 70 (men) / 69 (women).",

  // Transaction Costs
  buying_cost_pct:           "Buying transaction costs as % of purchase price (notary, agent, registration). Decimal. Typical CH: 1–3%.",
  buying_cost_fixed:         "Fixed buying costs added on top of the percentage costs. CHF.",
  property_transfer_tax_rate:"Cantonal property transfer tax (Handänderungssteuer) as % of price. Auto-set by canton preset. Decimal.",
  selling_cost_pct:          "Selling costs as % of sale price (agent, notary). Decimal. Typical CH: 2–4%.",
  selling_cost_fixed:        "Fixed selling costs. CHF.",
  capex_rate:                "Major renovation/capital expenditure as % of property value, paid every capex_interval_years. Decimal. Typical: 3–5%.",
  capex_interval_years:      "Years between major capex events. E.g. 15 = full renovation every 15 years.",
  capex_first_year:          "Year of simulation at which the first capex event occurs.",

  // Equity
  cash_downpayment: "Cash equity from liquid assets for the down payment. CHF. Swiss minimum: 10% of purchase price from own funds (not Pillar 2).",
  pillar2_used:     "Pillar 2 capital withdrawn or pledged for the down payment. CHF. Reduces your P2 balance and future retirement income.",
  family_help:      "Gift or interest-free loan from family contributing to equity. CHF.",

  // Landlord Mode
  rent_out_monthly_multiplier:        "Multiplier on rent_monthly to set the tenant rent when the property is rented out. 1.0 = same rent as the reference apartment.",
  rent_out_vacancy_rate:              "Fraction of the year the property sits empty (no rental income). Decimal. E.g. 0.05 = 5% vacancy.",
  rent_out_management_fee_rate:       "Annual property management fee as fraction of rental income. Decimal. E.g. 0.08 = 8%.",
  rent_out_other_costs:               "Other annual landlord costs (extra insurance, small repairs). CHF/year.",
  rent_out_income_tax_rate:           "Marginal tax rate on net rental income. Decimal. Usually equals marginal_tax_rate.",
  second_home_rent_monthly:           "Monthly rent you pay for your own place while renting out the purchased property (Buy & Rent-out strategies). CHF/month.",
  second_home_rent_multiplier:        "Multiplier on second_home_rent_monthly. Use 1.0; adjust if your secondary rent grows differently.",
  second_home_rent_deposit_months:    "Security deposit months for your own rented home while being a landlord. Typically 2–3.",
  rent_out_trigger_liquidity_threshold: "Buy→Rent-out strategy: liquid assets threshold below which the property is rented out. 0 = rent out as soon as liquidity hits zero.",
};

// ---- Basic vs Advanced param split ----

const BASIC_PARAMS = {
  current_age:                  "e.g. 35",
  retirement_age:               "e.g. 65",
  liquid_assets:                "e.g. 100000",
  income_working_annual:        "e.g. 120000",
  retirement_income_annual:     "e.g. 30240",
  non_housing_expenses_working: "e.g. 50000",
  non_housing_expenses_retired: "e.g. 40000",
  rent_monthly:                 "e.g. 2000",
  purchase_price:               "e.g. 1000000",
  marginal_tax_rate:            "e.g. 0.25",
  pillar2_start:                "e.g. 50000",
  pillar2_contrib:              "e.g. 6000",
  pillar3a_start:               "e.g. 20000",
  pillar3a_contrib:             "e.g. 7258",
  cash_downpayment:             "e.g. 200000",
  pillar2_used:                 "e.g. 0",
  pillar3a_used:                "e.g. 0",
  family_help:                  "e.g. 0",
};

// ---- State ----

let currentCanton = "TG";
let running = false;

// ---- DOM refs ----

const btnRun = document.getElementById("btn-run");
const progressFill = document.getElementById("progress-bar-fill");
const progressLabel = document.getElementById("progress-label");
const cantonSelect = document.getElementById("canton-select");
const configToggle = document.getElementById("config-toggle-btn");
const configPanel = document.getElementById("config-panel");
const themeToggle = document.getElementById("theme-toggle");
const langSelect = document.getElementById("lang-select");
const configLevelToggle = document.getElementById("config-level-toggle");
const btnExportPreset = document.getElementById("btn-export-preset");
const btnImportPreset = document.getElementById("btn-import-preset");
const importPresetInput = document.getElementById("import-preset-input");

// ---- Config UI <-> Data ----

/**
 * Read the current config from the DOM.
 * Each .param-row with data-param has inputs with data-field="value"|"min"|"max"|"n".
 */
function readConfigFromUI() {
  const config = { ...DEFAULT_CONFIG };
  const rows = document.querySelectorAll(".param-row[data-param]");

  for (const row of rows) {
    const key = row.dataset.param;

    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      config[key] = checkbox.checked;
      continue;
    }

    const modeBtn = row.querySelector(".mode-toggle button.active");
    const mode = modeBtn ? modeBtn.dataset.mode : "fixed";

    if (mode === "fixed") {
      const input = row.querySelector('.fixed-input input[data-field="value"]');
      if (input) {
        const val = input.value.trim();
        if (val === "") {
          // Empty field — keep DEFAULT_CONFIG value (already spread above)
        } else {
          config[key] = parseFloat(val) || 0;
        }
      }
    } else {
      const minInput = row.querySelector('.range-inputs input[data-field="min"]');
      const maxInput = row.querySelector('.range-inputs input[data-field="max"]');
      const nInput = row.querySelector('.range-inputs input[data-field="n"]');
      if (minInput && maxInput && nInput) {
        const minVal = parseFloat(minInput.value) || 0;
        const maxVal = parseFloat(maxInput.value) || 0;
        const nVal = parseInt(nInput.value) || 2;
        config[key] = lin(minVal, maxVal, nVal);
      }
    }
  }

  return config;
}

/**
 * Populate the UI from a config object.
 * @param {Object} config
 * @param {boolean} forceValues - if true, populate basic params with their actual values
 *                                (used when loading a saved preset)
 */
function populateUI(config, forceValues = false) {
  const rows = document.querySelectorAll(".param-row[data-param]");
  for (const row of rows) {
    const key = row.dataset.param;
    const value = config[key];
    if (value === undefined) continue;

    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = !!value;
      continue;
    }

    const isRange = value !== null && typeof value === "object" && typeof value.type === "string";

    const fixedBtn = row.querySelector('.mode-toggle button[data-mode="fixed"]');
    const rangeBtn = row.querySelector('.mode-toggle button[data-mode="range"]');
    const fixedGroup = row.querySelector(".fixed-input");
    const rangeGroup = row.querySelector(".range-inputs");

    if (isRange) {
      fixedBtn?.classList.remove("active");
      rangeBtn?.classList.add("active");
      fixedGroup?.classList.add("hidden");
      rangeGroup?.classList.add("active");

      const minInput = row.querySelector('.range-inputs input[data-field="min"]');
      const maxInput = row.querySelector('.range-inputs input[data-field="max"]');
      const nInput = row.querySelector('.range-inputs input[data-field="n"]');

      if (value.type === "lin" || value.type === "log") {
        if (minInput) minInput.value = value.min;
        if (maxInput) maxInput.value = value.max;
        if (nInput) nInput.value = value.n;
      } else if (value.type === "choices") {
        if (minInput) minInput.value = Math.min(...value.values);
        if (maxInput) maxInput.value = Math.max(...value.values);
        if (nInput) nInput.value = value.values.length;
      }
    } else {
      fixedBtn?.classList.add("active");
      rangeBtn?.classList.remove("active");
      fixedGroup?.classList.remove("hidden");
      rangeGroup?.classList.remove("active");
      const input = row.querySelector('.fixed-input input[data-field="value"]');
      if (input) {
        if (!forceValues && key in BASIC_PARAMS) {
          input.value = "";
          input.placeholder = BASIC_PARAMS[key];
        } else {
          input.value = typeof value === "number" ? value : "";
          if (key in BASIC_PARAMS) input.placeholder = BASIC_PARAMS[key];
        }
      }
    }
  }
}

/**
 * Apply canton profile overrides to the UI.
 * Locked fields are forced to fixed mode, made readonly, and visually grayed out.
 */
function applyCanton(code) {
  // Unlock and restore defaults for any previously canton-locked rows
  document.querySelectorAll(".param-row[data-canton-locked]").forEach((row) => {
    const key = row.dataset.param;
    row.removeAttribute("data-canton-locked");
    const input = row.querySelector('.fixed-input input[data-field="value"]');
    if (input) input.removeAttribute("readonly");
    // Restore the DEFAULT_CONFIG value for this param (may be a range)
    if (key && DEFAULT_CONFIG[key] !== undefined) {
      populateUI({ [key]: DEFAULT_CONFIG[key] }, false);
    }
  });

  currentCanton = code || "";

  if (currentCanton && CANTON_PROFILES[currentCanton]) {
    const profile = CANTON_PROFILES[currentCanton];
    for (const [key, val] of Object.entries(profile)) {
      const row = document.querySelector(`.param-row[data-param="${key}"]`);
      if (!row) continue;

      // Force fixed mode (canton value is always a scalar)
      const fixedBtn = row.querySelector('.mode-toggle button[data-mode="fixed"]');
      const rangeBtn = row.querySelector('.mode-toggle button[data-mode="range"]');
      const fixedGroup = row.querySelector(".fixed-input");
      const rangeGroup = row.querySelector(".range-inputs");
      fixedBtn?.classList.add("active");
      rangeBtn?.classList.remove("active");
      fixedGroup?.classList.remove("hidden");
      rangeGroup?.classList.remove("active");

      const input = row.querySelector('.fixed-input input[data-field="value"]');
      if (input) {
        input.value = val;
        input.setAttribute("readonly", "");
      }
      row.dataset.cantonLocked = "true";
    }
  }

  updateComboCount();
}

function updateComboCount() {
  try {
    const config = readConfigFromUI();
    const merged = applyCantonProfile(config, currentCanton);
    const { sweep } = splitConfig(merged);
    const total = totalCombinations(sweep);
    if (progressLabel) {
      progressLabel.textContent = `${total.toLocaleString()} scenarios`;
    }
  } catch {
    // ignore during init
  }
}

// ---- Mode toggle wiring ----

function wireModeToggles() {
  document.querySelectorAll(".mode-toggle").forEach((toggle) => {
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".param-row");
        if (!row) return;
        toggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const fixedGroup = row.querySelector(".fixed-input");
        const rangeGroup = row.querySelector(".range-inputs");
        if (btn.dataset.mode === "fixed") {
          fixedGroup?.classList.remove("hidden");
          rangeGroup?.classList.remove("active");
        } else {
          fixedGroup?.classList.add("hidden");
          rangeGroup?.classList.add("active");
        }
        updateComboCount();
      });
    });
  });
}

// ---- Event markers ----

/**
 * Compute vertical-line event markers from base (fixed) and sweep (ranged) config.
 * Returns array of { label, min, max, median, color, dash } objects.
 * min === max means a single line; min < max means draw a band too.
 */
function computeEventMarkers(base, sweep, T) {
  function getVals(key) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      const v = Number(base[key]);
      return isFinite(v) && v > 0 ? [v] : null;
    }
    if (Object.prototype.hasOwnProperty.call(sweep, key)) {
      return expandSpec(key, sweep[key]).filter((v) => v > 0);
    }
    return null;
  }

  function makeMarker(label, vals, color, dash, showLabel = true) {
    if (!vals || vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    if (min > T) return null;
    return {
      label, showLabel,
      min: Math.min(min, T), max: Math.min(max, T), median: Math.min(median, T),
      color, dash,
    };
  }

  // For recurring events: one marker per occurrence within T
  function addRecurring(markers, intervalVals, label, color, dash, startVals = null) {
    if (!intervalVals || intervalVals.length === 0) return;
    const minInterval = Math.min(...intervalVals);
    const maxInterval = Math.max(...intervalVals);
    const sorted = [...intervalVals].sort((a, b) => a - b);
    const medInterval = sorted[Math.floor(sorted.length / 2)];

    // startVals: for capex, offsets the first occurrence
    const startMin = startVals ? Math.min(...startVals) : 0;
    const startMax = startVals ? Math.max(...startVals) : 0;
    const startMed = startVals ? [...startVals].sort((a, b) => a - b)[Math.floor(startVals.length / 2)] : 0;

    let n = 1;
    while (true) {
      const occMin = startVals ? startMin + (n - 1) * minInterval : n * minInterval;
      const occMax = startVals ? startMax + (n - 1) * maxInterval : n * maxInterval;
      const occMed = startVals ? startMed + (n - 1) * medInterval : n * medInterval;
      if (occMin > T) break;
      // Only show the band (min/max spread) for the first occurrence;
      // subsequent occurrences show a single line at the median to avoid compounding bands.
      const useMin = n === 1 ? occMin : occMed;
      const useMax = n === 1 ? occMax : occMed;
      markers.push({
        label, showLabel: n === 1,
        min: Math.min(useMin, T), max: Math.min(useMax, T), median: Math.min(occMed, T),
        color, dash,
      });
      n++;
    }
  }

  const markers = [];

  // Retirement (one-time)
  const ageVals = getVals("current_age");
  const retAgeVals = getVals("retirement_age");
  if (ageVals && retAgeVals) {
    const retYears = [];
    for (const ra of retAgeVals) for (const ca of ageVals) {
      const y = Math.ceil(ra - ca);
      if (y > 0) retYears.push(y);
    }
    const m = makeMarker("Retirement", retYears, "#D62728", [6, 3]);
    if (m) markers.push(m);
  }

  // Mortgage fixed end (one-time)
  const m1 = makeMarker("Fixed end", getVals("mortgage_fixed_years"), "#FF7F0E", [6, 3]);
  if (m1) markers.push(m1);

  // Amortization end (one-time)
  const m2 = makeMarker("Amort. end", getVals("amort_years"), "#7F7F7F", [4, 4]);
  if (m2) markers.push(m2);

  // Capex — recurring: first at capex_first_year, then every capex_interval_years
  const capexFirst = getVals("capex_first_year");
  const capexInterval = getVals("capex_interval_years");
  if (capexFirst && capexInterval) {
    addRecurring(markers, capexInterval, "Capex", "#9467BD", [3, 5], capexFirst);
  }

  // Stock crashes — recurring every stock_crash_interval_years
  const stockInterval = getVals("stock_crash_interval_years");
  if (stockInterval) {
    addRecurring(markers, stockInterval, "Stock crash", "#2CA02C", [2, 4]);
  }

  // Housing crashes — recurring every housing_crash_interval_years
  const housingInterval = getVals("housing_crash_interval_years");
  if (housingInterval) {
    addRecurring(markers, housingInterval, "Hsg crash", "#17BECF", [2, 4]);
  }

  return markers;
}

// ---- Run simulation ----

async function runSimulation() {
  if (running) return;
  running = true;
  btnRun.disabled = true;
  btnRun.textContent = t("btn_running");
  progressFill.style.width = "0%";
  progressLabel.textContent = t("status_starting");

  try {
    const config = readConfigFromUI();
    const { agg, base, sweep, total } = await runSweep(
      config,
      currentCanton,
      (completed, totalN) => {
        const pct = ((completed / totalN) * 100).toFixed(1);
        progressFill.style.width = pct + "%";
        progressLabel.textContent = `${completed.toLocaleString()} / ${totalN.toLocaleString()} (${pct}%)`;
      },
    );

    progressFill.style.width = "100%";
    progressLabel.textContent = `${t("status_done")} — ${total.toLocaleString()} ${t("scenarios")}`;

    const T = Math.round(base.years || 60);
    const events = computeEventMarkers(base, sweep, T);

    destroyAllCharts();
    renderAllCharts(agg, events);
    renderSummary(agg);
  } catch (err) {
    progressLabel.textContent = `${t("Error")}: ${err.message}`;
    console.error(err);
  } finally {
    running = false;
    btnRun.disabled = false;
    btnRun.textContent = t("btn_run");
  }
}

// ---- Tooltip injection ----

function injectTooltips() {
  for (const [param, text] of Object.entries(TOOLTIPS)) {
    const row = document.querySelector(`.param-row[data-param="${param}"]`);
    if (!row) continue;

    const tip = document.createElement("span");
    tip.className = "param-help";
    tip.dataset.tip = text;
    tip.textContent = "?";

    const labelEl = row.querySelector(".param-label");
    if (labelEl) {
      // Insert tip icon after the label span, before mode-toggle
      labelEl.after(tip);
    } else {
      // Checkbox row — append after the <label>
      const lbl = row.querySelector("label");
      if (lbl) lbl.after(tip);
    }
  }
}

// ---- Config level (Basic / Advanced) ----

function initConfigLevels() {
  // Tag every param-row as basic or advanced
  document.querySelectorAll(".param-row[data-param]").forEach((row) => {
    const param = row.dataset.param;
    row.dataset.level = param in BASIC_PARAMS ? "basic" : "advanced";
  });
}

function initConfigLevelToggle() {
  const saved = localStorage.getItem("configLevel") || "basic";
  applyConfigLevel(saved);

  configLevelToggle?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyConfigLevel(btn.dataset.level);
    });
  });
}

function applyConfigLevel(level) {
  if (configPanel) configPanel.dataset.configMode = level;
  localStorage.setItem("configLevel", level);
  configLevelToggle?.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.level === level);
  });

  // In basic mode, auto-open visible groups so users see the fields
  if (level === "basic") {
    document.querySelectorAll(".config-group").forEach((group) => {
      const hasBasic = group.querySelector('.param-row[data-level="basic"]');
      if (hasBasic) group.open = true;
    });
  }
}

// ---- Theme ----

function initTheme() {
  const saved = localStorage.getItem("theme") || "light";
  applyTheme(saved);

  themeToggle?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
    });
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  themeToggle?.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

// ---- Language ----

function initLang() {
  const saved = localStorage.getItem("lang") || "en";
  langSelect.value = saved;
  setLang(saved);

  langSelect?.addEventListener("change", () => {
    localStorage.setItem("lang", langSelect.value);
    setLang(langSelect.value);
  });
}

// ---- Download buttons ----

function wireDownloadButtons() {
  document.querySelectorAll(".btn-download").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chartId = btn.dataset.chart;
      if (chartId) downloadChart(chartId);
    });
  });
}

// ---- Strategy legend toggles ----

function wireLegendToggles() {
  // Per-strategy toggles
  document.querySelectorAll(".strategy-legend .legend-item[data-strategy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.strategy;
      const vis = getVisibility();
      const next = !vis[key];
      btn.classList.toggle("is-off", !next);
      setStrategyEnabled(key, next);
    });
  });

  // Min-Max range toggle
  const bandsBtn = document.getElementById("legend-bands-toggle");
  if (bandsBtn) {
    bandsBtn.addEventListener("click", () => {
      const vis = getVisibility();
      const next = !vis.bands;
      bandsBtn.classList.toggle("is-off", !next);
      setBandsEnabled(next);
    });
  }
}

// ---- Export / Import preset ----

function exportPreset() {
  const config = readConfigFromUI();
  const preset = {
    version: 1,
    canton: currentCanton,
    config,
  };
  const json = JSON.stringify(preset, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `preset_${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importPreset(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const preset = JSON.parse(e.target.result);
      if (!preset || typeof preset.config !== "object") {
        throw new Error("Not a valid preset file.");
      }

      // Restore canton selector
      const canton = preset.canton || "";
      currentCanton = canton;
      if (cantonSelect) cantonSelect.value = canton;

      // Restore all param values, including basic ones
      populateUI(preset.config, true);
      updateComboCount();
    } catch (err) {
      alert(`${t("import_error")}: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// ---- Init ----

function init() {
  initConfigLevels();
  populateUI(DEFAULT_CONFIG);
  injectTooltips();
  initTheme();
  initLang();
  initConfigLevelToggle();

  if (cantonSelect) {
    cantonSelect.value = currentCanton;
    cantonSelect.addEventListener("change", () => {
      applyCanton(cantonSelect.value);
    });
    applyCanton(currentCanton);
  }

  wireModeToggles();
  wireDownloadButtons();
  wireLegendToggles();

  btnExportPreset?.addEventListener("click", exportPreset);
  btnImportPreset?.addEventListener("click", () => importPresetInput?.click());
  importPresetInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importPreset(file);
      e.target.value = ""; // reset so same file can be re-imported
    }
  });

  btnRun?.addEventListener("click", runSimulation);

  configToggle?.addEventListener("click", () => {
    configPanel?.classList.toggle("collapsed");
  });

  document.querySelectorAll(".param-row input").forEach((input) => {
    input.addEventListener("change", updateComboCount);
  });

  updateComboCount();
}

document.addEventListener("DOMContentLoaded", init);

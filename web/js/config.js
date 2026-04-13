/**
 * Configuration for buy-rent model (JS port of buy_rent_config.py).
 *
 * Each CONFIG value can be:
 * - a fixed number / string / boolean
 * - lin(min, max, n)   – linear sweep
 * - log(min, max, n)   – logarithmic sweep
 * - choices(v1, v2, …) – discrete choices
 */

// ---------------------------------------------------------------------------
// Range-spec factory helpers
// ---------------------------------------------------------------------------

export function lin(min, max, n) {
  return { type: "lin", min: Number(min), max: Number(max), n: Math.round(n) };
}

export function log(min, max, n) {
  return { type: "log", min: Number(min), max: Number(max), n: Math.round(n) };
}

export function choices(...values) {
  if (values.length === 1 && Array.isArray(values[0])) {
    return { type: "choices", values: values[0].map(Number) };
  }
  return { type: "choices", values: values.map(Number) };
}

// ---------------------------------------------------------------------------
// Canton profiles
// ---------------------------------------------------------------------------

export const CANTON_PROFILES = {
  // Zurich
  ZH: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.007,
    cap_gains_tax_rate_base: 0.40,
    cap_gains_schedule_key: "ZH",
    imputed_rent_pct: 0.65,
  },
  // Bern
  BE: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.018,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Lucerne
  LU: {
    property_tax_rate: 0.00077,
    property_transfer_tax_rate: 0.015,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Uri
  UR: {
    property_tax_rate: 0.0002,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Schwyz
  SZ: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Obwalden
  OW: {
    property_tax_rate: 0.0001,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Nidwalden
  NW: {
    property_tax_rate: 0.0001,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.60,
  },
  // Glarus
  GL: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Zug
  ZG: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.0,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.60,
  },
  // Fribourg
  FR: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.015,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Solothurn
  SO: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.022,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Basel-Stadt
  BS: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.03,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Basel-Landschaft
  BL: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.025,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Schaffhausen
  SH: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.0,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Appenzell Ausserrhoden
  AR: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "AR",
  },
  // Appenzell Innerrhoden
  AI: {
    property_tax_rate: 0.0001,
    property_transfer_tax_rate: 0.01,
    cap_gains_tax_rate_base: 0.40,
    cap_gains_schedule_key: "AI",
  },
  // St. Gallen
  SG: {
    property_tax_rate: 0.00008,
    property_transfer_tax_rate: 0.01,
    cap_gains_tax_rate_base: 0.335,
    cap_gains_schedule_key: "SG",
    imputed_rent_pct: 0.70,
  },
  // Graubunden
  GR: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Aargau
  AG: {
    property_tax_rate: 0.0,
    property_transfer_tax_rate: 0.0,
    cap_gains_tax_rate_base: 0.40,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Thurgau
  TG: {
    property_tax_rate: 0.00005,
    property_transfer_tax_rate: 0.01,
    cap_gains_tax_rate_base: 0.40,
    cap_gains_schedule_key: "TG",
    imputed_rent_pct: 0.60,
  },
  // Ticino
  TI: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.0,
    cap_gains_tax_rate_base: 0.40,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Vaud
  VD: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.022,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Valais
  VS: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.015,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Neuchatel
  NE: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.022,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Geneva
  GE: {
    property_tax_rate: 0.001,
    property_transfer_tax_rate: 0.03,
    cap_gains_tax_rate_base: 0.50,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
  // Jura
  JU: {
    property_tax_rate: 0.0015,
    property_transfer_tax_rate: 0.02,
    cap_gains_tax_rate_base: 0.30,
    cap_gains_schedule_key: "",
    imputed_rent_pct: 0.70,
  },
};

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // horizon
  years: 60,
  current_age: 20,
  retirement_age: 65,

  // starting assets & investing
  liquid_assets: 0.0,
  inflation_rate: lin(0.01, 0.05, 5),
  investment_tax_drag_rate: lin(0.0, 0.005, 2),
  wealth_tax_rate: lin(0.0, 0.003, 2),

  // household lifecycle cash flow
  income_working_annual: 180_000.0,
  retirement_income_annual: 2520 * 12,
  non_housing_expenses_working: 50_000.0,
  non_housing_expenses_retired: 50_000.0,
  retirement_oneoff_cost: 10000.0,
  stop_pillar2_contrib_at_retirement: true,

  // rent-side costs
  rent_insurance_annual: 1000,
  rent_deposit_months: 3,
  rent_deposit_interest_rate: 0,
  moving_cost: 10_000,

  // macro drivers
  market_return: lin(0.02, 0.10, 3),
  home_price_growth: lin(0.01, 0.10, 3),
  rent_growth: lin(0.01, 0.10, 3),

  // crash stress tests
  stock_crash_pct: lin(0.20, 0.55, 3),
  stock_crash_interval_years: choices(10, 15),
  housing_crash_pct: lin(0.10, 0.55, 3),
  housing_crash_interval_years: choices(18, 25),

  // landlord mode
  rent_out_monthly_multiplier: 1.00,
  rent_out_vacancy_rate: 0.05,
  rent_out_management_fee_rate: 0.01,
  rent_out_other_costs: 1000.0,
  rent_out_income_tax_rate: 0.25,
  second_home_rent_monthly: 2000.0,
  second_home_rent_multiplier: 1.00,
  second_home_rent_deposit_months: 3.0,
  rent_out_trigger_liquidity_threshold: 0.0,

  // property & owner costs
  purchase_price: 1000000,
  rent_monthly: 2000.0,
  maintenance_rate: 0.01,
  other_owner_costs: 5000.0,
  property_tax_rate: 0.0,
  property_tax_assessment_pct: 0.70,
  annual_net_tax_impact: 0.0,
  maintenance_deduction_pct_of_imputed: lin(0.10, 0.20, 2),
  mortgage_interest_deductible_pct: 1,

  // mortgage structure
  mortgage_fixed_years: 10,
  mortgage_fixed_rate: 0.015,
  mortgage_fixed_share: choices(0.60, 0.80),
  mortgage_variable_rate_initial: lin(0.005, 0.02, 2),
  mortgage_variable_rate_long: choices(0.020, 0.030),
  mortgage_variable_adjust_years: 10,
  mortgage_refix_rate: 0.02,
  mortgage_refix_years: 10,
  amort_years: 15,
  target_ltv: 0.65,
  upfront_mortgage_fees: 10_000.0,

  // taxes
  imputed_rent_pct: choices(0.60, 0.70),
  imputed_rent_abolition_year: 9999,
  marginal_tax_rate: choices(0.20, 0.30),
  cap_gains_tax_rate_base: 0.0,
  cap_gains_schedule_key: "",
  cap_gains_tax: 0.0,

  // 2nd pillar
  pillar2_start: 0.0,
  pillar2_contrib: 0.0,
  pillar2_rate: 0.02,
  pillar2_withdrawal_tax_rate: 0.10,
  pillar2_annuitize_at_retirement: true,
  pillar2_conversion_rate: 0.068,

  // 3rd pillar (3a)
  pillar3a_start: 0.0,
  pillar3a_contrib: 7258.0,
  pillar3a_rate: 0.01,
  pillar3a_used: 0,
  pillar3a_withdrawal_tax_rate: 0.08,
  pillar3a_tax_deduction_rate: 0.0,
  stop_pillar3a_contrib_at_retirement: true,

  // transaction costs
  buying_cost_pct: 0.01,
  buying_cost_fixed: 5000.0,
  property_transfer_tax_rate: 0.0,
  selling_cost_pct: 0.03,
  selling_cost_fixed: 5000.0,
  capex_rate: 0.05,
  capex_interval_years: 15,
  capex_first_year: 15,

  // equity levers
  cash_downpayment: 200_000,
  pillar2_used: 0,
  family_help: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true when value is a fixed (non-sweep) scalar.
 */
function isFixed(value) {
  const t = typeof value;
  return t === "number" || t === "string" || t === "boolean";
}

/**
 * Return true when value is a range/choices spec object.
 */
function isRange(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.type === "string" &&
    (value.type === "lin" || value.type === "log" || value.type === "choices")
  );
}

/**
 * Expand a range spec into an array of concrete numeric values.
 *
 * @param {string} name  - parameter name (for error messages)
 * @param {object} spec  - a lin/log/choices spec object
 * @returns {number[]}
 */
export function expandSpec(name, spec) {
  if (!isRange(spec)) {
    throw new Error(`${name}: not a range spec`);
  }

  if (spec.type === "choices") {
    return [...spec.values];
  }

  if (spec.type === "lin") {
    const { min, max, n } = spec;
    if (n < 1) throw new Error(`${name}: lin n must be >= 1`);
    if (n === 1) return [min];
    const step = (max - min) / (n - 1);
    return Array.from({ length: n }, (_, i) => min + step * i);
  }

  if (spec.type === "log") {
    const { min, max, n } = spec;
    if (n < 1) throw new Error(`${name}: log n must be >= 1`);
    if (min <= 0 || max <= 0) {
      throw new Error(`${name}: log range requires positive min/max`);
    }
    if (n === 1) return [min];
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const step = (logMax - logMin) / (n - 1);
    return Array.from({ length: n }, (_, i) => Math.exp(logMin + step * i));
  }

  throw new Error(`${name}: unknown spec type "${spec.type}"`);
}

/**
 * Split a config dict into {base, sweep} where base holds fixed values and
 * sweep holds range specs.
 *
 * @param {Object} config
 * @returns {{base: Object, sweep: Object}}
 */
export function splitConfig(config) {
  const base = {};
  const sweep = {};
  for (const [key, value] of Object.entries(config)) {
    if (isFixed(value)) {
      base[key] = value;
    } else if (isRange(value)) {
      sweep[key] = value;
    } else {
      throw new Error(`${key}: unsupported config value`);
    }
  }
  return { base, sweep };
}

/**
 * Merge canton-specific overrides into a config object.
 *
 * @param {Object} config  - base config (not mutated)
 * @param {string} canton  - canton code (e.g. "ZH"), or "" to skip
 * @returns {Object} merged config
 */
export function applyCantonProfile(config, canton) {
  if (!canton) return { ...config };
  const code = canton.trim().toUpperCase();
  if (!(code in CANTON_PROFILES)) {
    throw new Error(
      `Unknown canton '${canton}'. Supported: ${Object.keys(CANTON_PROFILES).sort().join(", ")}`
    );
  }
  return { ...config, ...CANTON_PROFILES[code] };
}

/**
 * Apply canton profile then split into {base, sweep}.
 *
 * @param {Object} config
 * @param {string} canton
 * @returns {{base: Object, sweep: Object}}
 */
export function buildRuntimeConfig(config, canton) {
  return splitConfig(applyCantonProfile(config, canton));
}

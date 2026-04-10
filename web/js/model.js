/**
 * Simulation engine (JS port of buy-rent.py).
 * All parameter names use snake_case to match config.js.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SWISS_MIN_NON_AMORTIZING_LTV = 0.65;

// ---------------------------------------------------------------------------
// MortgagePlan
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MortgagePlan
 * @property {number} initial_balance
 * @property {number} non_amortizing_balance
 * @property {number} annual_amortization
 */

/**
 * @param {Object} p - params
 * @returns {MortgagePlan}
 */
export function buildMortgagePlan(p) {
  const equity_total = p.cash_downpayment + p.pillar2_used + (p.pillar3a_used || 0) + p.family_help;
  const mortgage0 = Math.max(0.0, p.purchase_price - equity_total);
  const non_amortizing_balance = Math.min(mortgage0, p.target_ltv * p.purchase_price);
  const amortizing_balance0 = Math.max(0.0, mortgage0 - non_amortizing_balance);
  const annual_amortization = p.amort_years > 0 ? amortizing_balance0 / p.amort_years : 0.0;
  return { initial_balance: mortgage0, non_amortizing_balance, annual_amortization };
}

// ---------------------------------------------------------------------------
// Rate helpers
// ---------------------------------------------------------------------------

export function variableRateForYear(p, year) {
  const adj = Math.max(1, p.mortgage_variable_adjust_years);
  const frac = Math.min(1.0, year / adj);
  return p.mortgage_variable_rate_initial + frac * (p.mortgage_variable_rate_long - p.mortgage_variable_rate_initial);
}

export function fixedRateForYear(p, year) {
  if (year <= p.mortgage_fixed_years) {
    return p.mortgage_fixed_rate;
  }
  if (p.mortgage_refix_years > 0) {
    const years_since_refix = year - p.mortgage_fixed_years;
    const refix_cycle = p.mortgage_refix_years;
    if (years_since_refix <= refix_cycle) {
      return p.mortgage_refix_rate;
    }
    const cycles_elapsed = Math.floor((years_since_refix - 1) / refix_cycle);
    const year_in_cycle = years_since_refix - cycles_elapsed * refix_cycle;
    if (year_in_cycle <= refix_cycle) {
      return p.mortgage_refix_rate;
    }
  }
  return p.mortgage_variable_rate_long;
}

export function blendedRateForYear(p, year) {
  const fix_rate = fixedRateForYear(p, year);
  const var_rate = variableRateForYear(p, year);
  return p.mortgage_fixed_share * fix_rate + (1.0 - p.mortgage_fixed_share) * var_rate;
}

// ---------------------------------------------------------------------------
// Growth / crash helpers
// ---------------------------------------------------------------------------

export function isPeriodicCrashYear(year, intervalYears) {
  return intervalYears > 0 && year > 0 && year % intervalYears === 0;
}

export function marketGrowthFactorForYear(p, year) {
  let factor = 1.0 + p.market_return;
  if (isPeriodicCrashYear(year, p.stock_crash_interval_years)) {
    factor *= (1.0 - p.stock_crash_pct);
  }
  return Math.max(0.0, factor);
}

export function homeGrowthFactorForYear(p, year) {
  let factor = 1.0 + p.home_price_growth;
  if (isPeriodicCrashYear(year, p.housing_crash_interval_years)) {
    factor *= (1.0 - p.housing_crash_pct);
  }
  return Math.max(0.0, factor);
}

// ---------------------------------------------------------------------------
// Home value path
// ---------------------------------------------------------------------------

/**
 * @param {Object} p
 * @param {number} maxYear
 * @returns {Float64Array}
 */
export function buildHomeValuePath(p, maxYear) {
  const values = new Float64Array(maxYear + 1);
  values[0] = p.purchase_price;
  for (let y = 1; y <= maxYear; y++) {
    values[y] = values[y - 1] * homeGrowthFactorForYear(p, y);
  }
  return values;
}

// ---------------------------------------------------------------------------
// Second-home rent base
// ---------------------------------------------------------------------------

export function secondHomeMonthlyRentBase(p) {
  if (p.second_home_rent_monthly > 0.0) {
    return p.second_home_rent_monthly;
  }
  return p.second_home_rent_multiplier * p.rent_monthly;
}

// ---------------------------------------------------------------------------
// Mortgage year computation
// ---------------------------------------------------------------------------

/**
 * @returns {{interest: number, principal: number, mortgage_end: number}}
 */
export function computeMortgageYear(p, plan, year, mortgageBegin) {
  const interest = mortgageBegin * blendedRateForYear(p, year);
  const amortizing_begin = Math.max(0.0, mortgageBegin - plan.non_amortizing_balance);
  let principal;
  if (year === 0) {
    principal = 0.0;
  } else if (year <= p.amort_years) {
    principal = Math.min(amortizing_begin, plan.annual_amortization);
  } else {
    principal = 0.0;
  }
  const mortgage_end = Math.max(0.0, mortgageBegin - principal);
  return { interest, principal, mortgage_end };
}

// ---------------------------------------------------------------------------
// Owner year computation
// ---------------------------------------------------------------------------

/**
 * @returns {{housing_cash_out: number, mortgage_end: number, capex_amount: number, home_value: number}}
 */
export function computeOwnerYear(p, plan, year, mortgageBegin, homeValue, rentGross, capexAmount, inflationFactor) {
  const mr = computeMortgageYear(p, plan, year, mortgageBegin);
  const maintenance = homeValue * p.maintenance_rate;
  const prop_tax = homeValue * p.property_tax_rate;
  const other_owner = p.other_owner_costs * inflationFactor;

  // Wealth tax on property (assessed value)
  const property_wealth_tax = homeValue * p.property_tax_assessment_pct * p.wealth_tax_rate;

  // Tax impact: imputed rent minus deductions (including capex)
  const imputed_rent = p.imputed_rent_pct * rentGross;
  const maintenance_deduction = Math.max(maintenance, imputed_rent * p.maintenance_deduction_pct_of_imputed);
  const interest_deduction = mr.interest * p.mortgage_interest_deductible_pct;
  const capex_deduction = capexAmount;
  const taxable_imputed = imputed_rent - interest_deduction - maintenance_deduction - capex_deduction;
  const tax_impact = taxable_imputed * p.marginal_tax_rate + p.annual_net_tax_impact * inflationFactor;

  const housing_cash_out = (
    mr.interest + mr.principal + maintenance + other_owner
    + prop_tax + capexAmount + tax_impact + property_wealth_tax
  );
  return {
    housing_cash_out,
    mortgage_end: mr.mortgage_end,
    capex_amount: capexAmount,
    home_value: homeValue,
  };
}

// ---------------------------------------------------------------------------
// Landlord year computation
// ---------------------------------------------------------------------------

/**
 * @returns {{net_cash_flow: number, total_cash_out: number, mortgage_end: number, capex_amount: number, home_value: number}}
 */
export function computeLandlordYear(p, plan, year, mortgageBegin, homeValue, rentGross, capexAmount,
                                     secondHomeHousingOut, nonHousing, retirementOneoff, income, inflationFactor) {
  const mr = computeMortgageYear(p, plan, year, mortgageBegin);
  const maintenance = homeValue * p.maintenance_rate;
  const prop_tax = homeValue * p.property_tax_rate;
  const other_owner = p.other_owner_costs * inflationFactor;
  const property_wealth_tax = homeValue * p.property_tax_assessment_pct * p.wealth_tax_rate;

  const rent_out_effective = p.rent_out_monthly_multiplier * rentGross * (1.0 - p.rent_out_vacancy_rate);
  const rent_out_mgmt = rent_out_effective * p.rent_out_management_fee_rate;
  const rent_out_other = p.rent_out_other_costs * inflationFactor;
  const rent_out_taxable = rent_out_effective - (
    mr.interest + maintenance + other_owner + prop_tax + capexAmount + rent_out_mgmt + rent_out_other
  );
  const rent_out_tax = Math.max(0.0, rent_out_taxable) * p.rent_out_income_tax_rate;
  const rent_out_property_cash = (
    mr.interest + mr.principal + maintenance + other_owner + prop_tax
    + capexAmount + rent_out_mgmt + rent_out_other + rent_out_tax + property_wealth_tax
  );
  const total_cash_out = (
    secondHomeHousingOut + nonHousing + retirementOneoff
    + rent_out_property_cash - rent_out_effective
  );
  const net_cash_flow = income - total_cash_out;
  return {
    net_cash_flow,
    total_cash_out,
    mortgage_end: mr.mortgage_end,
    capex_amount: capexAmount,
    home_value: homeValue,
  };
}

// ---------------------------------------------------------------------------
// Investment step
// ---------------------------------------------------------------------------

export function investStep(prev, contribution, year, p) {
  const gross = prev * marketGrowthFactorForYear(p, year);
  const tax_base = Math.max(0.0, prev);
  const tax_drag = tax_base * p.investment_tax_drag_rate;
  const wealth_tax = tax_base * p.wealth_tax_rate;
  return gross - tax_drag - wealth_tax + contribution;
}

// ---------------------------------------------------------------------------
// CapEx
// ---------------------------------------------------------------------------

export function capexForYear(p, year, homeValue) {
  if (p.capex_interval_years <= 0 || p.capex_rate <= 0 || year <= 0) {
    return 0.0;
  }
  const start = Math.max(0, p.capex_first_year);
  if (year >= start && (year - start) % p.capex_interval_years === 0) {
    return p.capex_rate * homeValue;
  }
  return 0.0;
}

// ---------------------------------------------------------------------------
// Capital gains tax schedules
// ---------------------------------------------------------------------------

const REDUCTION_TABLE_5_20 = [
  [5, 0.05], [6, 0.08], [7, 0.11], [8, 0.14], [9, 0.17],
  [10, 0.20], [11, 0.23], [12, 0.26], [13, 0.29], [14, 0.32],
  [15, 0.35], [16, 0.38], [17, 0.41], [18, 0.44], [19, 0.47],
  [20, 0.50],
];

function reductionFromTable(years, table) {
  let reduction = 0.0;
  for (let i = 0; i < table.length; i++) {
    if (years >= table[i][0]) {
      reduction = Math.max(reduction, table[i][1]);
    }
  }
  return reduction;
}

/**
 * Returns multiplier on base capital gains tax rate based on holding period schedule.
 * @param {string} scheduleKey - canton code (ZH, AR, AI, TG, SG)
 * @param {number} years - holding period in years
 * @param {number} gain - capital gain amount
 * @returns {number}
 */
export function capGainsMultiplier(scheduleKey, years, gain) {
  const key = scheduleKey ? scheduleKey.trim().toUpperCase() : "";

  let surcharge = 0.0;
  let reduction = 0.0;

  if (key === "ZH") {
    if (years < 1) surcharge = 0.50;
    else if (years < 2) surcharge = 0.25;
    reduction = reductionFromTable(years, REDUCTION_TABLE_5_20);
  } else if (key === "AR") {
    if (years < 0.5) surcharge = 0.50;
    else if (years < 1) surcharge = 0.35;
    else if (years < 2) surcharge = 0.20;
    else if (years < 3) surcharge = 0.10;
    else if (years < 4) surcharge = 0.05;
    if (years >= 10) {
      reduction = Math.min((years - 9) * 0.025, 0.50);
    }
  } else if (key === "AI") {
    if (years < 3) {
      const missing_months = Math.max(0.0, (3.0 - years) * 12.0);
      surcharge = Math.min(0.36, missing_months * 0.01);
    }
    reduction = reductionFromTable(years, REDUCTION_TABLE_5_20);
  } else if (key === "TG") {
    if (years < 3) {
      const missing_months = Math.max(0.0, (3.0 - years) * 12.0);
      surcharge = Math.min(0.36, missing_months * 0.01);
    }
    if (years >= 6) {
      reduction = Math.min((years - 5) * 0.04, 0.72);
    }
  } else if (key === "SG") {
    if (years < 5) {
      const missing_full_years = Math.ceil(5 - years);
      surcharge = Math.min(0.05, Math.max(0.0, missing_full_years * 0.01));
    }
    if (years > 15) {
      const years_over = Math.max(0.0, years - 15);
      const red_low = Math.min(years_over * 0.015, 0.405);
      const red_high = Math.min(years_over * 0.01, 0.20);
      if (gain <= 0) {
        reduction = 0.0;
      } else if (gain <= 500000) {
        reduction = red_low;
      } else {
        reduction = (500000 / gain) * red_low + ((gain - 500000) / gain) * red_high;
      }
    }
  }

  return Math.max(0.0, 1.0 + surcharge - reduction);
}

// ---------------------------------------------------------------------------
// Sale proceeds
// ---------------------------------------------------------------------------

export function saleProceedsAtYear(p, year, homeValue, mortgageEnd, capexCum, p2Outstanding, buyingCosts, p2WithdrawalTax, p3aOutstanding, p3aWithdrawalTax) {
  const selling_costs_base = homeValue * p.selling_cost_pct + p.selling_cost_fixed;
  const gain = Math.max(0.0, homeValue - p.purchase_price - buyingCosts - selling_costs_base - capexCum);
  const cg_rate = p.cap_gains_tax_rate_base * capGainsMultiplier(p.cap_gains_schedule_key, year, gain);
  const cg_tax = gain > 0 ? (gain * cg_rate + p.cap_gains_tax) : 0.0;
  const sell_costs = selling_costs_base + cg_tax;
  const p2_tax_refund = p2Outstanding > 0 ? p2WithdrawalTax : 0.0;
  const p3a_outstanding = p3aOutstanding || 0;
  const p3a_tax_refund = p3a_outstanding > 0 ? (p3aWithdrawalTax || 0) : 0.0;
  return homeValue - sell_costs - mortgageEnd - p2Outstanding + p2_tax_refund - p3a_outstanding + p3a_tax_refund;
}

// ---------------------------------------------------------------------------
// Param clamping
// ---------------------------------------------------------------------------

export function clampParams(p) {
  const c = Object.assign({}, p);
  c.years = Math.max(0, Math.round(c.years)) | 0;
  c.current_age = Math.max(18.0, Math.min(100.0, c.current_age));
  c.retirement_age = Math.max(18.0, Math.min(100.0, c.retirement_age));
  c.amort_years = Math.max(0, Math.round(c.amort_years)) | 0;
  c.mortgage_fixed_years = Math.max(0, Math.round(c.mortgage_fixed_years)) | 0;
  c.mortgage_variable_adjust_years = Math.max(1, Math.round(c.mortgage_variable_adjust_years)) | 0;
  c.stock_crash_interval_years = Math.max(0, Math.round(c.stock_crash_interval_years)) | 0;
  c.housing_crash_interval_years = Math.max(0, Math.round(c.housing_crash_interval_years)) | 0;
  c.stock_crash_pct = Math.min(0.95, Math.max(0.0, c.stock_crash_pct));
  c.housing_crash_pct = Math.min(0.95, Math.max(0.0, c.housing_crash_pct));
  c.rent_out_monthly_multiplier = Math.max(0.0, c.rent_out_monthly_multiplier);
  c.rent_out_vacancy_rate = Math.min(0.99, Math.max(0.0, c.rent_out_vacancy_rate));
  c.rent_out_management_fee_rate = Math.min(0.99, Math.max(0.0, c.rent_out_management_fee_rate));
  c.rent_out_other_costs = Math.max(0.0, c.rent_out_other_costs);
  c.rent_out_income_tax_rate = Math.min(1.0, Math.max(0.0, c.rent_out_income_tax_rate));
  c.second_home_rent_monthly = Math.max(0.0, c.second_home_rent_monthly);
  c.second_home_rent_multiplier = Math.max(0.0, c.second_home_rent_multiplier);
  c.second_home_rent_deposit_months = Math.min(3.0, Math.max(0.0, c.second_home_rent_deposit_months));
  c.mortgage_refix_years = Math.max(0, Math.round(c.mortgage_refix_years)) | 0;
  c.pillar2_conversion_rate = Math.min(1.0, Math.max(0.0, c.pillar2_conversion_rate));
  c.pillar3a_start = Math.max(0.0, c.pillar3a_start || 0);
  c.pillar3a_contrib = Math.max(0.0, c.pillar3a_contrib || 0);
  c.pillar3a_rate = Math.max(0.0, c.pillar3a_rate || 0);
  c.pillar3a_used = Math.max(0.0, c.pillar3a_used || 0);
  c.pillar3a_withdrawal_tax_rate = Math.min(1.0, Math.max(0.0, c.pillar3a_withdrawal_tax_rate || 0));
  c.pillar3a_tax_deduction_rate = Math.min(1.0, Math.max(0.0, c.pillar3a_tax_deduction_rate || 0));
  c.stop_pillar3a_contrib_at_retirement = c.stop_pillar3a_contrib_at_retirement !== false;
  c.property_tax_assessment_pct = Math.min(1.0, Math.max(0.0, c.property_tax_assessment_pct));
  c.capex_interval_years = Math.max(0, Math.round(c.capex_interval_years)) | 0;
  c.capex_first_year = Math.max(0, Math.round(c.capex_first_year)) | 0;
  c.rent_deposit_months = Math.min(3.0, Math.max(0.0, c.rent_deposit_months));
  c.mortgage_fixed_share = Math.min(1.0, Math.max(0.0, c.mortgage_fixed_share));
  c.target_ltv = Math.min(1.0, Math.max(SWISS_MIN_NON_AMORTIZING_LTV, c.target_ltv));
  return c;
}

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

export function validateParams(p) {
  const min_downpayment = 0.20 * p.purchase_price;
  if (p.cash_downpayment < min_downpayment) {
    throw new Error(
      `Invalid financing: cash_downpayment (${p.cash_downpayment.toFixed(2)}) ` +
      `is below 20% of purchase_price (${p.purchase_price.toFixed(2)}). ` +
      `Minimum required: ${min_downpayment.toFixed(2)}.`
    );
  }
  if (p.pillar2_used > p.pillar2_start) {
    throw new Error(
      `Invalid 2nd pillar: pillar2_used (${p.pillar2_used.toFixed(2)}) ` +
      `exceeds pillar2_start (${p.pillar2_start.toFixed(2)}).`
    );
  }
  const p3a_used = p.pillar3a_used || 0;
  const p3a_start = p.pillar3a_start || 0;
  if (p3a_used > p3a_start) {
    throw new Error(
      `Invalid 3rd pillar: pillar3a_used (${p3a_used.toFixed(2)}) ` +
      `exceeds pillar3a_start (${p3a_start.toFixed(2)}).`
    );
  }
}

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

/**
 * Run the full simulation for a single parameter set.
 * Returns a plain object (Trajectory) with Float64Array time-series.
 * @param {Object} p - params (will be clamped internally)
 * @returns {Object} Trajectory
 */
export function simulate(p) {
  p = clampParams(p);
  const T = p.years;
  const N = T + 1; // array length

  // Retirement year
  let retirement_year = Math.max(0, Math.ceil(p.retirement_age - p.current_age));
  retirement_year = Math.min(retirement_year, T + 1);

  // Pre-compute inflation factors
  const infl = new Float64Array(N);
  infl[0] = 1.0;
  for (let t = 1; t < N; t++) {
    infl[t] = infl[t - 1] * (1.0 + p.inflation_rate);
  }

  // Income, non-housing, retirement oneoff, rent insurance
  const income_annual = new Float64Array(N);
  const non_housing_expenses = new Float64Array(N);
  const retirement_oneoff = new Float64Array(N);
  const rent_insurance = new Float64Array(N);

  for (let t = 0; t < N; t++) {
    const retired = t >= retirement_year;
    income_annual[t] = (retired ? p.retirement_income_annual : p.income_working_annual) * infl[t];
    non_housing_expenses[t] = (retired ? p.non_housing_expenses_retired : p.non_housing_expenses_working) * infl[t];
    rent_insurance[t] = p.rent_insurance_annual * infl[t];
  }
  if (retirement_year <= T) {
    retirement_oneoff[retirement_year] = p.retirement_oneoff_cost * infl[retirement_year];
  }

  // Home value & rent paths
  const home_value = buildHomeValuePath(p, T);

  const rent_annual_gross = new Float64Array(N);
  const second_home_rent_monthly_base = secondHomeMonthlyRentBase(p);
  const second_home_rent_annual_gross = new Float64Array(N);

  for (let t = 0; t < N; t++) {
    const rg = Math.pow(1.0 + p.rent_growth, t);
    rent_annual_gross[t] = 12.0 * p.rent_monthly * rg;
    second_home_rent_annual_gross[t] = 12.0 * second_home_rent_monthly_base * rg;
  }

  // Rent housing cash out
  const rent_housing_cash_out = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    rent_housing_cash_out[t] = rent_annual_gross[t] + rent_insurance[t];
  }

  // Mortgage
  const mortgage_plan = buildMortgagePlan(p);
  const mortgage_bal = new Float64Array(N);
  const interest_arr = new Float64Array(N);
  const principal_arr = new Float64Array(N);
  const capex_arr = new Float64Array(N);

  let mb = mortgage_plan.initial_balance;
  for (let t = 0; t < N; t++) {
    const mr = computeMortgageYear(p, mortgage_plan, t, mb);
    interest_arr[t] = mr.interest;
    principal_arr[t] = mr.principal;
    mortgage_bal[t] = mr.mortgage_end;
    capex_arr[t] = capexForYear(p, t, home_value[t]);
    mb = mr.mortgage_end;
  }

  // Cumulative capex
  const capex_cum = new Float64Array(N);
  capex_cum[0] = capex_arr[0];
  for (let t = 1; t < N; t++) {
    capex_cum[t] = capex_cum[t - 1] + capex_arr[t];
  }

  // Owner costs (vectorized)
  const maintenance = new Float64Array(N);
  const other_owner = new Float64Array(N);
  const prop_tax = new Float64Array(N);
  const property_wealth_tax = new Float64Array(N);

  for (let t = 0; t < N; t++) {
    maintenance[t] = home_value[t] * p.maintenance_rate;
    other_owner[t] = p.other_owner_costs * infl[t];
    prop_tax[t] = home_value[t] * p.property_tax_rate;
    property_wealth_tax[t] = home_value[t] * p.property_tax_assessment_pct * p.wealth_tax_rate;
  }

  // Tax impact
  const imputed_rent = new Float64Array(N);
  const maintenance_deduction = new Float64Array(N);
  const interest_deduction = new Float64Array(N);
  const taxable_imputed = new Float64Array(N);
  const tax_impact = new Float64Array(N);

  for (let t = 0; t < N; t++) {
    imputed_rent[t] = p.imputed_rent_pct * rent_annual_gross[t];
    maintenance_deduction[t] = Math.max(maintenance[t], imputed_rent[t] * p.maintenance_deduction_pct_of_imputed);
    interest_deduction[t] = interest_arr[t] * p.mortgage_interest_deductible_pct;
    taxable_imputed[t] = imputed_rent[t] - interest_deduction[t] - maintenance_deduction[t] - capex_arr[t];
    tax_impact[t] = taxable_imputed[t] * p.marginal_tax_rate + p.annual_net_tax_impact * infl[t];
  }

  // Buy housing cash out
  const buy_housing_cash_out = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    buy_housing_cash_out[t] = (
      interest_arr[t] + principal_arr[t] + maintenance[t] + other_owner[t]
      + prop_tax[t] + capex_arr[t] + tax_impact[t] + property_wealth_tax[t]
    );
  }

  const total_cash_out_buy = new Float64Array(N);
  const total_cash_out_rent = new Float64Array(N);
  const net_cashflow_buy = new Float64Array(N);
  const net_cashflow_rent = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    total_cash_out_buy[t] = buy_housing_cash_out[t] + non_housing_expenses[t] + retirement_oneoff[t];
    total_cash_out_rent[t] = rent_housing_cash_out[t] + non_housing_expenses[t] + retirement_oneoff[t];
    net_cashflow_buy[t] = income_annual[t] - total_cash_out_buy[t];
    net_cashflow_rent[t] = income_annual[t] - total_cash_out_rent[t];
  }

  // Buy-to-let economics (vectorized base)
  const rent_out_gross = new Float64Array(N);
  const rent_out_effective = new Float64Array(N);
  const rent_out_mgmt = new Float64Array(N);
  const rent_out_other = new Float64Array(N);
  const rent_out_taxable = new Float64Array(N);
  const rent_out_tax = new Float64Array(N);
  const rent_out_property_cash = new Float64Array(N);
  const second_home_rent_housing = new Float64Array(N);
  const total_cash_out_buy_let_base = new Float64Array(N);
  const net_cashflow_buy_let_base = new Float64Array(N);

  for (let t = 0; t < N; t++) {
    rent_out_gross[t] = p.rent_out_monthly_multiplier * rent_annual_gross[t];
    rent_out_effective[t] = rent_out_gross[t] * (1.0 - p.rent_out_vacancy_rate);
    rent_out_mgmt[t] = rent_out_effective[t] * p.rent_out_management_fee_rate;
    rent_out_other[t] = p.rent_out_other_costs * infl[t];
    rent_out_taxable[t] = rent_out_effective[t] - (
      interest_arr[t] + maintenance[t] + other_owner[t] + prop_tax[t]
      + capex_arr[t] + rent_out_mgmt[t] + rent_out_other[t]
    );
    rent_out_tax[t] = Math.max(0.0, rent_out_taxable[t]) * p.rent_out_income_tax_rate;
    rent_out_property_cash[t] = (
      interest_arr[t] + principal_arr[t] + maintenance[t] + other_owner[t] + prop_tax[t]
      + capex_arr[t] + rent_out_mgmt[t] + rent_out_other[t] + rent_out_tax[t] + property_wealth_tax[t]
    );
    second_home_rent_housing[t] = second_home_rent_annual_gross[t] + rent_insurance[t];
    total_cash_out_buy_let_base[t] = (
      second_home_rent_housing[t] + non_housing_expenses[t] + retirement_oneoff[t]
      + rent_out_property_cash[t] - rent_out_effective[t]
    );
    net_cashflow_buy_let_base[t] = income_annual[t] - total_cash_out_buy_let_base[t];
  }

  // Upfront costs
  const buying_costs = p.purchase_price * (p.buying_cost_pct + p.property_transfer_tax_rate) + p.buying_cost_fixed;
  const pillar2_withdrawal_tax = p.pillar2_used * p.pillar2_withdrawal_tax_rate;
  const pillar3a_withdrawal_tax = p.pillar3a_used * p.pillar3a_withdrawal_tax_rate;
  const upfront_from_liquid = p.cash_downpayment + buying_costs + p.upfront_mortgage_fees + p.moving_cost + pillar2_withdrawal_tax + pillar3a_withdrawal_tax;

  // Rent-side upfront
  const rent_deposit = p.rent_monthly * p.rent_deposit_months;
  const rent_upfront = p.moving_cost + rent_deposit;

  // Investment accounts
  const inv_rent = new Float64Array(N);
  const inv_buy = new Float64Array(N);
  const inv_buy_let_trigger = new Float64Array(N);
  const inv_buy_let_immediate = new Float64Array(N);

  const total_cash_out_buy_let_trigger = new Float64Array(N);
  const total_cash_out_buy_let_immediate = new Float64Array(N);
  const net_cashflow_buy_let_trigger = new Float64Array(N);
  const net_cashflow_buy_let_immediate = new Float64Array(N);

  // Copy buy_let_base into immediate cashflow arrays
  for (let t = 0; t < N; t++) {
    net_cashflow_buy_let_immediate[t] = net_cashflow_buy_let_base[t];
    total_cash_out_buy_let_immediate[t] = total_cash_out_buy_let_base[t];
  }

  const second_home_deposit0 = p.second_home_rent_deposit_months * second_home_rent_monthly_base;
  const second_home_deposit_immediate_bal = new Float64Array(N);
  second_home_deposit_immediate_bal[0] = second_home_deposit0;

  // Year 0
  inv_buy[0] = investStep(p.liquid_assets - upfront_from_liquid, net_cashflow_buy[0], 0, p);
  inv_rent[0] = investStep(p.liquid_assets - rent_upfront, net_cashflow_rent[0], 0, p);
  inv_buy_let_immediate[0] = investStep(
    p.liquid_assets - upfront_from_liquid - second_home_deposit0,
    net_cashflow_buy_let_immediate[0], 0, p
  );

  // -----------------------------------------------------------------------
  // Pillar 2 & 3a accumulation (computed BEFORE investment loops so that
  // annuity income / lump-sum withdrawals / tax benefits can be fed into
  // the investment loop as proper compounding contributions)
  // -----------------------------------------------------------------------

  // 2nd pillar
  const p2_rent = new Float64Array(N);
  const p2_buy = new Float64Array(N);
  const p2_annuity_rent = new Float64Array(N);
  const p2_annuity_buy = new Float64Array(N);
  p2_rent[0] = p.pillar2_start;
  p2_buy[0] = Math.max(0.0, p.pillar2_start - p.pillar2_used);
  const pr = 1.0 + p.pillar2_rate;

  let p2_rent_annuitized = false;
  let p2_buy_annuitized = false;
  for (let t = 1; t < N; t++) {
    let contrib = p.pillar2_contrib;
    if (p.stop_pillar2_contrib_at_retirement && t >= retirement_year) {
      contrib = 0.0;
    }
    if (p.pillar2_annuitize_at_retirement && t === retirement_year) {
      const rent_annuity_val = p2_rent[t - 1] * pr * p.pillar2_conversion_rate;
      const buy_annuity_val = p2_buy[t - 1] * pr * p.pillar2_conversion_rate;
      for (let s = t; s < N; s++) {
        p2_annuity_rent[s] = rent_annuity_val;
        p2_annuity_buy[s] = buy_annuity_val;
      }
      p2_rent[t] = 0.0;
      p2_rent_annuitized = true;
      p2_buy[t] = 0.0;
      p2_buy_annuitized = true;
    } else {
      p2_rent[t] = p2_rent_annuitized ? 0.0 : p2_rent[t - 1] * pr + contrib;
      p2_buy[t] = p2_buy_annuitized ? 0.0 : p2_buy[t - 1] * pr + contrib;
    }
  }

  // 3rd pillar (3a)
  const p3a_rent = new Float64Array(N);
  const p3a_buy = new Float64Array(N);
  p3a_rent[0] = p.pillar3a_start;
  p3a_buy[0] = Math.max(0.0, p.pillar3a_start - p.pillar3a_used);
  const p3r = 1.0 + p.pillar3a_rate;

  for (let t = 1; t < N; t++) {
    let contrib3a = p.pillar3a_contrib;
    if (p.stop_pillar3a_contrib_at_retirement && t >= retirement_year) {
      contrib3a = 0.0;
    }
    if (t === retirement_year) {
      // Balance just before withdrawal (final growth + contribution)
      p3a_rent[t] = p3a_rent[t - 1] * p3r + contrib3a;
      p3a_buy[t] = p3a_buy[t - 1] * p3r + contrib3a;
      // Will be zeroed after computing lump sums below
    } else if (t < retirement_year) {
      p3a_rent[t] = p3a_rent[t - 1] * p3r + contrib3a;
      p3a_buy[t] = p3a_buy[t - 1] * p3r + contrib3a;
    } else {
      p3a_rent[t] = 0.0;
      p3a_buy[t] = 0.0;
    }
  }

  // Pre-compute P3a lump-sum net amounts at retirement
  let p3a_rent_lump_net = 0.0;
  let p3a_buy_lump_net = 0.0;
  if (retirement_year > 0 && retirement_year < N) {
    p3a_rent_lump_net = p3a_rent[retirement_year] * (1.0 - p.pillar3a_withdrawal_tax_rate);
    p3a_buy_lump_net = p3a_buy[retirement_year] * (1.0 - p.pillar3a_withdrawal_tax_rate);
    // Zero out balances post-withdrawal
    for (let t = retirement_year; t < N; t++) {
      p3a_rent[t] = 0.0;
      p3a_buy[t] = 0.0;
    }
  }

  // Build per-year extra-contribution arrays for the investment loop:
  // P2 annuity income + P3a lump sum + P3a tax deduction benefit
  const extra_contrib_rent = new Float64Array(N);
  const extra_contrib_buy = new Float64Array(N);

  for (let t = 0; t < N; t++) {
    // P2 annuity income (annual pension)
    if (p.pillar2_annuitize_at_retirement) {
      extra_contrib_rent[t] += p2_annuity_rent[t];
      extra_contrib_buy[t] += p2_annuity_buy[t];
    }

    // P3a tax deduction benefit (while contributing)
    if (t < retirement_year || !p.stop_pillar3a_contrib_at_retirement) {
      const contrib3a_t = (p.stop_pillar3a_contrib_at_retirement && t >= retirement_year) ? 0.0 : p.pillar3a_contrib;
      if (contrib3a_t > 0 && p.pillar3a_tax_deduction_rate > 0) {
        const benefit = contrib3a_t * p.pillar3a_tax_deduction_rate;
        extra_contrib_rent[t] += benefit;
        extra_contrib_buy[t] += benefit;
      }
    }
  }

  // P3a lump sum (one-time at retirement)
  if (retirement_year > 0 && retirement_year < N) {
    extra_contrib_rent[retirement_year] += p3a_rent_lump_net;
    extra_contrib_buy[retirement_year] += p3a_buy_lump_net;
  }

  // -----------------------------------------------------------------------
  // Buy->rent-out-on-trigger loop (uses extra_contrib_buy)
  // -----------------------------------------------------------------------
  const second_home_deposit_trigger_bal = new Float64Array(N);
  let switched_to_let = false;
  let switched_to_let_year = -1;

  for (let t = 0; t < N; t++) {
    let prev;
    if (t === 0) {
      prev = p.liquid_assets - upfront_from_liquid;
    } else {
      prev = inv_buy_let_trigger[t - 1];
    }

    const extra = extra_contrib_buy[t];

    if (!switched_to_let) {
      const owner_cash_out = total_cash_out_buy[t];
      const owner_net_cf = net_cashflow_buy[t];
      const owner_projected = investStep(prev, owner_net_cf + extra, t, p);
      if (t >= 1 && owner_projected <= p.rent_out_trigger_liquidity_threshold) {
        switched_to_let = true;
        switched_to_let_year = t;
        const deposit_add = (
          p.second_home_rent_deposit_months
          * second_home_rent_monthly_base
          * Math.pow(1.0 + p.rent_growth, t)
        );
        second_home_deposit_trigger_bal[t] = (
          t === 0
            ? deposit_add
            : second_home_deposit_trigger_bal[t - 1] * (1.0 + p.rent_deposit_interest_rate) + deposit_add
        );
        total_cash_out_buy_let_trigger[t] = total_cash_out_buy_let_base[t];
        net_cashflow_buy_let_trigger[t] = net_cashflow_buy_let_base[t];
        inv_buy_let_trigger[t] = investStep(prev - deposit_add, net_cashflow_buy_let_trigger[t] + extra, t, p);
      } else {
        total_cash_out_buy_let_trigger[t] = owner_cash_out;
        net_cashflow_buy_let_trigger[t] = owner_net_cf;
        inv_buy_let_trigger[t] = owner_projected;
        if (t > 0) {
          second_home_deposit_trigger_bal[t] = second_home_deposit_trigger_bal[t - 1];
        }
      }
    } else {
      second_home_deposit_trigger_bal[t] = (
        second_home_deposit_trigger_bal[t - 1] * (1.0 + p.rent_deposit_interest_rate)
      );
      total_cash_out_buy_let_trigger[t] = total_cash_out_buy_let_base[t];
      net_cashflow_buy_let_trigger[t] = net_cashflow_buy_let_base[t];
      inv_buy_let_trigger[t] = investStep(prev, net_cashflow_buy_let_trigger[t] + extra, t, p);
    }
  }

  // -----------------------------------------------------------------------
  // Main investment loops — pillar income now compounds correctly
  // -----------------------------------------------------------------------
  for (let t = 1; t < N; t++) {
    inv_buy[t] = investStep(inv_buy[t - 1], net_cashflow_buy[t] + extra_contrib_buy[t], t, p);
    inv_rent[t] = investStep(inv_rent[t - 1], net_cashflow_rent[t] + extra_contrib_rent[t], t, p);
    inv_buy_let_immediate[t] = investStep(inv_buy_let_immediate[t - 1], net_cashflow_buy_let_immediate[t] + extra_contrib_buy[t], t, p);
    second_home_deposit_immediate_bal[t] = second_home_deposit_immediate_bal[t - 1] * (1.0 + p.rent_deposit_interest_rate);
  }

  // Rent deposit balance
  const rent_deposit_bal = new Float64Array(N);
  rent_deposit_bal[0] = rent_deposit;
  const dr = 1.0 + p.rent_deposit_interest_rate;
  for (let t = 1; t < N; t++) {
    rent_deposit_bal[t] = rent_deposit_bal[t - 1] * dr;
  }

  // Sale proceeds if liquidating at end of each year
  const sale_proceeds = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    sale_proceeds[t] = saleProceedsAtYear(
      p, t, home_value[t], mortgage_bal[t], capex_cum[t],
      p.pillar2_used, buying_costs, pillar2_withdrawal_tax,
      p.pillar3a_used, pillar3a_withdrawal_tax
    );
  }

  // Pillar 2 & 3a repayment on sale
  const p2_repayment = p.pillar2_used;
  const p3a_repayment = p.pillar3a_used;

  // Net worths
  const networth_rent = new Float64Array(N);
  const networth_buy = new Float64Array(N);
  const networth_buy_let_trigger = new Float64Array(N);
  const networth_buy_let_immediate = new Float64Array(N);
  for (let t = 0; t < N; t++) {
    networth_rent[t] = inv_rent[t] + p2_rent[t] + p3a_rent[t] + rent_deposit_bal[t];
    networth_buy[t] = inv_buy[t] + (p2_buy[t] + p2_repayment) + (p3a_buy[t] + p3a_repayment) + sale_proceeds[t];
    networth_buy_let_trigger[t] = inv_buy_let_trigger[t] + (p2_buy[t] + p2_repayment) + (p3a_buy[t] + p3a_repayment) + sale_proceeds[t] + second_home_deposit_trigger_bal[t];
    networth_buy_let_immediate[t] = inv_buy_let_immediate[t] + (p2_buy[t] + p2_repayment) + (p3a_buy[t] + p3a_repayment) + sale_proceeds[t] + second_home_deposit_immediate_bal[t];
  }

  // Build years array
  const years = new Float64Array(N);
  for (let t = 0; t < N; t++) years[t] = t;

  return {
    years,
    total_cash_out_rent,
    total_cash_out_buy,
    total_cash_out_buy_let_trigger,
    total_cash_out_buy_let_immediate,
    net_cashflow_rent,
    net_cashflow_buy,
    net_cashflow_buy_let_trigger,
    net_cashflow_buy_let_immediate,
    retirement_year: retirement_year <= T ? retirement_year : -1,
    invest_rent: inv_rent,
    invest_buy: inv_buy,
    invest_buy_let_trigger: inv_buy_let_trigger,
    invest_buy_let_immediate: inv_buy_let_immediate,
    p2_rent_end: p2_rent[T],
    p2_buy_end: p2_buy[T],
    mortgage_balance_end: mortgage_bal[T],
    buy_let_trigger_switch_year: switched_to_let_year,
    second_home_deposit_trigger_end: second_home_deposit_trigger_bal[T],
    second_home_deposit_immediate_end: second_home_deposit_immediate_bal[T],
    networth_rent,
    networth_buy,
    networth_buy_let_trigger,
    networth_buy_let_immediate,
  };
}

// ---------------------------------------------------------------------------
// breakeven
// ---------------------------------------------------------------------------

/**
 * First year where buy net worth >= rent net worth.
 * @param {Object} tr - Trajectory
 * @returns {number} year index, or -1 if never
 */
export function breakeven(tr) {
  for (let t = 0; t < tr.networth_buy.length; t++) {
    if (tr.networth_buy[t] - tr.networth_rent[t] >= 0) {
      return t;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// firstNonPositiveYear (helper)
// ---------------------------------------------------------------------------

function firstNonPositiveYear(arr) {
  for (let t = 0; t < arr.length; t++) {
    if (arr[t] <= 0.0) return t;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// projectUntilDepletion
// ---------------------------------------------------------------------------

/**
 * Extend the timeline past the configured horizon until net worth is depleted.
 * @param {Object} p - params
 * @param {Object} tr - trajectory from simulate()
 * @param {number} [maxProjectionAge=110]
 * @returns {Object} DepletionProjection
 */
export function projectUntilDepletion(p, tr, maxProjectionAge = 110) {
  p = clampParams(p);
  const T = tr.years.length - 1;
  const max_year = Math.max(T, Math.ceil(maxProjectionAge - p.current_age));

  const retirement_year = Math.max(0, Math.ceil(p.retirement_age - p.current_age));
  const pr = 1.0 + p.pillar2_rate;
  const dr = 1.0 + p.rent_deposit_interest_rate;
  const home_values = buildHomeValuePath(p, max_year);
  const mortgage_plan = buildMortgagePlan(p);
  const buying_costs = p.purchase_price * (p.buying_cost_pct + p.property_transfer_tax_rate) + p.buying_cost_fixed;
  const pillar2_withdrawal_tax = p.pillar2_used * p.pillar2_withdrawal_tax_rate;
  const pillar3a_withdrawal_tax = p.pillar3a_used * p.pillar3a_withdrawal_tax_rate;
  const sh_rent_base = secondHomeMonthlyRentBase(p);

  function inflFactor(year) {
    return Math.pow(1.0 + p.inflation_rate, year);
  }

  function rentGrossForYear(year) {
    return 12.0 * p.rent_monthly * Math.pow(1.0 + p.rent_growth, year);
  }

  function rentHousingOutForYear(year) {
    return rentGrossForYear(year) + p.rent_insurance_annual * inflFactor(year);
  }

  function secondHomeHousingOutForYear(year) {
    return 12.0 * sh_rent_base * Math.pow(1.0 + p.rent_growth, year) + p.rent_insurance_annual * inflFactor(year);
  }

  function incomeForYear(year) {
    const base = year >= retirement_year ? p.retirement_income_annual : p.income_working_annual;
    return base * inflFactor(year);
  }

  function nonHousingForYear(year) {
    const base = year >= retirement_year ? p.non_housing_expenses_retired : p.non_housing_expenses_working;
    return base * inflFactor(year);
  }

  function retirementOneoffForYear(year) {
    return year === retirement_year ? p.retirement_oneoff_cost * inflFactor(year) : 0.0;
  }

  function p2ContribForYear(year) {
    if (p.stop_pillar2_contrib_at_retirement && year >= retirement_year) return 0.0;
    return p.pillar2_contrib;
  }

  function ownerStateForYear(year, mortgageBegin, prevCapexCum) {
    const hv = home_values[year];
    const capex_y = capexForYear(p, year, hv);
    const new_capex_cum = prevCapexCum + capex_y;
    const ow = computeOwnerYear(
      p, mortgage_plan, year, mortgageBegin, hv,
      rentGrossForYear(year), capex_y, inflFactor(year)
    );
    const total_out = ow.housing_cash_out + nonHousingForYear(year) + retirementOneoffForYear(year);
    const net_cf = incomeForYear(year) - total_out;
    return { net_cf, mortgage_end: ow.mortgage_end, capex_cum: new_capex_cum, home_value: hv };
  }

  function landlordStateForYear(year, mortgageBegin, prevCapexCum) {
    const hv = home_values[year];
    const capex_y = capexForYear(p, year, hv);
    const new_capex_cum = prevCapexCum + capex_y;
    const ll = computeLandlordYear(
      p, mortgage_plan, year, mortgageBegin, hv,
      rentGrossForYear(year), capex_y,
      secondHomeHousingOutForYear(year),
      nonHousingForYear(year),
      retirementOneoffForYear(year),
      incomeForYear(year),
      inflFactor(year)
    );
    return { net_cf: ll.net_cash_flow, mortgage_end: ll.mortgage_end, capex_cum: new_capex_cum, home_value: hv };
  }

  function clipSeriesAfterZero(series, zeroYear) {
    if (zeroYear < 0) return;
    series[zeroYear] = 0.0;
    for (let i = zeroYear + 1; i < series.length; i++) {
      series[i] = NaN;
    }
  }

  // Base horizon series (year 0..T) copied from the main simulation
  const years = [];
  const rent_nw = [];
  const buy_nw = [];
  const buy_let_trigger_nw = [];
  const buy_let_immediate_nw = [];

  for (let t = 0; t <= T; t++) {
    years.push(t);
    rent_nw.push(tr.networth_rent[t]);
    buy_nw.push(tr.networth_buy[t]);
    buy_let_trigger_nw.push(tr.networth_buy_let_trigger[t]);
    buy_let_immediate_nw.push(tr.networth_buy_let_immediate[t]);
  }

  let rent_zero_year = firstNonPositiveYear(tr.networth_rent);
  let buy_zero_year = firstNonPositiveYear(tr.networth_buy);
  let buy_let_trigger_zero_year = firstNonPositiveYear(tr.networth_buy_let_trigger);
  let buy_let_immediate_zero_year = firstNonPositiveYear(tr.networth_buy_let_immediate);
  let buy_sale_year = -1;
  let buy_let_trigger_switch_year = tr.buy_let_trigger_switch_year;

  clipSeriesAfterZero(rent_nw, rent_zero_year);
  clipSeriesAfterZero(buy_nw, buy_zero_year);
  clipSeriesAfterZero(buy_let_trigger_nw, buy_let_trigger_zero_year);
  clipSeriesAfterZero(buy_let_immediate_nw, buy_let_immediate_zero_year);

  let rent_alive = rent_zero_year < 0;
  let buy_alive = buy_zero_year < 0;
  let buy_let_trigger_alive = buy_let_trigger_zero_year < 0;
  let buy_let_immediate_alive = buy_let_immediate_zero_year < 0;

  // State at year T
  let rent_liquid = tr.invest_rent[T];
  let rent_p2 = tr.p2_rent_end;
  let rent_deposit_bal = p.rent_monthly * p.rent_deposit_months * Math.pow(1.0 + p.rent_deposit_interest_rate, T);

  // P2 annuity state
  let rent_p2_annuity = 0.0;
  let buy_p2_annuity = 0.0;
  if (p.pillar2_annuitize_at_retirement && retirement_year <= T) {
    let acc = p.pillar2_start;
    for (let t = 1; t < retirement_year; t++) {
      const contrib = (p.stop_pillar2_contrib_at_retirement && t >= retirement_year) ? 0.0 : p.pillar2_contrib;
      acc = acc * pr + contrib;
    }
    rent_p2_annuity = acc * pr * p.pillar2_conversion_rate;

    let buy_acc = Math.max(0.0, p.pillar2_start - p.pillar2_used);
    for (let t = 1; t < retirement_year; t++) {
      const contrib = (p.stop_pillar2_contrib_at_retirement && t >= retirement_year) ? 0.0 : p.pillar2_contrib;
      buy_acc = buy_acc * pr + contrib;
    }
    buy_p2_annuity = buy_acc * pr * p.pillar2_conversion_rate;
  }

  let buy_liquid = tr.invest_buy[T];
  let buy_p2 = tr.p2_buy_end;
  let buy_p2_outstanding = p.pillar2_used;
  let buy_p3a = 0.0; // P3a is fully withdrawn by retirement (within T)
  let buy_p3a_outstanding = p.pillar3a_used;
  let buy_has_home = true;
  let buy_rent_deposit = 0.0;
  let buy_mortgage_end_val = tr.mortgage_balance_end;

  let trigger_liquid = tr.invest_buy_let_trigger[T];
  let trigger_p2 = tr.p2_buy_end;
  let trigger_p2_outstanding = p.pillar2_used;
  let trigger_p3a = 0.0;
  let trigger_p3a_outstanding = p.pillar3a_used;
  let trigger_mortgage_end_val = tr.mortgage_balance_end;
  let trigger_switched_to_let = buy_let_trigger_switch_year >= 0;
  let trigger_second_home_deposit = tr.second_home_deposit_trigger_end;
  let trigger_home_value = home_values[T];

  let immediate_liquid = tr.invest_buy_let_immediate[T];
  let immediate_p2 = tr.p2_buy_end;
  let immediate_p2_outstanding = p.pillar2_used;
  let immediate_p3a = 0.0;
  let immediate_p3a_outstanding = p.pillar3a_used;
  let immediate_mortgage_end_val = tr.mortgage_balance_end;
  let immediate_second_home_deposit = tr.second_home_deposit_immediate_end;
  let immediate_home_value = home_values[T];

  // Reconstruct capex_cum at year T
  let buy_capex_cum = 0;
  for (let t = 0; t <= T; t++) {
    buy_capex_cum += capexForYear(p, t, home_values[t]);
  }
  let trigger_capex_cum = buy_capex_cum;
  let immediate_capex_cum = buy_capex_cum;

  for (let year = T + 1; year <= max_year; year++) {
    years.push(year);
    const income = incomeForYear(year);
    const non_housing = nonHousingForYear(year);
    const retire_oneoff = retirementOneoffForYear(year);
    const p2_contrib = p2ContribForYear(year);

    // --- RENT ---
    if (rent_alive) {
      const rent_cash_out = rentHousingOutForYear(year) + non_housing + retire_oneoff;
      const rent_net_cf = income - rent_cash_out;
      rent_liquid = investStep(rent_liquid, rent_net_cf + rent_p2_annuity, year, p);
      if (!(p.pillar2_annuitize_at_retirement && year >= retirement_year)) {
        rent_p2 = rent_p2 * pr + p2_contrib;
      }
      rent_deposit_bal = rent_deposit_bal * dr;
      let rent_total_nw = rent_liquid + rent_p2 + rent_deposit_bal; // P3a already withdrawn to liquid by retirement
      if (rent_total_nw <= 0.0) {
        rent_total_nw = 0.0;
        rent_alive = false;
        rent_zero_year = year;
      }
      rent_nw.push(rent_total_nw);
    } else {
      rent_nw.push(NaN);
    }

    // --- BUY ---
    if (buy_alive) {
      let buy_total_nw;
      if (buy_has_home) {
        const os = ownerStateForYear(year, buy_mortgage_end_val, buy_capex_cum);
        const projected_owner_liquid = investStep(buy_liquid, os.net_cf + buy_p2_annuity, year, p);
        if (projected_owner_liquid <= 0.0) {
          buy_capex_cum = os.capex_cum;
          const sale_cash = saleProceedsAtYear(
            p, year, os.home_value, os.mortgage_end, buy_capex_cum,
            buy_p2_outstanding, buying_costs, pillar2_withdrawal_tax,
            buy_p3a_outstanding, pillar3a_withdrawal_tax
          );
          buy_p2 += buy_p2_outstanding;
          buy_p2_outstanding = 0.0;
          buy_p3a += buy_p3a_outstanding;
          buy_p3a_outstanding = 0.0;
          buy_has_home = false;
          buy_sale_year = year;
          buy_rent_deposit = p.rent_deposit_months * p.rent_monthly * Math.pow(1.0 + p.rent_growth, year);
          buy_liquid = buy_liquid + sale_cash - buy_rent_deposit;
          const rent_cash_out = rentHousingOutForYear(year) + non_housing + retire_oneoff;
          const rent_net_cf = income - rent_cash_out;
          buy_liquid = investStep(buy_liquid, rent_net_cf + buy_p2_annuity, year, p);
          if (!(p.pillar2_annuitize_at_retirement && year >= retirement_year)) {
            buy_p2 = buy_p2 * pr + p2_contrib;
          }
          buy_rent_deposit = buy_rent_deposit * dr;
          buy_total_nw = buy_liquid + buy_p2 + buy_p3a + buy_rent_deposit;
        } else {
          buy_liquid = projected_owner_liquid;
          if (!(p.pillar2_annuitize_at_retirement && year >= retirement_year)) {
            buy_p2 = buy_p2 * pr + p2_contrib;
          }
          buy_mortgage_end_val = os.mortgage_end;
          buy_capex_cum = os.capex_cum;
          const sale_cash_if_sell = saleProceedsAtYear(
            p, year, os.home_value, os.mortgage_end, buy_capex_cum,
            buy_p2_outstanding, buying_costs, pillar2_withdrawal_tax,
            buy_p3a_outstanding, pillar3a_withdrawal_tax
          );
          buy_total_nw = buy_liquid + buy_p2 + buy_p2_outstanding + buy_p3a + buy_p3a_outstanding + sale_cash_if_sell;
        }
      } else {
        const rent_cash_out = rentHousingOutForYear(year) + non_housing + retire_oneoff;
        const rent_net_cf = income - rent_cash_out;
        buy_liquid = investStep(buy_liquid, rent_net_cf + buy_p2_annuity, year, p);
        if (!(p.pillar2_annuitize_at_retirement && year >= retirement_year)) {
          buy_p2 = buy_p2 * pr + p2_contrib;
        }
        buy_rent_deposit = buy_rent_deposit * dr;
        buy_total_nw = buy_liquid + buy_p2 + buy_p3a + buy_rent_deposit;
      }

      if (buy_total_nw <= 0.0) {
        buy_total_nw = 0.0;
        buy_alive = false;
        buy_zero_year = year;
      }
      buy_nw.push(buy_total_nw);
    } else {
      buy_nw.push(NaN);
    }

    // --- BUY-LET TRIGGER ---
    if (buy_let_trigger_alive) {
      if (trigger_switched_to_let) {
        trigger_second_home_deposit = trigger_second_home_deposit * dr;
        const ls = landlordStateForYear(year, trigger_mortgage_end_val, trigger_capex_cum);
        trigger_liquid = investStep(trigger_liquid, ls.net_cf + buy_p2_annuity, year, p);
        trigger_mortgage_end_val = ls.mortgage_end;
        trigger_capex_cum = ls.capex_cum;
        trigger_home_value = ls.home_value;
      } else {
        const os = ownerStateForYear(year, trigger_mortgage_end_val, trigger_capex_cum);
        const projected_owner_liquid = investStep(trigger_liquid, os.net_cf + buy_p2_annuity, year, p);
        if (year >= 1 && projected_owner_liquid <= p.rent_out_trigger_liquidity_threshold) {
          trigger_switched_to_let = true;
          buy_let_trigger_switch_year = year;
          const deposit_add = p.second_home_rent_deposit_months * sh_rent_base * Math.pow(1.0 + p.rent_growth, year);
          trigger_second_home_deposit = trigger_second_home_deposit * dr + deposit_add;
          const ls = landlordStateForYear(year, trigger_mortgage_end_val, trigger_capex_cum);
          trigger_liquid = investStep(trigger_liquid - deposit_add, ls.net_cf + buy_p2_annuity, year, p);
          trigger_mortgage_end_val = ls.mortgage_end;
          trigger_capex_cum = ls.capex_cum;
          trigger_home_value = ls.home_value;
        } else {
          trigger_liquid = projected_owner_liquid;
          trigger_mortgage_end_val = os.mortgage_end;
          trigger_capex_cum = os.capex_cum;
          trigger_home_value = os.home_value;
        }
      }

      if (!(p.pillar2_annuitize_at_retirement && year >= retirement_year)) {
        trigger_p2 = trigger_p2 * pr + p2_contrib;
      }
      const trigger_sale_cash_if_sell = saleProceedsAtYear(
        p, year, trigger_home_value, trigger_mortgage_end_val, trigger_capex_cum,
        trigger_p2_outstanding, buying_costs, pillar2_withdrawal_tax,
        trigger_p3a_outstanding, pillar3a_withdrawal_tax
      );
      let trigger_total_nw = (
        trigger_liquid + trigger_p2 + trigger_p2_outstanding + trigger_p3a + trigger_p3a_outstanding + trigger_sale_cash_if_sell + trigger_second_home_deposit
      );
      if (trigger_total_nw <= 0.0) {
        trigger_total_nw = 0.0;
        buy_let_trigger_alive = false;
        buy_let_trigger_zero_year = year;
      }
      buy_let_trigger_nw.push(trigger_total_nw);
    } else {
      buy_let_trigger_nw.push(NaN);
    }

    // --- BUY-LET IMMEDIATE ---
    if (buy_let_immediate_alive) {
      immediate_second_home_deposit = immediate_second_home_deposit * dr;
      const ls = landlordStateForYear(year, immediate_mortgage_end_val, immediate_capex_cum);
      immediate_liquid = investStep(immediate_liquid, ls.net_cf + buy_p2_annuity, year, p);
      immediate_mortgage_end_val = ls.mortgage_end;
      immediate_capex_cum = ls.capex_cum;
      immediate_home_value = ls.home_value;
      if (!(p.pillar2_annuitize_at_retirement && year >= retirement_year)) {
        immediate_p2 = immediate_p2 * pr + p2_contrib;
      }
      const immediate_sale_cash_if_sell = saleProceedsAtYear(
        p, year, immediate_home_value, immediate_mortgage_end_val, immediate_capex_cum,
        immediate_p2_outstanding, buying_costs, pillar2_withdrawal_tax,
        immediate_p3a_outstanding, pillar3a_withdrawal_tax
      );
      let immediate_total_nw = (
        immediate_liquid + immediate_p2 + immediate_p2_outstanding + immediate_p3a + immediate_p3a_outstanding
        + immediate_sale_cash_if_sell + immediate_second_home_deposit
      );
      if (immediate_total_nw <= 0.0) {
        immediate_total_nw = 0.0;
        buy_let_immediate_alive = false;
        buy_let_immediate_zero_year = year;
      }
      buy_let_immediate_nw.push(immediate_total_nw);
    } else {
      buy_let_immediate_nw.push(NaN);
    }

    if (!buy_alive && !rent_alive && !buy_let_trigger_alive && !buy_let_immediate_alive) {
      break;
    }
  }

  // Convert to typed arrays
  const len = years.length;
  const out_years = new Float64Array(len);
  const out_rent = new Float64Array(len);
  const out_buy = new Float64Array(len);
  const out_trigger = new Float64Array(len);
  const out_immediate = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    out_years[i] = years[i];
    out_rent[i] = rent_nw[i];
    out_buy[i] = buy_nw[i];
    out_trigger[i] = buy_let_trigger_nw[i];
    out_immediate[i] = buy_let_immediate_nw[i];
  }

  return {
    years: out_years,
    networth_rent: out_rent,
    networth_buy: out_buy,
    networth_buy_let_trigger: out_trigger,
    networth_buy_let_immediate: out_immediate,
    rent_zero_year,
    buy_zero_year,
    buy_let_trigger_zero_year,
    buy_let_immediate_zero_year,
    buy_sale_year,
    buy_let_trigger_switch_year,
  };
}

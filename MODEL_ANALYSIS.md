# Financial Model Analysis

This document describes how the simulation engine (`web/js/model.js`) works, identifies
logical errors, and proposes a fix plan. It is written for both humans and AI models
that will implement the fixes.

---

## 1. Model Overview

The simulator compares **5 strategies** over a configurable time horizon (default 60 years):

| # | Strategy | Description |
|---|----------|-------------|
| 1 | **Rent** | Never buy; invest all surplus cash in the stock market |
| 2 | **Buy (Swiss default)** | Buy a home; only amortize the 2nd mortgage (above 65% LTV) |
| 3 | **Buy (repay 1st)** | Buy a home; fully amortize the entire mortgage |
| 4 | **Buy-to-let (trigger)** | Live in the home, switch to renting it out when liquidity drops below a threshold |
| 5 | **Buy-to-let (immediate)** | Buy the home and immediately rent it out; live in a rented second home |

All strategies share the same income, non-housing expenses, inflation, retirement
transition, Pillar 2/3a pensions, and investment account logic.

---

## 2. Core Formulas

### 2.1 Inflation

Every year `t`:
```
inflationFactor[t] = (1 + inflation_rate) ^ t
```

Income, non-housing expenses, rent insurance, and owner "other costs" are all multiplied
by this factor.

### 2.2 Income & Expenses

```
income[t] = (working ? income_working_annual : retirement_income_annual) * inflationFactor[t]
non_housing[t] = (working ? non_housing_expenses_working : non_housing_expenses_retired) * inflationFactor[t]
retirement_oneoff[retirement_year] = retirement_oneoff_cost * inflationFactor[retirement_year]
```

Retirement happens at year `retirement_year = ceil(retirement_age - current_age)`.

### 2.3 Home Value Path

```
home_value[0] = purchase_price
home_value[t] = home_value[t-1] * homeGrowthFactor[t]

homeGrowthFactor[t] = (1 + home_price_growth) * (isCrashYear ? (1 - housing_crash_pct) : 1)
```

Crash years occur periodically every `housing_crash_interval_years`.

### 2.4 Rent Path

```
rent_annual_gross[t] = 12 * rent_monthly * (1 + rent_growth) ^ t
rent_housing_cash_out[t] = rent_annual_gross[t] + rent_insurance_annual * inflationFactor[t]
```

### 2.5 Mortgage

Swiss mortgages are split into two tranches:
- **1st mortgage**: up to `target_ltv` (65%) of purchase price — not required to be amortized
- **2nd mortgage**: the slice between target_ltv and actual LTV — must be amortized within `amort_years`

```
equity = cash_downpayment + pillar2_used + pillar3a_used + family_help
initial_balance = max(0, purchase_price - equity)
non_amortizing = min(initial_balance, target_ltv * purchase_price)   // 1st mortgage
amortizing = max(0, initial_balance - non_amortizing)                // 2nd mortgage
annual_amortization = amortizing / amort_years
```

Each year:
```
interest[t] = mortgageBegin[t] * blendedRate[t]
principal[t] = min(amortizingBalance, annual_amortization)   // only years 1..amort_years
mortgageEnd[t] = mortgageBegin[t] - principal[t]
```

The blended rate mixes fixed and variable portions:
```
blendedRate[t] = fixed_share * fixedRate[t] + (1 - fixed_share) * variableRate[t]
```

### 2.6 Owner Housing Cash-Out (Buy strategies)

```
maintenance[t] = home_value[t] * maintenance_rate
prop_tax[t] = home_value[t] * property_tax_rate
other_owner[t] = other_owner_costs * inflationFactor[t]
property_wealth_tax[t] = home_value[t] * property_tax_assessment_pct * wealth_tax_rate

// Tax impact (Swiss Eigenmietwert system)
imputed_rent[t] = imputed_rent_pct * rent_annual_gross[t]
maintenance_deduction[t] = max(maintenance[t], imputed_rent[t] * maintenance_deduction_pct_of_imputed)
interest_deduction[t] = interest[t] * mortgage_interest_deductible_pct
taxable_imputed[t] = imputed_rent[t] - interest_deduction[t] - maintenance_deduction[t] - capex[t]
tax_impact[t] = taxable_imputed[t] * marginal_tax_rate + annual_net_tax_impact * inflationFactor[t]

housing_cash_out[t] = interest[t] + principal[t] + maintenance[t] + other_owner[t]
                    + prop_tax[t] + capex[t] + tax_impact[t] + property_wealth_tax[t]
```

### 2.7 Landlord Cash-Out (Buy-to-let strategies)

When renting out the property:
```
rent_out_effective[t] = rent_out_monthly_multiplier * rent_annual_gross[t] * (1 - vacancy_rate)
rent_out_mgmt[t] = rent_out_effective[t] * management_fee_rate
rent_out_other[t] = rent_out_other_costs * inflationFactor[t]

// Rental income tax
rent_out_taxable[t] = rent_out_effective[t] - (interest + maintenance + other + prop_tax + capex + mgmt + other_costs)
rent_out_tax[t] = max(0, rent_out_taxable[t]) * rent_out_income_tax_rate

// Net property cash-out (costs minus rental income)
property_cash[t] = interest + principal + maintenance + other + prop_tax + capex
                 + mgmt + other_costs + tax + property_wealth_tax
total_cash_out[t] = second_home_rent + non_housing + retirement_oneoff + property_cash - rent_out_effective
```

### 2.8 Net Cash Flow

For each strategy:
```
total_cash_out[t] = housing_cash_out[t] + non_housing[t] + retirement_oneoff[t]
net_cashflow[t] = income[t] - total_cash_out[t]
```

### 2.9 Investment Account (investStep) -- WHERE THE BUG LIVES

This is the core compounding function. Each year, the previous investment balance grows,
taxes are deducted, and the year's net cash flow is added:

```javascript
function investStep(prev, contribution, year, p) {
  const gross = prev * marketGrowthFactorForYear(p, year);    // <<<< BUG: applied to negative prev
  const tax_base = Math.max(0.0, prev);
  const tax_drag = tax_base * p.investment_tax_drag_rate;
  const wealth_tax = tax_base * p.wealth_tax_rate;
  return gross - tax_drag - wealth_tax + contribution;
}
```

Where:
```
marketGrowthFactor[t] = (1 + market_return) * (isCrashYear ? (1 - stock_crash_pct) : 1)
```

**Year 0 initialization (buy):**
```
upfront = cash_downpayment + buying_costs + mortgage_fees + moving_cost + pillar2_tax + pillar3a_tax
inv_buy[0] = investStep(liquid_assets - upfront, net_cashflow_buy[0], 0, p)
```

**Year 0 initialization (rent):**
```
rent_upfront = moving_cost + rent_deposit
inv_rent[0] = investStep(liquid_assets - rent_upfront, net_cashflow_rent[0], 0, p)
```

**Subsequent years:**
```
inv[t] = investStep(inv[t-1], net_cashflow[t] + extra_contrib[t], t, p)
```

`extra_contrib` includes Pillar 2 annuity income, Pillar 3a lump-sum at retirement,
and Pillar 3a tax deduction benefit.

### 2.10 CapEx (Capital Expenditures)

```
capex[t] = capex_rate * home_value[t]    // every capex_interval_years, starting at capex_first_year
```

### 2.11 Sale Proceeds

If selling the home at year `t`:
```
selling_costs = home_value[t] * selling_cost_pct + selling_cost_fixed
gain = max(0, home_value[t] - purchase_price - buying_costs - selling_costs - cumulative_capex)
capital_gains_tax = gain * cap_gains_rate * schedule_multiplier(canton, years, gain)
sale_proceeds = home_value[t] - selling_costs - capital_gains_tax - mortgageEnd[t]
             - pillar2_outstanding + pillar2_tax_refund
             - pillar3a_outstanding + pillar3a_tax_refund
```

### 2.12 Net Worth

```
networth_rent[t] = inv_rent[t] + pillar2_rent[t] + pillar3a_rent[t] + rent_deposit_bal[t]

networth_buy[t] = inv_buy[t]
               + (pillar2_buy[t] + pillar2_used)      // pension balance + amount to be repaid on sale
               + (pillar3a_buy[t] + pillar3a_used)
               + sale_proceeds[t]                       // hypothetical sale equity at this year
```

The `pillar2_used` addition cancels with the `pillar2_outstanding` subtraction inside
`sale_proceeds`, so effectively: net worth = investments + pensions + home equity.

### 2.13 Pillar 2 (Occupational Pension)

```
p2_rent[0] = pillar2_start
p2_buy[0] = pillar2_start - pillar2_used

// Each year (before retirement):
p2[t] = p2[t-1] * (1 + pillar2_rate) + pillar2_contrib

// At retirement (if annuitize):
annual_annuity = p2[retirement-1] * (1 + pillar2_rate) * conversion_rate
p2[retirement..] = 0   // balance consumed, annual annuity paid out instead
```

### 2.14 Pillar 3a (Private Pension)

```
p3a[0] = pillar3a_start (or pillar3a_start - pillar3a_used for buy)

// Each year (before retirement):
p3a[t] = p3a[t-1] * (1 + pillar3a_rate) + pillar3a_contrib

// At retirement:
lump_sum_net = p3a[retirement] * (1 - pillar3a_withdrawal_tax_rate)
// Added to investment account as a one-time contribution
p3a[retirement..] = 0
```

---

## 3. Identified Bugs

### BUG 1 (CRITICAL): Negative investment balances compound at market return rate

**Location**: `investStep()` in `model.js:243-249`

**Problem**: When `prev < 0` (the person has exhausted their liquid assets and is running
a deficit), the function computes:

```
gross = prev * (1 + market_return)
```

This means a negative balance of -100,000 with 10% market return becomes -110,000 the
next year — as if the person's debt grows at the stock market rate. Over many years,
this creates exponential debt growth that can reach millions or tens of millions.

**Why this is wrong**: A negative investment portfolio balance is not a real financial
instrument. You cannot "owe" the stock market. In reality:
- The person would need to borrow at a consumer credit rate (typically 5-8% in
  Switzerland, but NOT the stock market return rate which can be 10%+)
- Or more realistically, the person is functionally insolvent and the simulation
  should recognize that their spending exceeds their means

**Magnitude**: With default sweep parameters:
- `market_return` sweeps up to 10%
- At retirement (year 45 with defaults), income drops from 180k to ~30k base
- Non-housing expenses remain at 50k base
- After inflation adjustment (up to 5%), the annual deficit can be enormous
- A deficit of -200k compounding at 10% for 15 years: grows to ~-835k from
  compounding alone, plus accumulating annual deficits
- In extreme sweep combinations, this easily produces values in the tens of millions

### BUG 2 (CRITICAL): Stock market crashes reduce negative balances

**Location**: Same `investStep()` + `marketGrowthFactorForYear()` in `model.js:96-102`

**Problem**: During a crash year, `marketGrowthFactorForYear` returns a value < 1.0
(e.g., `1.06 * (1 - 0.40) = 0.636`). When `prev` is negative:

```
gross = -500,000 * 0.636 = -318,000   // debt magically reduced by 36%!
```

A stock market crash magically reduces the person's "debt" by the crash percentage.
This is nonsensical — stock market crashes do not forgive personal debts.

**This is the mirror image of Bug 1**: both stem from applying market dynamics
(growth AND crashes) to balances that are not actually invested in the market.

### BUG 3 (MODERATE): Asymmetric tax treatment of negative balances

**Location**: `investStep()` in `model.js:245-247`

**Problem**: The code correctly avoids taxing negative balances:
```
const tax_base = Math.max(0.0, prev);  // no tax when negative
```

But combined with Bug 1, this creates an internally inconsistent model: when `prev < 0`,
the balance grows at market rate (as if invested) but receives no offsetting tax
benefit. This makes the negative-balance behavior worse than even a consistent
(but still wrong) application of market dynamics would be.

---

## 4. Root Cause Summary

All three bugs stem from a single design oversight: **`investStep()` does not distinguish
between positive balances (actually invested in the market) and negative balances (a
deficit/debt that has no market exposure).**

The investment account is used as a "catch-all" liquidity pool. When expenses exceed
income, the balance goes negative, but the function continues to apply market growth to
it as if it were a leveraged short position in the market.

---

## 5. Fix Plan

### Fix A: Clamp market growth to non-negative balances only (RECOMMENDED)

**File**: `web/js/model.js`, function `investStep` (line ~243)

**Change**: Only apply market growth/crash dynamics when `prev >= 0`. When `prev < 0`,
do not apply any growth — the deficit simply accumulates additively from annual
cash flows.

**Current code:**
```javascript
export function investStep(prev, contribution, year, p) {
  const gross = prev * marketGrowthFactorForYear(p, year);
  const tax_base = Math.max(0.0, prev);
  const tax_drag = tax_base * p.investment_tax_drag_rate;
  const wealth_tax = tax_base * p.wealth_tax_rate;
  return gross - tax_drag - wealth_tax + contribution;
}
```

**Proposed code:**
```javascript
export function investStep(prev, contribution, year, p) {
  let gross;
  if (prev >= 0) {
    // Positive balance: invested in the market, subject to growth, crashes, and taxes
    gross = prev * marketGrowthFactorForYear(p, year);
    const tax_drag = prev * p.investment_tax_drag_rate;
    const wealth_tax = prev * p.wealth_tax_rate;
    return gross - tax_drag - wealth_tax + contribution;
  } else {
    // Negative balance: deficit/debt — not invested, no market dynamics
    // Simply carry forward the deficit and add this year's cash flow
    return prev + contribution;
  }
}
```

**Rationale**:
- When you have no investments, market returns don't apply to you
- When you're in deficit, the deficit is just a running total of how much you've
  overspent — it doesn't compound
- This is the simplest fix and avoids introducing a new "borrowing rate" parameter
  that would add complexity
- The contribution (net cash flow) still adds/subtracts normally, so if income
  exceeds expenses, the deficit shrinks; if not, it grows linearly

**Edge case — crossing zero within a year**: If `prev` is positive but
`prev + contribution` would be negative, the current approach applies full market
growth to `prev` then adds the negative contribution. This is slightly inaccurate
(market should only apply to the portion that was positive), but it's a reasonable
annual-step approximation and not worth the complexity of a mid-year split.

### Fix B (ALTERNATIVE): Apply a configurable borrowing rate to negative balances

If you want more realism, you could apply a separate `borrowing_rate` (e.g., 3-5%)
to negative balances instead of the market return. This would require:

1. Adding a new parameter `borrowing_rate` to config.js DEFAULT_CONFIG
2. Modifying `investStep` to use `borrowing_rate` when `prev < 0`
3. Adding the parameter to the UI

**Not recommended as the initial fix** because:
- It adds a new parameter users need to understand
- The "no compounding on deficit" approach (Fix A) is simpler and still realistic
- Can be added later as an enhancement if users want it

### Additional Considerations

1. **No changes needed to net worth calculation**: The net worth formulas correctly
   combine investment balance + pension + home equity. The fix to `investStep` will
   automatically flow through to correct net worth values.

2. **No changes needed to cash flow calculation**: The annual cash flows (income minus
   expenses) are correctly computed. The bug is only in how the cumulative investment
   balance is updated.

3. **Test the fix with extreme sweep parameters**: After implementing Fix A, run the
   simulation with the full default sweep (which includes `market_return` up to 10%,
   `inflation_rate` up to 5%, `rent_growth` up to 10%) and verify that:
   - Net worth values stay within reasonable ranges (no values exceeding +/- 10M for
     a 1M property with 180k income)
   - The "depletion" projection (`projectUntilDepletion`) still works correctly
   - Cash flow charts look reasonable

4. **The `projectUntilDepletion` function** (line ~1082) also calls `investStep` in its
   extension loop, so the fix will automatically apply there too. No separate changes
   needed.

5. **The buy-to-let trigger logic** (line ~900) checks
   `owner_projected <= p.rent_out_trigger_liquidity_threshold` to decide when to switch
   to renting out. With the fix, the projected value will be less negative (or not
   negative at all), which may change when the trigger fires. This is correct behavior —
   the trigger should be based on realistic projections.

---

## 6. Files Modified

| File | Function | Change |
|------|----------|--------|
| `web/js/model.js` | `investStep` (line ~243) | **APPLIED** Fix A: clamp market dynamics to non-negative balances |

That's it — a single function change. The fix is minimal, surgical, and addresses all
three bugs simultaneously.

**Status: FIXED** — Fix A was applied on 2026-04-14. The function now branches on the
sign of `prev`: positive balances follow the original market-growth + tax logic; negative
balances simply accumulate additively (`prev + contribution`) with no market dynamics.

# Swiss Rent vs Buy Simulator

A deterministic grid-sweep simulator that compares renting vs buying property in Switzerland across hundreds of thousands of scenarios. Runs entirely in the browser — no server needed.

**Live:** [swiss-rent-vs-buy-simulator.darkanhell.workers.dev](https://swiss-rent-vs-buy-simulator.darkanhell.workers.dev)

## What it does

The simulator models four strategies over a configurable time horizon (up to 60+ years):

- **Rent** — rent an apartment, invest savings in the market
- **Buy (Owner-occupied)** — purchase a home with a mortgage, live in it
- **Buy then Rent-out** — buy a home, live in it, rent it out when liquidity drops below a threshold
- **Buy & Rent-out** — buy a property and immediately rent it out while renting your own place

For each strategy, it tracks net worth, cash flows, liquid assets, and mortgage balances year by year. It then compares outcomes across all parameter combinations to show when and how often buying beats renting.

## Key features

- **Deterministic grid sweep** — every combination of parameter ranges is evaluated (no random sampling). Default configuration produces 622,080 scenarios.
- **Swiss-specific tax model** — imputed rental value (Eigenmietwert), capital gains tax schedules (Grundstuckgewinnsteuer) for ZH/AR/AI/TG/SG, property transfer tax (Handanderungssteuer), Pillar 2 (BVG/LPP) mechanics, and cantonal presets for all 26 cantons.
- **Client-side only** — simulation runs in Web Workers with streaming aggregation. No data leaves the browser.
- **Crash stress testing** — periodic stock market and housing crashes at configurable intervals and severity.
- **8 interactive charts** — net worth, cash outflow, cash flow, liquidity, buy-vs-rent delta, annual gap change, win share percentage, and end-delta histogram. All with event line markers for retirement, mortgage milestones, crashes, and renovations.
- **Dark mode** with persistent theme toggle.
- **Multi-language** — English, German, French, and Italian.
- **PNG export** — download any chart as a PNG image.

## Architecture

```
web/
  index.html          Single-page app shell
  css/style.css       Styles (light + dark mode)
  js/
    app.js            UI controller, event wiring, tooltips
    config.js         Default parameters, canton profiles, sweep specs
    model.js          Core simulation engine (port of Python original)
    sweep.js          Grid expansion, worker management, aggregate merging
    worker.js         Web Worker — runs simulations, streams aggregated stats
    charts.js         Chart.js rendering, custom event-line plugin, PNG export
    i18n.js           Translations (EN/DE/FR/IT)
```

The simulation uses **streaming aggregation** to avoid memory issues: each Web Worker accumulates count/sum/min/max per year per field, then the main thread merges worker results. This keeps memory at O(T x fields) instead of O(N x T x fields), allowing 600k+ scenarios without OOM.

## Parameters

Every parameter can be set to a fixed value or a range (min/max/n) for the grid sweep. Parameters include:

- **Horizon** — simulation years, current age, retirement age
- **Financial** — liquid assets, income, expenses, inflation, market returns
- **Property** — purchase price, maintenance, property taxes, renovation cycles
- **Mortgage** — fixed/variable rate split, amortization, refix terms
- **Swiss taxes** — imputed rent, marginal rate, capital gains schedules, Pillar 2
- **Crashes** — stock and housing crash severity and frequency
- **Landlord mode** — vacancy, management fees, rental income taxation

Canton presets auto-fill property tax rate, transfer tax, capital gains tax, imputed rent percentage, and the applicable capital gains schedule.

## Running locally

Serve the `web/` directory with any static HTTP server:

```bash
# Python
python3 -m http.server 8080 -d web

# Node
npx serve web
```

Then open `http://localhost:8080`.

## License

MIT

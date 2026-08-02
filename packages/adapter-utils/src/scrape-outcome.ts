// Classifies a balance-scraping adapter's result so a run that returned nothing (or
// returned garbage that *looks* like data) can be told apart from a run that legitimately
// found real balances — the "did-nothing rule" (home-infra CONVENTIONS.md §18).
//
// Two distinct failure shapes collapse to the same 'suspect' verdict here:
//   - empty_scrape: zero tiles/rows scraped at all (selectors broke or session expired).
//   - all_zero_balance: tiles WERE found (the name selector matched) but every balance
//     came back exactly 0 — the betterment-adapter shape, where an OR filter kept a
//     real-looking goal name whose balance selector had rotted (see scrape.ts's
//     `.filter(g => g.name !== 'Unknown Goal' || g.balance !== '0')`). A literal $0.00
//     across every investment account is not a plausible real state for a funded
//     account, so it is treated the same as finding nothing.
//
// A real, single zero-balance goal mixed with other nonzero balances is NOT suspect —
// that is a normal state for a newly-created, unfunded goal. Only "every balance is
// zero" is flagged.
export interface ScrapeOutcome {
  outcome: 'ok' | 'suspect';
  reason?: 'empty_scrape' | 'all_zero_balance';
}

export function classifyBalanceScrape(balances: number[]): ScrapeOutcome {
  if (balances.length === 0) {
    return { outcome: 'suspect', reason: 'empty_scrape' };
  }
  if (balances.every((b) => b === 0)) {
    return { outcome: 'suspect', reason: 'all_zero_balance' };
  }
  return { outcome: 'ok' };
}

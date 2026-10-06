# Speed ideas not taken (yet)

Each one says what it would gain, why it isn't in, and what has to happen first.

## Command bar preconnect and prerender (J4, a page typed often)

Chrome's omnibox learns which typed text leads to which page (AutocompleteActionPredictor) and, once it's confident
about what Enter would open, connects to the site (confidence ≥ 0.3) or prerenders the page (≥ 0.5, never a search), so
Enter shows it at once. We built it (5c9d0422: `nn_omnibox_typed`/`opened`, a 10 s bound on how old a prerendered page
may be) and took it out again: it gained nothing, for two reasons.

- This engine keeps Chrome's "Preload pages" setting off by default (the ungoogled patches set
  `NetworkPredictionOptions::kDefault = kDisabled`), and both preconnect and prerender respect it.
- With it on, every prerender is cancelled as its page loads (`PrerenderFinalStatus::kMojoBinderPolicy`): the page
  binds NNCore's page channel, `nncore.mojom.NNPageHost`, which Chrome doesn't allow in a prerendered page. That cancels
  sites' own speculation-rules prerenders too.

To take it up again:
1. The owner decides whether Preload pages is on by default. It fetches pages before the user opens them, a privacy
   call, and the reason the ungoogled patches turn it off.
2. NNPageHost in prerendered pages: grant it (or defer binding until activation) after a review that a prerendered
   page's posts can't act on the tab it's prerendered in before it's shown.
3. Then measure the trained case (a page opened from the bar 3+ times), with the staleness checks: a page changed
   within the bound shows the prerendered version; past it, the new one; nothing prerenders in another profile.

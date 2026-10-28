# Synerise Suggestions (Autocomplete) — Integration Contract

Suggestions is the search autocomplete under the theme's search box. Unlike
recommendations and search there is **no app-block template to copy**: it ships as a
global **app embed** that attaches to the theme's existing search input and takes
over the native predictive-search dropdown. Its runtime is tightly coupled to the
theme (native takeover, theme skin, keyboard, modal, zero/no-results states) and is
still being hardened across themes, so a hand-maintained copy of it would be large
and fragile.

This doc is therefore the **API contract** — enough for you, or an AI assistant, to
build a theme-owned alternative — preceded by the three ways to use suggestions.

## Three ways to use suggestions

| Route | Use it when | Who maintains it |
|---|---|---|
| **1. Shipped app embed** (default) | You want working autocomplete with settings-level customization | Synerise — updated with the app |
| **2. Embed + your theme CSS** | Spacing, colors, typography of the dropdown | You own the CSS; the markup may change between app versions |
| **3. Theme-owned alternative built from this contract** | Structural changes (layout, badges, extra data) or a single dropdown with no native fetch | You — it is ordinary theme code; see the [Horizon example](#example-theme-owned-suggestions-on-horizon-module-swap) |

**Route 1 — enable the embed.** Theme editor → *App embeds* → **Synerise
Suggestions** → on; paste your **product search index (UUID)** (the same index as
[Search Results](search-results.md)); optionally a query-suggestion index and the
zero-state / no-results recommendation campaigns; save. The settings cover labels,
limits, minimum characters, field mapping and the search-input selector.

**Route 2 — style it.** Inspect the rendered dropdown and add scoped theme CSS. The
embed's own markup uses `snr-sg` classes; on Horizon it renders with the theme's own
markup instead (see *Behavior notes*). Re-check after app updates — the markup is not
a frozen contract.

**Route 3 — build your own with an AI assistant.** Give the assistant this file's raw
URL (flow in the README, *Working with Sidekick*). The contract below gives it the
connection, requests, responses, events and states; it must own everything else:
attaching to the search input, rendering, keyboard navigation, request cancellation,
suppressing or replacing the native predictive search, tracking, and every state.
Work on a duplicate theme, keep the **Synerise** (tracking) embed on — it publishes
the connection — and switch the **Synerise Suggestions** embed off so the two do not
compete. The example at the end of this doc is exactly that, done on Horizon.

Synerise is also building a visual component configurator with an autocomplete kind,
for deep customization without theme code. Until it ships, routes 2 and 3 are the
customization surface.

## Connection

```js
window.__snrs.config = { trackerKey, aiApiHost }   // Synerise tracking code
// _snrs_uuid cookie -> clientUUID
```

## Requests (two independent autocomplete calls per keystroke, one AbortController)

**Products** — the product search index:
```
GET {aiApiHost}/search/v2/indices/{suggestion_index}/autocomplete
    ?query=<term>&token={trackerKey}&limit=<max_products>
    &displayAttributes=handle,title,imageLink,price   # plural (vs recommendations' singular displayAttribute)
    &includeMeta=true[&clientUUID=<uuid>]
```

**Phrases** (only if a dedicated suggestion index is configured):
```
GET {aiApiHost}/search/v2/indices/{suggestion_phrase_index}/autocomplete
    ?query=<term>&token={trackerKey}&limit=<max_suggestions>&includeMeta=true[&clientUUID=<uuid>]
```

**Zero-state / no-results recommendations** reuse the recommendations endpoint
(`{aiApiHost}/recommendations/v2/recommend/campaigns/{campaignId}` — see
[`recommendations.md`](recommendations.md)).

## Responses

- **Products:** `data[]` — items with `itemId`, `handle`, `imageLink`, `title`,
  `price.value` (major units, formatted with the shop's `shop.money_format`);
  `extras.correlationId`. `itemId` is always returned; the other fields are the
  requested `displayAttributes`.
- **Phrases:** `data[].suggestion` — the suggested phrase string (tolerating a bare
  string or a `{ suggestion | text | query }` object per entry); no display
  attributes.

## Events

- **Product card click** → `itemSearchClick({ item, correlationId, searchType: 'autocomplete' })`
  where `item` is the product's `itemId` string from the response (not the product
  object; needs `window.SR` + `correlationId`), then navigate to the product.
- **Suggestion phrase click** → navigate to `/search?q=<phrase>` (and the
  "View all results" link → `/search?q=<term>`).
- **Zero-state / no-results recommendation cards** carry no `correlationId`, so they
  only navigate (no search event).

## States

| State | Shown |
|---|---|
| Empty search box | Zero-state recommendations + heading (only if the campaign returns products) |
| 1 … (min−1) chars | Nothing |
| ≥ min chars, results | Query-suggestion pills + product cards + "View all results" |
| ≥ min chars, no results | No-results message + no-results recommendations |
| Request error | Error message + no-results recommendations |

## Behavior notes (shipped embed)

- Debounced input; in-flight calls aborted via `AbortController`.
- The theme's native predictive-search dropdown is suppressed (render-blocking CSS)
  so the widget owns every state.
- On **Horizon** (input inside `predictive-search-component`) it renders with the
  theme's own markup (a "skin"); other themes use the widget's own cards.
- Keyboard navigation (↑/↓/Enter/Esc) over `[role=option]`.

## Example: theme-owned suggestions on Horizon (module swap)

Built by Shopify Sidekick in October 2026 from this contract alone, on a duplicate of
the Horizon theme, and tested on a stage store. It is an example of route 3, not a
Synerise deliverable: the code is yours, Synerise does not update it, and every
selector and class in it is Horizon's.

**Idea.** Horizon's search modal is a web component (`predictive-search-component`,
`assets/predictive-search.js`) that fetches Shopify's predictive search through the
Section Rendering API and morphs the HTML into the dropdown. Instead of hiding that
dropdown and drawing a second one (what the embed does), replace the **data source**:
keep the component — modal, reset button, keyboard navigation, card classes — and swap
the two methods that fetch, so the dropdown is filled from Synerise. Nothing else in
the theme changes and no Shopify predictive-search request is made.

**Files.**

- `assets/snr-native-suggestions.js` (new, ~120 lines) — exports
  `renderSynerise(component, term)` and `cancelSynerise(component)`. It reads
  `window.__snrs.config` and the `_snrs_uuid` cookie, calls the two autocomplete
  endpoints in parallel (one `AbortController` per component, previous call aborted),
  the recommendations endpoint for the empty and no-results states, and builds
  Horizon's own result markup (`predictive-search-results__*`, `resource-card`) into
  `component.refs.predictiveSearchResults`. Configuration (indexes, campaigns, limits,
  `minChars`, labels) sits at the top of the file. Product cards fire
  `itemSearchClick` with the `itemId` and the `correlationId`.
- `assets/predictive-search.js` (Horizon's, edited) — the diff against the original is
  small:

```js
import { renderSynerise, cancelSynerise } from './snr-native-suggestions.js?v=1';
// …
disconnectedCallback() {
  super.disconnectedCallback();
  this.#controller.abort();
  cancelSynerise(this);
}
// …
async #getSearchResults(searchTerm) {
  await renderSynerise(this, searchTerm);   // was: Section Rendering API fetch + morph
  this.#resetScrollPositions();
}
// …
#resetSearch = async () => {
  this.#currentIndex = -1;
  this.refs.searchInput.value = '';
  this.#hideResetButton();
  await renderSynerise(this, '');           // was: empty-state section + recently viewed
  this.#resetScrollPositions();
};
```

  Two further edits: the empty state loads unconditionally (the original only loaded
  it when recently-viewed products existed), and the `SearchUpdateEvent` dispatch is
  dropped, so anything else listening for Horizon's search updates goes quiet.

**Install (Edit code, on a duplicate theme).** Back up `assets/predictive-search.js`
under another name, upload the two files, turn the **Synerise Suggestions** embed off
and leave **Synerise** (tracking) on. Test: typing at least `minChars` characters,
keyboard navigation, a product click, clearing the input, a no-results term. Undo =
restore the backup and re-enable the embed.

**Gotchas seen while testing.**

- Horizon loads the module from `snippets/search-modal.liquid` via
  `'predictive-search.js' | asset_url`. If the snippet ends up pointing at your backup,
  the native search silently keeps running — check which file it loads.
- Browsers cache ES-module imports aggressively: bump the `?v=` on the import whenever
  you change the helper, then fully reload the theme editor.
- Format prices with the shop's money format (expose `shop.money_format` on a data
  attribute from Liquid, as the embed does) rather than a hardcoded currency.
- Horizon's recently-viewed empty state is replaced by the zero-state campaign.

**What you give up:** app-managed updates, cross-theme portability, and the coming
configurator. **What you gain:** one dropdown, one fetch per keystroke, full control of
the markup.

## Prerequisites

- The **Synerise** app embed (tracking code) enabled.
- A **product search index** (reuse the [Search Results](search-results.md) index).
- *(Optional)* a **query suggestions** entry (Synerise → AI Search → Suggestions)
  for phrases, and **AI Recommendations campaigns** for the zero-state / no-results
  slots.

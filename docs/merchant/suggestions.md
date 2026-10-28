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
| **3. Theme-owned alternative built from this contract** | Structural changes (layout, badges, extra data) or a single dropdown with no native fetch | You — it is ordinary theme code; see the [Horizon example](#example-theme-owned-suggestions-on-horizon) |

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
replacing the native predictive search's data source (so the theme stops fetching
Shopify suggestions on every keystroke — hiding its dropdown with CSS is the fallback,
not the goal), tracking, and every state.
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
- The theme's native predictive-search dropdown is hidden with CSS so the widget owns
  every state. This is the theme-independent trade-off the embed makes today: it does
  not stop the theme's own predictive-search request on each keystroke. A theme-owned
  build should not copy it — replace the native data source instead (see the example
  below).
- On **Horizon** (input inside `predictive-search-component`) it renders with the
  theme's own markup (a "skin"); other themes use the widget's own cards.
- Keyboard navigation (↑/↓/Enter/Esc) over `[role=option]`.

## Example: theme-owned suggestions on Horizon

An approach for route 3 on the Horizon theme. It is ordinary theme code you own:
Synerise does not update it, and the selectors and classes involved are Horizon's.

**Idea.** Horizon's search modal is a web component (`predictive-search-component`,
loaded from `assets/predictive-search.js`) that fetches Shopify's predictive search
and renders the result into its dropdown. Instead of hiding that dropdown and drawing
a second one, replace its **data source**: keep the component — modal, reset button,
keyboard navigation, card classes — and change the methods that fetch, so the
dropdown is filled from Synerise. The theme then makes no Shopify predictive-search
request. Inspect the Horizon version you actually have: the method names and the
empty-state lifecycle differ between releases, and the empty state may need to load
regardless of recently-viewed products once it is campaign-driven. Preserve every
behavior you are not replacing.

**What to build.**

- A small helper module in `assets/` that implements this contract: reads the
  connection from `window.__snrs.config` and the `_snrs_uuid` cookie, calls the two
  autocomplete endpoints in parallel (one `AbortController` per component, previous
  call aborted), calls the recommendations endpoint for the empty and no-results
  states, and builds Horizon's own result markup (`predictive-search-results__*`,
  `resource-card`) into the component's results container. Build product and search
  links from `window.Shopify.routes.root` so they stay locale-aware, and treat every
  API value as text (set `textContent`, never inject it as HTML). Keep configuration
  (indexes, campaigns, limits, minimum characters, labels) at the top of the file.
  Product cards fire `itemSearchClick` with the `itemId` and `correlationId`.
- An edited copy of `assets/predictive-search.js` that imports the helper and calls it
  from the method that fetches search results and from the method that resets the
  search (the empty state), aborting the helper's request when the component is
  removed. Leave unrelated behavior as shipped.

**Install (Edit code, on a duplicate theme).** Back up `assets/predictive-search.js`
under another name, upload the two files, turn the **Synerise Suggestions** embed off
and leave **Synerise** (tracking) on. Check typing past the minimum characters,
keyboard navigation, a product click, clearing the input and a no-results term. To
undo, restore the backup and re-enable the embed.

**Acceptance checks.** With the test theme open and the network panel filtered:

- No request to `/search/suggest` (the Shopify predictive-search endpoint) while
  typing, opening or clearing the search.
- At the configured minimum characters, the Synerise autocomplete request(s) appear —
  one for products, one more for phrases if a phrase index is set — and the
  recommendations request only in the empty and no-results states.
- A product click sends `itemSearchClick` whose `item` is the `itemId` string and
  whose `correlationId` matches the autocomplete response.
- Clearing the input or typing quickly leaves no stale results: the earlier request is
  aborted and only the latest term's results render.

**Things to watch.**

- Horizon loads the module from `snippets/search-modal.liquid`. Make sure it still
  points at the edited file, not the backup, or the native search keeps running.
- Browsers cache module imports; add a version query to the import (`?v=2`) when the
  helper changes, then fully reload the theme editor.
- Format prices with the shop's money format rather than a hardcoded currency.
- Horizon's recently-viewed empty state is replaced by the zero-state campaign.

**What you give up:** app-managed updates, cross-theme portability and the coming
configurator. **What you gain:** one dropdown, no duplicate Shopify predictive-search
requests, full control of the markup.

## Prerequisites

- The **Synerise** app embed (tracking code) enabled.
- A **product search index** (reuse the [Search Results](search-results.md) index).
- *(Optional)* a **query suggestions** entry (Synerise → AI Search → Suggestions)
  for phrases, and **AI Recommendations campaigns** for the zero-state / no-results
  slots.

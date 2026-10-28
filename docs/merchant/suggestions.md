# Synerise Suggestions (Autocomplete) — Integration Contract

Unlike recommendations and search, this is a **contract-only** doc — there is
**no copy-&-customize template**.

**Why no template:** Suggestions is not a section a merchant places; it is a global
**app embed** that attaches to the theme's existing search input and **takes over**
the native predictive-search dropdown. Its runtime (~23 KB) is tightly coupled to the
theme (native takeover, theme skin, keyboard, modal, zero/no-results states), and it
is still being hardened across themes. A hand-maintained self-contained copy would be
large, fragile, and strictly worse than the shipped embed.

**So, to use suggestions:**
- **Enable the shipped Synerise Suggestions app embed** (the supported path): theme
  editor → *App embeds* → **Synerise Suggestions** → on; paste your **product search
  index (UUID)** (the same index as [Search Results](search-results.md)); optionally
  a query-suggestion index and the zero-state / no-results recommendation campaigns;
  save.
- **For deep dropdown customization**, Synerise is building a visual component
  configurator with an autocomplete kind designed for exactly this. Until then, the
  embed's settings (labels, limits, field mapping, search-input selector) are the
  customization surface.

This doc specifies the **API contract** so an assistant (or we) can reason about
suggestions and keep parity with recommendations/search.

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

## Prerequisites

- The **Synerise** app embed (tracking code) enabled.
- A **product search index** (reuse the [Search Results](search-results.md) index).
- *(Optional)* a **query suggestions** entry (Synerise → AI Search → Suggestions)
  for phrases, and **AI Recommendations campaigns** for the zero-state / no-results
  slots.

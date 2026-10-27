# Synerise Search Results — Merchant Integration Contract

**Internal source doc** for preparing the public merchant guide. Specifies the AI
Search results integration precisely enough that a merchant — or their AI
assistant — can generate and customize a correct search-results section. The
buildable template is Synerise's own **app-block template** —
`extensions/synerise/blocks/search-results.liquid` plus its runtime
(`assets/snr-search-page.js`, `snr-utils.js`, `snr-search.css`, `snr-cards.css`) —
mirrored read-only to the public repo. Base your custom section on it.

## What you get

A **self-contained theme section** that replaces the storefront search results page
with results from a Synerise **AI Search index**: product grid, facets (text +
range), sort, and pagination — all client-side, on the **Search** template. The
query comes from the page URL (`?q=`).

## Prerequisites

- The **Synerise** app embed (tracking code) is enabled — publishes
  `window.__snrs.config` and sets `_snrs_uuid`. Without it the section stays hidden.
- A **Synerise AI Search index** (copy its index UUID), with the card fields set as
  **response** attributes and the attributes to filter/facet/sort on given the
  matching roles (see *Index attribute roles*).

## Two zones (what you may change)

Each file is split into zones by **marker comments** — a zone runs from its marker to the
next marker (a file may switch zones several times):

```liquid
{%- comment -%} ==== SNR INTEGRATION PLUMBING — do not change ==== {%- endcomment -%}
{%- comment -%} ==== SNR PRESENTATION — change freely ==== {%- endcomment -%}
```
```js
// ==== SNR INTEGRATION PLUMBING — do not change ====
// ==== SNR PRESENTATION — change freely ====
```

- **Integration plumbing — do NOT change:** reading `search_index` + the blank
  guard, the root `<div data-snr-search-root …>` with all its `data-*` attributes,
  the `<script>` tags, and in the runtime: the query request + auth (`token`),
  `credentials:'omit'`, `clientUUID` (sent in the body so the search is recorded
  server-side), the facets/filters/IQL building, the sort mapping, pagination, the
  `itemSearchClick` event, URL state, HTML escaping, init/re-init.
- **Presentation — change freely:** the `<style>`, the `<main>` wrapper, the schema
  labels/defaults/extra settings, the `attr_*` field mapping (settings `attr_handle`,
  `attr_title`, `attr_image`, `attr_price`), the `snr_extra_attrs` line, and — on the
  copy-into-theme route — the runtime's render functions (grid, facets, empty state
  in `snr-search-page.js`; card markup in `snr-utils.js` → `buildCard()`). Keep the
  `snr-search-page__*` hook classes the runtime queries; add your own.

## Connection (read at runtime — never hard-code)

```js
window.__snrs.config = { trackerKey, aiApiHost }   // published by the Synerise tracking code
// _snrs_uuid cookie -> clientUUID
```

## Request

```
POST {aiApiHost}/search/v2/indices/{index}/query?token={trackerKey}
Content-Type: application/json
credentials: 'omit'

{
  "query":  "<?q= from the URL>",
  "limit":  <page_size>,
  "page":   <n>,
  "includeMeta": true,
  "displayAttribute": ["handle","title","imageLink","price"],   // root of each attr_* path (+ snr_extra_attrs)
  "clientUUID": "<uuid>",          // in the BODY -> server records item.search; no client search-view event
  "facets": ["*"],                 // when facets on: all facetable attributes
  "includeFacets": "all",          // returns extras.allFacets (+ filteredFacets)
  "sortBy": "<attr>", "ordering": "asc|desc",   // when a non-relevance sort is selected
  "filters": "<IQL>"               // when facet filters are applied
}
```

- **`displayAttribute`** = the root segment of each `attr_*` path, plus whatever you
  list in `snr_extra_attrs` (emitted as `data-attr-extra`); request any attributes
  your index returns that way, then render them in `buildCard()`.
- **Sort** (`SORT_MAP`): `relevance` (default; omit sort), `price_asc`,
  `price_desc`, `name_asc`, `name_desc`. `sortBy` is resolved from the `attr_*` mapping
  (e.g. price → `price.value`); the attribute must be **sortable** on the index
  (price must be a **range/numeric** attribute, not text).
- **Filters** are built as **IQL**: text facets → `name == "v"` (values OR'd);
  range facets → `name >= min AND name <= max`; facets AND'd together.

## Response

- `body.data[]` — each item has at least `{ itemId, handle }` plus requested
  attributes (`title`, `imageLink`, `price.value`). **`price.value` is in MAJOR
  units.**
- `body.meta.totalCount` — total matches (drives "Load more").
- `body.extras.allFacets` (+ `facetsOrdering`, `filteredFacets`) — facet buckets.
  A **range** facet comes as `{ min, max }` bounds; a text facet as a
  `value → count` map (a numeric-attribute-stored-as-text facet is detected when
  every bucket key parses as a number).
- `body.extras.correlationId` — required on the click event.

## Events

- **`itemSearchClick({ item, position, correlationId, searchType: 'full-text-search' })`**
  — on result click (needs `window.SR` + a `correlationId`; skipped otherwise).
- The **search itself is recorded server-side** from the `clientUUID` in the
  request body — there is no separate client-side search-view event.

## Behavior

- **Empty query** (`?q=` missing) → render nothing.
- **Empty results** → the no-results message; a failed request → "Search is
  temporarily unavailable."
- **URL state** — `?q`, `?sort`, and `?f.<attr>` (text = comma list, range =
  `min~max`) are kept in sync via `history.replaceState`, so searches are
  shareable/back-nav safe.
- Product links are **locale/market-aware** (shop route root).
- **Re-initializes on `shopify:section:load`** (theme editor).
- HTML-escape every API string.

## Index attribute roles (configured in Synerise AI Search)

- **Response** — returned in results; only these can be shown on cards (include
  handle, title, image, price).
- **Filterable** — backs applied filters (supports range, e.g. `price`).
- **Facetable** — powers the facet list with per-value counts.
- **Sortable** — enables sorting (text alphabetical, range/numeric by value).

## From app block to theme section (the four adaptations)

The mirrored file is an **app block**. Your copy is a **theme section**. Make exactly these edits:

1. `block.settings.*` → `section.settings.*` (every occurrence; **keep the setting ids and
   types** — `search_index` and the `attr_*` mapping are read by the runtime. Labels, `info`,
   defaults and extra settings may change.)
2. In `{% schema %}`: remove `"target"` (and `"templates"` if present), add
   `"presets": [{ "name": "Synerise Search Results" }]` so the section can be added from the theme editor.
3. Runtime + styles — pick one:
   - **Copy into your theme (default, full customization):** upload these files, unchanged,
     to your theme's `assets/` (Online Store → Themes → Edit code → Assets → Add a new asset):
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/snr-utils.js`
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/snr-search-page.js`
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/snr-cards.css`
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/snr-search.css`

     The `{{ 'x.js' | asset_url }}` tags then work unchanged. **The product card markup is not
     in the Liquid — it is `buildCard()` in `snr-utils.js`** (its PRESENTATION zone). Anything
     about the card itself (a badge, a second price, a rating) is a change to your copy of
     that file; this is why copy-into-theme is the default route.
   - **Load from the mirror (restyle only, auto-updating):** replace each `asset_url`
     tag with the mirror's pinned URL (`https://cdn.jsdelivr.net/gh/Synerise/shopify-storefront-components@<tag>/extensions/synerise/assets/<file>`).
     The runtime is then read-only; customize the Liquid, `<style>`, schema and `attr_*` mapping.
4. Nothing else — the `data-*` attributes, hook classes and script order are plumbing.

The **index UUID is a schema setting** (per instance); do not hard-code it.

Place the section on the **Search** template and hide the theme's native results
section there, or you get two result lists.

## Customize with an AI assistant

Point the assistant at the mirrored app-block template + this contract:

> Read `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/blocks/search-results.liquid` and this
> contract, create a section on my Search template based on it, set
> `search_index=<your index UUID>`, apply the four adaptations (copy the runtime
> into my theme), customize the PRESENTATION zones, and keep every
> `SNR INTEGRATION PLUMBING` zone unchanged.

The assistant hands you the files to install (a section + the assets). **Use the
Sidekick chat, not the theme editor's "Generate block"** — see
[Working with Sidekick](README.md#working-with-sidekick-and-other-ai-assistants).

## Install without AI (deterministic)

**Online Store → Themes → Edit code → Sections → Add a new section →** paste the
app-block template (`extensions/synerise/blocks/search-results.liquid`) from the
mirror → apply the **four adaptations** above (upload `snr-utils.js`,
`snr-search-page.js`, `snr-search.css`, `snr-cards.css` to *Assets*) → Save → add
the section to the **Search** template → set the **Search index**.
(Installing a custom section writes a theme file — expected; the "no theme files"
guarantee applies only to the app-block route.)

## Limitations

- **Single-currency.** Prices use the store's `money_format`; no multi-currency /
  market price conversion.

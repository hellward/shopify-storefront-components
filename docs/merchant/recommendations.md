# Synerise Recommendations — Merchant Integration Contract

**Internal source doc** for preparing the public merchant guide. It specifies the
integration precisely enough that a merchant — or their AI assistant — can generate
and customize a correct recommendations section. The buildable template is
Synerise's own **app-block template** — `extensions/synerise/blocks/recommendations.liquid`
plus its runtime (`assets/recommendations.js`, `snr-utils.js`, `snr-cards.css`) —
mirrored read-only to the public repo. Base your custom section on it.

## What you get

A **self-contained theme section** that renders a Synerise AI Recommendations
campaign as product cards, client-side. **One configurable section**; each
placement is an **instance** with its own campaign, heading, product count and
columns — no per-campaign code duplication.

## Prerequisites

- The **Synerise** app embed (tracking code) is enabled on the theme — it
  publishes the connection (`window.__snrs.config`) and sets the `_snrs_uuid`
  cookie. Without it the section stays hidden.
- A **Synerise AI Recommendations campaign** (copy its Campaign ID).

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

- **Integration plumbing — do NOT change:** reading `campaign_id` + the blank guard,
  the page context (`itemId` logic), the root `<section data-snr-recommendations …>`
  tag with all its `data-*` attributes, the `.snr-recommendations__slot` elements
  (one per item), the `<script>` tags, and in the runtime: the API call + auth
  (`token`), `credentials:'omit'`, `clientUUID`, the `recommendationView` /
  `recommendationClick` events, hide-on-empty, HTML escaping, init/re-init.
- **Presentation — change freely:** the `<style>`, the heading, the grid, the
  schema labels/defaults/extra settings, the `attr_*` field mapping (settings
  `attr_handle`, `attr_title`, `attr_image`, `attr_price`), the `snr_extra_attrs`
  line, and — on the copy-into-theme route — the card markup in `buildCard()`
  (`snr-utils.js`).

## Connection (read at runtime — never hard-code)

```js
window.__snrs.config = { trackerKey, aiApiHost }   // published by the Synerise tracking code
// _snrs_uuid cookie (set by the tracker SDK) -> clientUUID
```

## Request

```
GET {aiApiHost}/recommendations/v2/recommend/campaigns/{campaign_id}
    ?token={trackerKey}
    &displayAttribute=handle,title,imageLink,price   # root of each attr_* path (+ snr_extra_attrs)
    [&clientUUID={uuid}]
    [&itemId={seed}]
```
sent with `credentials: 'omit'`.

- **`displayAttribute`** = the root segment of each `attr_*` path, plus whatever you
  list in `snr_extra_attrs` (emitted as `data-attr-extra`). Request **any attributes
  your campaign exposes** (configured in Synerise **AI Engine Configuration**) that
  way, then render them in `buildCard()`.
- **Context:** product page → `itemId` = the product id; cart → one `itemId` per
  cart product; home / collection → no `itemId`.

## Response

- `body.data[]` — each item has at least `{ itemId, handle }` plus the requested
  attributes (base: `title`, `imageLink`, `price.value`).
  - **`price.value` is in MAJOR currency units** (do not divide by 100).
  - `imageLink` is a full image URL.
- `body.extras.correlationId` — passed on the view/click events.

## Events

- **`recommendationView({ campaignId, correlationId, productIds })`** — fired once
  when the section enters the viewport (`IntersectionObserver`, threshold 0.5). The
  render does not wait for the SDK; if `window.SR` isn't ready yet the impression is
  **deferred** until it is (not dropped).
- **`recommendationClick({ campaignId, correlationId, productId, position })`** —
  on product click (delegated handler).

Both are guarded on `window.SR` (provided by the tracking code) and skipped if it
is absent.

## Behavior

- Hide the section on **empty results or any error** — never a broken shell.
- **HTML-escape** every API string placed into markup/attributes.
- Product links are **locale/market-aware** (built from the shop's route root, not
  a hard-coded `/products/`).
- **Re-initializes on `shopify:section:load`** so it works when added or edited in
  the theme editor.

## From app block to theme section (the four adaptations)

The mirrored file is an **app block**. Your copy is a **theme section**. Make exactly these edits:

1. `block.settings.*` → `section.settings.*` (every occurrence; **keep the setting ids and
   types** — `campaign_id` and the `attr_*` mapping are read by the runtime. Labels, `info`,
   defaults and extra settings may change.)
2. In `{% schema %}`: remove `"target"` (and `"templates"` if present), add
   `"presets": [{ "name": "Synerise Recommendations" }]` so the section can be added from the theme editor.
3. Runtime + styles — pick one:
   - **Copy into your theme (default, full customization):** upload these files, unchanged,
     to your theme's `assets/` (Online Store → Themes → Edit code → Assets → Add a new asset):
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/snr-utils.js`
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/recommendations.js`
     - `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/assets/snr-cards.css`

     The `{{ 'x.js' | asset_url }}` tags then work unchanged. **The product card markup is not
     in the Liquid — it is `buildCard()` in `snr-utils.js`** (its PRESENTATION zone). Anything
     about the card itself (a badge, a second price, a rating) is a change to your copy of
     that file; this is why copy-into-theme is the default route.
   - **Load from the mirror (restyle only, pinned to a release tag):** replace each
     `asset_url` tag with the mirror's pinned URL (`https://cdn.jsdelivr.net/gh/Synerise/shopify-storefront-components@<tag>/extensions/synerise/assets/<file>`).
     The runtime is then read-only and stays at that tag until you change it;
     customize the Liquid, `<style>`, schema and `attr_*` mapping.
4. Nothing else — the `data-*` attributes, hook classes and script order are plumbing.

The **Campaign ID is a schema setting** (per instance); do not hard-code it.

## Extend the data (example)

To show a sale strikethrough: in the section's PRESENTATION zone set
`{%- assign snr_extra_attrs = 'compareAtPrice' -%}` (the attribute must be a
**response attribute** on the campaign's feed in AI Engine Configuration) — the
runtime then requests it — and render it in `buildCard()` (`snr-utils.js`, copied
into your theme) with `getPath(item, 'compareAtPrice')` next to the price. Extending
the attribute set — not just restyling — is the intended "full customization."

## Customize with an AI assistant

Point the assistant at the mirrored app-block template + this contract (assistants
such as Sidekick can fetch public HTTPS URLs):

> Read `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/extensions/synerise/blocks/recommendations.liquid` and this
> contract, create a theme section based on it, set `campaign_id=<your id>`, apply
> the four adaptations (copy the runtime into my theme), customize the PRESENTATION
> zones, and keep every `SNR INTEGRATION PLUMBING` zone unchanged.

The assistant fetches the real template + runtime from the mirror and hands you the
files to install (a section + three assets). **Use the Sidekick chat, not the theme
editor's "Generate block"** — see [Working with Sidekick](README.md#working-with-sidekick-and-other-ai-assistants).

## Install without AI (deterministic)

**Online Store → Themes → Edit code → Sections → Add a new section →** paste the
app-block template (`extensions/synerise/blocks/recommendations.liquid`) from the
mirror → apply the **four adaptations** above (upload `snr-utils.js`,
`recommendations.js`, `snr-cards.css` to *Assets*) → Save → add the section to a
template → set the **Campaign ID**.

> Installing this custom **section writes a theme file** — that is expected for a
> custom section. (The "no theme files are written" guarantee applies only to the
> **app-block** route, where you add our shipped block from the theme editor.)

## Limitations

- **Single-currency.** Prices use the store's `money_format`; there is no
  multi-currency / market price conversion.

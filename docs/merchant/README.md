# Synerise Storefront Components — AI Codegen Framework

Build your **own** Synerise-powered storefront components in your Shopify theme —
generated or customized with an AI assistant (Shopify Sidekick, or any coding tool
like Cursor / Claude Code), or adapted by hand. **You own the generated code**;
customization is based on Synerise's **own app-block templates + runtime** (mirrored
read-only to the public repo
[`github.com/Synerise/shopify-storefront-components`](https://github.com/Synerise/shopify-storefront-components))
plus a precise **contract** per component, so the integration stays correct.

This is the **customizable alternative** to the Synerise app's built-in storefront
components — for when you need markup, layout, or data the app blocks can't express.
For standard, no-code use, enable the app's built-in blocks instead.

## Components

| Component | What it does | What's provided |
|---|---|---|
| **Recommendations** | Product grid from a Synerise AI Recommendations campaign | Contract + our mirrored **app-block template** — [recommendations.md](recommendations.md) |
| **Search** | AI Search results page (grid, facets, sort, pagination) | Contract + our mirrored **app-block template** — [search-results.md](search-results.md) |
| **Suggestions** | Search autocomplete under the theme's search box | **Contract only** — [suggestions.md](suggestions.md) (see its note) |

> **Suggestions is contract-only.** It is a global app embed that takes over the
> theme's native search dropdown — too theme-coupled to hand over as a copy-&-paste
> block. Use the shipped Synerise Suggestions app embed; the contract is here for
> reference. Deep visual customization is the job of the Synerise component
> configurator (coming later).

## Prerequisites (once)

1. **Synerise tracking enabled.** The **Synerise** app embed (tracking code) must be
   on the theme — it publishes the connection every component reads
   (`window.__snrs.config = { trackerKey, aiApiHost }`) and sets the `_snrs_uuid`
   cookie. Without it, the components stay hidden. You never put the tracker key or
   API host in a component's settings — only the campaign/index id + presentation.

2. **The Synerise-side object** for the component (copy its id in the Synerise
   platform):
   - Recommendations → an **AI Recommendations campaign**
     ([create one](https://hub.synerise.com/docs/ai-hub/recommendations-v2/creating-recommendation-campaign/)).
   - Search → an **AI Search index**
     ([create one](https://hub.synerise.com/docs/ai-hub/ai-search/create-index/)),
     with the card fields set as **response** attributes and the filter/facet/sort
     attributes given the matching roles
     ([define attributes](https://hub.synerise.com/docs/ai-search/configuring-ai-search/index-settings/define-attributes/)).
   - Suggestions → the product index above, plus optionally a **query suggestions**
     entry (Synerise → AI Search → Suggestions) for suggested phrases.

## How to use

Same source, two ways:

- **With an AI assistant** — point it at the component's public URL and describe
  your change (assistants such as Sidekick can fetch public URLs):

  > Read `<public URL of recommendations.md>` and the app-block template it links,
  > create a theme section based on it, set `campaign_id = <your id>`, apply the
  > four adaptations (copy the runtime into my theme), and customize the
  > PRESENTATION zones to `<your change>`. Keep every `SNR INTEGRATION PLUMBING`
  > zone unchanged.

- **By hand** — copy the component's **app-block template** from the mirror into a
  new theme section (Online Store → Themes → Edit code → Sections → add a section),
  apply the **four adaptations** listed in the component's contract (settings
  object, schema preset, runtime assets, nothing else), and set the campaign/index id.

## The two zones (how customization stays safe)

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

- **Integration plumbing — do NOT change:** the API call + auth, `clientUUID`, the
  view/click events, hide-on-empty, HTML escaping, the root element's `data-*`
  attributes, the hook classes and the script tags. Changing these breaks the
  integration or analytics.
- **Presentation — change freely:** the styles, the wrapper/heading markup, the
  layout, the schema labels/defaults, the `attr_*` field mapping (which attributes
  you render), and — when the runtime is copied into your theme — the card markup
  in `buildCard()`. To show more data, set `snr_extra_attrs = 'compareAtPrice'`
  (a PRESENTATION line in the section) so the runtime requests that attribute, then
  render it in `buildCard()`.

Keep the plumbing intact and the component keeps working no matter how you restyle
it.

## Connection reference (developer)

The tracking code publishes, synchronously, before the components run:

```js
window.__snrs.config = { trackerKey, aiApiHost }   // aiApiHost = <sdk-host>/ai
// _snrs_uuid cookie -> clientUUID (anonymous shopper id)
```

Components read this at runtime; product links are built locale/market-aware from
the shop's route root. Prices use the store's `money_format` (single-currency; no
market price conversion).

## Troubleshooting

- **The component doesn't appear.** It hides itself on purpose when the tracking
  embed/config is missing, the campaign/index id is wrong, or there are no results.
  Check that `window.__snrs.config` exists on the page and the id is valid.
- **Cards show with no image or price.** The `attr_*` field mapping (settings
  `attr_handle`, `attr_title`, `attr_image`, `attr_price`) doesn't match what your
  campaign/index returns. Fix the attribute names and/or set them as
  **response** attributes in Synerise. `handle` is required — items with no handle
  are dropped (check the browser console for a warning).
- **Price sort does nothing (Search).** Price must be a **range/numeric** attribute
  on the index (a text price can't sort).

## What this is / isn't

- **Use this** if you (or your AI tool) want to own and customize the component code.
- For **no-code / standard** placement, enable the Synerise app's built-in blocks.
- For **visual customization without code**, the Synerise component configurator is
  the future path (not yet released).

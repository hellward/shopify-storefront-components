# Synerise Storefront Components — AI Codegen Framework

Build your **own** Synerise-powered storefront components in your Shopify theme —
generated or customized with an AI assistant (Shopify Sidekick, or any coding tool
like Cursor / Claude Code), or adapted by hand. **You own the generated code**;
customization is based on Synerise's **own app-block templates + runtime** (mirrored
read-only to the public repo
[`github.com/Synerise/shopify-storefront-components`](https://github.com/Synerise/shopify-storefront-components),
the canonical source — forks and test mirrors may carry the same files)
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

> **Suggestions has no template.** It is a global app embed that takes over the
> theme's native search dropdown — too theme-coupled to hand over as a copy-&-paste
> block. Default: use the shipped Synerise Suggestions app embed. For structural
> customization, build a theme-owned alternative from the contract with an AI
> assistant — [suggestions.md](suggestions.md) lists the three routes and a worked
> Horizon example. Deep visual customization without theme code is the job of the
> Synerise component configurator (coming later).

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
  > zone unchanged, except the required `block.settings` → `section.settings` rename.

  Ask for the **files** (the section + the runtime assets) and install them yourself —
  see *Working with Sidekick* below for what the assistant can and cannot do.

- **By hand** — copy the component's **app-block template** from the mirror into a
  new theme section (Online Store → Themes → Edit code → Sections → add a section),
  apply the **four adaptations** listed in the component's contract (settings
  object, schema preset, runtime assets, nothing else), and set the campaign/index id.

## Working with Sidekick (and other AI assistants)

For this multi-file integration, ask **Sidekick chat** to read the public sources and
give you complete downloadable files, then install them through *Edit code*. Do not
rely on the theme editor's **"Generate block"** to install a section and its runtime
assets. Sidekick's direct-editing capabilities vary by editing surface and change over
time; what follows is what worked in October 2026 on a Horizon theme.

| | **Sidekick chat** (the panel in the admin / theme editor) | **"Generate block"** (theme editor → Add block → AI) |
|---|---|---|
| Reads our public URLs (template, contract, runtime) | Yes | Not in our runs — it worked from the prompt text only |
| Writes files into your theme | Hands you files to download | One standalone theme block in `blocks/` |
| Creates a section or uploads assets | No | No |
| Result for our components | The section + assets, ready to install | A look-alike block without the runtime — nothing loaded |

**The flow that works**

1. In the Sidekick chat, paste the prompt from the component's contract (with your
   campaign / index id and your presentation changes).
2. If Sidekick offers to "generate this theme block", **decline** and ask instead:
   *"Give me the complete section file and the asset files to download."*
3. Download the files (one `.liquid` for `sections/`, two or three for `assets/`).
4. Confirm which theme you are about to edit — check its name and ID in the Themes
   list — and prefer a duplicate of your live theme for the first install.
5. **Online Store → Themes → Edit code**: *Assets → Add a new asset* for each runtime /
   CSS file (keep the filenames). If a file with the same name already exists (for
   example `snr-utils.js` from another Synerise component), compare the two before
   overwriting it. The runtime files are released **together**: `snr-utils.js` and the
   component runtimes you copy (`recommendations.js`, `snr-search-page.js`) from one
   release tag belong with each other, so when you upgrade one, upload the matching
   others from the same tag — after comparing them with your copies to carry over
   your customizations. (The Suggestions runtime, `snr-suggestions.js`, ships inside
   the app embed and updates with the app; you never upload it.) Then *Sections → Add a new section*, paste the `.liquid`, save.
6. Theme editor → *Add section* → pick the component, set the id if not pre-filled.

After that the code is yours: edit `buildCard()` in your copy of `snr-utils.js`, the
`<style>` block or the schema at any time; the PRESENTATION / PLUMBING markers show you
where. `snr-utils.js` is shared by Recommendations and Search — scope card changes to
one component's root class (e.g. `.snr-recommendations .snr-card__badge`) if you use both.

**Why "Generate block" is the wrong tool here.** It produces a single self-contained
theme block and cannot add files to `sections/` or `assets/`. Our components need the
runtime files, so in our runs the generated block rendered an empty frame. If you tried
it, remove the failed block instance from the template in the theme editor, and delete
its file (`blocks/ai_gen_*.liquid`) only after confirming no other template uses it.

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
  integration or analytics. The one sanctioned edit inside plumbing is the
  `block.settings` → `section.settings` rename the contracts require.
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

- **The component doesn't appear.** It hides itself on purpose (Recommendations and
  Search) when the tracking embed/config is missing, the campaign/index id is wrong,
  or there are no results. Check that `window.__snrs.config` exists on the page and
  the id is valid. Suggestions behaves differently: it shows error and no-results
  states, listed in its contract.
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

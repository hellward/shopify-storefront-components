# Synerise Storefront Components for Shopify

This is a **read-only mirror** of the theme app extension shipped with the
[Synerise](https://synerise.com) Shopify app: the app-block templates, their
runtime and styles, and the merchant-facing contracts for customizing them.
It is published automatically by Synerise's CI on every release of the app.
Pull requests are not accepted here; for questions or problems contact Synerise
support.

## Layout

| Path | What it holds |
|---|---|
| `extensions/synerise/blocks/` | The app-block templates (Liquid) — the base for a customized theme section |
| `extensions/synerise/assets/` | The runtime (`*.js`) and styles (`*.css`) the templates load |
| `docs/merchant/` | The merchant guide and one contract per component |

The paths are the same as in the Synerise Shopify app repository, so a contract
that cites `extensions/synerise/blocks/recommendations.liquid` means that file.

## Use

Start at [`docs/merchant/README.md`](docs/merchant/README.md). It explains how
to turn an app-block template into a theme section you own — with an AI
assistant (Shopify Sidekick, Cursor, Claude Code, …) or by hand — and what must
stay unchanged for the Synerise integration to keep working.

Fetch files by URL:

- Latest template or contract (always the newest release):
  `https://raw.githubusercontent.com/Synerise/shopify-storefront-components/main/<path>`
- Runtime assets, pinned to a release — use this form when you load the runtime
  from a CDN instead of copying it into your theme:
  `https://cdn.jsdelivr.net/gh/Synerise/shopify-storefront-components@<tag>/extensions/synerise/assets/<file>`

Pin the tag for runtime assets. `main` moves with every release.

## Versioning

Tags are the Synerise Shopify integration's release versions (for example
`v1.4.2`), one snapshot commit each; `main` always equals the latest release.
A release here can be ahead of what the Synerise app currently serves to your
store — that is fine for a section you own, since you copy the runtime into
your theme (or pin a tag) and it talks to Synerise directly.

## License

MIT — see [LICENSE](LICENSE).

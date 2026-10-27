// ==== SNR INTEGRATION PLUMBING — do not change ====
(function () {
  // Synerise SDK sets this cookie with the client UUID.
  var SNRS_UUID_COOKIE = '_snrs_uuid';

  function getCookie(name) {
    if (typeof document === 'undefined') return null;
    var prefix = name + '=';
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i];
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(prefix) === 0) {
        try { return decodeURIComponent(c.substring(prefix.length)); } catch (_) { return c.substring(prefix.length); }
      }
    }
    return null;
  }

  function getClientUuid() {
    return getCookie(SNRS_UUID_COOKIE);
  }

  var ESCAPE_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  };
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, function (ch) { return ESCAPE_MAP[ch]; });
  }

  // Formats using the store's money_format string (Shopify's standard algorithm),
  // so card prices match the theme's `| money` output for every visitor. `amount`
  // is in MAJOR units (Synerise catalog price) and is scaled to cents for the
  // algorithm. Falls back to `${{amount}}` when no format is supplied.
  function formatMoney(amount, moneyFormat) {
    if (typeof amount !== 'number' || !isFinite(amount)) return '';
    var format = moneyFormat || '${{amount}}';
    var cents = Math.round(amount * 100);
    var placeholder = /\{\{\s*(\w+)\s*\}\}/;
    function delim(precision, thousands, decimal) {
      var n = (cents / 100).toFixed(precision == null ? 2 : precision);
      var parts = n.split('.');
      var whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + (thousands == null ? ',' : thousands));
      return whole + (parts[1] ? (decimal == null ? '.' : decimal) + parts[1] : '');
    }
    var match = format.match(placeholder);
    if (!match) return format;
    var value;
    switch (match[1]) {
      case 'amount_no_decimals': value = delim(0); break;
      case 'amount_with_comma_separator': value = delim(2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = delim(0, '.', ','); break;
      case 'amount_with_apostrophe_separator': value = delim(2, "'"); break;
      case 'amount_with_space_separator': value = delim(2, ' ', ','); break;
      case 'amount_no_decimals_with_space_separator': value = delim(0, ' '); break;
      default: value = delim(2);
    }
    return format.replace(placeholder, value);
  }

  // Resolves a dot-path (e.g. "price.value") against an object; undefined if any step is missing.
  function getPath(obj, path) {
    if (obj == null || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Locale/market-aware storefront links. Shopify publishes the current locale's
  // route prefix as window.Shopify.routes.root ('/' or e.g. '/fr-ca/'); read at
  // call time so a late-set global is honored. Falls back to '/' off-storefront.
  function routeRoot() {
    var root = (typeof window !== 'undefined' && window.Shopify && window.Shopify.routes &&
      window.Shopify.routes.root);
    if (typeof root !== 'string' || root === '') return '/';
    return root.charAt(root.length - 1) === '/' ? root : root + '/';
  }
  function productUrl(handle) {
    return routeRoot() + 'products/' + encodeURIComponent(handle);
  }
  function searchUrl(query) {
    return routeRoot() + 'search?q=' + encodeURIComponent(query);
  }

  // Parses the root element's data-attr-extra ("compareAtPrice, badge.label") into
  // the list of extra attribute paths a block wants requested alongside the four
  // card slots. Trims entries, drops empties; null/undefined -> [].
  function parseExtraAttributes(raw) {
    if (raw == null || raw === '') return [];
    var out = [];
    var parts = String(raw).split(',');
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].trim();
      if (v) out.push(v);
    }
    return out;
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return NaN;
  }

  // console.warn once per distinct key, so a misconfiguration surfaces without spamming the console.
  var warnedKeys = {};
  function warnOnce(key, message) {
    if (warnedKeys[key]) return;
    warnedKeys[key] = true;
    if (typeof console !== 'undefined' && console.warn) console.warn(message);
  }

  // Default field mapping = Synerise catalog / AI-Search index shape.
  var DEFAULT_CARD_FIELDS = { handle: 'handle', title: 'title', image: 'imageLink', price: 'price.value' };

  // ==== SNR PRESENTATION — change freely ====
  // Card markup — keep escapeHtml() on every API string and productUrl() for the link.
  // Builds a product card. Shared by the search and recommendations blocks; styled by snr-cards.css.
  // `moneyFormat` is the store's shop.money_format string (so prices match the theme).
  // `fields` maps card slots to attribute paths in the API item, e.g.
  //   { handle: 'handle', title: 'title', image: 'imageLink', price: 'price.value' }.
  // Any omitted key falls back to DEFAULT_CARD_FIELDS. Callers whose API uses a different
  // shape (e.g. recommendations returns flat `image`/`price`) pass their own mapping.
  function buildCard(item, moneyFormat, fields) {
    item = item || {};
    fields = fields || {};
    var handlePath = fields.handle || DEFAULT_CARD_FIELDS.handle;
    var titlePath = fields.title || DEFAULT_CARD_FIELDS.title;
    var imagePath = fields.image || DEFAULT_CARD_FIELDS.image;
    var pricePath = fields.price || DEFAULT_CARD_FIELDS.price;

    var handle = getPath(item, handlePath) || '';
    var title = getPath(item, titlePath) || handle || '';
    if (!handle) {
      warnOnce('handle:' + handlePath,
        '[SNRUtils.buildCard] Cannot build a product card: no value at the handle attribute "' + handlePath +
        '" (used for the product link). Set the correct attribute on the block or expose it on the index.');
    }
    var href = productUrl(handle);

    var imageUrl = getPath(item, imagePath);
    var img = imageUrl
      ? '<img class="snr-card__image" src="' + escapeHtml(imageUrl) +
        '" alt="' + escapeHtml(title) + '" loading="lazy">'
      : '<span class="snr-card__image"></span>';

    var priceNum = toNumber(getPath(item, pricePath));
    var price = isFinite(priceNum)
      ? '<span class="snr-card__price">' + formatMoney(priceNum, moneyFormat) + '</span>'
      : '';

    return '<a class="snr-card" href="' + href + '">' +
      img +
      '<span class="snr-card__title">' + escapeHtml(title) + '</span>' +
      price +
      '</a>';
  }

  // ==== SNR INTEGRATION PLUMBING — do not change ====
  // Shared storefront config for the components. The Synerise tracking code
  // (pasted into the Synerise app embed) publishes it synchronously as
  // window.__snrs.config = { trackerKey, aiApiHost }. Components run deferred, so
  // by the time they call this the inline config is already set. Returns {} when
  // absent so callers can gate cleanly (block stays hidden until configured).
  function getConfig() {
    return (typeof window !== 'undefined' && window.__snrs && window.__snrs.config) || {};
  }

  var api = {
    getCookie: getCookie,
    getClientUuid: getClientUuid,
    escapeHtml: escapeHtml,
    formatMoney: formatMoney,
    getPath: getPath,
    parseExtraAttributes: parseExtraAttributes,
    buildCard: buildCard,
    productUrl: productUrl,
    searchUrl: searchUrl,
    getConfig: getConfig
  };

  if (typeof window !== 'undefined') { window.SNRUtils = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();

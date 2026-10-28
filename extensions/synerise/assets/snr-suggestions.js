(function () {
  var SNRUtils = (typeof window !== 'undefined' && window.SNRUtils) ||
    (typeof require !== 'undefined' ? require('./snr-utils.js') : {});

  // Root segment of each mapped field path, de-duped (same as recommendations.js).
  function cardAttributes(fields) {
    fields = fields || {};
    var out = [];
    ['handle', 'title', 'image', 'price'].forEach(function (slot) {
      var root = String(fields[slot] || '').split('.')[0];
      if (root && out.indexOf(root) === -1) out.push(root);
    });
    return out;
  }

  function buildAutocompleteUrl(cfg, query, uuid) {
    var url = cfg.apiUri
      + '/search/v2/indices/' + encodeURIComponent(cfg.index) + '/autocomplete'
      + '?query=' + encodeURIComponent(query)
      + '&token=' + encodeURIComponent(cfg.trackerKey)
      + '&limit=' + encodeURIComponent(cfg.limit)
      + '&displayAttributes=' + cardAttributes(cfg.fields).join(',')
      + '&includeMeta=true';
    if (uuid) url += '&clientUUID=' + encodeURIComponent(uuid);
    return url;
  }

  // Query suggestions come from a SEPARATE, dedicated suggestion index (same as
  // the portal and the Magento integration) — a second autocomplete call against
  // cfg.phraseIndex whose documents are the phrases (data[].suggestion). No
  // display attributes: the response carries phrases, not product cards.
  function buildSuggestionUrl(cfg, query, uuid) {
    var limit = isFinite(cfg.maxSuggestions) ? cfg.maxSuggestions : cfg.limit;
    var url = cfg.apiUri
      + '/search/v2/indices/' + encodeURIComponent(cfg.phraseIndex) + '/autocomplete'
      + '?query=' + encodeURIComponent(query)
      + '&token=' + encodeURIComponent(cfg.trackerKey)
      + '&limit=' + encodeURIComponent(limit)
      + '&includeMeta=true';
    if (uuid) url += '&clientUUID=' + encodeURIComponent(uuid);
    return url;
  }

  function parseAutocompleteResponse(body, fields) {
    var handlePath = (fields && fields.handle) || 'handle';
    // Products: data items that have a value at the handle attribute.
    var data = (body && body.data) || [];
    var products = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i] && SNRUtils.getPath(data[i], handlePath)) products.push(data[i]);
    }
    var correlationId = (body && body.extras && body.extras.correlationId) || '';
    return { products: products, correlationId: correlationId };
  }

  // Phrases from the suggestion-index autocomplete response: data[].suggestion,
  // tolerating a bare string or {suggestion|text|query} object per entry.
  function parseSuggestions(body) {
    var data = (body && body.data) || [];
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var entry = data[i];
      var text = (typeof entry === 'string') ? entry
        : (entry && (entry.suggestion || entry.text || entry.query)) || '';
      if (text) out.push(text);
    }
    return out;
  }

  // Recommendations shown in the zero-state / no-results panels (home context —
  // the search dropdown has no product/cart context). The campaign is passed in
  // so zero-state and no-results can use different campaigns. displayAttribute is
  // SINGULAR here, matching the recommendations endpoint (vs the autocomplete
  // plural form).
  function buildRecoUrl(cfg, campaign, uuid) {
    var url = cfg.apiUri
      + '/recommendations/v2/recommend/campaigns/' + encodeURIComponent(campaign)
      + '?token=' + encodeURIComponent(cfg.trackerKey)
      + '&displayAttribute=' + cardAttributes(cfg.fields).join(',')
      + '&includeMeta=true';
    if (uuid) url += '&clientUUID=' + encodeURIComponent(uuid);
    return url;
  }

  // Recommendation products: data items that resolve a value at the handle path.
  function parseReco(body, fields) {
    var handlePath = (fields && fields.handle) || 'handle';
    var data = (body && body.data) || [];
    var products = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i] && SNRUtils.getPath(data[i], handlePath)) products.push(data[i]);
    }
    return products;
  }

  // Escapes text, wrapping case-insensitive occurrences of the query in <mark>
  // (matching the theme's native query-suggestion highlighting).
  function highlightMatch(text, query) {
    text = String(text == null ? '' : text);
    if (!query) return SNRUtils.escapeHtml(text);
    var lowText = text.toLowerCase();
    var lowQ = String(query).toLowerCase();
    var out = '', i = 0;
    while (i < text.length) {
      var at = lowText.indexOf(lowQ, i);
      if (at === -1) { out += SNRUtils.escapeHtml(text.slice(i)); break; }
      out += SNRUtils.escapeHtml(text.slice(i, at));
      out += '<mark>' + SNRUtils.escapeHtml(text.slice(at, at + lowQ.length)) + '</mark>';
      i = at + lowQ.length;
    }
    return out;
  }

  // <li> query-suggestion items — theme pills in skin mode, plain rows otherwise.
  function suggestionItemsHtml(suggestions, cfg, query) {
    var parts = [];
    for (var i = 0; i < suggestions.length; i++) {
      var sug = suggestions[i];
      if (cfg.skin) {
        parts.push('<li class="predictive-search-results__card--query" role="option" data-query="' +
          SNRUtils.escapeHtml(sug) + '"><a class="pills__pill predictive-search-results__pill" href="' +
          SNRUtils.escapeHtml(SNRUtils.searchUrl(sug)) + '"><span>' + highlightMatch(sug, query) + '</span></a></li>');
      } else {
        parts.push('<li class="snr-sg__suggestion" role="option" data-query="' +
          SNRUtils.escapeHtml(sug) + '">' + SNRUtils.escapeHtml(sug) + '</li>');
      }
    }
    return parts.join('');
  }

  // <li> product cards — theme resource-card in skin mode, our card otherwise.
  // Both carry the behavior hooks (role=option, data-handle, data-item-id).
  function productItemsHtml(products, cfg) {
    var fields = cfg.fields || {};
    var parts = [];
    for (var j = 0; j < products.length; j++) {
      var p = products[j];
      var handle = SNRUtils.getPath(p, fields.handle || 'handle') || '';
      var itemId = SNRUtils.getPath(p, 'itemId') || '';
      var hooks = 'role="option" data-handle="' + SNRUtils.escapeHtml(handle) +
        '" data-item-id="' + SNRUtils.escapeHtml(itemId) + '"';
      if (cfg.skin) {
        var title = SNRUtils.getPath(p, fields.title || 'title') || handle || '';
        var image = SNRUtils.getPath(p, fields.image || 'imageLink');
        var priceNum = SNRUtils.toNumber(SNRUtils.getPath(p, fields.price || 'price.value'));   // null/'' → NaN → no price
        var price = isFinite(priceNum) ? SNRUtils.formatMoney(priceNum, cfg.moneyFormat) : '';
        parts.push('<li class="predictive-search-results__card predictive-search-results__card--product" ' + hooks + '>' +
          '<div class="resource-card" data-resource-type="product">' +
          '<a class="resource-card__link" href="' + SNRUtils.escapeHtml(SNRUtils.productUrl(handle)) + '">' +
          '<span class="visually-hidden">' + SNRUtils.escapeHtml(title) + '</span></a>' +
          '<div class="resource-card__media" style="--resource-card-aspect-ratio: 4 / 5;">' +
          (image ? '<img class="resource-card__image" src="' + SNRUtils.escapeHtml(image) + '" alt="" loading="lazy">' : '') +
          '</div>' +
          '<div class="resource-card__content"><p class="resource-card__title paragraph">' + SNRUtils.escapeHtml(title) + '</p>' +
          (price ? '<div><span class="price">' + SNRUtils.escapeHtml(price) + '</span></div>' : '') +
          '</div></div></li>');
      } else {
        parts.push('<li class="snr-sg__product" ' + hooks + '>' +
          SNRUtils.buildCard(p, cfg.moneyFormat, cfg.fields) + '</li>');
      }
    }
    return parts.join('');
  }

  // Wrap product <li>s in the appropriate list container for the current mode.
  function productsListHtml(products, cfg) {
    if (cfg.skin) {
      return '<ul class="predictive-search-results__list predictive-search-results__wrapper-products list-unstyled">' +
        productItemsHtml(products, cfg) + '</ul>';
    }
    return '<ul class="snr-sg__list snr-sg__products">' + productItemsHtml(products, cfg) + '</ul>';
  }

  function renderDropdown(parsed, cfg, query) {
    var sug = parsed.suggestions || [];
    var prod = parsed.products || [];
    if (!sug.length && !prod.length) return '';
    var inner = [];
    if (sug.length) {
      if (cfg.skin) {
        inner.push('<ul class="predictive-search-results__list predictive-search-results__wrapper predictive-search-results__wrapper-queries list-unstyled">' +
          suggestionItemsHtml(sug, cfg, query) + '</ul>');
      } else {
        inner.push('<div class="snr-sg__section snr-sg__section--suggestions"><ul class="snr-sg__list">' +
          suggestionItemsHtml(sug, cfg, query) + '</ul></div>');
      }
    }
    if (prod.length) {
      if (cfg.skin) {
        inner.push('<div class="predictive-search-results__products"><h4 class="predictive-search-results__title">Products</h4>' +
          productsListHtml(prod, cfg) + '</div>');
      } else {
        inner.push('<div class="snr-sg__section snr-sg__section--products">' + productsListHtml(prod, cfg) + '</div>');
      }
    }
    var parts = [];
    parts.push(cfg.skin ? '<div class="predictive-search-results__inner">' + inner.join('') + '</div>' : inner.join(''));
    if (cfg.viewAllLabel && query) {
      parts.push('<div class="snr-sg__section snr-sg__footer">' +
        '<a class="snr-sg__viewall button" href="' + SNRUtils.escapeHtml(SNRUtils.searchUrl(query)) + '">' +
        SNRUtils.escapeHtml(cfg.viewAllLabel) + '</a></div>');
    }
    return parts.join('');
  }

  // Panel shown when the search returns nothing or the request failed: a message
  // plus (optionally) recommendation cards. Empty string when there is neither,
  // which lets the caller fall back to closing the panel.
  function renderNoResults(cfg, opts) {
    opts = opts || {};
    var message = opts.message || '';
    var heading = opts.heading || '';
    var products = opts.products || [];
    var prefixHtml = opts.prefixHtml || '';   // e.g. phrase pills that loaded although products failed
    if (!message && !products.length && !prefixHtml) return '';
    var parts = [prefixHtml, '<div class="snr-sg__section snr-sg__noresults">'];
    if (message) parts.push('<div class="snr-sg__noresults-msg">' + SNRUtils.escapeHtml(message) + '</div>');
    if (products.length) {
      if (heading) {
        parts.push(cfg.skin
          ? '<h4 class="predictive-search-results__title">' + SNRUtils.escapeHtml(heading) + '</h4>'
          : '<div class="snr-sg__noresults-heading">' + SNRUtils.escapeHtml(heading) + '</div>');
      }
      parts.push(productsListHtml(products, cfg));
    }
    parts.push('</div>');
    return parts.join('');
  }

  // Combine the two autocomplete results (each null on error) into one outcome.
  //   products failed            → 'error'   (phrases kept for the error panel)
  //   nothing to show            → 'empty'
  //   otherwise                  → 'results'
  function decideQueryOutcome(prod, suggestions) {
    var sug = suggestions || [];
    if (prod === null || prod === undefined) return { kind: 'error', products: [], suggestions: sug, correlationId: '' };
    var products = prod.products || [];
    var kind = (products.length || sug.length) ? 'results' : 'empty';
    return { kind: kind, products: products, suggestions: sug, correlationId: prod.correlationId || '' };
  }

  function readConfig(el, shared) {
    shared = shared || {};
    return {
      el: el,
      trackerKey: shared.trackerKey || '',
      apiUri: (shared.aiApiHost || '').replace(/\/+$/, ''),
      index: el.getAttribute('data-index') || '',
      phraseIndex: el.getAttribute('data-phrase-index') || '',
      selector: el.getAttribute('data-selector') || '',
      minChars: parseInt(el.getAttribute('data-min-chars'), 10) || 3,
      limit: Math.max(
        parseInt(el.getAttribute('data-max-suggestions'), 10) || 6,
        parseInt(el.getAttribute('data-max-products'), 10) || 6
      ),
      maxSuggestions: parseInt(el.getAttribute('data-max-suggestions'), 10),
      maxProducts: parseInt(el.getAttribute('data-max-products'), 10),
      moneyFormat: el.getAttribute('data-money-format') || '',
      viewAllLabel: el.getAttribute('data-view-all-label') || '',
      noResultsLabel: el.getAttribute('data-no-results-label') || '',
      errorLabel: el.getAttribute('data-error-label') || '',
      noResultsRecoLabel: el.getAttribute('data-no-results-reco-label') || '',
      zeroStateLabel: el.getAttribute('data-zero-state-label') || '',
      zeroStateCampaign: el.getAttribute('data-zero-state-campaign') || '',
      noResultsCampaign: el.getAttribute('data-no-results-campaign') || '',
      fields: {
        handle: el.getAttribute('data-attr-handle') || 'handle',
        title: el.getAttribute('data-attr-title') || 'title',
        image: el.getAttribute('data-attr-image') || 'imageLink',
        price: el.getAttribute('data-attr-price') || 'price.value'
      }
    };
  }

  function debounce(fn, ms) {
    var t;
    function wrapped() {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    }
    wrapped.cancel = function () { clearTimeout(t); };
    return wrapped;
  }

  // Generation gate: a render is allowed only for the latest token. Every input
  // event and every dismissal invalidates synchronously, so a late response for
  // an earlier term (or for a closed panel) is dropped instead of rendered.
  function createGate() {
    var gen = 0;
    return {
      next: function () { gen += 1; return gen; },
      current: function (token) { return token === gen; },
      invalidate: function () { gen += 1; }
    };
  }

  // ---- Keyboard + ARIA (combobox pattern) ----
  // The panel is the single listbox; options get ids and aria-selected; while the
  // panel is open the bound input carries aria-expanded / aria-controls /
  // aria-activedescendant and gets its ORIGINAL values back on close (a theme
  // such as Horizon sets its own aria-controls on the same input).
  var LISTBOX_ID = 'snr-sg-listbox';
  var NAV_KEYS = { ArrowDown: 1, ArrowUp: 1, Enter: 1 };

  function openAria(widget, input) {
    var panel = widget.panel;
    panel.setAttribute('role', 'listbox');
    panel.id = LISTBOX_ID;
    var opts = panel.querySelectorAll('[role=option]');
    for (var i = 0; i < opts.length; i++) if (!opts[i].id) opts[i].id = 'snr-sg-opt-' + i;
    if (!input.__snrSgAria) {
      input.__snrSgAria = {
        'aria-expanded': input.getAttribute('aria-expanded'),
        'aria-controls': input.getAttribute('aria-controls'),
        'aria-activedescendant': input.getAttribute('aria-activedescendant')
      };
    }
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', LISTBOX_ID);
    input.removeAttribute('aria-activedescendant');
  }

  function closeAria(input) {
    var saved = input && input.__snrSgAria;
    if (!saved) return;
    var keys = Object.keys(saved);
    for (var i = 0; i < keys.length; i++) {
      if (saved[keys[i]] == null) input.removeAttribute(keys[i]);
      else input.setAttribute(keys[i], saved[keys[i]]);
    }
    delete input.__snrSgAria;
  }

  function setActive(widget, idx) {
    var opts = widget.panel.querySelectorAll('[role=option]');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.remove('is-active');
      opts[i].removeAttribute('aria-selected');
    }
    var opt = opts[idx];
    if (!opt) return null;
    opt.classList.add('is-active');
    opt.setAttribute('aria-selected', 'true');
    var input = widget.cfg._activeInput;
    if (input && opt.id) input.setAttribute('aria-activedescendant', opt.id);
    return opt;
  }

  // Runs from a WINDOW capture listener so it precedes every theme handler
  // (Horizon binds on document in capture phase, Dawn on its element). Consumes
  // ArrowDown/ArrowUp/Enter on keydown — and the matching keyup, which Dawn
  // navigates on — only while our panel is open for a bound input. Escape closes
  // the panel and is NOT stopped: the theme still closes its modal. Returns true
  // when the event was consumed.
  function handleKey(widget, ev) {
    if (!widget || !ev || !ev.target || !ev.target.__snrSgBound) return false;
    var panel = widget.panel;
    if (!panel || panel.hidden) return false;
    if (ev.isComposing || ev.altKey || ev.ctrlKey || ev.metaKey) return false;   // IME / shortcuts belong to the page
    var key = ev.key;
    if (ev.type === 'keydown' && key === 'Escape') { widget.close(); return false; }   // also for option-less panels
    var opts = panel.querySelectorAll('[role=option]');
    if (!opts.length) return false;
    if (ev.type === 'keyup') {
      if (NAV_KEYS[key] && widget._consumedKey === key) {
        widget._consumedKey = null;
        ev.stopImmediatePropagation();
        return true;
      }
      return false;
    }
    if (ev.type !== 'keydown') return false;
    if (!NAV_KEYS[key]) return false;
    var active = panel.querySelector('[role=option].is-active');
    var idx = -1;
    for (var k = 0; k < opts.length; k++) { if (opts[k] === active) { idx = k; break; } }
    if (key === 'Enter') {
      if (!active) return false;              // no selection: the theme submits the form
      ev.preventDefault(); ev.stopImmediatePropagation();
      widget._consumedKey = key;
      active.click();
      return true;
    }
    ev.preventDefault(); ev.stopImmediatePropagation();
    widget._consumedKey = key;
    setActive(widget, key === 'ArrowDown' ? (idx + 1) % opts.length : (idx <= 0 ? opts.length : idx) - 1);
    return true;
  }

  // One pair of window capture listeners per page, dispatching to the widget.
  function installKeyCapture() {
    if (typeof window === 'undefined' || !window.addEventListener || window.__snrSgKeys) return;
    window.__snrSgKeys = true;
    var types = ['keydown', 'keyup'];
    for (var i = 0; i < types.length; i++) {
      window.addEventListener(types[i], function (ev) {
        var el = document.querySelector('[data-snr-suggestions]');
        handleKey(el && el.__snrSg, ev);
      }, true);
    }
  }

  // ---- Horizon: stop the native predictive-search fetch ----
  // Horizon's component base resolves the declarative on:input="/search" handler
  // on the INSTANCE at dispatch time, and `search` is a public instance field. So
  // replacing it on each upgraded <predictive-search-component> stops the theme's
  // own suggest request per keystroke while its modal and keyboard handling stay
  // intact; the clear-button toggle `search` used to do is kept by the stub below.
  // The original is kept on the instance and
  // restored whenever our widget cannot run — native search is never silenced
  // without ours taking over. (Verified in a headless harness, 2026-10-28.)
  var HORIZON_TAG = 'predictive-search-component';

  // Replacement for Horizon's `search`: no fetch, but the one side effect the
  // shopper sees — the clear (X) button following the input's value — is kept.
  function horizonSearchStub(component) {
    return function () {
      var refs = component.refs;
      if (refs && refs.resetButton && refs.searchInput) {
        refs.resetButton.hidden = !String(refs.searchInput.value || '').trim();
      }
    };
  }

  // `selector` (the embed's input selector): when given, only components that
  // contain an input WE bound are patched — native search is never silenced
  // without ours taking over.
  function neutralizeHorizon(scope, selector) {
    var nodes = (scope && scope.querySelectorAll) ? scope.querySelectorAll(HORIZON_TAG) : [];
    var patched = 0;
    for (var i = 0; i < nodes.length; i++) {
      var c = nodes[i];
      if (typeof c.search !== 'function' || c.__snrNativeSearch) continue;   // not upgraded yet / already ours
      if (selector) {
        var input = c.querySelector ? c.querySelector(selector) : null;
        if (!input || !input.__snrSgBound) continue;
      }
      c.__snrNativeSearch = c.search;
      c.search = horizonSearchStub(c);
      patched += 1;
    }
    return patched;
  }

  function restoreHorizon(scope) {
    var nodes = (scope && scope.querySelectorAll) ? scope.querySelectorAll(HORIZON_TAG) : [];
    for (var i = 0; i < nodes.length; i++) {
      var c = nodes[i];
      if (!c.__snrNativeSearch) continue;
      c.search = c.__snrNativeSearch;
      delete c.__snrNativeSearch;
    }
  }

  // Instances in the DOM before Horizon's module ran are plain elements until
  // the definition lands: wait for it, upgrade synchronously, then patch.
  function neutralizeHorizonWhenReady(scope, selector) {
    if (typeof customElements !== 'undefined' && customElements && typeof customElements.whenDefined === 'function') {
      customElements.whenDefined(HORIZON_TAG).then(function () {
        var nodes = (scope && scope.querySelectorAll) ? scope.querySelectorAll(HORIZON_TAG) : [];
        for (var i = 0; i < nodes.length; i++) if (customElements.upgrade) customElements.upgrade(nodes[i]);
        neutralizeHorizon(scope, selector);
      }).catch(function () {});
    } else {
      neutralizeHorizon(scope, selector);
    }
  }

  // One dropdown element reused per widget, appended to <body>, positioned under
  // the focused input.
  function ensurePanel() {
    var p = document.querySelector('.snr-sg');
    if (!p) {
      p = document.createElement('div');
      p.className = 'snr-sg';
      p.hidden = true;
      document.body.appendChild(p);
    }
    return p;
  }

  // Modal-search themes (e.g. Horizon) open search in a <dialog> rendered in the
  // browser top layer; a body-appended panel paints behind it. When the bound
  // input lives inside such a modal, re-parent the panel into the modal content
  // so it shares that layer, and flow it as a block (no absolute positioning).
  function hostPanel(panel, input) {
    // The input lives in the modal header; the results region (__content) is a
    // sibling, not an ancestor. Resolve the modal scope, then host the panel in
    // the content WRAPPER — a stable container the theme does not re-render on
    // input. (__content itself is the live region the theme rewrites, so a panel
    // appended there is wiped on the next keystroke.)
    var scope = input && input.closest && input.closest('predictive-search-component, dialog, [role=dialog]');
    var host = document.body;
    if (scope && scope.querySelector) {
      host = scope.querySelector('.predictive-search-form__content-wrapper')
        || scope.querySelector('form')
        || scope;
    }
    var inModal = host !== document.body;
    if (panel.parentNode !== host) {
      if (inModal) host.insertBefore(panel, host.firstChild);
      else host.appendChild(panel);
    }
    panel.classList.toggle('snr-sg--modal', inModal);
    panel._host = host;
    panel._inModal = inModal;
    return host;
  }

  function positionPanel(panel, input) {
    if (panel._inModal) return; // flows as a block inside the modal content
    var r = input.getBoundingClientRect();
    panel.style.top = (window.scrollY + r.bottom) + 'px';
    panel.style.left = (window.scrollX + r.left) + 'px';
    panel.style.width = r.width + 'px';
  }

  // Once-per-widget setup. The flag is set only after the connection and index
  // check out, so a first attempt that ran before the tracking code published its
  // config (or before the merchant set an index) is retried by the next initAll().
  // Inputs are bound separately (bindInputs) and may be zero at this point: a
  // search modal rendered later is bound on shopify:section:load.
  function initBlock(el, shared) {
    if (el.__snrSgInit) return;
    var cfg = readConfig(el, shared);
    if (!cfg.trackerKey || !cfg.apiUri || !cfg.index || !cfg.selector) {
      restoreHorizon(document);   // inert: give Horizon its native search back
      return;                     // retryable (flag not set)
    }
    el.__snrSgInit = true;
    var panel = ensurePanel();
    var gate = createGate();
    var widget;   // assigned once the closures below exist

    // Drop everything pending for the previous term: the in-flight request, the
    // debounced fetch not yet started, and the right to render.
    function invalidate() {
      if (cfg._abort) cfg._abort.abort();
      cfg._abort = null;
      if (debouncedRun) debouncedRun.cancel();
      gate.invalidate();
    }

    function close() {
      invalidate();
      panel.hidden = true;
      panel.innerHTML = '';
      closeAria(cfg._activeInput);
      if (widget) widget._consumedKey = null;
    }

    function fetchJson(url, signal) {
      return fetch(url, { credentials: 'omit', signal: signal })
        .then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); });
    }

    function showHtml(input, html, correlationId) {
      hostPanel(panel, input);
      panel.classList.toggle('snr-sg--skin', !!cfg.skin);
      panel.innerHTML = html;
      panel._correlationId = correlationId || '';
      positionPanel(panel, input);
      panel.hidden = false;
      if (cfg._activeInput && cfg._activeInput !== input) closeAria(cfg._activeInput);   // panel moved to another input
      cfg._activeInput = input;
      openAria(widget, input);
    }

    // Recommendation-backed panel for the empty states. The native dropdown is
    // suppressed unconditionally by CSS while the block is on the page, so these
    // states always render our own panel (or close to nothing). Reco products
    // carry no search correlationId, so clicking them only navigates (fireClick
    // no-ops without a correlationId).
    // opts: { campaign, message, heading } — message is the status line (always
    // shown); heading sits above the recommendations and only appears with them
    // (so the zero-state, which has no status line, collapses to nothing when the
    // campaign returns no products).
    function showRecoState(input, opts, signal, guard) {
      function render(products) {
        if (signal && signal.aborted) return;
        if (guard && !guard()) return;
        if (isFinite(cfg.maxProducts)) products = products.slice(0, cfg.maxProducts);
        var html = renderNoResults(cfg, { message: opts.message, heading: opts.heading, products: products, prefixHtml: opts.prefixHtml });
        if (!html) { close(); return; }
        showHtml(input, html, '');
      }
      if (opts.campaign) {
        fetchJson(buildRecoUrl(cfg, opts.campaign, SNRUtils.getClientUuid()), signal)
          .then(function (body) { render(parseReco(body, cfg.fields)); })
          .catch(function () { render([]); });
      } else {
        render([]);
      }
    }

    function runQuery(input, q, signal, guard) {
      var uuid = SNRUtils.getClientUuid();
      // Products (product index) and query suggestions (dedicated suggestion
      // index) are two independent autocomplete calls; each resolves to null on
      // error. decideQueryOutcome() combines them: phrases that loaded are shown
      // even when the product search failed (above the error message).
      var productP = fetchJson(buildAutocompleteUrl(cfg, q, uuid), signal)
        .then(function (body) { return parseAutocompleteResponse(body, cfg.fields); })
        .catch(function () { return null; });
      var suggestP = cfg.phraseIndex
        ? fetchJson(buildSuggestionUrl(cfg, q, uuid), signal)
            .then(function (body) { return parseSuggestions(body); })
            .catch(function () { return null; })
        : Promise.resolve(null);

      Promise.all([productP, suggestP]).then(function (res) {
        if (signal && signal.aborted) return; // superseded by a newer keystroke
        if (guard && !guard()) return;        // term changed / panel dismissed meanwhile
        var o = decideQueryOutcome(res[0], res[1]);
        var suggestions = isFinite(cfg.maxSuggestions) ? o.suggestions.slice(0, cfg.maxSuggestions) : o.suggestions;
        if (o.kind === 'error') { // product search failed → error state, phrases kept
          var prefix = suggestions.length ? renderDropdown({ suggestions: suggestions, products: [] }, cfg, '') : '';
          showRecoState(input, { campaign: cfg.noResultsCampaign, message: cfg.errorLabel, heading: cfg.noResultsRecoLabel, prefixHtml: prefix }, signal, guard);
          return;
        }
        var products = isFinite(cfg.maxProducts) ? o.products.slice(0, cfg.maxProducts) : o.products;
        var parsed = { products: products, suggestions: suggestions, correlationId: o.correlationId };
        var html = renderDropdown(parsed, cfg, q);
        if (html) { showHtml(input, html, parsed.correlationId); return; }
        showRecoState(input, { campaign: cfg.noResultsCampaign, message: cfg.noResultsLabel, heading: cfg.noResultsRecoLabel }, signal, guard); // 200 but nothing
      });
    }

    // Decide what to show, aborting any in-flight request first:
    //   empty       -> zero-state recommendations
    //   < minChars  -> nothing (native already hidden; avoids mid-typing noise)
    //   >= minChars -> product + suggestion search
    function run(input) {
      if (cfg._abort) cfg._abort.abort();
      var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      cfg._abort = ac;
      var signal = ac && ac.signal;
      var token = gate.next();
      cfg._activeInput = input;
      // Render with the theme's native markup when inside a Horizon-style search
      // modal, so results inherit the theme's styling; our own cards otherwise.
      cfg.skin = !!(input.closest && input.closest('predictive-search-component'));
      var q = input.value.trim();
      // True while this run is still the one allowed to paint the panel.
      function guard() { return gate.current(token) && cfg._activeInput === input && input.value.trim() === q; }
      if (!q.length) { showRecoState(input, { campaign: cfg.zeroStateCampaign, message: '', heading: cfg.zeroStateLabel }, signal, guard); return; }
      if (q.length < cfg.minChars) { close(); return; }
      runQuery(input, q, signal, guard);
    }

    var debouncedRun = debounce(run, 300);

    // Idempotent per input (a re-rendered section may hand us the same node again).
    function bindInputs(scope) {
      var root = scope && scope.querySelectorAll ? scope : document;
      var found = root.querySelectorAll(cfg.selector);
      var bound = 0;
      for (var i = 0; i < found.length; i++) {
        if (found[i].__snrSgBound) continue;
        found[i].__snrSgBound = true;
        bindInput(found[i]);
        bound += 1;
      }
      neutralizeHorizonWhenReady(root, cfg.selector);   // after binding: only components with a bound input
      return bound;
    }

    function bindInput(input) {
      (function (input) {
        // Invalidate NOW (abort + cancel pending), debounce only the next fetch.
        input.addEventListener('input', function () { invalidate(); cfg._activeInput = input; debouncedRun(input); });
        input.addEventListener('focus', function () { invalidate(); run(input); });
        // Keyboard: handled by the window capture listener (installKeyCapture).
      })(input);
    }

    widget = { cfg: cfg, panel: panel, gate: gate, close: close, invalidate: invalidate, run: run, showHtml: showHtml, bindInputs: bindInputs, _consumedKey: null };
    el.__snrSg = widget;
    bindInputs(document);
    installKeyCapture();

    // Select by behavior hook (works for both our markup and the theme skin):
    // data-query -> navigate to /search?q=; data-handle -> product page.
    panel.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== panel) {
        if (node.hasAttribute) {
          if (node.hasAttribute('data-query')) {
            window.location.href = SNRUtils.searchUrl(node.getAttribute('data-query'));
            return;
          }
          if (node.hasAttribute('data-handle')) {
            fireClick(cfg, panel, node);
            var link = node.querySelector('a');
            if (link) window.location.href = link.getAttribute('href');
            return;
          }
        }
        node = node.parentNode;
      }
    });

    document.addEventListener('mousedown', function (ev) {
      if (!panel.hidden && !panel.contains(ev.target) && !(ev.target.closest && ev.target.closest(cfg.selector))) close();
    });
  }

  function fireClick(cfg, panel, node) {
    if (!window.SR || !window.SR.event || typeof window.SR.event.itemSearchClick !== 'function') return;
    if (!panel._correlationId) return;
    window.SR.event.itemSearchClick({
      item: node.getAttribute('data-item-id'), correlationId: panel._correlationId, searchType: 'autocomplete'
    });
  }

  // `scope` (a re-rendered section in the theme editor) narrows the INPUT lookup
  // only; the embed root is global (target: body) and always looked up on document.
  function initAll(scope) {
    var el = document.querySelector('[data-snr-suggestions]');
    if (!el) return;
    if (!el.__snrSg) { initBlock(el, SNRUtils.getConfig()); return; }
    el.__snrSg.bindInputs(scope && scope.querySelectorAll ? scope : document);
  }

  // The theme editor re-renders a section's HTML without re-running scripts and
  // emits shopify:section:load instead; a replaced search input is bound here.
  function onSectionLoad(event) {
    initAll(event && event.target);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cardAttributes: cardAttributes, decideQueryOutcome: decideQueryOutcome, debounce: debounce, createGate: createGate, handleKey: handleKey, neutralizeHorizon: neutralizeHorizon, restoreHorizon: restoreHorizon, setActive: setActive, initBlock: initBlock, initAll: initAll, onSectionLoad: onSectionLoad, buildAutocompleteUrl: buildAutocompleteUrl, buildSuggestionUrl: buildSuggestionUrl, buildRecoUrl: buildRecoUrl, parseAutocompleteResponse: parseAutocompleteResponse, parseSuggestions: parseSuggestions, parseReco: parseReco, highlightMatch: highlightMatch, renderDropdown: renderDropdown, renderNoResults: renderNoResults };
  }

  if (typeof document !== 'undefined' && SNRUtils && SNRUtils.getConfig) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { initAll(); });
    else initAll();
    document.addEventListener('shopify:section:load', onSectionLoad);
  }
})();

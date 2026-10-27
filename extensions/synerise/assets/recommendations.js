// ==== SNR INTEGRATION PLUMBING — do not change ====
(function () {
  var SNRUtils = (typeof window !== 'undefined' && window.SNRUtils) ||
    (typeof require !== 'undefined' ? require('./snr-utils.js') : null);

  var SELECTOR = '[data-snr-recommendations]';

  function readConfig(el) {
    // trackerKey + API host come from the shared config published by the tracking
    // code (window.__snrs.config); campaign_id stays per-block (data attribute).
    var shared = SNRUtils.getConfig();
    return {
      el: el,
      trackerKey: shared.trackerKey || '',
      apiUri: (shared.aiApiHost || '').replace(/\/+$/, ''),
      campaignId: el.getAttribute('data-campaign-id') || '',
      limit: parseInt(el.getAttribute('data-limit'), 10) || 8,
      contextType: el.getAttribute('data-context-type') || 'home',
      contextId: el.getAttribute('data-context-id') || '',
      cartItemIds: el.getAttribute('data-cart-item-ids') || '',
      moneyFormat: el.getAttribute('data-money-format') || '',
      // Card field mapping — attribute paths in the API item. Defaults match the
      // shared catalog shape (imageLink, nested price.value), same as search.
      fields: {
        handle: el.getAttribute('data-attr-handle') || 'handle',
        title: el.getAttribute('data-attr-title') || 'title',
        image: el.getAttribute('data-attr-image') || 'imageLink',
        price: el.getAttribute('data-attr-price') || 'price.value',
        // Extra attribute paths to request (data-attr-extra, comma-separated) so a
        // customized buildCard() can read them; empty by default.
        extra: SNRUtils.parseExtraAttributes(el.getAttribute('data-attr-extra'))
      }
    };
  }

  // The API attributes to request = the root segment of each mapped field path
  // (e.g. price path "price.value" -> request the "price" attribute), de-duplicated.
  function cardAttributes(fields) {
    fields = fields || {};
    var out = [];
    function add(path) {
      var root = String(path || '').split('.')[0];
      if (root && out.indexOf(root) === -1) out.push(root);
    }
    ['handle', 'title', 'image', 'price'].forEach(function (slot) { add(fields[slot]); });
    (fields.extra || []).forEach(add);
    return out;
  }

  function buildContextParams(cfg) {
    if (cfg.contextType === 'product' && cfg.contextId) {
      return '&itemId=' + encodeURIComponent(cfg.contextId);
    }
    if (cfg.contextType === 'cart' && cfg.cartItemIds) {
      var ids;
      try { ids = JSON.parse(cfg.cartItemIds); } catch (_) { ids = []; }
      if (!ids || !ids.length) return '';
      var parts = [];
      for (var i = 0; i < ids.length; i++) {
        parts.push('itemId=' + encodeURIComponent(ids[i]));
      }
      return '&' + parts.join('&');
    }
    // 'home', 'collection', or unknown → no itemId
    return '';
  }

  function buildRequestUrl(cfg, uuid) {
    var url = cfg.apiUri
      + '/recommendations/v2/recommend/campaigns/' + encodeURIComponent(cfg.campaignId)
      + '?token=' + encodeURIComponent(cfg.trackerKey)
      + '&displayAttribute=' + cardAttributes(cfg.fields).join(',');
    if (uuid) url += '&clientUUID=' + encodeURIComponent(uuid);
    url += buildContextParams(cfg);
    return url;
  }

  function hideBlock(el) {
    el.style.display = 'none';
  }

  function whenSrEvent(method, cb) {
    function ready() {
      return window.SR && window.SR.event && typeof window.SR.event[method] === 'function';
    }
    if (ready()) { cb(); return; }
    var waited = 0, POLL_MS = 200, MAX_MS = 10000;
    var timer = setInterval(function () {
      if (ready()) {
        clearInterval(timer);
        cb();
      } else if ((waited += POLL_MS) >= MAX_MS) {
        clearInterval(timer);
      }
    }, POLL_MS);
  }

  function fireViewEvent(cfg, items) {
    if (!window.SR || !window.SR.event || typeof window.SR.event.recommendationView !== 'function') return;
    var productIds = [];
    for (var i = 0; i < items.length; i++) productIds.push(String(items[i].itemId));
    window.SR.event.recommendationView({
      campaignId: cfg.campaignId,
      correlationId: cfg.el.getAttribute('data-correlation-id') || null,
      productIds: productIds
    });
  }

  function fireClickEvent(cfg, li) {
    if (!window.SR || !window.SR.event || typeof window.SR.event.recommendationClick !== 'function') return;
    window.SR.event.recommendationClick({
      campaignId: cfg.campaignId,
      correlationId: cfg.el.getAttribute('data-correlation-id') || null,
      productId: li.getAttribute('data-product-id'),
      position: parseInt(li.getAttribute('data-position'), 10)
    });
  }

  function installViewObserver(cfg) {
    function sendView() {
      whenSrEvent('recommendationView', function () {
        fireViewEvent(cfg, cfg._renderedItems || []);
      });
    }
    if (typeof IntersectionObserver !== 'function') {
      sendView();
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          observer.disconnect();
          sendView();
          return;
        }
      }
    }, { threshold: 0.5 });
    observer.observe(cfg.el);
  }

  function installClickHandler(cfg) {
    cfg.el.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== cfg.el) {
        if (node.tagName === 'LI' && node.getAttribute('data-product-id')) {
          fireClickEvent(cfg, node);
          return;
        }
        node = node.parentNode;
      }
    });
  }

  // Stamps the attribution hooks the click event reads (fireClickEvent) on a
  // rendered slot. Presentation code must call this for every card it renders.
  function markSlot(slot, item, position) {
    slot.setAttribute('data-product-id', String(item.itemId));
    slot.setAttribute('data-position', String(position));
  }

  // Fills skeleton slots with JS-built cards from the API items. Returns the
  // items actually rendered (capped by available slots).
  // ==== SNR PRESENTATION — change freely ====
  // Keep: the slot query, the markSlot() call per card, and returning the rendered
  // items — the recommendationView/recommendationClick events depend on them.
  function renderCards(cfg, items) {
    var slots = cfg.el.querySelectorAll('.snr-recommendations__slot');
    var rendered = [];
    for (var i = 0; i < items.length && i < slots.length; i++) {
      var slot = slots[i];
      slot.className = 'snr-recommendations__slot';
      slot.innerHTML = SNRUtils.buildCard(items[i], cfg.moneyFormat, cfg.fields);
      markSlot(slot, items[i], i);
      rendered.push(items[i]);
    }
    for (var j = items.length; j < slots.length; j++) {
      slots[j].style.display = 'none';
    }
    return rendered;
  }

  // ==== SNR INTEGRATION PLUMBING — do not change ====
  function initBlock(el) {
    // The block emits its own <script src="recommendations.js">, so the script
    // runs once per block on the page and each run scans every block. Guard so a
    // block is initialized exactly once, regardless of how many times this runs.
    if (el.__snrRecoInitialized) return;
    el.__snrRecoInitialized = true;

    var cfg = readConfig(el);
    if (!cfg.trackerKey || !cfg.apiUri || !cfg.campaignId) {
      hideBlock(el);
      return;
    }

    var uuid = SNRUtils.getClientUuid();
    var url = buildRequestUrl(cfg, uuid);

    fetch(url, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('recommendations_api_' + res.status);
        return res.json();
      })
      .then(function (body) {
        var data = (body && body.data) || [];
        var items = [];
        for (var i = 0; i < data.length && items.length < cfg.limit; i++) {
          if (data[i] && SNRUtils.getPath(data[i], cfg.fields.handle)) items.push(data[i]);
        }
        if (!items.length) {
          hideBlock(el);
          return;
        }
        var correlationId = (body && body.extras && body.extras.correlationId) || '';
        if (correlationId) el.setAttribute('data-correlation-id', correlationId);

        var rendered = renderCards(cfg, items);
        if (!rendered.length) {
          hideBlock(el);
          return;
        }
        cfg._renderedItems = rendered;
        installViewObserver(cfg);
        installClickHandler(cfg);
      })
      .catch(function () {
        hideBlock(el);
      });
  }

  // `scope` defaults to the document; the theme editor passes the re-rendered
  // section element so only its blocks are (re)initialized.
  function initAll(scope) {
    var root = scope && typeof scope.querySelectorAll === 'function'
      ? scope
      : (typeof document !== 'undefined' ? document : null);
    if (!root) return;
    var blocks = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < blocks.length; i++) initBlock(blocks[i]);
  }

  // The theme editor re-renders a section's HTML on every settings change
  // without re-running its scripts; it emits shopify:section:load instead.
  function onSectionLoad(event) {
    initAll(event && event.target);
  }

  if (typeof document !== 'undefined' && SNRUtils) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { initAll(); });
    } else {
      initAll();
    }
    document.addEventListener('shopify:section:load', onSectionLoad);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      readConfig: readConfig,
      buildContextParams: buildContextParams,
      buildRequestUrl: buildRequestUrl,
      whenSrEvent: whenSrEvent,
      initBlock: initBlock,
      initAll: initAll,
      onSectionLoad: onSectionLoad
    };
  }
})();

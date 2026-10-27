// ==== SNR INTEGRATION PLUMBING — do not change ====
(function () {
  // Card + formatting helpers come from snr-utils.js (loaded first as a
  // separate <script>; require()'d under node --test).
  var SNRUtils = (typeof window !== 'undefined' && window.SNRUtils) ||
    (typeof require !== 'undefined' ? require('./snr-utils.js') : {});
  var getClientUuid = SNRUtils.getClientUuid;
  var escapeHtml = SNRUtils.escapeHtml;
  var formatMoney = SNRUtils.formatMoney;
  var buildCard = SNRUtils.buildCard;
  var getPath = SNRUtils.getPath;

  // A range-typed attribute in the AI engine returns its facet as native bounds
  // { min: <num>, max: <num> } (not a value->count map).
  function isRangeShape(buckets) {
    return !!buckets && typeof buckets === 'object'
      && Object.prototype.hasOwnProperty.call(buckets, 'min')
      && Object.prototype.hasOwnProperty.call(buckets, 'max')
      && isFinite(Number(buckets.min)) && isFinite(Number(buckets.max));
  }

  // A facet is numeric (range UI) when it comes as native { min, max } bounds, OR
  // (numeric attribute stored as text) when EVERY bucket key parses as a finite
  // number; otherwise it is a text facet (checkboxes). The API exposes no type field.
  function detectFacetType(buckets) {
    if (isRangeShape(buckets)) return 'range';
    var keys = Object.keys(buckets || {});
    if (!keys.length) return 'text';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.trim() === '' || !isFinite(Number(k))) return 'text';
    }
    return 'range';
  }

  // Turns extras.allFacets + facetsOrdering into an ordered, typed array.
  // Uses allFacets (the stable, unfiltered option set) so multi-select keeps
  // all options visible. filteredFacets is reserved for a future live-count overlay.
  function normalizeFacets(extras) {
    var src = (extras && extras.allFacets) || {};
    var ordering = (extras && extras.facetsOrdering) || Object.keys(src);
    var out = [];
    for (var i = 0; i < ordering.length; i++) {
      var name = ordering[i];
      var buckets = src[name];
      if (!buckets) continue;
      // Native range-typed facet: carry the bounds, not value buckets.
      if (isRangeShape(buckets)) {
        out.push({ name: name, type: 'range', min: Number(buckets.min), max: Number(buckets.max) });
        continue;
      }
      var values = Object.keys(buckets).map(function (v) { return { value: v, count: buckets[v] }; });
      if (!values.length) continue;
      out.push({ name: name, type: detectFacetType(buckets), values: values });
    }
    return out;
  }

  // Builds an IQL filter string from typed state.filters.
  // text  -> name == "v"   (multiple values OR'd in a group)
  // range -> name >= min AND name <= max   (present bounds only)
  // Facets are AND'd together. Returns '' when nothing is active.
  function escapeIql(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  function buildFilterIql(filters) {
    var clauses = [];
    var names = Object.keys(filters || {});
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var f = filters[name];
      if (!f) continue;
      if (f.type === 'text') {
        var vals = (f.values || []).filter(function (v) { return v !== '' && v != null; });
        if (!vals.length) continue;
        var terms = vals.map(function (v) { return name + ' == "' + escapeIql(v) + '"'; });
        clauses.push(terms.length > 1 ? '(' + terms.join(' OR ') + ')' : terms[0]);
      } else if (f.type === 'range') {
        var parts = [];
        if (f.min != null && f.min !== '' && isFinite(Number(f.min))) parts.push(name + ' >= ' + Number(f.min));
        if (f.max != null && f.max !== '' && isFinite(Number(f.max))) parts.push(name + ' <= ' + Number(f.max));
        if (!parts.length) continue;
        clauses.push(parts.length > 1 ? '(' + parts.join(' AND ') + ')' : parts[0]);
      }
    }
    return clauses.join(' AND ');
  }

  // ---- Configuration ----

  var ROOT_SELECTOR = '[data-snr-search-root]';
  var PAGE_SIZE = 24;
  var FACET_VALUES_INITIAL = 8;

  // Maps the UI sort token to a card field slot + ordering. The actual sortBy
  // attribute is resolved at query time from the block's configured field mapping
  // (state.fields), so a price sort uses the merchant-configured attribute
  // (e.g. "price.value") rather than a hardcoded name. 'relevance' is intentionally
  // absent → both fields omitted = default ranking. The resolved attribute must be
  // configured sortable on the index.
  var SORT_MAP = {
    price_asc: { field: 'price', ordering: 'asc' },
    price_desc: { field: 'price', ordering: 'desc' },
    name_asc: { field: 'title', ordering: 'asc' },
    name_desc: { field: 'title', ordering: 'desc' }
  };

  // ---- State ----
  // One state object per root. Populated by initRoot.

  function newState(root) {
    // trackerKey + API host come from the shared config published by the tracking
    // code (window.__snrs.config); the search index stays per-block (data attribute).
    var shared = SNRUtils.getConfig();
    return {
      root: root,
      trackerKey: shared.trackerKey || '',
      apiUri: (shared.aiApiHost || '').replace(/\/+$/, ''),
      index: root.getAttribute('data-index') || '',
      pageSize: parseInt(root.getAttribute('data-page-size'), 10) || PAGE_SIZE,
      showFacets: root.getAttribute('data-show-facets') !== '0',
      showHeading: root.getAttribute('data-show-heading') === '1',
      emptyText: root.getAttribute('data-empty-text') || 'No results found.',
      moneyFormat: root.getAttribute('data-money-format') || '',
      // Card field mapping — attribute paths in the index response. Defaults match
      // the Synerise catalog shape (imageLink, nested price.value).
      fields: {
        handle: root.getAttribute('data-attr-handle') || 'handle',
        title: root.getAttribute('data-attr-title') || 'title',
        image: root.getAttribute('data-attr-image') || 'imageLink',
        price: root.getAttribute('data-attr-price') || 'price.value',
        // Extra attribute paths to request (data-attr-extra, comma-separated) so a
        // customized buildCard() can read them; empty by default.
        extra: SNRUtils.parseExtraAttributes(root.getAttribute('data-attr-extra'))
      },
      query: '',
      sort: 'relevance',
      filters: {},        // { name: {type:'text',values:[...]} | {type:'range',min,max} }
      page: 1,
      totalResults: 0,
      correlationId: '',
      facets: [],         // normalizeFacets(extras): [{name,type,values:[{value,count}]}]
      results: [],        // accumulated across load-more
      els: {}             // populated when skeleton injected
    };
  }

  // ---- URL state encode/decode ----

  // URL value <-> typed filter. Range encoded as "min~max" (either side optional);
  // anything without "~" is a comma-separated text value list.
  function parseFilterValue(raw) {
    if (raw.indexOf('~') !== -1) {
      var b = raw.split('~');
      return {
        type: 'range',
        min: b[0] !== '' && isFinite(Number(b[0])) ? Number(b[0]) : null,
        max: b[1] !== '' && isFinite(Number(b[1])) ? Number(b[1]) : null
      };
    }
    return { type: 'text', values: raw.split(',').filter(function (v) { return v.length > 0; }) };
  }
  function serializeFilter(filter) {
    if (filter.type === 'range') {
      return (filter.min != null ? filter.min : '') + '~' + (filter.max != null ? filter.max : '');
    }
    return (filter.values || []).join(',');
  }

  function parseUrl() {
    var params = new URLSearchParams(window.location.search);
    var query = params.get('q') || '';
    var sort = params.get('sort') || 'relevance';
    var filters = {};
    params.forEach(function (val, key) {
      if (key.indexOf('f.') === 0) {
        filters[key.substring(2)] = parseFilterValue(val);
      }
    });
    return { query: query, sort: sort, filters: filters };
  }

  function syncUrl(state) {
    var params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.sort && state.sort !== 'relevance') params.set('sort', state.sort);
    var fkeys = Object.keys(state.filters);
    for (var i = 0; i < fkeys.length; i++) {
      var ser = serializeFilter(state.filters[fkeys[i]]);
      if (ser && ser !== '~') params.set('f.' + fkeys[i], ser);
    }
    var qs = params.toString();
    var newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }

  // Stamps the hooks the click handler reads (fireSearchClick / navigation) on a
  // rendered card. Presentation code must call this for every card it renders.
  function markCard(li, item, handle, position) {
    li.setAttribute('data-handle', handle);
    li.setAttribute('data-item-id', item.itemId || '');
    li.setAttribute('data-position', String(position));
  }

  // ==== SNR PRESENTATION — change freely ====
  // Keep the snr-search-page__* hook classes that state.els queries and the
  // markCard() call per rendered card; add your own classes/markup freely.
  // ---- Skeleton injection ----

  function buildSkeleton(state) {
    state.root.innerHTML =
      '<header class="snr-search-page__header">' +
        (state.showHeading ? '<h1 class="snr-search-page__title"></h1>' : '') +
        '<div class="snr-search-page__sort">' +
          '<label for="snr-sort" class="snr-search-page__sort-label">Sort:</label>' +
          '<select id="snr-sort" class="snr-search-page__sort-select">' +
            '<option value="relevance">Relevance</option>' +
            '<option value="price_asc">Price (low to high)</option>' +
            '<option value="price_desc">Price (high to low)</option>' +
            '<option value="name_asc">Name (A–Z)</option>' +
            '<option value="name_desc">Name (Z–A)</option>' +
          '</select>' +
        '</div>' +
      '</header>' +
      '<div class="snr-search-page__layout">' +
        '<aside class="snr-search-page__facets"></aside>' +
        '<section class="snr-search-page__main">' +
          '<ul class="snr-search-page__grid"></ul>' +
          '<div class="snr-search-page__loadmore">' +
            '<button type="button" class="snr-search-page__loadmore-btn" hidden>Load more</button>' +
          '</div>' +
          '<div class="snr-search-page__empty" hidden></div>' +
        '</section>' +
      '</div>';

    state.els = {
      title: state.root.querySelector('.snr-search-page__title'),
      sortSelect: state.root.querySelector('.snr-search-page__sort-select'),
      facets: state.root.querySelector('.snr-search-page__facets'),
      grid: state.root.querySelector('.snr-search-page__grid'),
      loadmoreBtn: state.root.querySelector('.snr-search-page__loadmore-btn'),
      empty: state.root.querySelector('.snr-search-page__empty')
    };
  }

  // ---- Rendering ----

  function renderTitle(state) {
    if (!state.els.title) return;
    state.els.title.textContent = state.query
      ? 'Search results for "' + state.query + '"'
      : 'Search';
  }

  function renderEmpty(state) {
    state.els.empty.hidden = false;
    state.els.empty.textContent = state.emptyText;
    state.els.grid.innerHTML = '';
    // Intentionally do NOT clear the facets panel here: when an over-restrictive
    // filter combination yields no results, wiping the filters would strand the
    // user (nothing left to deselect). Keep the last-rendered facets — with their
    // selections — so they can always uncheck and recover.
    state.els.loadmoreBtn.hidden = true;
    state.results = [];
    state.totalResults = 0;
  }

  function renderFacets(state) {
    if (!state.showFacets || !state.facets || !state.facets.length) {
      state.els.facets.innerHTML = '';
      return;
    }
    var parts = [];
    if (Object.keys(state.filters).length) {
      parts.push('<button type="button" class="snr-facet-clear-all">Clear all filters</button>');
    }
    for (var i = 0; i < state.facets.length; i++) {
      var f = state.facets[i];
      var hasSel = !!state.filters[f.name];
      parts.push('<div class="snr-facet" data-facet-name="' + escapeHtml(f.name) + '">');
      parts.push('<h3 class="snr-facet__title">' + escapeHtml(f.label || f.name) +
        (hasSel ? ' <button type="button" class="snr-facet-clear" data-facet-name="' + escapeHtml(f.name) +
          '">clear</button>' : '') +
        '</h3>');
      parts.push(f.type === 'range' ? renderRangeFacet(state, f) : renderTextFacet(state, f));
      parts.push('</div>');
    }
    state.els.facets.innerHTML = parts.join('');
  }

  function renderTextFacet(state, f) {
    var values = f.values || [];
    var visible = values.slice(0, FACET_VALUES_INITIAL);
    var hidden = values.slice(FACET_VALUES_INITIAL);
    var parts = ['<ul class="snr-facet__list">'];
    for (var j = 0; j < visible.length; j++) parts.push(facetValueLi(state, f.name, visible[j]));
    if (hidden.length) {
      parts.push('<li><details><summary class="snr-facet__more">Show ' + hidden.length +
        ' more</summary><ul class="snr-facet__list">');
      for (var k = 0; k < hidden.length; k++) parts.push(facetValueLi(state, f.name, hidden[k]));
      parts.push('</ul></details></li>');
    }
    parts.push('</ul>');
    return parts.join('');
  }

  function renderRangeFacet(state, f) {
    // Numeric-attribute-as-text facets carry value buckets (derive bounds from them);
    // native range facets carry explicit f.min / f.max.
    var nums = (f.values || []).map(function (v) { return Number(v.value); }).filter(isFinite);
    var lo = nums.length ? Math.min.apply(null, nums) : (f.min != null ? f.min : '');
    var hi = nums.length ? Math.max.apply(null, nums) : (f.max != null ? f.max : '');
    var sel = state.filters[f.name];
    var minVal = sel && sel.type === 'range' && sel.min != null ? sel.min : '';
    var maxVal = sel && sel.type === 'range' && sel.max != null ? sel.max : '';
    return '<div class="snr-facet-range">' +
      '<input type="number" class="snr-facet-range__min" inputmode="decimal" placeholder="' + escapeHtml(String(lo)) +
        '" value="' + escapeHtml(String(minVal)) + '" aria-label="Minimum ' + escapeHtml(f.name) + '">' +
      '<span class="snr-facet-range__sep">–</span>' +
      '<input type="number" class="snr-facet-range__max" inputmode="decimal" placeholder="' + escapeHtml(String(hi)) +
        '" value="' + escapeHtml(String(maxVal)) + '" aria-label="Maximum ' + escapeHtml(f.name) + '">' +
      '<button type="button" class="snr-facet-range__apply">Apply</button>' +
      '</div>';
  }

  function facetValueLi(state, facetName, val) {
    var sel = state.filters[facetName];
    var selected = !!(sel && sel.type === 'text' && sel.values.indexOf(val.value) !== -1);
    return '<li class="snr-facet__item">' +
      '<label class="snr-facet__label">' +
        '<input type="checkbox" data-facet-name="' + escapeHtml(facetName) + '"' +
          ' data-facet-value="' + escapeHtml(val.value) + '"' + (selected ? ' checked' : '') + '>' +
        '<span class="snr-facet__value">' + escapeHtml(val.value) + '</span>' +
        '<span class="snr-facet__count">(' + (val.count || 0) + ')</span>' +
      '</label></li>';
  }

  function renderGrid(state, items, append) {
    if (!append) state.els.grid.innerHTML = '';
    var startIndex = state.els.grid.children.length;
    var rendered = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var handle = item && getPath(item, state.fields.handle);
      if (!handle) continue;
      var li = document.createElement('li');
      li.className = 'snr-search-page__slot';
      markCard(li, item, handle, startIndex + i);
      li.innerHTML = buildCard(item, state.moneyFormat, state.fields);
      state.els.grid.appendChild(li);
      rendered++;
    }
    // Results came back but none had a usable handle → almost always a field-mapping
    // mismatch. Surface it once instead of silently rendering an empty grid.
    if (items.length > 0 && rendered === 0 && !state._warnedNoHandle) {
      state._warnedNoHandle = true;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[snr-search] Received ' + items.length + ' result(s) but none had a value at the handle attribute "' +
          state.fields.handle + '". Check the block\'s field mapping or the index response attributes.');
      }
    }
  }

  function updateLoadMore(state) {
    var fetched = state.results.length;
    if (fetched >= state.totalResults || fetched === 0) {
      state.els.loadmoreBtn.hidden = true;
    } else {
      state.els.loadmoreBtn.hidden = false;
    }
  }

  // ==== SNR INTEGRATION PLUMBING — do not change ====
  // ---- API request ----

  // The index attributes to fetch = the root segment of each mapped field path
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

  function performSearch(state, append) {
    var uuid = getClientUuid();
    var url = state.apiUri + '/search/v2/indices/' + encodeURIComponent(state.index) + '/query'
      + '?token=' + encodeURIComponent(state.trackerKey);
    var body = {
      query: state.query,
      limit: state.pageSize,
      page: state.page,
      includeMeta: true,
      displayAttribute: cardAttributes(state.fields)
    };
    // clientUUID in the body (not the URL) lets the search API record item.search
    // server-side, so the storefront doesn't emit that event itself.
    if (uuid) body.clientUUID = uuid;
    if (state.showFacets) {
      body.facets = ['*'];          // all facetable attributes
      body.includeFacets = 'all';   // returns allFacets (+ filteredFacets)
    }
    var sortSpec = SORT_MAP[state.sort];
    if (sortSpec) {
      // Resolve the sort attribute from the configured field mapping so it matches
      // the merchant's index (e.g. "price.value"), not the default slot name.
      body.sortBy = state.fields[sortSpec.field];
      body.ordering = sortSpec.ordering;
    }
    var iql = buildFilterIql(state.filters);
    if (iql) body.filters = iql;

    return fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error('search_api_' + res.status);
      return res.json();
    }).then(function (json) {
      var data = (json && json.data) || [];
      state.totalResults = (json && json.meta && typeof json.meta.totalCount === 'number')
        ? json.meta.totalCount
        : data.length;
      state.facets = normalizeFacets(json && json.extras);
      state.correlationId = (json && json.extras && json.extras.correlationId) || '';

      if (!data.length && !append) {
        renderEmpty(state);
        return;
      }

      state.els.empty.hidden = true;
      if (!append) state.results = [];
      state.results = state.results.concat(data);
      renderGrid(state, data, append);
      renderFacets(state);
      updateLoadMore(state);
    }).catch(function () {
      // Network error or non-2xx: show a generic error in the grid area.
      if (!append) {
        renderEmpty(state);
        state.els.empty.textContent = 'Search is temporarily unavailable. Please try again.';
      }
      // For append: leave existing results in place; hide the load-more.
      state.els.loadmoreBtn.hidden = true;
    });
  }

  // ---- Events ----
  // item.search is recorded server-side (see performSearch); only the click is client-side.

  // Fires `item.search.click` via the SDK's dedicated helper. correlationId is
  // required by Synerise to attribute the click to its search; skip if absent.
  function fireSearchClick(state, slot) {
    if (!window.SR || !window.SR.event || typeof window.SR.event.itemSearchClick !== 'function') return;
    var itemId = slot.getAttribute('data-item-id');
    if (!itemId || !state.correlationId) return;
    window.SR.event.itemSearchClick({
      item: itemId,
      position: parseInt(slot.getAttribute('data-position'), 10),
      correlationId: state.correlationId,
      searchType: 'full-text-search'
    });
  }

  // ---- Event wiring ----

  function applyFilterChange(state) {
    state.page = 1;
    syncUrl(state);
    performSearch(state, false);
  }

  function wire(state) {
    // Sort.
    state.els.sortSelect.value = state.sort;
    state.els.sortSelect.addEventListener('change', function () {
      state.sort = state.els.sortSelect.value;
      state.page = 1;
      syncUrl(state);
      performSearch(state, false);
    });

    // Text facets — checkbox toggles (delegated change).
    state.els.facets.addEventListener('change', function (ev) {
      var input = ev.target;
      if (!input || input.type !== 'checkbox') return;
      var name = input.getAttribute('data-facet-name');
      var val = input.getAttribute('data-facet-value');
      if (!name || val == null) return;
      var cur = (state.filters[name] && state.filters[name].type === 'text')
        ? state.filters[name].values.slice() : [];
      if (input.checked) { if (cur.indexOf(val) === -1) cur.push(val); }
      else { cur = cur.filter(function (v) { return v !== val; }); }
      if (cur.length) state.filters[name] = { type: 'text', values: cur };
      else delete state.filters[name];
      applyFilterChange(state);
    });

    // Range Apply + clear buttons (delegated click).
    state.els.facets.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('snr-facet-range__apply')) {
        var box = t.closest('.snr-facet');
        var name = box.getAttribute('data-facet-name');
        var minEl = box.querySelector('.snr-facet-range__min');
        var maxEl = box.querySelector('.snr-facet-range__max');
        var min = minEl.value !== '' && isFinite(Number(minEl.value)) ? Number(minEl.value) : null;
        var max = maxEl.value !== '' && isFinite(Number(maxEl.value)) ? Number(maxEl.value) : null;
        if (min == null && max == null) delete state.filters[name];
        else state.filters[name] = { type: 'range', min: min, max: max };
        applyFilterChange(state);
      } else if (t.classList.contains('snr-facet-clear')) {
        delete state.filters[t.getAttribute('data-facet-name')];
        applyFilterChange(state);
      } else if (t.classList.contains('snr-facet-clear-all')) {
        state.filters = {};
        applyFilterChange(state);
      }
    });

    // Load more.
    state.els.loadmoreBtn.addEventListener('click', function () {
      state.page = state.page + 1;
      performSearch(state, true);
    });

    // Grid click — delegated.
    state.els.grid.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== state.els.grid) {
        if (node.classList && node.classList.contains('snr-search-page__slot')) {
          fireSearchClick(state, node);
          return;
        }
        node = node.parentNode;
      }
    });
  }

  // ---- Initialization ----

  function initRoot(root) {
    // The block emits its own <script src>, so the script may run once per block
    // on the page and the theme editor re-emits section:load; init each root once.
    if (root.__snrSearchInitialized) return;
    root.__snrSearchInitialized = true;

    var state = newState(root);
    if (!state.trackerKey || !state.apiUri || !state.index) return;

    var parsed = parseUrl();
    state.query = parsed.query;
    state.sort = parsed.sort;
    state.filters = parsed.filters;

    // Guard against invalid sort values arriving via URL.
    var VALID_SORTS = ['relevance', 'price_asc', 'price_desc', 'name_asc', 'name_desc'];
    if (VALID_SORTS.indexOf(state.sort) === -1) state.sort = 'relevance';

    buildSkeleton(state);
    renderTitle(state);
    wire(state);

    if (!state.query) {
      renderEmpty(state);
      return;
    }

    performSearch(state, false);
  }

  // `scope` defaults to the document; the theme editor passes the re-rendered
  // section element so only its roots are (re)initialized.
  function initAll(scope) {
    var container = scope && typeof scope.querySelectorAll === 'function'
      ? scope
      : (typeof document !== 'undefined' ? document : null);
    if (!container) return;
    var roots = container.querySelectorAll(ROOT_SELECTOR);
    for (var i = 0; i < roots.length; i++) initRoot(roots[i]);
  }

  // The theme editor re-renders a section's HTML on every settings change
  // without re-running its scripts; it emits shopify:section:load instead.
  function onSectionLoad(event) {
    initAll(event && event.target);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { initAll(); });
    } else {
      initAll();
    }
    document.addEventListener('shopify:section:load', onSectionLoad);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      detectFacetType: detectFacetType,
      buildFilterIql: buildFilterIql,
      normalizeFacets: normalizeFacets,
      parseFilterValue: parseFilterValue,
      serializeFilter: serializeFilter,
      cardAttributes: cardAttributes,
      renderGrid: renderGrid,
      parseExtraAttributes: SNRUtils.parseExtraAttributes,
      initRoot: initRoot,
      initAll: initAll,
      onSectionLoad: onSectionLoad
    };
  }
})();

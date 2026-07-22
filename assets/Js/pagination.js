/* ============================================================
   FINWISE — Shared pagination helper
   Renders a numbered pager (prev · 1 … n · next) into a container
   and calls back with the chosen page. Pure UI: the caller owns the
   data, decides page size, and re-renders its own rows. Reused by the
   Transactions table and the Dashboard "Recent Transactions" list so
   both look and behave identically.

   Usage:
     FinwisePagination.render(containerEl, {
       total: 42,        // total item count
       perPage: 10,
       current: 1,       // 1-based current page
       onGo: function (page) { ... }   // called when a page is picked
     });

   Behavior:
     • Auto-derives page count from total/perPage, so new pages appear
       as the data grows — no manual page list to maintain.
     • Collapses long ranges with an ellipsis (always shows first, last,
       and a window around the current page).
     • Hides itself entirely when there's only one page (nothing to do).
   ============================================================ */
(function () {
  "use strict";

  /* Build the list of page tokens to show: numbers and "…" gaps.
     Always includes 1 and last; keeps a ±1 window around current. */
  function pageTokens(current, totalPages) {
    var tokens = [];
    var window = 1; // pages on each side of current
    var last = totalPages;
    var pushed = {};
    function add(p) { if (p >= 1 && p <= last && !pushed[p]) { pushed[p] = true; tokens.push(p); } }

    add(1);
    for (var p = current - window; p <= current + window; p++) add(p);
    add(last);

    // Sort numerically, then insert ellipsis markers where there are gaps.
    tokens.sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      if (i > 0 && tokens[i] - tokens[i - 1] > 1) out.push("…");
      out.push(tokens[i]);
    }
    return out;
  }

  function render(container, opts) {
    if (!container) return;
    opts = opts || {};
    var total = Math.max(0, Number(opts.total) || 0);
    var perPage = Math.max(1, Number(opts.perPage) || 10);
    var totalPages = Math.max(1, Math.ceil(total / perPage));
    var current = Math.min(Math.max(1, Number(opts.current) || 1), totalPages);
    var onGo = typeof opts.onGo === "function" ? opts.onGo : function () {};

    // One page (or empty): nothing to paginate.
    if (totalPages <= 1) { container.innerHTML = ""; container.hidden = true; return; }
    container.hidden = false;

    var html = '<button type="button" class="pager__btn" data-go="' + (current - 1) + '"' +
      (current === 1 ? " disabled" : "") + ' aria-label="Previous page">' +
      '<span class="material-symbols-outlined" style="font-size:20px">chevron_left</span></button>';

    pageTokens(current, totalPages).forEach(function (tok) {
      if (tok === "…") { html += '<span class="pager__ellipsis">…</span>'; return; }
      html += '<button type="button" class="pager__btn' + (tok === current ? " active" : "") +
        '" data-go="' + tok + '"' + (tok === current ? ' aria-current="page"' : "") + '>' + tok + '</button>';
    });

    html += '<button type="button" class="pager__btn" data-go="' + (current + 1) + '"' +
      (current === totalPages ? " disabled" : "") + ' aria-label="Next page">' +
      '<span class="material-symbols-outlined" style="font-size:20px">chevron_right</span></button>';

    container.innerHTML = html;
    container.classList.add("pager");

    // Delegate clicks once per render (innerHTML replaced each time, so old
    // listeners are discarded with the old nodes).
    container.onclick = function (e) {
      var btn = e.target.closest("[data-go]");
      if (!btn || btn.disabled) return;
      var page = Number(btn.getAttribute("data-go"));
      if (page >= 1 && page <= totalPages && page !== current) onGo(page);
    };
  }

  window.FinwisePagination = { render: render };
})();

/* ============================================================
   FINWISE — Shared transaction store
   A tiny localStorage-backed store so a transaction saved on the
   Add Transaction page shows up everywhere (Transactions table,
   Dashboard totals + recent list, charts) — updating LIVE, without
   a page refresh.

   How "live" works:
     • add() persists, then broadcasts a `finwise:change` event on
       window. Every page re-renders on that event.
     • A `storage` listener catches saves made in OTHER tabs/pages,
       so an open Dashboard reflects a transaction added elsewhere.
   Renders are idempotent: each one removes the rows it previously
   injected before inserting again, so repeated renders never stack.

   Load this BEFORE page-specific scripts (e.g. transactions.js) so
   injected rows exist before those scripts cache the DOM.
   ============================================================ */
(function () {
  "use strict";

  var KEY = "finwise.transactions";
  var EVT = "finwise:change";

  var BASE = { balance: 284350, income: 98200, expense: 42650, count: 47 };

  /* Dashboard "Recent Transactions" list: paginated 10/page with its own
     search box. State lives here so re-renders (on add/edit/delete) preserve
     the page and query. */
  var DASH_PER_PAGE = 10;
  var dashPage = 1;
  var dashQuery = "";

  /* ---- Smart category → icon resolver ----
     One ordered rule table drives BOTH the emoji (Categories page, Add
     Transaction chips) and the Material Symbol (Dashboard recent list,
     Transactions table), so a newly-added category gets a relevant icon
     that stays visually consistent everywhere. Rules are matched top-down
     (first hit wins), so put more specific categories before general ones.
     Each rule: { keywords, emoji, icon }. Keywords match a category name by
     whole token, prefix (handles plurals: "grocer" → "groceries"), or, when
     hyphenated, as a phrase substring ("home-improvement"). */
  var CATEGORY_RULES = [
    // Income
    { keywords: ["salary", "payroll", "wage", "wages", "paycheck", "stipend"], emoji: "💰", icon: "payments" },
    { keywords: ["freelance", "freelancer", "contract", "gig", "client", "consult", "consulting"], emoji: "👨‍💻", icon: "work" },
    { keywords: ["dividend", "dividends", "stock", "stocks", "share", "shares", "equity", "trading", "crypto", "bitcoin", "portfolio", "invest", "investment"], emoji: "📈", icon: "trending_up" },
    { keywords: ["saving", "savings", "deposit", "emergency-fund"], emoji: "🏦", icon: "savings" },
    { keywords: ["refund", "cashback", "reimburse", "reimbursement", "bonus"], emoji: "💸", icon: "payments" },
    // Specific nouns first — these win over the broader groups below when a
    // name contains two matchable words (e.g. "Car Insurance", "Dog Food").
    { keywords: ["insurance", "premium"], emoji: "🛡️", icon: "shield" },
    { keywords: ["pet", "pets", "dog", "cat", "vet", "veterinary", "kitten", "puppy"], emoji: "🐕", icon: "pets" },
    { keywords: ["fitness", "gym", "workout", "exercise", "sport", "sports", "yoga"], emoji: "🏋️", icon: "fitness_center" },
    { keywords: ["coffee", "cafe", "tea", "espresso", "latte", "starbucks"], emoji: "☕", icon: "local_cafe" },
    { keywords: ["fuel", "petrol", "gasoline", "diesel"], emoji: "⛽", icon: "local_gas_station" },
    // Housing & food
    { keywords: ["rent", "mortgage", "housing", "landlord", "lease"], emoji: "🏠", icon: "home" },
    { keywords: ["grocer", "grocery", "groceries", "supermarket", "mart"], emoji: "🛒", icon: "shopping_cart" },
    { keywords: ["restaurant", "dining", "dinner", "lunch", "breakfast", "meal", "meals", "food", "eat", "takeout", "snack", "snacks"], emoji: "🍱", icon: "restaurant" },
    { keywords: ["bar", "pub", "alcohol", "beer", "wine", "drinks", "liquor"], emoji: "🍻", icon: "local_bar" },
    // Transport & travel
    { keywords: ["transport", "commute", "taxi", "uber", "cab", "bus", "train", "metro", "subway", "parking", "toll", "car", "vehicle", "ride"], emoji: "🚗", icon: "commute" },
    { keywords: ["flight", "flights", "airline", "airfare", "travel", "trip", "vacation", "holiday", "hotel", "airbnb", "lodging"], emoji: "✈️", icon: "flight" },
    // Financial obligations
    { keywords: ["tax", "taxes", "vat"], emoji: "🧾", icon: "receipt_long" },
    { keywords: ["loan", "debt", "emi", "installment", "repayment"], emoji: "🏦", icon: "account_balance" },
    { keywords: ["subscription", "subscribe"], emoji: "🔁", icon: "autorenew" },
    // Bills & utilities
    { keywords: ["electric", "electricity", "utility", "utilities", "water", "power", "bill", "bills"], emoji: "⚡", icon: "bolt" },
    { keywords: ["internet", "wifi", "broadband", "phone", "mobile", "telecom", "data"], emoji: "📶", icon: "wifi" },
    // Lifestyle
    { keywords: ["entertain", "entertainment", "movie", "movies", "cinema", "netflix", "film", "game", "gaming", "music", "spotify", "concert", "streaming"], emoji: "🎬", icon: "movie" },
    { keywords: ["shopping", "clothes", "clothing", "fashion", "apparel", "shoes", "mall", "retail", "tailor", "tailoring", "stitching", "boutique", "dress"], emoji: "🛍️", icon: "shopping_bag" },
    { keywords: ["health", "medical", "doctor", "hospital", "clinic", "pharmacy", "medicine", "dental", "dentist", "therapy"], emoji: "🏥", icon: "medical_services" },
    { keywords: ["beauty", "salon", "haircut", "spa", "cosmetic", "cosmetics", "makeup", "barber"], emoji: "💇", icon: "spa" },
    { keywords: ["kid", "kids", "child", "children", "childcare", "baby", "daycare", "toy", "toys"], emoji: "🧸", icon: "child_care" },
    { keywords: ["education", "school", "tuition", "course", "class", "book", "books", "university", "college", "student", "learning", "udemy"], emoji: "🎓", icon: "school" },
    { keywords: ["gift", "gifts", "present", "donation", "donate", "charity"], emoji: "🎁", icon: "redeem" },
    { keywords: ["business", "office", "work", "supplies", "equipment"], emoji: "💼", icon: "work" },
    { keywords: ["home-improvement", "furniture", "repair", "maintenance", "tools", "hardware"], emoji: "🛠️", icon: "handyman" },
    { keywords: ["misc", "other", "general", "uncategorized"], emoji: "🏷️", icon: "sell" }
  ];
  var DEFAULT_ICON = { emoji: "🏷️", icon: "sell" };

  /* Exact-name canon for the built-in Add Transaction category chips. A
     category saved from one of those chips resolves to the identical icon
     everywhere else (Dashboard recent list, Transactions table, Categories
     page), keeping the Add Transaction page the single visual reference. */
  var CHIP_CANONICAL = {
    food: { emoji: "🍱", icon: "restaurant" },
    housing: { emoji: "🏠", icon: "home" },
    transport: { emoji: "🚗", icon: "commute" },
    shopping: { emoji: "🛍️", icon: "shopping_bag" },
    entertain: { emoji: "🎬", icon: "movie" },
    health: { emoji: "🏥", icon: "medical_services" },
    bills: { emoji: "🧾", icon: "payments" }
  };

  /* Resolve a category name/slug to its { emoji, icon } pair. */
  function resolveCategory(name) {
    var s = slug(name);
    if (!s) return DEFAULT_ICON;
    if (CHIP_CANONICAL[s]) return CHIP_CANONICAL[s];
    var tokens = s.split("-");
    for (var i = 0; i < CATEGORY_RULES.length; i++) {
      var rule = CATEGORY_RULES[i];
      for (var j = 0; j < rule.keywords.length; j++) {
        var k = rule.keywords[j];
        if (k.indexOf("-") !== -1) {          // multi-word keyword → phrase match
          if (s.indexOf(k) !== -1) return rule;
          continue;
        }
        for (var t = 0; t < tokens.length; t++) {
          var tok = tokens[t];
          if (!tok) continue;
          if (tok === k) return rule;
          // Prefix match (min 4 chars) absorbs plurals / minor variants.
          if (Math.min(tok.length, k.length) >= 4 && (tok.indexOf(k) === 0 || k.indexOf(tok) === 0)) return rule;
        }
      }
    }
    return DEFAULT_ICON;
  }

  /* Palette for the data-driven expense donut (cycled per category). */
  var DONUT_COLORS = ["var(--danger)", "var(--accent)", "var(--warning)", "var(--success)", "var(--text-muted)"];

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  /* Returns true on success, false if persistence failed (e.g. the
     localStorage quota was exceeded by a large receipt image). */
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function slug(s) {
    return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function iconFor(categoryKey) {
    return resolveCategory(categoryKey).icon;
  }
  function formatAmount(n) {
    // Indian grouping to match the balance card (e.g. 2,84,350).
    return Number(n).toLocaleString("en-IN");
  }
  function formatDate(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    if (isNaN(d)) return iso;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[d.getMonth()] + " " + String(d.getDate()).padStart(2, "0") + ", " + d.getFullYear();
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var Store = {
    getAll: function () {
      // Newest first.
      return read().slice().sort(function (a, b) {
        return (b.date || "").localeCompare(a.date || "") || (b.id - a.id);
      });
    },
    add: function (tx) {
      var list = read();
      tx.id = Date.now();
      tx.amount = Math.abs(Number(tx.amount) || 0);
      tx.categoryKey = tx.categoryKey || slug(tx.category);
      list.push(tx);
      if (!write(list)) return null;         // quota/persist failure — signal caller
      Store.broadcast();
      return tx;
    },
    clear: function () { write([]); Store.broadcast(); },
    /* Fetch one transaction by id (newest-first order not needed here). */
    get: function (id) {
      return read().filter(function (t) { return String(t.id) === String(id); })[0] || null;
    },
    /* Update an existing transaction in place. Only the keys present in
       `patch` are changed; pass receipt:null to explicitly clear it. Returns
       the updated entry, or null if not found / persistence failed. */
    update: function (id, patch) {
      var list = read(), found = null;
      list.forEach(function (t) {
        if (String(t.id) !== String(id)) return;
        if (patch.type != null) t.type = patch.type;
        if (patch.amount != null) t.amount = Math.abs(Number(patch.amount) || 0);
        if (patch.description != null) t.description = patch.description;
        if (patch.category != null) { t.category = patch.category; t.categoryKey = slug(patch.category); }
        if (patch.payment != null) t.payment = patch.payment;
        if (patch.date != null) t.date = patch.date;
        if (patch.recurring != null) t.recurring = patch.recurring;
        if ("receipt" in patch) t.receipt = patch.receipt;
        found = t;
      });
      if (!found) return null;
      if (!write(list)) return null;
      Store.broadcast();
      return found;
    },
    /* Delete one transaction by id. Returns true if a row was removed. */
    remove: function (id) {
      var list = read();
      var next = list.filter(function (t) { return String(t.id) !== String(id); });
      if (next.length === list.length) return false;
      if (!write(next)) return false;
      Store.broadcast();
      return true;
    },
    /* Notify this page (and, via storage, other tabs) that data changed. */
    broadcast: function () {
      try { window.dispatchEvent(new CustomEvent(EVT)); } catch (e) {}
    },
    summary: function () {
      var inc = 0, exp = 0, list = read();
      list.forEach(function (t) {
        if (t.type === "income") inc += Math.abs(+t.amount || 0);
        else exp += Math.abs(+t.amount || 0);
      });
      return {
        addedIncome: inc,
        addedExpense: exp,
        count: list.length,
        income: BASE.income + inc,
        expense: BASE.expense + exp,
        balance: BASE.balance + inc - exp,
        txCount: BASE.count + list.length
      };
    },
    // Expose helpers for pages that render their own rows.
    icon: iconFor,
    resolve: resolveCategory,
    slug: slug,
    /* Total expense amount for a given category, matched by slug so a budget
       named "Groceries" picks up transactions categorised "groceries",
       "Grocery", etc. Income is ignored. Used by the budgets engine. */
    spentForCategory: function (name) {
      var key = slug(name), total = 0;
      read().forEach(function (t) {
        if (t.type === "income") return;
        if ((t.categoryKey || slug(t.category)) === key) total += Math.abs(+t.amount || 0);
      });
      return total;
    },
    fmtAmount: formatAmount,
    fmtDate: formatDate
  };

  /* ---- Render: Transactions page table (prepend stored rows) ---- */
  function renderTxTable() {
    var body = document.getElementById("tx-body");
    if (!body) return;
    // Idempotent: clear rows we injected on a previous render.
    Array.prototype.slice.call(body.querySelectorAll("tr[data-store-injected]"))
      .forEach(function (r) { r.remove(); });

    var frag = document.createDocumentFragment();
    Store.getAll().forEach(function (t) {
      var income = t.type === "income";
      var signed = (income ? "+" : "-") + "PKR " + formatAmount(t.amount);
      var tr = document.createElement("tr");
      tr.setAttribute("data-tx", "");
      tr.setAttribute("data-store-injected", "");
      tr.setAttribute("data-id", t.id);
      tr.setAttribute("data-type", t.type);
      tr.setAttribute("data-category", t.categoryKey || slug(t.category));
      tr.setAttribute("data-date", t.date || "");
      tr.setAttribute("data-amount", (income ? "" : "-") + t.amount);
      tr.innerHTML =
        '<td class="mono">' + escapeHtml(formatDate(t.date)) + '</td>' +
        '<td><p style="font-weight:600">' + escapeHtml(t.description || "Transaction") + '</p>' +
        '<p class="faint" style="font-size:12px">' + escapeHtml(t.payment || "") + '</p></td>' +
        '<td><span class="chip">' + escapeHtml(t.category || "Other") + '</span></td>' +
        '<td><span class="badge badge--' + (income ? "success" : "danger") + ' type-badge">' + (income ? "Income" : "Expense") + '</span></td>' +
        '<td class="text-right mono ' + (income ? "text-success" : "text-danger") + '" style="font-weight:600">' + signed + '</td>' +
        '<td class="text-right" style="white-space:nowrap">' +
          (t.receipt ? '<button type="button" class="row-action row-action--receipt material-symbols-outlined" data-receipt aria-label="View receipt" title="View receipt">receipt_long</button>' : '') +
          '<a class="row-action row-action--edit material-symbols-outlined" href="add-transaction.html?edit=' + encodeURIComponent(t.id) + '" aria-label="Edit transaction" title="Edit">edit</a>' +
          '<button type="button" class="row-action row-action--delete material-symbols-outlined" data-delete aria-label="Delete transaction" title="Delete">delete</button>' +
        '</td>';
      frag.appendChild(tr);
    });
    body.insertBefore(frag, body.firstChild);
  }

  /* ---- Render: Dashboard totals + recent list + expense donut ---- */
  function renderDashboard() {
    var s = Store.summary();
    var bal = document.getElementById("db-balance");
    var inc = document.getElementById("db-income");
    var exp = document.getElementById("db-expense");
    var cnt = document.getElementById("db-count");
    if (bal) bal.textContent = "PKR " + formatAmount(s.balance);
    if (inc) inc.textContent = "PKR " + formatAmount(s.income);
    if (exp) exp.textContent = "PKR " + formatAmount(s.expense);
    if (cnt) cnt.textContent = String(s.txCount);

    renderRecentList();
    renderDonut();
    renderTrend();
  }

  /* ---- Render: Dashboard "Recent Transactions" (paginated + searchable) ----
     store.js fully owns this list: while the user has no stored transactions
     we leave the static demo rows in place; once they add any, we replace the
     demo rows with their real transactions, 10 per page, filtered by the
     dashboard search box. Re-runs on every finwise:change so it stays live. */
  function renderRecentList() {
    var body = document.getElementById("dash-tx-body");
    if (!body) return;

    var all = Store.getAll();
    var demoRows = Array.prototype.slice.call(body.querySelectorAll("tr[data-demo-row]"));
    var emptyRow = body.querySelector("tr[data-dash-empty]");
    var pager = document.getElementById("dash-tx-pagination");

    // No stored transactions yet — keep the demo rows, no pager.
    if (!all.length) {
      demoRows.forEach(function (r) { r.hidden = false; });
      if (emptyRow) emptyRow.hidden = true;
      if (pager) { pager.innerHTML = ""; pager.hidden = true; }
      return;
    }
    // Have real data — hide the demo rows for good.
    demoRows.forEach(function (r) { r.hidden = true; });

    // Filter by the dashboard search query (description / category / amount).
    var q = dashQuery.trim().toLowerCase();
    var terms = q ? q.split(/\s+/).filter(Boolean) : [];
    var matched = all.filter(function (t) {
      if (!terms.length) return true;
      var hay = ((t.description || "") + " " + (t.category || "") + " " + t.amount + " " + (t.type || "")).toLowerCase();
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    });

    // Clear previously-injected rows.
    Array.prototype.slice.call(body.querySelectorAll("tr[data-store-injected]"))
      .forEach(function (r) { r.remove(); });

    // Empty-state (search matched nothing).
    if (emptyRow) emptyRow.hidden = matched.length !== 0;

    var totalPages = Math.max(1, Math.ceil(matched.length / DASH_PER_PAGE));
    if (dashPage > totalPages) dashPage = totalPages;
    var start = (dashPage - 1) * DASH_PER_PAGE;
    var slice = matched.slice(start, start + DASH_PER_PAGE);

    var frag = document.createDocumentFragment();
    slice.forEach(function (t) {
      var income = t.type === "income";
      var signed = (income ? "+" : "-") + "PKR " + formatAmount(t.amount);
      var tr = document.createElement("tr");
      tr.setAttribute("data-store-injected", "");
      tr.innerHTML =
        '<td><div class="row gap-3"><div class="tile-icon" style="width:40px;height:40px;border-radius:var(--r-full)">' +
        '<span class="material-symbols-outlined filled-icon">' + iconFor(t.categoryKey || slug(t.category)) + '</span></div>' +
        '<span style="font-weight:600">' + escapeHtml(t.description || "Transaction") + '</span></div></td>' +
        '<td><span class="badge badge--neutral">' + escapeHtml(t.category || "Other") + '</span></td>' +
        '<td class="muted">' + escapeHtml(formatDate(t.date)) + '</td>' +
        '<td class="text-right mono ' + (income ? "text-success" : "text-danger") + '" style="font-weight:700">' + signed + '</td>';
      frag.appendChild(tr);
    });
    // Insert before the empty-state row so it stays last.
    if (emptyRow) body.insertBefore(frag, emptyRow);
    else body.appendChild(frag);

    // Pager.
    if (pager && window.FinwisePagination) {
      FinwisePagination.render(pager, {
        total: matched.length,
        perPage: DASH_PER_PAGE,
        current: dashPage,
        onGo: function (page) { dashPage = page; renderRecentList(); }
      });
    }
  }

  /* Wire the dashboard search box to the recent list (once). */
  function initDashSearch() {
    var input = document.querySelector('[data-search-input="dash-tx"]');
    var clear = document.querySelector('[data-search-clear="dash-tx"]');
    if (!input || input._finwiseWired) return;
    input._finwiseWired = true;
    input.addEventListener("input", function () {
      dashQuery = input.value || "";
      dashPage = 1;
      if (clear) clear.hidden = input.value === "";
      renderRecentList();
    });
    if (clear) clear.addEventListener("click", function () {
      input.value = ""; dashQuery = ""; dashPage = 1; clear.hidden = true;
      input.focus(); renderRecentList();
    });
  }

  /* ---- Render: Income vs Expenses trend (last 6 months, live) ----
     Rebuilds both line paths + their gradient fills from the user's real
     monthly income/expense totals (base demo figures folded into the current
     month), and relabels the x-axis with the actual months. Updates on every
     finwise:change, so adding/editing/deleting a transaction reshapes the
     chart instantly with no refresh. */
  function renderTrend() {
    var svg = document.getElementById("trend-chart");
    if (!svg) return;
    var labelsWrap = document.getElementById("trend-labels");

    var now = new Date();
    var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // Build the last 6 month buckets (oldest → newest).
    var buckets = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ year: d.getFullYear(), month: d.getMonth(), label: MON[d.getMonth()], income: 0, expense: 0 });
    }
    // Fold the demo baseline into the current (newest) month so the chart is
    // never empty and stored transactions visibly move it.
    buckets[buckets.length - 1].income += BASE.income;
    buckets[buckets.length - 1].expense += BASE.expense;

    read().forEach(function (t) {
      var amt = Math.abs(+t.amount || 0);
      var d = t.date ? new Date(t.date) : null;
      var target = null;
      if (d && !isNaN(d)) {
        for (var b = 0; b < buckets.length; b++) {
          if (buckets[b].year === d.getFullYear() && buckets[b].month === d.getMonth()) { target = buckets[b]; break; }
        }
      } else {
        target = buckets[buckets.length - 1]; // undated → current month
      }
      if (!target) return; // outside the 6-month window
      if (t.type === "income") target.income += amt;
      else target.expense += amt;
    });

    // Scale to the SVG viewBox (600×200) with vertical padding.
    var W = 600, H = 200, padTop = 20, padBottom = 30;
    var max = 1;
    buckets.forEach(function (b) { max = Math.max(max, b.income, b.expense); });
    var n = buckets.length;
    function x(i) { return n === 1 ? W / 2 : (i / (n - 1)) * W; }
    function y(v) { return H - padBottom - (v / max) * (H - padTop - padBottom); }

    // Smooth-ish polyline (straight segments keep it readable and honest).
    function linePath(key) {
      return buckets.map(function (b, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(b[key]).toFixed(1); }).join(" ");
    }
    function areaPath(key) {
      return linePath(key) + " L" + x(n - 1).toFixed(1) + " " + H + " L" + x(0).toFixed(1) + " " + H + " Z";
    }

    var defs =
      '<defs>' +
      '<linearGradient id="incomeGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--success)"></stop><stop offset="100%" stop-color="var(--success)" stop-opacity="0"></stop></linearGradient>' +
      '<linearGradient id="expenseGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--danger)"></stop><stop offset="100%" stop-color="var(--danger)" stop-opacity="0"></stop></linearGradient>' +
      '</defs>';
    svg.innerHTML = defs +
      '<path style="opacity:.12" d="' + areaPath("income") + '" fill="url(#incomeGradient)"></path>' +
      '<path style="opacity:.12" d="' + areaPath("expense") + '" fill="url(#expenseGradient)"></path>' +
      '<path style="opacity:.9" d="' + linePath("income") + '" fill="none" stroke="var(--success)" stroke-width="3" stroke-linejoin="round"></path>' +
      '<path style="opacity:.9" d="' + linePath("expense") + '" fill="none" stroke="var(--danger)" stroke-width="3" stroke-linejoin="round"></path>';

    if (labelsWrap) {
      labelsWrap.innerHTML = buckets.map(function (b) {
        return '<span class="eyebrow">' + b.label + '</span>';
      }).join("");
    }
  }

  /* ---- Render: data-driven expense-breakdown donut (dashboard) ----
     Rebuilds the ring + legend from the user's own stored expenses.
     Left untouched (keeps the static demo) when nothing is stored yet
     or the donut markup isn't on this page. */
  function renderDonut() {
    var svg = document.getElementById("donut-ring");
    var legend = document.getElementById("donut-legend");
    var totalEl = document.getElementById("donut-total");
    if (!svg || !legend) return;

    var byCat = {};
    read().forEach(function (t) {
      if (t.type === "income") return;
      var name = t.category || "Other";
      byCat[name] = (byCat[name] || 0) + Math.abs(+t.amount || 0);
    });
    var cats = Object.keys(byCat).map(function (k) { return { name: k, value: byCat[k] }; });
    if (!cats.length) return; // no stored expenses — keep the demo donut

    cats.sort(function (a, b) { return b.value - a.value; });
    // Keep the top 4, roll the rest into "Others".
    if (cats.length > 5) {
      var others = cats.slice(4).reduce(function (sum, c) { return sum + c.value; }, 0);
      cats = cats.slice(0, 4);
      cats.push({ name: "Others", value: others });
    }
    var total = cats.reduce(function (sum, c) { return sum + c.value; }, 0);

    var C = 251.2; // 2·π·r, r = 40
    var offset = 0;
    var rings = '<circle cx="50" cy="50" fill="transparent" r="40" stroke="var(--surface-3)" stroke-width="12"></circle>';
    cats.forEach(function (c, i) {
      var frac = total ? c.value / total : 0;
      var len = frac * C;
      var color = DONUT_COLORS[i % DONUT_COLORS.length];
      // Draw each arc as a dash of `len`, rotated to sit after the previous ones.
      rings += '<circle cx="50" cy="50" fill="transparent" r="40" stroke="' + color +
        '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
        '" transform="rotate(' + ((offset / C) * 360 - 90).toFixed(2) + ' 50 50)" stroke-width="12"></circle>';
      offset += len;
    });
    svg.innerHTML = rings;

    legend.innerHTML = cats.map(function (c, i) {
      var pct = total ? Math.round((c.value / total) * 100) : 0;
      var color = DONUT_COLORS[i % DONUT_COLORS.length];
      return '<div class="row-between"><div class="row gap-2">' +
        '<span class="legend-dot" style="background:' + color + '"></span>' +
        '<span style="font-size:14px">' + escapeHtml(c.name) + '</span></div>' +
        '<span style="font-weight:600;font-size:14px">' + pct + '%</span></div>';
    }).join("");

    if (totalEl) {
      totalEl.textContent = total >= 1000
        ? "PKR " + Math.round(total / 1000) + "k"
        : "PKR " + formatAmount(total);
    }
  }

  /* Re-render everything this page contains. Safe to call repeatedly. */
  function renderAll() {
    renderTxTable();
    renderDashboard();
    initDashSearch();
  }

  /* ============================================================
     Shared CATEGORY store
     Custom categories created on the Add Transaction page ("Other" +
     a typed name) or on the Categories page are persisted here and
     shared across both, live.
     ============================================================ */
  var CAT_KEY = "finwise.categories";
  var CAT_EVT = "finwise:categories";

  /* Emoji for a category name — resolved from the shared CATEGORY_RULES
     table so it stays in sync with the Material icon used elsewhere. */
  function emojiForCategory(name) {
    return resolveCategory(name).emoji;
  }

  function readCats() {
    try { return JSON.parse(localStorage.getItem(CAT_KEY)) || []; }
    catch (e) { return []; }
  }

  var Categories = {
    getAll: function () { return readCats(); },
    has: function (name) {
      var n = String(name || "").trim().toLowerCase();
      return readCats().some(function (c) { return c.name.toLowerCase() === n; });
    },
    /* Create a category. Returns the entry, or null if the name is blank,
       a duplicate, or persistence failed. Dedupe is case-insensitive. */
    add: function (cat) {
      if (!cat || !cat.name) return null;
      var name = String(cat.name).trim();
      if (!name) return null;
      var list = readCats();
      if (list.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) return null;
      var entry = {
        id: Date.now(),
        name: name,
        type: cat.type === "income" ? "income" : "expense",
        emoji: (cat.emoji && String(cat.emoji).trim()) || emojiForCategory(name)
      };
      list.push(entry);
      try { localStorage.setItem(CAT_KEY, JSON.stringify(list)); }
      catch (e) { return null; }
      try { window.dispatchEvent(new CustomEvent(CAT_EVT)); } catch (e) {}
      return entry;
    },
    /* Subscribe to category changes — same tab (custom event) and other
       tabs (native storage event). */
    onChange: function (fn) {
      window.addEventListener(CAT_EVT, fn);
      window.addEventListener("storage", function (e) { if (e.key === CAT_KEY) fn(); });
    },
    emojiFor: emojiForCategory,
    iconFor: iconFor,
    resolve: resolveCategory
  };

  // Initial paint. Runs synchronously (scripts sit at end of <body>, so the
  // DOM is ready) and must happen before transactions.js caches its rows.
  renderAll();

  // Live updates: same-page saves fire `finwise:change`; saves in other
  // tabs arrive via the native `storage` event.
  window.addEventListener(EVT, renderAll);
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) renderAll();
  });

  Store.render = renderAll;
  window.FinwiseStore = Store;
  window.FinwiseCategories = Categories;
})();

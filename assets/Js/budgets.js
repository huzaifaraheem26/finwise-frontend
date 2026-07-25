/* ============================================================
   FINWISE — Budgets engine (Budget page + Dashboard overview)
   Fully data-driven, persistent budgets that react to transactions live.

   Key behaviors:
     • Create / edit / delete budgets (localStorage-backed).
     • Each budget has: name, limit, base spent, period (monthly|yearly),
       alertsEnabled, threshold%.
     • EFFECTIVE SPENT = base spent + expense transactions whose category
       matches the budget name (by slug), within the budget's period window.
       So adding a transaction under a matching category (including a custom
       "Other" category) instantly updates the budget's spent, remaining,
       progress %, bar and status — here, on the Budget page, and on the
       Dashboard overview — with no refresh.
     • When alertsEnabled and effective spend reaches the threshold or the
       limit, the user gets an in-app (bell) notification. Alerts are deduped
       per budget+level.
     • Budget Alerts section lists budgets at/over threshold; each can be
       marked Reviewed.

   Mirrors store.js conventions: a small store object, a custom change event
   for same-page updates, and a `storage` listener for cross-tab sync. Also
   listens to `finwise:change` (transactions) so budgets recompute live.
   Reuses shared theme/components only (.card, .modal, .field, .progress,
   .badge, .alert-critical, window.finwiseConfirm, window.FinwiseNotify).
   ============================================================ */
(function () {
  "use strict";

  // Base names — the actual localStorage keys are `<BASE>:<uid>`, so User B on
  // the same browser never sees User A's budgets. When nobody is signed in,
  // keyFor()/sentKey() return null and read/write no-op.
  var BUDGET_BASE = "finwise.budgets";
  var SENT_BASE = "finwise.budgetAlertsSent";
  var EVT = "finwise:budgets";
  var TX_EVT = "finwise:change";       // fired by store.js on transaction changes
  var USER_EVT = "finwise:user-changed";
  var USER_KEY = "finwise:user";
  var DEFAULT_THRESHOLD = 80;

  function currentUid() {
    try {
      var u = JSON.parse(localStorage.getItem(USER_KEY)) || {};
      return u.uid || null;
    } catch (e) { return null; }
  }
  function scoped(base) {
    var uid = currentUid();
    return uid ? base + ":" + uid : null;
  }
  function budgetKey() { return scoped(BUDGET_BASE); }
  function sentKey() { return scoped(SENT_BASE); }
  function txKey() { return scoped("finwise.transactions"); }  // for storage listener

  /* When the FinwiseApi service is loaded AND the backend is reachable, every
     budget mutation is mirrored to the server (which then rebroadcasts via
     Socket.io to other tabs). Reads still come from the localStorage cache so
     rendering stays synchronous. On boot we hydrate the cache from the API,
     then re-render. Offline / no-backend: localStorage-only mode. */
  var API_READY = false;
  function apiReady() { return API_READY && !!window.FinwiseApi; }
  function apiCall(promise) {
    if (!promise || typeof promise.then !== "function") return;
    promise.then(function () {}, function (err) {
      console.warn("[budgets] API sync failed:", err && err.message);
    });
  }
  function fromApi(b) {
    if (!b) return null;
    return {
      id: b.id || b._id || Date.now(),
      name: b.category || b.name || "Budget",
      limit: Math.abs(Number(b.amount != null ? b.amount : b.limit) || 0),
      spent: 0,                     // computed live from transactions
      period: b.period === "yearly" ? "yearly" : "monthly",
      alertsEnabled: b.notifications !== false,
      threshold: 80,                // backend has no threshold field yet
      reviewedLevel: null
    };
  }

  /* Budgets start empty — the user creates their own. No seeded/demo data.
     Storage is uid-scoped: signed-out reads return [] and writes are dropped. */
  function read() {
    var k = budgetKey();
    if (!k) return [];
    try {
      var raw = localStorage.getItem(k);
      if (raw == null) return [];
      return JSON.parse(raw) || [];
    } catch (e) { return []; }
  }
  function write(list) {
    var k = budgetKey();
    if (!k) return false;
    try { localStorage.setItem(k, JSON.stringify(list)); }
    catch (e) { return false; }
    try { window.dispatchEvent(new CustomEvent(EVT)); } catch (e) {}
    return true;
  }

  function fmt(n) { return Number(n || 0).toLocaleString("en-IN"); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function slug(s) {
    return (window.FinwiseStore && FinwiseStore.slug)
      ? FinwiseStore.slug(s)
      : String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function iconFor(name) {
    return (window.FinwiseCategories && FinwiseCategories.iconFor)
      ? FinwiseCategories.iconFor(name) : "sell";
  }
  function thresholdOf(b) {
    var t = Number(b.threshold);
    return (t > 0 && t <= 100) ? t : DEFAULT_THRESHOLD;
  }

  /* ---- Calendar / month view state ----
     The Budget page has a month selector. `viewYear`/`viewMonth` are the
     month currently being viewed (default: the real current month). spentFor
     computes each budget's transaction contribution against this month, so
     navigating months re-scopes the whole page. The manual "spent so far"
     base is only counted when viewing the real current month (it represents
     present spending and carries no date). */
  var realNow = new Date();
  var viewYear = realNow.getFullYear();
  var viewMonth = realNow.getMonth();

  function isCurrentView() {
    return viewYear === realNow.getFullYear() && viewMonth === realNow.getMonth();
  }

  /* Effective spent = base (current month only) + matching expense
     transactions within the viewed month (monthly) or viewed year (yearly).
     Matched by category slug so a "Groceries" budget catches
     "grocery"/"Groceries" transactions. */
  function spentFor(b) {
    var base = isCurrentView() ? Math.abs(Number(b.spent) || 0) : 0;
    if (!window.FinwiseStore || !FinwiseStore.getAll) return base;
    var key = slug(b.name);
    var extra = 0;
    FinwiseStore.getAll().forEach(function (t) {
      if (t.type === "income") return;
      if ((t.categoryKey || slug(t.category)) !== key) return;
      if (t.date) {
        var d = new Date(t.date);
        if (!isNaN(d)) {
          if (d.getFullYear() !== viewYear) return;
          if (b.period !== "yearly" && d.getMonth() !== viewMonth) return;
        }
      } else if (!isCurrentView()) {
        // Undated transactions only count toward the current month view.
        return;
      }
      extra += Math.abs(+t.amount || 0);
    });
    return base + extra;
  }

  /* Does the viewed month have any stored transactions at all? Drives the
     "No data available for the selected month" state. The current month is
     always considered to have data (budgets + base spend live there). */
  function viewMonthHasData() {
    if (isCurrentView()) return true;
    if (!window.FinwiseStore || !FinwiseStore.getAll) return false;
    return FinwiseStore.getAll().some(function (t) {
      if (!t.date) return false;
      var d = new Date(t.date);
      return !isNaN(d) && d.getFullYear() === viewYear && d.getMonth() === viewMonth;
    });
  }

  /* over | warning (>= threshold) | ontrack, from effective spent. */
  function levelFor(b) {
    var spent = spentFor(b);
    var pct = b.limit > 0 ? (spent / b.limit) * 100 : 0;
    if (pct >= 100) return "over";
    if (pct >= thresholdOf(b)) return "warning";
    return "ontrack";
  }

  var Budgets = {
    getAll: function () { return read().slice(); },
    get: function (id) {
      return read().filter(function (b) { return String(b.id) === String(id); })[0] || null;
    },
    add: function (b) {
      if (!b || !b.name) return null;
      var list = read();
      var entry = {
        id: Date.now(),
        name: String(b.name).trim(),
        limit: Math.abs(Number(b.limit) || 0),
        spent: Math.abs(Number(b.spent) || 0),
        period: b.period === "yearly" ? "yearly" : "monthly",
        alertsEnabled: b.alertsEnabled !== false,
        threshold: thresholdOf(b),
        reviewedLevel: null
      };
      if (!entry.name || !entry.limit) return null;
      list.push(entry);
      if (!write(list)) return null;
      if (apiReady()) {
        var tempId = entry.id;
        apiCall(window.FinwiseApi.createBudget({
          category: entry.name,
          amount: entry.limit,
          period: entry.period,
          notifications: entry.alertsEnabled
        }).then(function (res) {
          var real = res && res.data;
          if (!real || !real.id) return;
          var l = read();
          for (var i = 0; i < l.length; i++) {
            if (String(l[i].id) === String(tempId)) { l[i].id = real.id; break; }
          }
          write(l);
        }));
      }
      return entry;
    },
    update: function (id, patch) {
      var list = read(), found = null;
      list.forEach(function (b) {
        if (String(b.id) !== String(id)) return;
        if (patch.name != null) b.name = String(patch.name).trim();
        if (patch.limit != null) b.limit = Math.abs(Number(patch.limit) || 0);
        if (patch.spent != null) b.spent = Math.abs(Number(patch.spent) || 0);
        if (patch.period != null) b.period = patch.period === "yearly" ? "yearly" : "monthly";
        if (patch.alertsEnabled != null) b.alertsEnabled = !!patch.alertsEnabled;
        if (patch.threshold != null) b.threshold = thresholdOf({ threshold: patch.threshold });
        if (patch.reviewedLevel !== undefined) b.reviewedLevel = patch.reviewedLevel;
        found = b;
      });
      if (!write(list)) return null;
      if (found && apiReady()) {
        var body = {};
        if (patch.name != null) body.category = String(patch.name).trim();
        if (patch.limit != null) body.amount = Math.abs(Number(patch.limit) || 0);
        if (patch.period != null) body.period = patch.period === "yearly" ? "yearly" : "monthly";
        if (patch.alertsEnabled != null) body.notifications = !!patch.alertsEnabled;
        // Only sync when there's something the backend cares about (skip
        // client-only fields like `reviewedLevel` / `threshold`).
        if (Object.keys(body).length) apiCall(window.FinwiseApi.updateBudget(id, body));
      }
      return found;
    },
    remove: function (id) {
      var list = read();
      var next = list.filter(function (b) { return String(b.id) !== String(id); });
      if (next.length === list.length) return false;
      if (!write(next)) return false;
      if (apiReady()) apiCall(window.FinwiseApi.deleteBudget(id));
      return true;
    },
    spentFor: spentFor,
    level: levelFor,
    threshold: thresholdOf
  };
  /* One-shot legacy migration: attach any un-namespaced blob left by an
     earlier build to the current user's scoped key, then drop the legacy one. */
  (function migrateLegacy() {
    var uid = currentUid();
    [BUDGET_BASE, SENT_BASE].forEach(function (base) {
      var legacy = localStorage.getItem(base);
      if (legacy == null) return;
      if (uid && localStorage.getItem(base + ":" + uid) == null) {
        try { localStorage.setItem(base + ":" + uid, legacy); } catch (e) {}
      }
      try { localStorage.removeItem(base); } catch (e) {}
    });
  })();

  window.FinwiseBudgets = Budgets;

  /* Hydrate from the backend when available. Preserves the user's local-only
     fields (threshold, reviewedLevel) across a refetch by merging on id. */
  function hydrateFromApi() {
    if (!window.FinwiseApi || !window.FinwiseApi.isReachable) return;
    window.FinwiseApi.isReachable().then(function (ok) {
      if (!ok) return;
      API_READY = true;
      window.FinwiseApi.listBudgets().then(function (res) {
        var remote = (res.data || []).map(fromApi).filter(Boolean);
        var local = read();
        var localById = {};
        local.forEach(function (b) { localById[String(b.id)] = b; });
        var merged = remote.map(function (r) {
          var l = localById[String(r.id)];
          if (l) {
            r.threshold = l.threshold != null ? l.threshold : r.threshold;
            r.reviewedLevel = l.reviewedLevel != null ? l.reviewedLevel : null;
            r.spent = l.spent || 0; // manual "spent so far" base is client-only
          }
          return r;
        });
        // Budgets created offline (local timestamp ids, unknown to the server):
        // keep them AND push them up so both sides converge.
        var remoteIds = {};
        remote.forEach(function (r) { remoteIds[String(r.id)] = true; });
        var remoteNames = {};
        remote.forEach(function (r) { remoteNames[r.name.toLowerCase()] = true; });
        local.forEach(function (l) {
          if (remoteIds[String(l.id)]) return;
          if (!/^\d{12,}$/.test(String(l.id))) return; // server id we no longer have — drop
          if (remoteNames[String(l.name || "").toLowerCase()]) return; // same category already on server
          merged.push(l);
          apiCall(window.FinwiseApi.createBudget({
            category: l.name, amount: l.limit, period: l.period,
            notifications: l.alertsEnabled !== false
          }).then(function (res) {
            var real = res && res.data;
            if (!real || !real.id) return;
            var cur = read();
            for (var i = 0; i < cur.length; i++) {
              if (String(cur[i].id) === String(l.id)) { cur[i].id = real.id; break; }
            }
            write(cur);
          }));
        });
        write(merged);
      }).catch(function (err) {
        console.warn("[budgets] hydrate failed:", err && err.message);
      });
    });
  }
  hydrateFromApi();


  /* ---- Alert dedupe -------------------------------------------------- */
  function readSent() {
    var k = sentKey();
    if (!k) return {};
    try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; }
  }
  function writeSent(o) {
    var k = sentKey();
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {}
  }

  /* Fire in-app alerts for a budget at a given level, once per level.
     Resets lower levels so a later breach re-alerts. */
  function fireAlerts(b, level) {
    var sent = readSent();
    var idKey = "b" + b.id;
    var record = sent[idKey] || {};

    if (level === "ontrack") {
      if (record.warning || record.over) { delete sent[idKey]; writeSent(sent); }
      return;
    }

    // Re-arm the "over" alert whenever we're merely at warning again.
    if (level === "warning" && record.over) { record.over = false; }

    if (record[level]) { sent[idKey] = record; writeSent(sent); return; } // already alerted

    var spent = spentFor(b);
    var title, text;
    if (level === "over") {
      title = "Over Budget: " + b.name;
      text = b.name + " has exceeded its " + b.period + " limit by PKR " + fmt(spent - b.limit) + ".";
    } else {
      title = "Budget alert: " + b.name;
      text = b.name + " has reached " + Math.round(spent / b.limit * 100) + "% of its PKR " + fmt(b.limit) + " limit.";
    }

    // In-app (bell) only — this build sends no email notifications.
    if (window.FinwiseNotify) {
      window.FinwiseNotify.add(
        { icon: level === "over" ? "warning" : "notification_important",
          type: level === "over" ? "danger" : "accent",
          title: title, text: text },
        { key: "budget-alert:" + b.id + ":" + level }
      );
    }

    record[level] = true;
    sent[idKey] = record;
    writeSent(sent);
  }

  /* ============================================================ Rendering */

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var grid = document.getElementById("budget-grid");           // Budget page
    var dashList = document.getElementById("dash-budget-list");  // Dashboard overview
    if (!grid && !dashList) return; // neither surface present

    function toast(msg, type) { if (window.showToast) window.showToast(msg, type); }

    /* Run alerts for every budget (dedupe makes this safe to call each render).
       Honors the master Budget Alerts switch (Settings page): when the user has
       turned it OFF, no threshold/over-budget notifications fire regardless of
       spend or per-budget settings. */
    function alertsMasterOn() {
      return !window.FinwiseSettings || window.FinwiseSettings.budgetAlertsEnabled();
    }
    function runAlerts(list) {
      if (!alertsMasterOn()) return;
      list.forEach(function (b) {
        if (!b.alertsEnabled) return;
        fireAlerts(b, levelFor(b));
      });
    }

    /* ---------- Budget page ---------- */
    if (grid) {
      var alertsWrap = document.getElementById("budget-alerts");
      var totalBudgetEl = document.getElementById("bd-total");
      var totalSpentEl = document.getElementById("bd-spent");
      var remainingEl = document.getElementById("bd-remaining");
      var spentBarEl = document.getElementById("bd-spent-bar");
      var remainingPctEl = document.getElementById("bd-remaining-pct");
      var emptyEl = document.getElementById("budget-empty");

      /* Calendar / month selector */
      var monthLabelEl = document.getElementById("budget-month-label");
      var prevMonthBtn = document.getElementById("budget-prev-month");
      var nextMonthBtn = document.getElementById("budget-next-month");
      var noDataEl = document.getElementById("budget-no-data");
      var noDataTextEl = document.getElementById("budget-no-data-text");
      var backCurrentBtn = document.getElementById("budget-back-current");
      var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
      function viewLabel() { return MONTH_NAMES[viewMonth] + " " + viewYear; }

      /* Modal (create / edit) */
      var modal = document.getElementById("budget-modal");
      var form = document.getElementById("budget-form");
      var titleEl = document.getElementById("budget-modal-title");
      var nameInput = document.getElementById("budget-name");
      var limitInput = document.getElementById("budget-limit");
      var spentInput = document.getElementById("budget-spent");
      var periodSeg = document.getElementById("budget-period");
      var alertsToggle = document.getElementById("budget-alerts-toggle");
      var thresholdWrap = document.getElementById("budget-threshold-wrap");
      var thresholdInput = document.getElementById("budget-threshold");
      var editingId = null;
      var selectedPeriod = "monthly";

      function setPeriod(p) {
        selectedPeriod = p === "yearly" ? "yearly" : "monthly";
        if (periodSeg) periodSeg.querySelectorAll(".segmented__btn").forEach(function (btn) {
          btn.classList.toggle("active", btn.getAttribute("data-period") === selectedPeriod);
        });
      }
      function syncThresholdVisibility() {
        if (thresholdWrap) thresholdWrap.hidden = !(alertsToggle && alertsToggle.checked);
      }

      function openModal(id) {
        editingId = id || null;
        var b = id ? Budgets.get(id) : null;
        titleEl.textContent = b ? "Edit Budget" : "New Budget";
        nameInput.value = b ? b.name : "";
        limitInput.value = b ? b.limit : "";
        // "Spent so far" now lives as a tagged seed transaction, not b.spent.
        // Show its current amount when editing so the field round-trips.
        spentInput.value = b ? seedAmountFor(b.id) : "";
        setPeriod(b ? b.period : "monthly");
        if (alertsToggle) alertsToggle.checked = b ? b.alertsEnabled !== false : true;
        if (thresholdInput) thresholdInput.value = b ? thresholdOf(b) : DEFAULT_THRESHOLD;
        syncThresholdVisibility();
        modal.classList.add("open");
        setTimeout(function () { nameInput.focus(); }, 50);
      }
      function closeModal() {
        modal.classList.remove("open");
        editingId = null;
        form.reset();
        setPeriod("monthly");
        syncThresholdVisibility();
      }

      document.querySelectorAll("[data-open-budget]").forEach(function (btn) {
        btn.addEventListener("click", function () { openModal(null); });
      });
      modal.addEventListener("click", function (e) {
        if (e.target === modal || e.target.closest("[data-budget-close]")) closeModal();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
      });
      if (periodSeg) periodSeg.addEventListener("click", function (e) {
        var btn = e.target.closest(".segmented__btn");
        if (btn) setPeriod(btn.getAttribute("data-period"));
      });
      if (alertsToggle) alertsToggle.addEventListener("change", syncThresholdVisibility);

      /* Back a budget's manual "Spent so far" value with a real expense
         transaction so it deducts from the Current Balance (which is computed
         purely from transactions). The transaction is tagged budgetSeed:<id>
         and categorised as the budget name, so it counts toward spentFor()
         exactly once (b.spent is kept at 0 to avoid double-counting) and the
         Dashboard / Budget / summary cards all update live via finwise:change.
         Editing the amount updates the same seed txn; clearing it removes it. */
      function seedAmountFor(budgetId) {
        if (!window.FinwiseStore || !FinwiseStore.getAll) return "";
        var amt = "";
        FinwiseStore.getAll().forEach(function (t) {
          if (String(t.budgetSeed) === String(budgetId)) amt = Math.abs(Number(t.amount) || 0);
        });
        return amt;
      }
      function reconcileBudgetSeed(budgetId, budgetName, amount) {
        if (!window.FinwiseStore || !FinwiseStore.getAll) return;
        amount = Math.abs(Number(amount) || 0);
        var existing = null;
        FinwiseStore.getAll().forEach(function (t) {
          if (String(t.budgetSeed) === String(budgetId)) existing = t;
        });
        if (amount > 0) {
          if (existing) {
            FinwiseStore.update(existing.id, {
              amount: amount, category: budgetName,
              description: "Budget: " + budgetName
            });
          } else {
            FinwiseStore.add({
              type: "expense", amount: amount,
              description: "Budget: " + budgetName,
              category: budgetName, payment: "Transfer",
              date: new Date().toISOString().slice(0, 10),
              receipt: null, budgetSeed: budgetId
            });
          }
        } else if (existing) {
          FinwiseStore.remove(existing.id);
        }
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = nameInput.value.trim();
        var limit = Number(limitInput.value);
        var spent = spentInput.value === "" ? 0 : Number(spentInput.value);
        var alertsOn = alertsToggle ? alertsToggle.checked : true;
        var threshold = thresholdInput && thresholdInput.value !== "" ? Number(thresholdInput.value) : DEFAULT_THRESHOLD;

        if (!name) { toast("Enter a budget name", "danger"); return; }
        if (!limit || limit <= 0) { toast("Enter a valid limit amount", "danger"); return; }
        if (spent < 0 || isNaN(spent)) { toast("Enter a valid spent amount", "danger"); return; }
        if (alertsOn && (isNaN(threshold) || threshold < 1 || threshold > 100)) {
          toast("Threshold must be between 1 and 100%", "danger"); return;
        }

        // spent is kept at 0 on the budget record; the "Spent so far" amount
        // lives as a real expense transaction (reconcileBudgetSeed) so it hits
        // the Current Balance. spentFor() then reflects it via that txn.
        var patch = { name: name, limit: limit, spent: 0, period: selectedPeriod,
                      alertsEnabled: alertsOn, threshold: threshold };
        if (editingId) {
          Budgets.update(editingId, patch);
          reconcileBudgetSeed(editingId, name, spent);
          toast('Budget "' + name + '" updated', "success");
        } else {
          var created = Budgets.add(patch);
          if (!created) { toast("Could not save the budget", "danger"); return; }
          reconcileBudgetSeed(created.id, name, spent);
          toast('Budget "' + name + '" created', "success");
        }
        closeModal();
      });

      /* Budget card */
      function cardHtml(b) {
        var spent = spentFor(b);
        var lvl = levelFor(b);
        var pct = b.limit > 0 ? Math.round((spent / b.limit) * 100) : 0;
        var remaining = b.limit - spent;
        var fillPct = Math.min(100, pct);
        var periodLabel = b.period === "yearly" ? "Yearly" : "Monthly";

        var badge, fillMod, pctColor, footer;
        if (lvl === "over") {
          badge = '<span class="badge badge--danger">Over Budget</span>';
          fillMod = "progress__fill--danger"; pctColor = "text-danger";
          footer = '<p class="text-danger mt-2" style="font-size:14px;font-weight:700">- PKR ' + fmt(Math.abs(remaining)) + ' over limit</p>';
        } else if (lvl === "warning") {
          badge = '<span class="badge badge--warning">Warning</span>';
          fillMod = "progress__fill--warning"; pctColor = "text-warning";
          footer = '<p class="muted mt-2" style="font-size:14px">PKR ' + fmt(remaining) + ' left (threshold ' + thresholdOf(b) + '% reached)</p>';
        } else {
          badge = '<span class="badge badge--success">On Track</span>';
          fillMod = "progress__fill--success"; pctColor = "text-success";
          footer = '<p class="muted mt-2" style="font-size:14px">PKR ' + fmt(remaining) + ' left this ' + (b.period === "yearly" ? "year" : "month") + '</p>';
        }
        var spentColor = lvl === "over" ? "text-danger" : "text-accent";
        var alertBadge = b.alertsEnabled
          ? '<span class="badge badge--neutral" title="Alerts at ' + thresholdOf(b) + '%"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">notifications_active</span> ' + thresholdOf(b) + '%</span>'
          : '<span class="badge badge--neutral" title="Alerts off"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">notifications_off</span> Off</span>';

        return '' +
          '<div class="card card--interactive budget-tile' + (lvl === "over" ? " budget-tile--over" : "") + '">' +
            '<div class="row-between mb-4">' +
              '<div class="row gap-4">' +
                '<div class="tile-icon' + (lvl === "over" ? " tile-icon--danger" : "") + '"><span class="material-symbols-outlined">' + iconFor(b.name) + '</span></div>' +
                '<div><h4 class="subtitle">' + escapeHtml(b.name) + '</h4>' +
                  '<div class="row gap-2" style="margin-top:2px">' + badge +
                    '<span class="badge badge--neutral">' + periodLabel + '</span>' + alertBadge +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="row" style="gap:4px">' +
                '<button class="icon-btn" type="button" data-edit="' + b.id + '" aria-label="Edit budget" title="Edit"><span class="material-symbols-outlined" style="font-size:20px">edit</span></button>' +
                '<button class="icon-btn" type="button" data-delete="' + b.id + '" aria-label="Delete budget" title="Delete"><span class="material-symbols-outlined" style="font-size:20px">delete</span></button>' +
              '</div>' +
            '</div>' +
            '<div class="row-between mb-4">' +
              '<p class="muted" style="font-size:14px">PKR ' + fmt(b.limit) + ' Budget</p>' +
              '<p class="mono ' + (lvl === "over" ? "text-danger" : "") + '" style="font-weight:600">Spent <span class="' + spentColor + '">PKR ' + fmt(spent) + '</span></p>' +
            '</div>' +
            '<div class="row-between" style="margin-bottom:var(--sp-2)">' +
              '<span style="font-size:14px;font-weight:600">Progress</span>' +
              '<span class="mono ' + pctColor + '" style="font-size:14px">' + pct + '%</span>' +
            '</div>' +
            '<div class="progress" style="height:12px"><div class="progress__fill ' + fillMod + '" style="width:' + fillPct + '%"></div></div>' +
            footer +
          '</div>';
      }

      /* Alert row — for warning (threshold) or over budgets */
      function alertHtml(b) {
        var spent = spentFor(b);
        var lvl = levelFor(b);
        var reviewed = b.reviewedLevel === lvl;
        var over = spent - b.limit;

        if (reviewed) {
          return '' +
            '<div class="alert-critical" style="background:var(--surface-2);border-color:var(--border)">' +
              '<div class="tile-icon tile-icon--success"><span class="material-symbols-outlined">task_alt</span></div>' +
              '<div class="grow"><h4 style="font-weight:700">Reviewed — ' + escapeHtml(b.name) + '</h4>' +
                '<p class="muted">' + (lvl === "over"
                  ? "Over by PKR " + fmt(over) + ". You’ve acknowledged this alert."
                  : "At " + Math.round(spent / b.limit * 100) + "% of limit. You’ve acknowledged this alert.") + '</p></div>' +
              '<span class="badge badge--success">Reviewed</span>' +
            '</div>';
        }
        if (lvl === "over") {
          return '' +
            '<div class="alert-critical">' +
              '<div class="tile-icon tile-icon--danger"><span class="material-symbols-outlined">warning</span></div>' +
              '<div class="grow"><h4 class="text-danger" style="font-weight:700">Over budget: ' + escapeHtml(b.name) + '</h4>' +
                '<p class="muted">You’ve exceeded your ' + b.period + ' limit by <strong>PKR ' + fmt(over) + '</strong>.</p></div>' +
              '<button class="btn btn--danger btn--sm" type="button" data-review="' + b.id + '" data-level="over">Mark Reviewed</button>' +
            '</div>';
        }
        // warning
        return '' +
          '<div class="alert-critical" style="background:var(--warning-bg);border-color:var(--warning)">' +
            '<div class="tile-icon tile-icon--warning"><span class="material-symbols-outlined">notification_important</span></div>' +
            '<div class="grow"><h4 class="text-warning" style="font-weight:700">Approaching limit: ' + escapeHtml(b.name) + '</h4>' +
              '<p class="muted">At <strong>' + Math.round(spent / b.limit * 100) + '%</strong> of your PKR ' + fmt(b.limit) + ' limit (threshold ' + thresholdOf(b) + '%).</p></div>' +
            '<button class="btn btn--secondary btn--sm" type="button" data-review="' + b.id + '" data-level="warning">Mark Reviewed</button>' +
          '</div>';
      }

      function renderPage() {
        var list = Budgets.getAll();
        // Only evaluate alerts against the live current month — browsing past
        // months must not fire (or reset) real-time budget alerts.
        if (isCurrentView()) runAlerts(list);

        // ---- Calendar: reflect the viewed month + handle empty months ----
        if (monthLabelEl) monthLabelEl.textContent = viewLabel();
        // Next-month is disabled once we reach the real current month (no
        // future data to show).
        if (nextMonthBtn) nextMonthBtn.disabled = isCurrentView();

        var hasData = viewMonthHasData();
        // When a past month has no transaction data, show a friendly notice
        // instead of a blank page. The current month always renders (it holds
        // the live budgets even before any transaction is added).
        if (noDataEl) {
          noDataEl.hidden = hasData;
          if (!hasData && noDataTextEl) {
            noDataTextEl.textContent = "There are no transactions recorded for " + viewLabel() + ".";
          }
        }
        if (!hasData) {
          // Blank the grid/summary for the empty month; keep alerts meaningful.
          grid.innerHTML = "";
          if (emptyEl) emptyEl.hidden = true;
          if (totalBudgetEl) totalBudgetEl.textContent = "PKR 0";
          if (totalSpentEl) totalSpentEl.textContent = "PKR 0";
          if (remainingEl) { remainingEl.textContent = "PKR 0"; remainingEl.className = "mono text-success"; remainingEl.style.fontSize = "20px"; remainingEl.style.fontWeight = "600"; }
          if (spentBarEl) spentBarEl.style.width = "0%";
          if (remainingPctEl) remainingPctEl.textContent = "0% of total";
          if (alertsWrap) {
            alertsWrap.innerHTML = '<div class="alert-critical" style="background:var(--surface-2);border-color:var(--border)">' +
              '<div class="tile-icon"><span class="material-symbols-outlined">event_busy</span></div>' +
              '<div class="grow"><h4 style="font-weight:700">Nothing to show</h4>' +
              '<p class="muted">No budget activity for ' + escapeHtml(viewLabel()) + '.</p></div></div>';
          }
          return;
        }

        grid.innerHTML = list.map(cardHtml).join("");
        if (emptyEl) emptyEl.hidden = list.length !== 0;

        var totalBudget = 0, totalSpent = 0;
        list.forEach(function (b) { totalBudget += b.limit; totalSpent += spentFor(b); });
        var remaining = totalBudget - totalSpent;
        if (totalBudgetEl) totalBudgetEl.textContent = "PKR " + fmt(totalBudget);
        if (totalSpentEl) totalSpentEl.textContent = "PKR " + fmt(totalSpent);
        if (remainingEl) {
          remainingEl.textContent = (remaining < 0 ? "- PKR " : "PKR ") + fmt(Math.abs(remaining));
          remainingEl.className = "mono " + (remaining < 0 ? "text-danger" : "text-success");
          remainingEl.style.fontSize = "20px"; remainingEl.style.fontWeight = "600";
        }
        if (spentBarEl) spentBarEl.style.width = (totalBudget > 0 ? Math.min(100, Math.round(totalSpent / totalBudget * 100)) : 0) + "%";
        if (remainingPctEl) remainingPctEl.textContent = (totalBudget > 0 ? Math.max(0, Math.round(remaining / totalBudget * 100)) : 0) + "% of total";

        // Only surface alerts for budgets that have alerts ENABLED, and only
        // while the master Budget Alerts switch is on. A budget with alerts off
        // — or all alerts globally off — is never flagged, notified, or shown.
        var flagged = alertsMasterOn()
          ? list.filter(function (b) { return b.alertsEnabled && levelFor(b) !== "ontrack"; })
          : [];
        if (alertsWrap) {
          alertsWrap.innerHTML = flagged.length
            ? flagged.map(alertHtml).join("")
            : '<div class="alert-critical" style="background:var(--surface-2);border-color:var(--border)">' +
                '<div class="tile-icon tile-icon--success"><span class="material-symbols-outlined">verified</span></div>' +
                '<div class="grow"><h4 style="font-weight:700">All budgets on track</h4>' +
                '<p class="muted">No budgets are at or over their limit right now.</p></div></div>';
        }
      }

      /* ---- Calendar navigation ---- */
      function goMonth(delta) {
        var d = new Date(viewYear, viewMonth + delta, 1);
        // Never navigate past the real current month.
        if (d.getFullYear() > realNow.getFullYear() ||
            (d.getFullYear() === realNow.getFullYear() && d.getMonth() > realNow.getMonth())) return;
        viewYear = d.getFullYear();
        viewMonth = d.getMonth();
        renderPage();
      }
      if (prevMonthBtn) prevMonthBtn.addEventListener("click", function () { goMonth(-1); });
      if (nextMonthBtn) nextMonthBtn.addEventListener("click", function () { goMonth(1); });
      if (backCurrentBtn) backCurrentBtn.addEventListener("click", function () {
        viewYear = realNow.getFullYear(); viewMonth = realNow.getMonth(); renderPage();
      });

      grid.addEventListener("click", function (e) {
        var editBtn = e.target.closest("[data-edit]");
        if (editBtn) { openModal(editBtn.getAttribute("data-edit")); return; }
        var delBtn = e.target.closest("[data-delete]");
        if (delBtn) {
          var id = delBtn.getAttribute("data-delete");
          var b = Budgets.get(id);
          var name = b ? b.name : "this budget";
          if (typeof window.finwiseConfirm === "function") {
            window.finwiseConfirm({
              title: "Delete budget?",
              message: "“" + name + "” will be permanently removed. This can’t be undone.",
              confirmText: "Delete", cancelText: "Cancel", tone: "danger", icon: "delete"
            }).then(function (ok) { if (ok && Budgets.remove(id)) { reconcileBudgetSeed(id, name, 0); toast('Budget "' + name + '" deleted', "success"); } });
          } else if (window.confirm("Delete this budget?")) {
            if (Budgets.remove(id)) { reconcileBudgetSeed(id, name, 0); toast("Budget deleted", "success"); }
          }
        }
      });

      if (alertsWrap) {
        alertsWrap.addEventListener("click", function (e) {
          var reviewBtn = e.target.closest("[data-review]");
          if (!reviewBtn) return;
          var id = reviewBtn.getAttribute("data-review");
          var lvl = reviewBtn.getAttribute("data-level");
          var b = Budgets.get(id);
          Budgets.update(id, { reviewedLevel: lvl });
          toast((b ? b.name : "Alert") + " marked as reviewed", "success");
        });
      }

      var _renderPage = renderPage;
      renderPage._isPage = true;
      window.addEventListener(EVT, renderPage);
      window.addEventListener(TX_EVT, renderPage);
      window.addEventListener(USER_EVT, renderPage);
      window.addEventListener("storage", function (e) {
        if (!e.key) return;
        if (e.key === budgetKey() || e.key === txKey() || e.key === USER_KEY) renderPage();
      });
      // Re-render when the master Budget Alerts switch is toggled elsewhere.
      if (window.FinwiseSettings) window.FinwiseSettings.onChange(renderPage);
      renderPage();
    }

    /* ---------- Dashboard Budget Overview ---------- */
    if (dashList) {
      var capEl = document.getElementById("dash-budget-caption");

      function dashItem(b) {
        var spent = spentFor(b);
        var lvl = levelFor(b);
        var pct = b.limit > 0 ? Math.round((spent / b.limit) * 100) : 0;
        var fillPct = Math.min(100, pct);
        var mod = lvl === "over" ? "danger" : (lvl === "warning" ? "warning" : "success");
        var meta = lvl === "over"
          ? '<p class="budget-item__meta budget-item__meta--alert"><span class="material-symbols-outlined">error</span>PKR ' + fmt(spent) + ' <span>/ PKR ' + fmt(b.limit) + '</span> · Over budget</p>'
          : '<p class="budget-item__meta">PKR ' + fmt(spent) + ' <span>/ PKR ' + fmt(b.limit) + '</span></p>';
        return '' +
          '<div class="budget-item' + (lvl === "over" ? " budget-item--over" : "") + '">' +
            '<div class="budget-item__head">' +
              '<span class="budget-item__lead">' +
                '<span class="budget-item__icon budget-item__icon--' + (lvl === "over" ? "danger" : "success") + '"><span class="material-symbols-outlined">' + iconFor(b.name) + '</span></span>' +
                '<span class="budget-item__name">' + escapeHtml(b.name) + '</span>' +
              '</span>' +
              '<span class="budget-item__pct mono' + (lvl === "over" ? " text-danger" : "") + '">' + pct + '%</span>' +
            '</div>' +
            '<div class="progress"><div class="progress__fill progress__fill--' + mod + '" style="width:' + fillPct + '%"></div></div>' +
            meta +
          '</div>';
      }

      function renderDash() {
        var list = Budgets.getAll();
        runAlerts(list);
        // Show the top few, mirroring the original overview density.
        var shown = list.slice(0, 4);
        dashList.innerHTML = shown.length
          ? shown.map(dashItem).join("")
          : '<p class="muted" style="padding:var(--sp-4)">No budgets yet. <a href="budget.html" class="text-accent">Create one</a>.</p>';

        if (capEl) {
          var totalLimit = 0, totalSpent = 0;
          list.forEach(function (b) { totalLimit += b.limit; totalSpent += spentFor(b); });
          capEl.innerHTML = "PKR " + fmt(totalSpent) + " <span>of PKR " + fmt(totalLimit) + " used</span>";
        }
      }

      window.addEventListener(EVT, renderDash);
      window.addEventListener(TX_EVT, renderDash);
      window.addEventListener(USER_EVT, renderDash);
      window.addEventListener("storage", function (e) {
        if (!e.key) return;
        if (e.key === budgetKey() || e.key === txKey() || e.key === USER_KEY) renderDash();
      });
      if (window.FinwiseSettings) window.FinwiseSettings.onChange(renderDash);
      renderDash();
    }
  });
})();

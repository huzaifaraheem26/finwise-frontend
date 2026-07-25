/* ============================================================
   FINWISE — Goals engine
   Persistent savings goals that live in localStorage and react across
   the app. Users can:
     • Create a goal (name, target amount, icon, optional deadline).
     • Add money to a goal — which records a real EXPENSE transaction
       ("Goal: <name>") via the shared store, so the contribution is
       deducted from the available balance and shows up in history +
       dashboard totals. The goal's saved amount rises by the same sum.
     • See a completion notification (bell) the moment a goal reaches
       its target; completed goals move to their own section.

   Icons use Material Symbols (matching the rest of the app) rather than
   emoji, chosen from the shared category resolver where possible.

   Mirrors store.js/budgets.js conventions: a small store object, a
   custom change event for same-page updates, and a storage listener for
   cross-tab sync.
   ============================================================ */
(function () {
  "use strict";

  // Base name — the actual localStorage key is `<GOAL_BASE>:<uid>`, so User B
  // on the same browser never sees User A's goals. keyFor() returns null when
  // nobody is signed in, and read/write no-op in that case.
  var GOAL_BASE = "finwise.goals";
  var EVT = "finwise:goals";
  var USER_EVT = "finwise:user-changed";
  var USER_KEY = "finwise:user";

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
  function goalKey() { return scoped(GOAL_BASE); }

  /* Curated goal icons (Material Symbols) so the picker stays on-theme. */
  var ICONS = [
    "home", "directions_car", "flight", "school", "savings", "phone_iphone",
    "favorite", "celebration", "fitness_center", "pets", "diamond", "redeem"
  ];

  /* Goals start empty — the user creates their own. No seeded/demo data.
     Storage is uid-scoped: signed-out reads return [] and writes are dropped. */
  function read() {
    var k = goalKey();
    if (!k) return [];
    try {
      var raw = localStorage.getItem(k);
      if (raw == null) return [];
      return JSON.parse(raw) || [];
    } catch (e) { return []; }
  }
  function write(list) {
    var k = goalKey();
    if (!k) return false;
    try { localStorage.setItem(k, JSON.stringify(list)); }
    catch (e) { return false; }
    try { window.dispatchEvent(new CustomEvent(EVT)); } catch (e) {}
    return true;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  /* Currency-aware amount ("PKR 2,84,350" / "$ 2,84,350"). Falls back to a
     plain PKR string if the shared currency module isn't loaded yet. */
  function money(n) {
    if (window.FinwiseCurrency && FinwiseCurrency.format) return FinwiseCurrency.format(n);
    return "PKR " + Number(n || 0).toLocaleString("en-IN");
  }
  function pct(g) {
    if (!g.target || g.target <= 0) return 0;
    return Math.min(100, Math.round((g.saved / g.target) * 100));
  }
  function isComplete(g) { return g.saved >= g.target && g.target > 0; }

  var Goals = {
    getAll: function () { return read().slice(); },
    get: function (id) {
      return read().filter(function (g) { return String(g.id) === String(id); })[0] || null;
    },
    add: function (g) {
      if (!g || !g.name) return null;
      var list = read();
      var entry = {
        id: Date.now(),
        name: String(g.name).trim(),
        target: Math.abs(Number(g.target) || 0),
        saved: Math.abs(Number(g.saved) || 0),
        icon: g.icon || "savings",
        deadline: g.deadline || null,
        completedAt: null
      };
      if (!entry.name || !entry.target) return null;
      if (isComplete(entry)) entry.completedAt = Date.now();
      list.push(entry);
      return write(list) ? entry : null;
    },
    /* Add money to a goal. Records a matching expense transaction so the
       contribution leaves the available balance and appears in history.
       Returns { goal, justCompleted } or null on failure. */
    contribute: function (id, amount) {
      amount = Math.abs(Number(amount) || 0);
      if (!amount) return null;
      var list = read(), found = null, justCompleted = false;
      list.forEach(function (g) {
        if (String(g.id) !== String(id)) return;
        var wasComplete = isComplete(g);
        g.saved += amount;
        if (!wasComplete && isComplete(g)) { g.completedAt = Date.now(); justCompleted = true; }
        found = g;
      });
      if (!found) return null;
      if (!write(list)) return null;

      // Record the contribution as an expense transaction (deducts balance).
      if (window.FinwiseStore && FinwiseStore.add) {
        FinwiseStore.add({
          type: "expense",
          amount: amount,
          description: "Goal: " + found.name,
          category: "Savings",
          payment: "Transfer",
          date: new Date().toISOString().slice(0, 10),
          receipt: null
        });
      }
      return { goal: found, justCompleted: justCompleted };
    },
    /* Correct a goal's contributed (saved) amount to an exact value. Used when
       the user accidentally added the wrong sum. The difference from the old
       value is recorded as a compensating transaction so the available balance
       stays consistent: reducing the saved amount refunds the difference back
       to the balance (income), increasing it deducts more (expense). Progress,
       remaining gap and completion state all recalculate from the new value.
       Returns { goal, delta, justCompleted, justReverted } or null on failure. */
    setSaved: function (id, newSaved) {
      newSaved = Math.abs(Number(newSaved) || 0);
      if (isNaN(newSaved)) return null;
      var list = read(), found = null, delta = 0, justCompleted = false, justReverted = false;
      list.forEach(function (g) {
        if (String(g.id) !== String(id)) return;
        var wasComplete = isComplete(g);
        delta = newSaved - g.saved;      // + = added more, - = corrected down
        g.saved = newSaved;
        var nowComplete = isComplete(g);
        if (!wasComplete && nowComplete) { g.completedAt = Date.now(); justCompleted = true; }
        else if (wasComplete && !nowComplete) { g.completedAt = null; justReverted = true; }
        found = g;
      });
      if (!found) return null;
      if (!write(list)) return null;

      // Keep the available balance in sync with the correction.
      if (delta !== 0 && window.FinwiseStore && FinwiseStore.add) {
        FinwiseStore.add({
          type: delta > 0 ? "expense" : "income",
          amount: Math.abs(delta),
          description: "Goal adjustment: " + found.name,
          category: "Savings",
          payment: "Transfer",
          date: new Date().toISOString().slice(0, 10),
          receipt: null
        });
      }
      return { goal: found, delta: delta, justCompleted: justCompleted, justReverted: justReverted };
    },
    remove: function (id) {
      var list = read();
      var next = list.filter(function (g) { return String(g.id) !== String(id); });
      if (next.length === list.length) return false;
      return write(next);
    },
    icons: ICONS,
    pct: pct,
    isComplete: isComplete
  };
  /* One-shot legacy migration: attach any un-namespaced goals blob left by
     an earlier build to the current user's scoped key, then drop the
     legacy one. Also cleans up the dead `finwise.goals.seeded` flag from
     the previous never-used seeding path. */
  (function migrateLegacy() {
    var uid = currentUid();
    var legacy = localStorage.getItem(GOAL_BASE);
    if (legacy != null) {
      if (uid && localStorage.getItem(GOAL_BASE + ":" + uid) == null) {
        try { localStorage.setItem(GOAL_BASE + ":" + uid, legacy); } catch (e) {}
      }
      try { localStorage.removeItem(GOAL_BASE); } catch (e) {}
    }
    try { localStorage.removeItem("finwise.goals.seeded"); } catch (e) {}
  })();

  window.FinwiseGoals = Goals;

  /* ============================================================ Rendering */
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var grid = document.getElementById("goals-grid");
    if (!grid) return; // not the goals page

    var completedGrid = document.getElementById("goals-completed");
    var emptyEl = document.getElementById("goals-empty");
    var activeCountEl = document.getElementById("goals-active-count");
    var totalSavedEl = document.getElementById("goals-total-saved");
    var remainingGapEl = document.getElementById("goals-remaining-gap");

    function toast(m, t) { if (window.showToast) window.showToast(m, t); }

    /* ---- Modal: create goal ---- */
    var modal = document.getElementById("goal-modal");
    var form = document.getElementById("goal-form");
    var nameInput = document.getElementById("goal-name");
    var targetInput = document.getElementById("goal-target");
    var savedInput = document.getElementById("goal-saved");
    var deadlineInput = document.getElementById("goal-deadline");
    var iconPicker = document.getElementById("goal-icon-picker");
    var selectedIcon = ICONS[0];

    function renderIconPicker() {
      if (!iconPicker) return;
      iconPicker.innerHTML = ICONS.map(function (ic) {
        return '<button type="button" class="goal-icon-opt' + (ic === selectedIcon ? " active" : "") +
          '" data-icon="' + ic + '" aria-label="' + ic + '"><span class="material-symbols-outlined">' + ic + '</span></button>';
      }).join("");
    }
    function openModal() {
      if (!modal) return;
      form.reset();
      selectedIcon = ICONS[0];
      renderIconPicker();
      modal.classList.add("open");
      setTimeout(function () { if (nameInput) nameInput.focus(); }, 50);
    }
    function closeModal() { if (modal) modal.classList.remove("open"); }

    document.querySelectorAll("[data-open-goal]").forEach(function (b) {
      b.addEventListener("click", openModal);
    });
    if (modal) modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.closest("[data-goal-close]")) closeModal();
    });
    if (iconPicker) iconPicker.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-icon]");
      if (!btn) return;
      selectedIcon = btn.getAttribute("data-icon");
      renderIconPicker();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal && modal.classList.contains("open")) closeModal();
    });

    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (nameInput.value || "").trim();
      var target = Number(targetInput.value);
      var saved = savedInput.value === "" ? 0 : Number(savedInput.value);
      if (!name) { toast("Enter a goal name", "danger"); return; }
      if (!target || target <= 0) { toast("Enter a valid target amount", "danger"); return; }
      if (saved < 0 || isNaN(saved)) { toast("Enter a valid saved amount", "danger"); return; }
      var entry = Goals.add({ name: name, target: target, saved: saved, icon: selectedIcon, deadline: deadlineInput.value || null });
      if (!entry) { toast("Could not save the goal", "danger"); return; }
      toast('Goal "' + name + '" created', "success");
      closeModal();
    });

    /* ---- Modal: add money / edit contributed amount ----
       One modal, two modes:
         • "add"  — contribute a new amount on top of the current saved value.
         • "edit" — correct the total contributed (saved) amount to an exact
                    value; the balance is reconciled by Goals.setSaved. */
    var addModal = document.getElementById("addmoney-modal");
    var addForm = document.getElementById("addmoney-form");
    var addAmountInput = document.getElementById("addmoney-amount");
    var addGoalLabel = document.getElementById("addmoney-goal-label");
    var addTitle = document.getElementById("addmoney-title");
    var addDesc = document.getElementById("addmoney-desc");
    var addAmountLabel = document.getElementById("addmoney-amount-label");
    var addSubmit = document.getElementById("addmoney-submit");
    var addGoalId = null;
    var addMode = "add"; // "add" | "edit"

    function openAddMoney(id) {
      var g = Goals.get(id);
      if (!g || !addModal) return;
      addGoalId = id;
      addMode = "add";
      if (addTitle) addTitle.textContent = "Add Money";
      if (addDesc) {
        addDesc.innerHTML = 'Contributing to <span style="font-weight:700;color:var(--text)" id="addmoney-goal-label">' +
          escapeHtml(g.name) + '</span>. This is recorded as an expense and deducted from your balance.';
      }
      if (addAmountLabel) addAmountLabel.textContent = "Amount";
      if (addSubmit) addSubmit.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">add_card</span> Add Money';
      if (addForm) addForm.reset();
      addModal.classList.add("open");
      setTimeout(function () { if (addAmountInput) addAmountInput.focus(); }, 50);
    }

    function openEditSaved(id) {
      var g = Goals.get(id);
      if (!g || !addModal) return;
      addGoalId = id;
      addMode = "edit";
      if (addTitle) addTitle.textContent = "Edit Contributed Amount";
      if (addDesc) {
        addDesc.innerHTML = 'Correct the total saved for <span style="font-weight:700;color:var(--text)">' +
          escapeHtml(g.name) + '</span>. The difference is reconciled with your balance and progress updates automatically.';
      }
      if (addAmountLabel) addAmountLabel.textContent = "Total contributed amount";
      if (addSubmit) addSubmit.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">check</span> Save Changes';
      if (addForm) addForm.reset();
      if (addAmountInput) addAmountInput.value = g.saved;
      addModal.classList.add("open");
      setTimeout(function () { if (addAmountInput) { addAmountInput.focus(); addAmountInput.select(); } }, 50);
    }

    function closeAddMoney() { if (addModal) addModal.classList.remove("open"); addGoalId = null; addMode = "add"; }

    if (addModal) addModal.addEventListener("click", function (e) {
      if (e.target === addModal || e.target.closest("[data-addmoney-close]")) closeAddMoney();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && addModal && addModal.classList.contains("open")) closeAddMoney();
    });
    if (addForm) addForm.addEventListener("submit", function (e) {
      e.preventDefault();

      if (addMode === "edit") {
        // Empty is allowed → 0 (correct an accidental contribution to nothing).
        var raw = addAmountInput.value;
        if (raw !== "" && Number(raw) < 0) { toast("Enter a valid amount", "danger"); return; }
        var newSaved = raw === "" ? 0 : Number(raw);
        if (isNaN(newSaved)) { toast("Enter a valid amount", "danger"); return; }
        var eres = Goals.setSaved(addGoalId, newSaved);
        if (!eres) { toast("Could not update the amount", "danger"); return; }
        if (eres.delta === 0) {
          toast("No change to " + eres.goal.name, "info");
        } else if (eres.delta < 0) {
          toast(money(Math.abs(eres.delta)) + " refunded — " + eres.goal.name + " updated", "success");
        } else {
          toast(money(eres.delta) + " added — " + eres.goal.name + " updated", "success");
        }
        if (eres.justCompleted) {
          if (window.FinwiseNotify) {
            window.FinwiseNotify.add({
              icon: "emoji_events", type: "success",
              title: "Goal completed! 🎉",
              text: 'You reached your "' + eres.goal.name + '" target of ' + money(eres.goal.target) + ".",
            }, { key: "goal-complete:" + eres.goal.id });
          }
          toast('🎉 Goal "' + eres.goal.name + '" completed!', "success");
        }
        closeAddMoney();
        return;
      }

      var amount = Number(addAmountInput.value);
      if (!amount || amount <= 0) { toast("Enter a valid amount", "danger"); return; }
      var res = Goals.contribute(addGoalId, amount);
      if (!res) { toast("Could not add money", "danger"); return; }
      toast(money(amount) + " added to " + res.goal.name, "success");
      if (res.justCompleted) {
        if (window.FinwiseNotify) {
          window.FinwiseNotify.add({
            icon: "emoji_events", type: "success",
            title: "Goal completed! 🎉",
            text: 'You reached your "' + res.goal.name + '" target of ' + money(res.goal.target) + ".",
          }, { key: "goal-complete:" + res.goal.id });
        }
        toast('🎉 Goal "' + res.goal.name + '" completed!', "success");
      }
      closeAddMoney();
    });

    /* ---- Cards ---- */
    function activeCardHtml(g) {
      var p = pct(g);
      return '' +
        '<div class="card goal-card hover-lift">' +
          '<div class="row-between mb-4" style="align-items:flex-start">' +
            '<div class="goal-icon goal-icon--accent"><span class="material-symbols-outlined">' + escapeHtml(g.icon || "savings") + '</span></div>' +
            '<div class="ring">' +
              '<svg viewBox="0 0 36 36">' +
                '<path class="ring__track" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke-width="3"></path>' +
                '<path class="progress-ring-circle" style="stroke:var(--accent)" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke-dasharray="' + p + ', 100" stroke-linecap="round" stroke-width="3"></path>' +
              '</svg>' +
              '<span class="ring__label text-accent">' + p + '%</span>' +
            '</div>' +
          '</div>' +
          '<h5 class="title">' + escapeHtml(g.name) + '</h5>' +
          (g.deadline ? '<p class="muted row gap-2 mt-2" style="font-size:14px"><span class="material-symbols-outlined" style="font-size:16px">calendar_month</span>Target: ' + escapeHtml(fmtDeadline(g.deadline)) + '</p>' : '') +
          '<div class="col gap-2 mt-4">' +
            '<div class="goal-row"><span>Saved</span><span style="font-weight:700">' + money(g.saved) + '</span></div>' +
            '<div class="goal-row muted"><span>Target</span><span>' + money(g.target) + '</span></div>' +
          '</div>' +
          '<div style="margin-top:auto;padding-top:var(--sp-5)" class="row gap-2">' +
            '<button class="btn btn--secondary grow" data-add-money="' + g.id + '"><span class="material-symbols-outlined">add_card</span> Add Money</button>' +
            '<button class="icon-btn" data-edit-saved="' + g.id + '" aria-label="Edit contributed amount" title="Edit contributed amount"><span class="material-symbols-outlined">edit</span></button>' +
            '<button class="icon-btn" data-delete-goal="' + g.id + '" aria-label="Delete goal" title="Delete"><span class="material-symbols-outlined">delete</span></button>' +
          '</div>' +
        '</div>';
    }

    function completedCardHtml(g) {
      return '' +
        '<div class="card completed-card">' +
          '<div class="completed-medallion"><span class="material-symbols-outlined">' + escapeHtml(g.icon || "savings") + '</span></div>' +
          '<div class="grow">' +
            '<div class="row gap-2" style="margin-bottom:var(--sp-1)">' +
              '<span class="badge badge--success">ACHIEVED</span>' +
              (g.completedAt ? '<span class="text-success" style="font-size:14px;font-weight:600">' + escapeHtml(fmtDate(g.completedAt)) + '</span>' : '') +
            '</div>' +
            '<h5 class="title">' + escapeHtml(g.name) + '</h5>' +
            '<p class="muted" style="font-size:14px">' + money(g.target) + ' target reached!</p>' +
            '<div class="row gap-4 mt-4">' +
              '<button class="btn btn--ghost btn--sm" data-delete-goal="' + g.id + '">Remove</button>' +
            '</div>' +
          '</div>' +
          '<div class="tile-icon tile-icon--success" style="border-radius:var(--r-full)"><span class="material-symbols-outlined filled-icon" style="font-size:28px">celebration</span></div>' +
        '</div>';
    }

    function fmtDeadline(iso) {
      var d = new Date(iso);
      if (isNaN(d)) return iso;
      var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return M[d.getMonth()] + " " + d.getFullYear();
    }
    function fmtDate(ts) {
      var d = new Date(ts);
      if (isNaN(d)) return "";
      var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return M[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
    }

    function render() {
      var list = Goals.getAll();
      var active = list.filter(function (g) { return !isComplete(g); });
      var done = list.filter(isComplete);

      grid.innerHTML = active.map(activeCardHtml).join("");
      if (emptyEl) emptyEl.hidden = active.length !== 0;
      if (completedGrid) {
        completedGrid.innerHTML = done.length
          ? done.map(completedCardHtml).join("")
          : '<div class="goal-placeholder"><div class="tile-icon" style="border-radius:var(--r-full)"><span class="material-symbols-outlined">emoji_events</span></div><p class="muted">Your next big win is waiting.</p><p class="faint" style="font-size:14px;font-style:italic">Complete a goal to see it celebrated here.</p></div>';
      }

      // Summary
      var totalSaved = 0, totalTarget = 0;
      list.forEach(function (g) { totalSaved += g.saved; totalTarget += g.target; });
      var gap = Math.max(0, totalTarget - totalSaved);
      if (activeCountEl) activeCountEl.textContent = String(active.length);
      if (totalSavedEl) totalSavedEl.textContent = money(totalSaved);
      if (remainingGapEl) remainingGapEl.textContent = money(gap);
    }

    // Card actions (delegated).
    document.addEventListener("click", function (e) {
      var addBtn = e.target.closest("[data-add-money]");
      if (addBtn) { openAddMoney(addBtn.getAttribute("data-add-money")); return; }
      var editBtn = e.target.closest("[data-edit-saved]");
      if (editBtn) { openEditSaved(editBtn.getAttribute("data-edit-saved")); return; }
      var delBtn = e.target.closest("[data-delete-goal]");
      if (delBtn) {
        var id = delBtn.getAttribute("data-delete-goal");
        var g = Goals.get(id);
        var name = g ? g.name : "this goal";
        if (typeof window.finwiseConfirm === "function") {
          window.finwiseConfirm({
            title: "Delete goal?",
            message: "“" + name + "” will be permanently removed.",
            confirmText: "Delete", cancelText: "Cancel", tone: "danger", icon: "delete"
          }).then(function (ok) { if (ok && Goals.remove(id)) toast('Goal "' + name + '" deleted', "success"); });
        } else if (window.confirm("Delete this goal?")) {
          if (Goals.remove(id)) toast("Goal deleted", "success");
        }
      }
    });

    window.addEventListener(EVT, render);
    window.addEventListener(USER_EVT, render);
    window.addEventListener("storage", function (e) {
      if (!e.key) return;
      if (e.key === goalKey() || e.key === USER_KEY) render();
    });
    if (window.FinwiseCurrency) FinwiseCurrency.onChange(render);
    render();
  });
})();

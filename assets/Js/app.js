/* ============================================================
   FINWISE — Shared behavior
   Loaded on every page. All hooks are optional (guarded), so a
   page only gets the behavior for markup it actually contains.
   ============================================================ */
(function () {
  "use strict";

  /* ---- 1. Active nav highlight (keeps nav markup identical everywhere) ---- */
  function markActiveNav() {
    var here = (location.pathname.split("/").pop() || "dashboard.html").toLowerCase();
    document.querySelectorAll(".sidebar__nav .nav-link[href]").forEach(function (link) {
      var target = (link.getAttribute("href") || "").split("/").pop().toLowerCase();
      if (target && target === here) link.classList.add("active");
      else link.classList.remove("active");
    });
  }

  /* ---- 2. Mobile sidebar drawer ---- */
  function initNavDrawer() {
    var sidebar = document.querySelector(".sidebar");
    var toggle = document.querySelector(".nav-toggle");
    var scrim = document.querySelector(".scrim");
    if (!sidebar || !toggle) return;

    function open() { sidebar.classList.add("open"); if (scrim) scrim.classList.add("open"); }
    function close() { sidebar.classList.remove("open"); if (scrim) scrim.classList.remove("open"); }

    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      sidebar.classList.contains("open") ? close() : open();
    });
    if (scrim) scrim.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    // Close after navigating on mobile
    sidebar.querySelectorAll(".nav-link").forEach(function (l) {
      l.addEventListener("click", function () { if (window.innerWidth <= 768) close(); });
    });
  }

  /* ---- 3. Generic dropdowns  [data-dropdown] > [data-dropdown-toggle] + [data-dropdown-menu] ---- */
  function initDropdowns() {
    document.querySelectorAll("[data-dropdown]").forEach(function (dd) {
      var toggle = dd.querySelector("[data-dropdown-toggle]");
      var menu = dd.querySelector("[data-dropdown-menu]");
      if (!toggle || !menu) return;
      menu.style.display = "none";
      toggle.addEventListener("click", function (e) {
        e.stopPropagation();
        var showing = menu.style.display !== "none";
        menu.style.display = showing ? "none" : "block";
      });
    });
    document.addEventListener("click", function () {
      document.querySelectorAll("[data-dropdown-menu]").forEach(function (m) { m.style.display = "none"; });
    });
  }

  /* ---- 4. Modals  [data-modal-open="id"] / [data-modal-close] / .modal-overlay#id ---- */
  function initModals() {
    function openModal(id) { var m = document.getElementById(id); if (m) m.classList.add("open"); }
    function closeModal(m) { if (m) m.classList.remove("open"); }

    document.querySelectorAll("[data-modal-open]").forEach(function (btn) {
      btn.addEventListener("click", function () { openModal(btn.getAttribute("data-modal-open")); });
    });
    document.querySelectorAll("[data-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.closest(".modal-overlay")); });
    });
    document.querySelectorAll(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(ov); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") document.querySelectorAll(".modal-overlay.open").forEach(closeModal);
    });
    window.FinwiseModal = { open: openModal, close: function (id) { closeModal(document.getElementById(id)); } };
  }

  /* ---- 5. Toasts ---- */
  function ensureToastStack() {
    var stack = document.querySelector(".toast-stack");
    if (!stack) { stack = document.createElement("div"); stack.className = "toast-stack"; document.body.appendChild(stack); }
    return stack;
  }
  window.showToast = function (message, type) {
    var stack = ensureToastStack();
    var t = document.createElement("div");
    t.className = "toast" + (type ? " toast--" + type : "");
    var icon = type === "success" ? "check_circle" : type === "danger" ? "error" : "info";
    t.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span><span>' + message + "</span>";
    stack.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .3s, transform .3s";
      t.style.opacity = "0"; t.style.transform = "translateX(20px)";
      setTimeout(function () { t.remove(); }, 300);
    }, 3200);
  };

  /* ---- 6. Animate progress bars & scroll reveals ---- */
  function initProgressBars() {
    document.querySelectorAll(".progress__fill[data-value]").forEach(function (bar) {
      var target = bar.getAttribute("data-value") + "%";
      bar.style.width = "0%";
      requestAnimationFrame(function () { setTimeout(function () { bar.style.width = target; }, 150); });
    });
  }
  function initReveals() {
    var els = document.querySelectorAll(".fade-in-section");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("is-visible"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---- 7. Live table search --------------------------------------------
     An [data-search-input="TOKEN"] filters the rows of the matching
     [data-search-list="TOKEN"] as the user types. A row is hidden unless
     its text (or explicit data-search-text) contains every search term.
     Optional companions, matched by the same TOKEN:
       [data-search-clear="TOKEN"] — clear button (shown only when non-empty)
       [data-search-empty]         — row/element shown when nothing matches
     ---------------------------------------------------------------------- */
  function initTableSearch() {
    document.querySelectorAll("[data-search-input]").forEach(function (input) {
      var token = input.getAttribute("data-search-input");
      var list = document.querySelector('[data-search-list="' + token + '"]');
      if (!list) return;
      var clearBtn = document.querySelector('[data-search-clear="' + token + '"]');
      var empty = list.querySelector("[data-search-empty]");

      function rows() {
        return Array.prototype.filter.call(list.children, function (el) {
          return el.tagName === "TR" && !el.hasAttribute("data-search-empty");
        });
      }

      function apply() {
        var terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        var visible = 0;
        rows().forEach(function (row) {
          var hay = (row.getAttribute("data-search-text") || row.textContent || "").toLowerCase();
          var match = terms.every(function (t) { return hay.indexOf(t) !== -1; });
          row.hidden = !match;
          if (match) visible++;
        });
        if (empty) empty.hidden = visible !== 0;
        if (clearBtn) clearBtn.hidden = input.value === "";
      }

      input.addEventListener("input", apply);
      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          input.value = "";
          input.focus();
          apply();
        });
      }
      apply();
    });
  }

  /* ----------------------------------------------------------------------
     Notifications bell — global.
     The bell button (.icon-btn[aria-label="Notifications"]) ships as
     identical static markup on every page. Here we turn it into a working
     dropdown: build the panel once, toggle on click, clear the unread dot
     when opened, and let each item be dismissed.
     ---------------------------------------------------------------------- */
  /* ----------------------------------------------------------------------
     Notifications — shared, persistent store.
     Backed by localStorage so a notification raised on one page (e.g. a
     password change on Profile, or an over-budget category on Budgets) shows
     up on the bell across every page and survives navigation. Same-page
     updates fire a custom event; other tabs sync via the native storage event.
     ---------------------------------------------------------------------- */
  var NOTIF_KEY = "finwise:notifications";
  var NOTIF_EVT = "finwise:notifications";
  var NOTIF_SEEDED = "finwise:notifications-seeded";

  // Default demo notifications, seeded once. (Budget-exceeded alerts are
  // produced for real by the Budgets page, so they're not seeded here.)
  function seedDefaults() {
    var now = Date.now();
    return [
      { id: now - 1, icon: "savings",      type: "success", title: "Goal milestone reached", text: "Emergency Fund is now 75% funded. Keep it up!",   ts: now - 86400000 },
      { id: now - 2, icon: "receipt_long", type: "accent",  title: "New transaction added",   text: "PKR 3,450 at Al-Fatah Superstore was recorded.", ts: now - 172800000 }
    ];
  }

  function readNotifs() {
    try {
      var raw = localStorage.getItem(NOTIF_KEY);
      if (raw == null) {
        // First run on this browser: seed the demo notifications once.
        if (!localStorage.getItem(NOTIF_SEEDED)) {
          var seed = seedDefaults();
          localStorage.setItem(NOTIF_KEY, JSON.stringify(seed));
          localStorage.setItem(NOTIF_SEEDED, "1");
          return seed;
        }
        return [];
      }
      return JSON.parse(raw) || [];
    } catch (e) { return []; }
  }
  function writeNotifs(list) {
    try { localStorage.setItem(NOTIF_KEY, JSON.stringify(list)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent(NOTIF_EVT)); } catch (e) {}
  }

  function relativeTime(ts) {
    if (!ts) return "";
    var diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  }

  var Notify = {
    getAll: function () { return readNotifs(); },
    /* Add a notification. Pass opts.key to dedupe: a second add() with a key
       that already exists is ignored (prevents stacking the same over-budget
       alert on every page visit). Returns the entry, or null if deduped. */
    add: function (n, opts) {
      if (!n || !n.title) return null;
      var list = readNotifs();
      var key = opts && opts.key;
      if (key && list.some(function (x) { return x.key === key; })) return null;
      var entry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        icon: n.icon || "notifications",
        type: n.type || "accent",
        title: n.title,
        text: n.text || "",
        ts: Date.now(),
        key: key || undefined,
        unread: true
      };
      list.unshift(entry);
      writeNotifs(list);
      return entry;
    },
    remove: function (id) {
      var list = readNotifs().filter(function (x) { return String(x.id) !== String(id); });
      writeNotifs(list);
    },
    clear: function () { writeNotifs([]); },
    onChange: function (fn) {
      window.addEventListener(NOTIF_EVT, fn);
      window.addEventListener("storage", function (e) { if (e.key === NOTIF_KEY) fn(); });
    }
  };
  window.FinwiseNotify = Notify;

  function initNotifications() {
    var bell = document.querySelector('.icon-btn[aria-label="Notifications"]');
    if (!bell) return;

    // Wrap the bell so the panel can anchor to it.
    var wrap = document.createElement("div");
    wrap.className = "notif";
    bell.parentNode.insertBefore(wrap, bell);
    wrap.appendChild(bell);
    bell.setAttribute("aria-haspopup", "true");
    bell.setAttribute("aria-expanded", "false");

    var panel = document.createElement("div");
    panel.className = "notif__panel";
    panel.hidden = true;
    wrap.appendChild(panel);

    function render() {
      var data = Notify.getAll();
      var items = data.map(function (n) {
        return '<li class="notif__item" data-id="' + n.id + '">' +
          '<span class="notif__icon notif__icon--' + n.type + '"><span class="material-symbols-outlined">' + n.icon + '</span></span>' +
          '<div class="notif__body"><p class="notif__title">' + n.title + '</p>' +
          '<p class="notif__text">' + n.text + '</p>' +
          '<span class="notif__time">' + relativeTime(n.ts) + '</span></div>' +
          '<button class="notif__dismiss" aria-label="Dismiss"><span class="material-symbols-outlined">close</span></button>' +
          '</li>';
      }).join("");
      if (!data.length) {
        items = '<li class="notif__empty"><span class="material-symbols-outlined">notifications_off</span>You\'re all caught up</li>';
      }
      panel.innerHTML =
        '<div class="notif__head"><span>Notifications</span>' +
        (data.length ? '<button class="notif__clear" type="button">Clear all</button>' : "") +
        '</div><ul class="notif__list">' + items + '</ul>';
    }

    function updateDot() {
      var dot = bell.querySelector(".icon-btn__dot");
      if (!dot) return;
      // Keep the dot hidden while the panel is open (the user is looking at
      // the list); otherwise show it whenever there's anything to see.
      dot.style.display = (!panel.hidden || !Notify.getAll().length) ? "none" : "";
    }

    function open() {
      render();
      panel.hidden = false;
      wrap.classList.add("notif--open");
      bell.setAttribute("aria-expanded", "true");
      var dot = bell.querySelector(".icon-btn__dot");
      if (dot) dot.style.display = "none"; // mark as seen
    }
    function close() {
      panel.hidden = true;
      wrap.classList.remove("notif--open");
      bell.setAttribute("aria-expanded", "false");
    }

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      panel.hidden ? open() : close();
    });

    panel.addEventListener("click", function (e) {
      e.stopPropagation();
      var dismiss = e.target.closest(".notif__dismiss");
      if (dismiss) {
        Notify.remove(dismiss.closest(".notif__item").getAttribute("data-id"));
        return;
      }
      if (e.target.closest(".notif__clear")) Notify.clear();
    });

    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    // Live: re-render the panel (if open) and refresh the unread dot whenever
    // the store changes — same page or another tab.
    Notify.onChange(function () {
      if (!panel.hidden) render();
      updateDot();
    });
    updateDot();
  }

  /* ----------------------------------------------------------------------
     Themed confirmation dialog — window.finwiseConfirm(opts) -> Promise<bool>
     Replaces the native confirm() with a modal that matches the app theme.
     opts: { title, message, confirmText, cancelText, tone: 'danger'|'accent', icon }
     ---------------------------------------------------------------------- */
  window.finwiseConfirm = function (opts) {
    opts = opts || {};
    var tone = opts.tone === "accent" ? "accent" : "danger";
    var icon = opts.icon || (tone === "danger" ? "delete" : "help");
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML =
        '<div class="modal modal--sm" role="dialog" aria-modal="true">' +
          '<div class="modal__body confirm">' +
            '<div class="confirm__icon confirm__icon--' + tone + '"><span class="material-symbols-outlined">' + icon + '</span></div>' +
            '<p class="confirm__title">' + (opts.title || "Are you sure?") + '</p>' +
            '<p class="confirm__text">' + (opts.message || "") + '</p>' +
          '</div>' +
          '<div class="modal__foot" style="justify-content:center">' +
            '<button type="button" class="btn btn--secondary" data-cancel>' + (opts.cancelText || "Cancel") + '</button>' +
            '<button type="button" class="btn ' + (tone === "danger" ? "btn--danger" : "btn--primary") + '" data-confirm>' + (opts.confirmText || "Confirm") + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      // Trigger the open transition on the next frame.
      requestAnimationFrame(function () { overlay.classList.add("open"); });

      function done(result) {
        overlay.classList.remove("open");
        setTimeout(function () { overlay.remove(); }, 200);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") done(false);
        else if (e.key === "Enter") done(true);
      }
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) return done(false);
        if (e.target.closest("[data-cancel]")) return done(false);
        if (e.target.closest("[data-confirm]")) return done(true);
      });
      document.addEventListener("keydown", onKey);
      var confirmBtn = overlay.querySelector("[data-confirm]");
      if (confirmBtn) confirmBtn.focus();
    });
  };

  /* ----------------------------------------------------------------------
     Global currency — window.FinwiseCurrency
     The app stores amounts as plain numbers and labels them with a currency
     token. Users pick a currency once (Profile); we persist the choice and
     relabel the token everywhere — static markup AND JS-rendered content —
     via a debounced text sweep. No FX conversion: the number is unchanged,
     only the symbol/code in front of it changes (per product decision).
     ---------------------------------------------------------------------- */
  var CUR_KEY = "finwise:currency";
  var CUR_EVT = "finwise:currency";
  // code -> display token used in front of amounts.
  var CUR_SYMBOLS = { PKR: "PKR", USD: "$", GBP: "£", EUR: "€", AED: "AED" };
  // Any known currency token sitting directly in front of a number. Matched so
  // we can swap whatever is currently shown to the newly-selected currency.
  // (Lookbehind avoids matching inside words; supported in all modern browsers.)
  var CUR_TOKEN_RE = /(?<![A-Za-z0-9])([+\-]?)(PKR|Rs\.?|USD|GBP|EUR|AED|\$|£|€)\s?(?=[0-9])/g;

  function currentCurrency() {
    try { return localStorage.getItem(CUR_KEY) || "PKR"; } catch (e) { return "PKR"; }
  }
  function currencySymbol(code) {
    return CUR_SYMBOLS[code || currentCurrency()] || (code || "PKR");
  }

  var _sweepPending = false, _curObserver = null;

  // Replace every currency token in a text node with the active symbol.
  function sweepCurrency(root) {
    var sym = currencySymbol();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node, changed = [];
    while ((node = walker.nextNode())) {
      var v = node.nodeValue;
      if (!v || v.indexOf("PKR") === -1 && !/[$£€]|USD|GBP|EUR|AED|Rs/.test(v)) continue;
      var next = v.replace(CUR_TOKEN_RE, function (m, sign) { return sign + sym + " "; });
      if (next !== v) changed.push([node, next]);
    }
    changed.forEach(function (pair) { pair[0].nodeValue = pair[1]; });
  }

  // Debounced + self-disconnecting so our own text edits don't re-trigger it.
  function scheduleCurrencySweep() {
    if (_sweepPending) return;
    _sweepPending = true;
    requestAnimationFrame(function () {
      _sweepPending = false;
      if (_curObserver) _curObserver.disconnect();
      try { sweepCurrency(document.body); } catch (e) {}
      try { applyCurrencyLabels(); } catch (e) {}
      if (_curObserver) _curObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  }

  /* Standalone currency labels — elements like the Add Transaction amount
     prefix or the Budget modal's "PKR" chips that sit on their own (no number
     beside them), so the text sweep can't catch them. Mark them with
     data-currency-symbol and we set their text to the active symbol here. */
  function applyCurrencyLabels() {
    var sym = currencySymbol();
    document.querySelectorAll("[data-currency-symbol]").forEach(function (el) {
      if (el.textContent !== sym) el.textContent = sym;
    });
  }

  function initCurrency() {
    // Initial relabel (after store/budgets have done their first render).
    scheduleCurrencySweep();
    applyCurrencyLabels();

    // Watch for any DOM/text change (dynamic re-renders) and relabel again.
    if ("MutationObserver" in window) {
      _curObserver = new MutationObserver(function () { scheduleCurrencySweep(); });
      _curObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    }

    // Wire any currency selector on the page (Profile, etc.).
    document.querySelectorAll("[data-currency-select]").forEach(function (sel) {
      // Reflect the stored choice.
      var cur = currentCurrency();
      Array.prototype.forEach.call(sel.options, function (opt) {
        if ((opt.value || "").toUpperCase() === cur) sel.value = opt.value;
      });
      sel.addEventListener("change", function () {
        FinwiseCurrency.set(sel.value);
      });
    });
  }

  window.FinwiseCurrency = {
    get: currentCurrency,
    symbol: currencySymbol,
    /* Format a number with the active currency token (for JS that renders
       amounts itself, e.g. goals.js). Uses Indian grouping to match the app. */
    format: function (n) {
      return currencySymbol() + " " + Number(n || 0).toLocaleString("en-IN");
    },
    set: function (code) {
      code = (code || "PKR").toUpperCase();
      if (!CUR_SYMBOLS[code]) code = "PKR";
      try { localStorage.setItem(CUR_KEY, code); } catch (e) {}
      scheduleCurrencySweep();
      try { window.dispatchEvent(new CustomEvent(CUR_EVT)); } catch (e) {}
      if (window.showToast) window.showToast("Currency set to " + code, "success");
    },
    onChange: function (fn) {
      window.addEventListener(CUR_EVT, fn);
      window.addEventListener("storage", function (e) { if (e.key === CUR_KEY) fn(); });
    }
  };

  /* ----------------------------------------------------------------------
     Receipt lightbox — window.finwiseViewReceipt(src)
     Opens a stored receipt image (data URL) in a themed overlay so users can
     view attachments after saving a transaction. Click the backdrop, the
     close button, or press Escape to dismiss.
     ---------------------------------------------------------------------- */
  window.finwiseViewReceipt = function (src) {
    if (!src) return;
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay lightbox";
    overlay.innerHTML =
      '<div class="lightbox__inner" role="dialog" aria-modal="true" aria-label="Receipt attachment">' +
        '<button type="button" class="lightbox__close icon-btn" data-lightbox-close aria-label="Close">' +
          '<span class="material-symbols-outlined">close</span></button>' +
        '<img class="lightbox__img" src="' + src + '" alt="Receipt attachment"/>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add("open"); });

    function close() {
      overlay.classList.remove("open");
      setTimeout(function () { overlay.remove(); }, 200);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-lightbox-close]")) close();
    });
    document.addEventListener("keydown", onKey);
  };

  /* ---- 9. Logged-in user identity ----
     The authenticated user's name/email is captured into localStorage at
     sign-in (see firebase-config.js) and read here to replace the static
     placeholder markup on every page. Most app pages don't load the Firebase
     SDK, so localStorage is the shared source of truth for display. Profile
     edits update this store (and Firebase), so the name stays consistent. */
  var USER_KEY = "finwise:user";

  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function setStoredUser(patch) {
    var next = Object.assign({}, getStoredUser(), patch || {});
    try { localStorage.setItem(USER_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }

  // Derive up to two initials from a full name ("Ahmed Khan" -> "AK").
  function initialsFrom(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Paint the stored identity into the shared sidebar/topbar/profile markup.
  // No-ops for any element a given page doesn't have, and never overwrites
  // an <img> avatar or the static placeholder when we don't know the user.
  function applyUserIdentity() {
    var user = getStoredUser();

    // Avatar photo — applied even before a name is known, so an uploaded
    // picture shows on the Dashboard, sidebar, topbar and profile everywhere.
    applyAvatar(user.avatar);

    var name = (user.name || "").trim();
    if (!name) return; // not signed in on this browser — leave text untouched

    var first = name.split(/\s+/)[0];
    var inits = initialsFrom(name);

    document.querySelectorAll(".sidebar__user-name").forEach(function (el) {
      el.textContent = name;
    });
    document.querySelectorAll(".topbar__user span").forEach(function (el) {
      el.textContent = first;
    });
    // Text-based avatars only (skip image avatars) — and only when no photo
    // is set (applyAvatar handles the photo case).
    if (!user.avatar) {
      document.querySelectorAll(".avatar").forEach(function (el) {
        if (el.tagName === "IMG" || el.querySelector("img")) return;
        el.textContent = inits;
      });
    }

    // Profile identity heading, if present.
    document.querySelectorAll("[data-user-title]").forEach(function (el) {
      el.textContent = name;
    });

    // Profile form fields, if present on this page.
    var nameInput = document.querySelector("[data-user-name]");
    if (nameInput && "value" in nameInput) nameInput.value = name;
    var emailInput = document.querySelector("[data-user-email]");
    if (emailInput && "value" in emailInput && user.email) emailInput.value = user.email;
  }

  // Render the uploaded profile photo into every avatar slot on the page.
  // Image avatars (e.g. the profile card) get their src set; div-based text
  // avatars (sidebar/topbar) get it as a cover background with initials cleared.
  function applyAvatar(src) {
    if (!src) return;
    document.querySelectorAll(".avatar").forEach(function (el) {
      if (el.tagName === "IMG") { el.src = src; return; }
      var innerImg = el.querySelector("img");
      if (innerImg) { innerImg.src = src; return; }
      el.textContent = "";
      el.style.backgroundImage = 'url("' + src + '")';
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    });
  }

  // Public API for auth pages (login/signup) and the profile editor.
  window.FinwiseUser = {
    get: getStoredUser,
    set: function (patch) { var u = setStoredUser(patch); applyUserIdentity(); return u; },
    apply: applyUserIdentity,
    initials: initialsFrom,
    clear: function () { try { localStorage.removeItem(USER_KEY); } catch (e) {} },
  };

  /* ---- init ---- */
  document.addEventListener("DOMContentLoaded", function () {
    markActiveNav();
    initNavDrawer();
    initDropdowns();
    initModals();
    initProgressBars();
    initReveals();
    initTableSearch();
    initNotifications();
    applyUserIdentity();
    initCurrency();
  });
})();

/* ============================================================
   FINWISE — API service (frontend)
   ------------------------------------------------------------
   Thin wrapper around fetch() for talking to the FINWISE backend.

   Auth model:
     Protected endpoints require a Firebase ID token in the
     Authorization header. `getIdToken()` awaits the client SDK
     if it's still initialising, so callers don't need to
     coordinate — they just `await` any FinwiseApi.* method.

   Availability:
     The backend may not be reachable during offline demos or
     before the FYP deployment goes live. `isReachable()` runs a
     one-time health check; the caller can decide whether to fall
     back to localStorage (see store.js / budgets.js).

   Every method resolves with the parsed JSON `data` on success
   and REJECTS with an Error whose .message is the server's
   user-friendly error string.
   ============================================================ */
(function () {
  "use strict";

  // Backend base URL. Resolution order:
  //   1. window.FINWISE_API_BASE — set before this script loads to override.
  //   2. Local dev (localhost / 127.0.0.1 / file://) -> local API.
  //   3. Anything else (e.g. the Netlify domain) -> the deployed Render API.
var PROD_API_BASE = "https://finwise-backend-aywx.onrender.com/api";

  var host = (location.hostname || "").toLowerCase();
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "" || location.protocol === "file:";
  var API_BASE =
    window.FINWISE_API_BASE || (isLocal ? "http://localhost:5000/api" : PROD_API_BASE);

  /* ---- Firebase ID token acquisition ---------------------------------- */
  /**
   * Resolve the current user's Firebase ID token (or null if not signed in).
   * Waits briefly for the Firebase compat SDK to finish restoring the session
   * on page load, so callers don't race the SDK.
   */
  function getIdToken() {
    return new Promise(function (resolve) {
      if (typeof firebase === "undefined" || !firebase.auth) return resolve(null);
      var auth = firebase.auth();
      if (auth.currentUser) {
        auth.currentUser.getIdToken().then(resolve, function () { resolve(null); });
        return;
      }
      // Wait for the first auth-state event (usually fires within a tick).
      var unsub = auth.onAuthStateChanged(function (user) {
        try { unsub(); } catch (e) {}
        if (!user) return resolve(null);
        user.getIdToken().then(resolve, function () { resolve(null); });
      });
      // Guard: never hang the UI on a broken SDK.
      setTimeout(function () { try { unsub(); } catch (e) {} resolve(null); }, 3000);
    });
  }

  /* ---- Reachability probe --------------------------------------------- */
  var reachablePromise = null;
  /**
   * One-time GET /health check. Cached for the lifetime of the page. When
   * the backend is offline / mis-configured, callers fall back to
   * localStorage-only mode instead of exploding.
   */
  function isReachable() {
    if (reachablePromise) return reachablePromise;
    reachablePromise = fetch(API_BASE.replace(/\/api\/?$/, "") + "/api/health", {
      method: "GET",
      // A short timeout via AbortSignal so a hung server doesn't stall boot.
      signal: (function () {
        try { return AbortSignal.timeout(4000); } catch (e) { return undefined; }
      })(),
    })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
    return reachablePromise;
  }

  /* ---- Core request helper -------------------------------------------- */
  /**
   * @param {string} method HTTP verb
   * @param {string} path   e.g. "/transactions"
   * @param {object|null} body JSON body (or null for GET/DELETE)
   * @param {{auth?: boolean, query?: object}} [opts]
   */
  function request(method, path, body, opts) {
    opts = opts || {};
    var url = API_BASE + path;
    if (opts.query) {
      var qs = Object.keys(opts.query)
        .filter(function (k) { return opts.query[k] != null && opts.query[k] !== ""; })
        .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(opts.query[k]); })
        .join("&");
      if (qs) url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
    }

    var tokenPromise = opts.auth === false ? Promise.resolve(null) : getIdToken();

    return tokenPromise.then(function (token) {
      var headers = { "Accept": "application/json" };
      if (body != null) headers["Content-Type"] = "application/json";
      if (token) headers["Authorization"] = "Bearer " + token;

      return fetch(url, {
        method: method,
        headers: headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || (data && data.success === false)) {
          var msg = (data && (data.error || data.message)) ||
                    "Something went wrong. Please try again.";
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      if (err instanceof TypeError) {
        var e = new Error("Can't reach the server. Please check your connection.");
        e.status = 0;
        throw e;
      }
      throw err;
    });
  }

  function get(path, query) { return request("GET", path, null, { query: query }); }
  function post(path, body, opts) { return request("POST", path, body || {}, opts); }
  function put(path, body) { return request("PUT", path, body || {}); }
  function del(path) { return request("DELETE", path, null); }

  window.FinwiseApi = {
    // ---- Auth (public) ----
    requestPin: function (email) { return post("/auth/request-pin", { email: email }, { auth: false }); },
    resendPin: function (email) { return post("/auth/resend-pin", { email: email }, { auth: false }); },
    resetPassword: function (email, pin, newPassword) {
      return post("/auth/reset-password", { email: email, pin: pin, newPassword: newPassword }, { auth: false });
    },

    // ---- User profile ----
    getProfile: function () { return get("/user/profile"); },
    updateProfile: function (patch) { return put("/user/profile", patch); },
    getStats: function () { return get("/user/stats"); },

    // ---- Transactions ----
    listTransactions: function (query) { return get("/transactions", query); },
    getTransactionsSummary: function () { return get("/transactions/summary"); },
    getRecentTransactions: function (limit) { return get("/transactions/recent", { limit: limit || 10 }); },
    createTransaction: function (tx) { return post("/transactions", tx); },
    updateTransaction: function (id, patch) { return put("/transactions/" + encodeURIComponent(id), patch); },
    deleteTransaction: function (id) { return del("/transactions/" + encodeURIComponent(id)); },

    // ---- Budgets ----
    listBudgets: function () { return get("/budgets"); },
    createBudget: function (b) { return post("/budgets", b); },
    updateBudget: function (id, patch) { return put("/budgets/" + encodeURIComponent(id), patch); },
    deleteBudget: function (id) { return del("/budgets/" + encodeURIComponent(id)); },
    getBudgetAlerts: function () { return get("/budgets/alerts"); },

    // ---- Analytics ----
    getMonthlyAnalytics: function (year, month) { return get("/analytics/monthly", { year: year, month: month }); },
    getCategoryAnalytics: function (period) { return get("/analytics/categories", { period: period || "month" }); },
    getDailyAnalytics: function (days) { return get("/analytics/daily", { days: days || 30 }); },

    // ---- Utilities ----
    isReachable: isReachable,
    getIdToken: getIdToken,
    baseUrl: function () { return API_BASE; },
  };
})();

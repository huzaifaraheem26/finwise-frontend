/* ============================================================
   FINWISE — Realtime socket bridge
   ------------------------------------------------------------
   Connects to the FINWISE backend over Socket.io using the
   authenticated user's Firebase ID token, and re-dispatches
   incoming events as ordinary `finwise:change` window events so
   the existing store.js / budgets.js re-renders pick them up
   without knowing about sockets.

   Events consumed (server-side emitToUser(...)):
     transaction:created | transaction:updated | transaction:deleted | transaction:imported
     budget:created      | budget:updated      | budget:deleted
     budget:progress     (recomputed spend after a matching expense)

   Load order (on any page that renders live data):
     1. socket.io client script (https://cdn.socket.io/…/socket.io.min.js)
     2. firebase-config.js (ID token source)
     3. api.service.js
     4. THIS FILE (socket.service.js)
     5. store.js / budgets.js / goals.js …

   Safe no-op if:
     • socket.io isn't loaded on the page,
     • the backend base URL isn't reachable,
     • no user is signed in yet (retries when auth state resolves).
   ============================================================ */
(function () {
  "use strict";

  var TX_EVT = "finwise:change";      // matches store.js
  var BUDGET_EVT = "finwise:budgets"; // matches budgets.js
  var GOAL_EVT = "finwise:goals";     // matches goals.js
  var socket = null;

  /* Broadcast a shared "something changed" so store.js / budgets.js re-render.
     We include the raw payload for callers that want it. */
  function broadcast(name, payload) {
    try {
      window.dispatchEvent(new CustomEvent("finwise:realtime", { detail: { name: name, payload: payload } }));
    } catch (e) {}
  }
  function bump(evt) {
    try { window.dispatchEvent(new CustomEvent(evt)); } catch (e) {}
  }

  function baseUrl() {
    if (!window.FinwiseApi || !window.FinwiseApi.baseUrl) return null;
    // Strip trailing /api — socket.io mounts on the root HTTP server.
    return String(window.FinwiseApi.baseUrl()).replace(/\/api\/?$/, "");
  }

  function connect() {
    if (typeof io !== "function") return;                     // socket.io not loaded
    if (!window.FinwiseApi || !window.FinwiseApi.getIdToken) return;

    window.FinwiseApi.getIdToken().then(function (token) {
      if (!token) return;                                    // no user — try again after sign-in
      var url = baseUrl();
      if (!url) return;
      if (socket && socket.connected) return;                // idempotent

      try {
        socket = io(url, {
          auth: { token: token },
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          timeout: 5000,
        });
      } catch (e) { return; }

      socket.on("connect", function () {
        // eslint-disable-next-line no-console
        console.log("[socket] connected", socket.id);
      });

      // Transactions — merge into the local store so re-renders are instant
      // even before a subsequent list refetch completes.
      socket.on("transaction:created", function (tx) {
        if (window.FinwiseStore && window.FinwiseStore.upsertLocal) {
          window.FinwiseStore.upsertLocal(tx, { silent: true });
        }
        broadcast("transaction:created", tx);
        bump(TX_EVT);
      });
      socket.on("transaction:updated", function (tx) {
        if (window.FinwiseStore && window.FinwiseStore.upsertLocal) {
          window.FinwiseStore.upsertLocal(tx, { silent: true });
        }
        broadcast("transaction:updated", tx);
        bump(TX_EVT);
      });
      socket.on("transaction:deleted", function (payload) {
        if (window.FinwiseStore && window.FinwiseStore.removeLocal) {
          window.FinwiseStore.removeLocal(payload && payload.id, { silent: true });
        }
        broadcast("transaction:deleted", payload);
        bump(TX_EVT);
      });
      socket.on("transaction:imported", function (payload) {
        broadcast("transaction:imported", payload);
        // A bulk import needs a fresh list from the server; ask store to refetch.
        if (window.FinwiseStore && window.FinwiseStore.refetch) window.FinwiseStore.refetch();
        bump(TX_EVT);
      });

      // Budgets — bump the budgets event so budgets.js re-fetches / re-renders.
      socket.on("budget:created", function (b) { broadcast("budget:created", b); bump(BUDGET_EVT); });
      socket.on("budget:updated", function (b) { broadcast("budget:updated", b); bump(BUDGET_EVT); });
      socket.on("budget:deleted", function (b) { broadcast("budget:deleted", b); bump(BUDGET_EVT); });
      socket.on("budget:progress", function (p) { broadcast("budget:progress", p); bump(BUDGET_EVT); });

      // Goals — merge into the local cache then bump so goals.js re-renders.
      socket.on("goal:created", function (g) {
        if (window.FinwiseGoals && window.FinwiseGoals.upsertLocal) window.FinwiseGoals.upsertLocal(g);
        broadcast("goal:created", g); bump(GOAL_EVT);
      });
      socket.on("goal:updated", function (g) {
        if (window.FinwiseGoals && window.FinwiseGoals.upsertLocal) window.FinwiseGoals.upsertLocal(g);
        broadcast("goal:updated", g); bump(GOAL_EVT);
      });
      socket.on("goal:deleted", function (g) {
        if (window.FinwiseGoals && window.FinwiseGoals.removeLocal) window.FinwiseGoals.removeLocal(g && g.id);
        broadcast("goal:deleted", g); bump(GOAL_EVT);
      });

      socket.on("disconnect", function (reason) {
        // eslint-disable-next-line no-console
        console.log("[socket] disconnected:", reason);
      });
      socket.on("connect_error", function (err) {
        // Non-fatal — the app keeps working via REST + local cache.
        // eslint-disable-next-line no-console
        console.warn("[socket] connect_error:", err && err.message);
      });
    });
  }

  /* When auth state changes (e.g. user signs in on a page that loaded before
     the SDK finished), (re)connect the socket. */
  function watchAuth() {
    if (typeof firebase === "undefined" || !firebase.auth) return;
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        connect();
      } else if (socket) {
        try { socket.disconnect(); } catch (e) {}
        socket = null;
      }
    });
  }

  // Kick off after the DOM (and other scripts) settle.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { connect(); watchAuth(); });
  } else {
    connect(); watchAuth();
  }

  window.FinwiseSocket = {
    connect: connect,
    disconnect: function () {
      if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
    },
    isConnected: function () { return !!(socket && socket.connected); },
  };
})();

/* ============================================================
   FINWISE — API service (frontend)
   ------------------------------------------------------------
   Thin wrapper around fetch() for talking to the FINWISE backend.
   Loaded on pages that call the REST API (e.g. forget-password.html).

   Exposes window.FinwiseApi with the password-reset-by-PIN methods.
   Every method resolves with the parsed JSON body on success and
   REJECTS with an Error whose .message is the server's user-friendly
   error string, so callers can surface it straight to a toast.
   ============================================================ */
(function () {
  "use strict";

  // Backend base URL. Override before this script loads by setting
  // window.FINWISE_API_BASE (e.g. for a deployed API domain).
  var API_BASE = window.FINWISE_API_BASE || "http://localhost:5000/api";

  /**
   * POST JSON to `path` and normalise the response.
   * @param {string} path  e.g. "/auth/request-pin"
   * @param {object} body  JSON-serialisable request body
   * @returns {Promise<object>} resolves with parsed JSON on 2xx
   * @throws {Error} on non-2xx or network failure; .message is display-ready
   */
  function postJson(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
      .then(function (res) {
        // Parse JSON even on errors (the API returns { success, error }).
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!res.ok || (data && data.success === false)) {
              var msg =
                (data && (data.error || data.message)) ||
                "Something went wrong. Please try again.";
              var err = new Error(msg);
              err.status = res.status;
              throw err;
            }
            return data;
          });
      })
      .catch(function (err) {
        // Distinguish a network/CORS failure (no response) from an API error.
        if (err instanceof TypeError) {
          throw new Error(
            "Can't reach the server. Please check your connection and try again."
          );
        }
        throw err;
      });
  }

  window.FinwiseApi = {
    /** Request a reset PIN. @param {string} email */
    requestPin: function (email) {
      return postJson("/auth/request-pin", { email: email });
    },
    /** Resend a reset PIN. @param {string} email */
    resendPin: function (email) {
      return postJson("/auth/resend-pin", { email: email });
    },
    /**
     * Verify PIN + set a new password.
     * @param {string} email
     * @param {string} pin          6 digits
     * @param {string} newPassword  >= 6 chars
     */
    resetPassword: function (email, pin, newPassword) {
      return postJson("/auth/reset-password", {
        email: email,
        pin: pin,
        newPassword: newPassword,
      });
    },
  };
})();

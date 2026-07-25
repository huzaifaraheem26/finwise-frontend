/* ============================================================
   FINWISE — Firebase client (compat SDK) + Google Sign-In helper
   ------------------------------------------------------------
   Loaded on login.html / signup.html AFTER the Firebase compat
   SDK <script> tags. Exposes:
     window.finwiseAuthReady   — true if Firebase initialised OK
     window.finwiseGoogleSignIn(onError) — popup Google sign-in,
                                  redirects to dashboard on success.
   Everything is guarded so a missing/blocked SDK never throws and
   the rest of the page keeps working.
   ============================================================ */

/* Public web config — safe to ship to the browser (these keys are
   not secrets; access is controlled by Firebase Auth rules / allowed
   domains in the Firebase console). */
var firebaseConfig = {
  apiKey: "AIzaSyCdVQ7PhxFOUs9CQAz-AmWqtUtEtk4KxbE",
  authDomain: "finance-tracker-6eeeb.firebaseapp.com",
  projectId: "finance-tracker-6eeeb",
  storageBucket: "finance-tracker-6eeeb.firebasestorage.app",
  messagingSenderId: "718462533207",
  appId: "1:718462533207:web:7220af46ad76592914ad12"
};

(function () {
  "use strict";

  // The compat SDK must be loaded first (firebase-app-compat + firebase-auth-compat).
  if (typeof firebase === "undefined" || !firebase.initializeApp) {
    // eslint-disable-next-line no-console
    console.warn("[firebase] SDK not loaded — Google Sign-In disabled on this page.");
    window.finwiseAuthReady = false;
    return;
  }

  try {
    // Avoid re-initialising if the script is included more than once.
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    var auth = firebase.auth();
    var googleProvider = new firebase.auth.GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });

    window.auth = auth;
    window.googleProvider = googleProvider;
    window.finwiseAuthReady = true;

    /* Keep the user signed in across reloads/tabs until they explicitly log
       out. LOCAL persistence is Firebase's default, but we set it explicitly
       so a redirect sign-in (mobile) reliably restores the session when the
       page reloads after returning from Google. */
    try {
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) { /* older SDKs already default to LOCAL */ }

    /* Whether the current page is one of the auth pages (login/signup) — used
       to decide when Firebase auth-state changes should auto-redirect to
       the dashboard. */
    function onAuthPage() {
      var page = (location.pathname.split("/").pop() || "").toLowerCase();
      return page === "login.html" || page === "signup.html";
    }

    /**
     * Translate a Firebase auth error into a user-friendly message.
     * @param {{code?: string, message?: string}} err
     * @param {string} fallback
     * @returns {string}
     */
    function mapAuthError(err, fallback) {
      var code = err && err.code;
      switch (code) {
        case "auth/email-already-in-use":
          return "An account with this email already exists. Please sign in instead.";
        case "auth/invalid-email":
          return "That email address doesn't look valid.";
        case "auth/weak-password":
          return "Password is too weak — use at least 6 characters.";
        case "auth/operation-not-allowed":
          return "Email/password sign-in isn't enabled for this project.";
        case "auth/user-disabled":
          return "This account has been disabled.";
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          return "Incorrect email or password.";
        case "auth/expired-action-code":
          return "This reset link has expired. Please request a new one.";
        case "auth/invalid-action-code":
          return "This reset link is invalid or has already been used. Please request a new one.";
        case "auth/missing-email":
          return "Please enter your email address.";
        case "auth/too-many-requests":
          return "Too many attempts. Please wait a moment and try again.";
        case "auth/network-request-failed":
          return "Network error. Check your connection and try again.";
        default:
          return (err && err.message) || fallback;
      }
    }
    window.finwiseMapAuthError = mapAuthError;

    /**
     * Persist the signed-in user's display name + email so every app page
     * (which mostly don't load Firebase) can show it via window.FinwiseUser.
     * Falls back to the email's local-part when no display name is set
     * (e.g. Google accounts without one, or legacy accounts).
     * @param {firebase.User} user
     */
    function persistUser(user) {
      if (!user) return;
      var name =
        (user.displayName && user.displayName.trim()) ||
        (user.email ? user.email.split("@")[0] : "") ||
        "";
      // uid identifies the account and is used by every store to namespace
      // its localStorage cache — so User B on the same browser never sees
      // User A's transactions/budgets/goals/notifications/etc.
      var record = { uid: user.uid || "", name: name, email: user.email || "" };
      // Prefer the shared store API if app.js is loaded; else write directly.
      if (window.FinwiseUser && window.FinwiseUser.set) {
        window.FinwiseUser.set(record);
      } else {
        try { localStorage.setItem("finwise:user", JSON.stringify(record)); } catch (e) {}
      }
    }
    window.finwisePersistUser = persistUser;

    /**
     * Update the signed-in user's display name in Firebase AND the local
     * store, so the change is durable (survives re-login) and reflected
     * across the app immediately. Used by the profile editor.
     * @param {{name: string,
     *          onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseUpdateDisplayName = function (opts) {
      opts = opts || {};
      var name = (opts.name || "").trim();
      var user = auth.currentUser;
      if (!user) {
        // No live session (e.g. served statically): still update local display.
        if (window.FinwiseUser && window.FinwiseUser.set) window.FinwiseUser.set({ name: name });
        if (opts.onError) opts.onError("You're not signed in, so the change was saved locally only.");
        return;
      }
      user
        .updateProfile({ displayName: name })
        .then(function () {
          persistUser(user);
          if (opts.onSuccess) opts.onSuccess();
        })
        .catch(function (err) {
          console.error("[firebase] update-profile error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "Couldn't update your name. Please try again."));
        });
    };

    // Keep the local store in sync with the live Firebase session on any page
    // that loads the SDK (covers refreshes and the profile page). On the auth
    // pages this is also the safety net that completes a mobile Google sign-in:
    // if the browser restored the session after returning from Google but
    // getRedirectResult came back empty (common with third-party-storage
    // blocking), we still detect the signed-in user and move them to the
    // dashboard instead of leaving them stranded on the login page.
    var suppressAuthRedirect = false; // true while email sign-up provisions + signs out
    auth.onAuthStateChanged(function (user) {
      if (!user) return;
      persistUser(user);
      if (onAuthPage() && !suppressAuthRedirect) {
        window.location.replace("dashboard.html");
      }
    });

    /* Complete a Google REDIRECT sign-in. When the browser returns from the
       Google consent screen, getRedirectResult resolves with the signed-in
       user; we persist them and route to the dashboard. Runs once per page
       load on the auth pages that load this SDK. */
    (function handleRedirectResult() {
      // Only meaningful on the login/signup pages (which show a Google button).
      if (!onAuthPage()) return;
      auth
        .getRedirectResult()
        .then(function (result) {
          if (result && result.user) {
            persistUser(result.user);
            window.location.replace("dashboard.html");
          }
          // If result.user is null the session may still be restored via
          // onAuthStateChanged (above) — no need to do anything else here.
        })
        .catch(function (err) {
          // Ignore "no redirect operation" (normal first visit); surface others.
          if (!err || err.code === "auth/no-auth-event") return;
          console.error("[firebase] redirect-result error:", err);
          if (window.showToast) {
            window.showToast(mapAuthError(err, "Google sign-in failed. Please try again."), "danger");
          }
        });
    })();

    /**
     * Create a new account with email + password. On success we set the
     * display name, then sign the user out so they complete a fresh sign-in
     * on the login page (per the intended flow).
     * @param {{name?: string, email: string, password: string,
     *          onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseEmailSignUp = function (opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      // While provisioning we're briefly signed in; suppress the auth-state
      // auto-redirect (introduced for mobile Google flow) so the sign-out
      // below actually lands the user on the login page.
      suppressAuthRedirect = true;
      auth
        .createUserWithEmailAndPassword(opts.email, opts.password)
        .then(function (cred) {
          var user = cred && cred.user;
          var setName =
            opts.name && user
              ? user.updateProfile({ displayName: opts.name })
              : Promise.resolve();
          return setName.then(function () {
            // Persist the chosen name so it shows immediately after the
            // subsequent login (survives the sign-out below). Include the
            // real Firebase uid so stores keyed by uid line up on re-login.
            persistUser({ uid: user && user.uid, displayName: opts.name, email: opts.email });
            // Sign out after provisioning so the login page is a genuine sign-in.
            return auth.signOut();
          });
        })
        .then(function () {
          suppressAuthRedirect = false;
          if (opts.onSuccess) opts.onSuccess();
        })
        .catch(function (err) {
          suppressAuthRedirect = false;
          console.error("[firebase] sign-up error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "Sign-up failed. Please try again."));
        });
    };

    /**
     * Sign in with email + password. On success, redirects to the dashboard
     * (or calls opts.onSuccess if provided).
     * @param {{email: string, password: string,
     *          onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseEmailSignIn = function (opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      auth
        .signInWithEmailAndPassword(opts.email, opts.password)
        .then(function (cred) {
          persistUser(cred && cred.user);
          if (opts.onSuccess) opts.onSuccess();
          else window.location.href = "dashboard.html";
        })
        .catch(function (err) {
          console.error("[firebase] sign-in error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "Sign-in failed. Please check your credentials."));
        });
    };

    /**
     * Send a password-reset email. The reset link routes to our own
     * reset-password.html (Firebase appends ?mode=resetPassword&oobCode=…),
     * so the user lands on the Reset Password page rather than back here.
     * @param {{email: string,
     *          onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseSendResetEmail = function (opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      // Continue URL used by Firebase's action handler to build the reset link.
      var actionCodeSettings = {
        url: window.location.origin + "/reset-password.html",
        handleCodeInApp: false,
      };
      auth
        .sendPasswordResetEmail(opts.email, actionCodeSettings)
        .then(function () {
          if (opts.onSuccess) opts.onSuccess();
        })
        .catch(function (err) {
          console.error("[firebase] reset-email error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "Couldn't send the reset email. Please try again."));
        });
    };

    /**
     * Verify a password-reset code (oobCode) from the email link. Resolves
     * with the account email on success so the page can show it.
     * @param {string} oobCode
     * @param {{onSuccess?: (email: string) => void, onError?: (msg: string) => void}} [opts]
     */
    window.finwiseVerifyResetCode = function (oobCode, opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      auth
        .verifyPasswordResetCode(oobCode)
        .then(function (email) {
          if (opts.onSuccess) opts.onSuccess(email);
        })
        .catch(function (err) {
          console.error("[firebase] verify-reset-code error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "This reset link is invalid or has expired."));
        });
    };

    /**
     * Complete a password reset: set the new password for the code's account.
     * @param {{oobCode: string, password: string,
     *          onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseConfirmReset = function (opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      auth
        .confirmPasswordReset(opts.oobCode, opts.password)
        .then(function () {
          if (opts.onSuccess) opts.onSuccess();
        })
        .catch(function (err) {
          console.error("[firebase] confirm-reset error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "Couldn't reset your password. Please request a new link."));
        });
    };

    /**
     * Change the signed-in user's password. Firebase requires a recent login
     * to change credentials, so we re-authenticate with the CURRENT password
     * first, then update to the new one.
     * @param {{currentPassword: string, newPassword: string,
     *          onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseChangePassword = function (opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      var user = auth.currentUser;
      if (!user || !user.email) {
        if (opts.onError) opts.onError("You're not signed in. Please sign in again to change your password.");
        return;
      }
      var credential = firebase.auth.EmailAuthProvider.credential(user.email, opts.currentPassword);
      user
        .reauthenticateWithCredential(credential)
        .then(function () {
          return user.updatePassword(opts.newPassword);
        })
        .then(function () {
          if (opts.onSuccess) opts.onSuccess();
        })
        .catch(function (err) {
          console.error("[firebase] change-password error:", err);
          if (opts.onError) opts.onError(mapAuthError(err, "Couldn't change your password. Please try again."));
        });
    };

    /**
     * Permanently delete the signed-in user's account. Firebase may require a
     * recent login; if it does, we surface that so the caller can ask the user
     * to re-authenticate (e.g. re-login) and retry.
     * @param {{onSuccess?: () => void, onError?: (msg: string) => void}} opts
     */
    window.finwiseDeleteAccount = function (opts) {
      opts = opts || {};
      if (!window.finwiseAuthReady) {
        if (opts.onError) opts.onError("Authentication is not available right now.");
        return;
      }
      var user = auth.currentUser;
      if (!user) {
        if (opts.onError) opts.onError("You're not signed in.");
        return;
      }
      user
        .delete()
        .then(function () {
          if (opts.onSuccess) opts.onSuccess();
        })
        .catch(function (err) {
          console.error("[firebase] delete-account error:", err);
          if (err && err.code === "auth/requires-recent-login") {
            if (opts.onError) opts.onError("For security, please sign in again, then retry deleting your account.");
          } else if (opts.onError) {
            opts.onError(mapAuthError(err, "Couldn't delete your account. Please try again."));
          }
        });
    };

    /**
     * Trigger Google sign-in via popup on all devices (desktop and mobile).
     * Modern mobile browsers handle popups correctly; the old redirect flow
     * is unreliable on mobile because third-party storage blocking causes
     * getRedirectResult() to return null and onAuthStateChanged never fires,
     * leaving the user stranded on the login page.
     * If the browser explicitly blocks the popup, we fall back to redirect.
     * @param {(msg: string) => void} [onError]
     */
    window.finwiseGoogleSignIn = function (onError) {
      if (!window.finwiseAuthReady) {
        if (onError) onError("Authentication is not available right now.");
        return;
      }

      auth
        .signInWithPopup(googleProvider)
        .then(function (cred) {
          persistUser(cred && cred.user);
          window.location.href = "dashboard.html";
        })
        .catch(function (err) {
          // Silently ignore the user closing the popup; surface real errors.
          var ignore = [
            "auth/popup-closed-by-user",
            "auth/cancelled-popup-request",
            "auth/user-cancelled",
          ];
          if (err && ignore.indexOf(err.code) !== -1) return;
          // If the browser blocked the popup, fall back to the redirect flow.
          // handleRedirectResult + onAuthStateChanged (above) complete the sign-in on return.
          if (err && err.code === "auth/popup-blocked") {
            auth.signInWithRedirect(googleProvider).catch(function (e2) {
              if (onError) onError((e2 && e2.message) || "Google sign-in failed. Please try again.");
            });
            return;
          }
          var msg =
            err && err.code === "auth/unauthorized-domain"
              ? "This domain isn't authorized in Firebase. Add it under Authentication → Settings."
              : (err && err.message) || "Google sign-in failed. Please try again.";
          // eslint-disable-next-line no-console
          console.error("[firebase] Google sign-in error:", err);
          if (onError) onError(msg);
        });
    };

    // eslint-disable-next-line no-console
    console.log("✅ Firebase ready.");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[firebase] init failed:", e);
    window.finwiseAuthReady = false;
  }
})();

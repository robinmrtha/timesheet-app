import { useEffect } from "react";
import { ACCESS_LOGOUT_URL, NOT_SETUP_MESSAGE } from "../../shared/access.js";
import { NO_ACCESS_MESSAGE } from "../../shared/permissions.js";

function logOut() {
  window.location.assign(ACCESS_LOGOUT_URL);
}

export function AccessGate({ reason, email }) {
  const notSetup = reason === "not_setup";
  const noAccess = reason === "no_access";

  useEffect(() => {
    document.title = notSetup
      ? "Account not set up · Himalayan Bazaar"
      : noAccess
        ? "Access needed · Himalayan Bazaar"
        : "Sign in · Himalayan Bazaar";
  }, [notSetup, noAccess]);

  return (
    <div className="login-screen">
      <div className="login-card card">
        <p className="eyebrow">Himalayan Bazaar</p>
        {notSetup ? (
          <>
            <h1>{NOT_SETUP_MESSAGE}</h1>
            {email ? <p className="quiet">Signed in as {email}</p> : null}
            <p className="lede">Timesheet does not have its own password. Robin adds people by the email they use for Cloudflare Access.</p>
          </>
        ) : noAccess ? (
          <>
            <h1>{NO_ACCESS_MESSAGE}</h1>
            {email ? <p className="quiet">Signed in as {email}</p> : null}
            <p className="lede">Your Timesheet account is here, but no section is open for you yet.</p>
          </>
        ) : (
          <>
            <h1>Sign in required</h1>
            <p className="lede">
              Timesheet uses the same Cloudflare Access sign-in as the other tools (Google, or an email code). There is no separate Timesheet password.
            </p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </>
        )}
        <a className="btn btn-quiet btn-block" href="/">
          Home
        </a>
        <button className="btn btn-quiet btn-block" type="button" onClick={logOut}>
          Log out
        </button>
      </div>
    </div>
  );
}

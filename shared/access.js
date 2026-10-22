// Public Access settings shared by the Worker and the browser.
// The team domain is fixed. The application AUD tag is ACCESS_AUD, not this URL.

export const ACCESS_TEAM_URL = "https://hbzr.cloudflareaccess.com";
export const ACCESS_CERTS_URL = `${ACCESS_TEAM_URL}/cdn-cgi/access/certs`;
export const ACCESS_LOGOUT_URL = `${ACCESS_TEAM_URL}/cdn-cgi/access/logout`;
export const ACCESS_ISSUER = ACCESS_TEAM_URL;

export const NOT_SETUP_MESSAGE = "Your account isn't set up in Timesheet. Ask Robin.";

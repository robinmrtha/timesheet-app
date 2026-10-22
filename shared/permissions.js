// Section keys from the hub Worker (hbzr-app, entrypoint Hub).
// Levels are deny-by-default: a missing or unknown value is "none".

export const PERMISSION_SECTIONS = [
  "timesheet.own",
  "timesheet.team",
  "timesheet.payroll",
  "timesheet.admin",
];

export const NO_ACCESS_MESSAGE = "Ask Robin for access.";

const RANK = { none: 0, view: 1, edit: 2 };

export function emptySections() {
  return {
    "timesheet.own": "none",
    "timesheet.team": "none",
    "timesheet.payroll": "none",
    "timesheet.admin": "none",
  };
}

export function emptyPermissions(email = "") {
  return {
    email: email || "",
    active: false,
    isOwner: false,
    sections: emptySections(),
  };
}

export function allows(permissions, section, level = "view") {
  if (!permissions || permissions.active !== true) return false;
  if (!PERMISSION_SECTIONS.includes(section)) return false;
  const actual = permissions.sections?.[section] || "none";
  return (RANK[actual] || 0) >= (RANK[level] || 1);
}

export function hasAnyAccess(permissions) {
  if (!permissions || permissions.active !== true) return false;
  return PERMISSION_SECTIONS.some((section) => allows(permissions, section, "view"));
}

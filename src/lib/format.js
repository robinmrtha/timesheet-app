export function money(value) {
  return (Number(value) || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function hoursText(value) {
  return `${(Number(value) || 0).toFixed(2)} hrs`;
}

export function isoDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthToDate() {
  const now = new Date();
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) };
}

export function formatDate(iso) {
  if (!iso) return "";
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(iso);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function personName(person) {
  const name = person?.name?.trim();
  if (name) return name;
  return person?.email || "Unknown";
}

export function optionLabel(person) {
  const name = personName(person);
  return person?.active === false ? `${name} (inactive)` : name;
}

export function initials(person) {
  const parts = personName(person).split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export function rangeLabel(filters) {
  if (filters.allTime || (!filters.from && !filters.to)) return "All time";
  return `${filters.from || "…"} → ${filters.to || "…"}`;
}

export function entryAmount(entry) {
  return (Number(entry.hours) || 0) * (Number(entry.hourlyRate) || 0);
}

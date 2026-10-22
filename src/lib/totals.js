import { personName } from "./format.js";

function sumHours(entries) {
  return entries.reduce((total, entry) => total + (Number(entry.hours) || 0), 0);
}

function sumPay(entries) {
  return entries.reduce(
    (total, entry) => total + (Number(entry.hours) || 0) * (Number(entry.hourlyRate) || 0),
    0,
  );
}

export function summarize(entries) {
  const paid = entries.filter((entry) => entry.status === "paid");
  const unpaid = entries.filter((entry) => entry.status !== "paid");
  return {
    unpaidCount: unpaid.length,
    paidCount: paid.length,
    totalCount: entries.length,
    unpaidHours: sumHours(unpaid),
    paidHours: sumHours(paid),
    totalHours: sumHours(entries),
    unpaidPay: sumPay(unpaid),
    paidPay: sumPay(paid),
    totalPay: sumPay(entries),
  };
}

export function summarizeByEmployee(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.userId)) {
      map.set(entry.userId, {
        userId: entry.userId,
        name: personName({ name: entry.employeeName, email: entry.employeeEmail }),
        active: entry.employeeActive !== false,
        unpaidHours: 0,
        paidHours: 0,
        totalHours: 0,
        unpaidPay: 0,
        paidPay: 0,
        totalPay: 0,
      });
    }
    const row = map.get(entry.userId);
    const hours = Number(entry.hours) || 0;
    const pay = hours * (Number(entry.hourlyRate) || 0);
    row.totalHours += hours;
    row.totalPay += pay;
    if (entry.status === "paid") {
      row.paidHours += hours;
      row.paidPay += pay;
    } else {
      row.unpaidHours += hours;
      row.unpaidPay += pay;
    }
  }
  return [...map.values()].sort(
    (a, b) => b.unpaidPay - a.unpaidPay || a.name.localeCompare(b.name),
  );
}

import { useState } from "react";
import { monthToDate } from "../lib/format.js";

export function useDateFilters() {
  const initial = monthToDate();
  const [allTime, setAllTimeState] = useState(false);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  function setAllTime(checked) {
    setAllTimeState(checked);
    if (checked) {
      setFrom("");
      setTo("");
      return;
    }
    const next = monthToDate();
    setFrom(next.from);
    setTo(next.to);
  }

  return { allTime, setAllTime, from, setFrom, to, setTo };
}

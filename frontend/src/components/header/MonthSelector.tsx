import { useMonth } from "../../context/MonthContext";
import { currentMonthKey, formatMonthKey } from "../../utils/format";

export function MonthSelector() {
  const { monthKey, goPrev, goNext, goToday } = useMonth();
  const isCurrent = monthKey === currentMonthKey();

  return (
    <div className="month-selector">
      <button className="month-arrow" onClick={goPrev} aria-label="חודש קודם">
        ›
      </button>
      <button
        className={`month-label ${isCurrent ? "" : "month-label-other"}`}
        onClick={goToday}
        title={isCurrent ? "" : "חזרה לחודש הנוכחי"}
      >
        {formatMonthKey(monthKey)}
      </button>
      <button className="month-arrow" onClick={goNext} aria-label="חודש הבא">
        ‹
      </button>
    </div>
  );
}

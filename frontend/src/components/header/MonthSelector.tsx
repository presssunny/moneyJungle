import { useMonth } from "../../context/MonthContext";
import { currentMonthKey, HEBREW_MONTHS } from "../../utils/format";

/** Year range offered in the picker: a few back, one ahead of "today". */
function yearOptions(selectedYear: number): number[] {
  const thisYear = Number(currentMonthKey().split("-")[0]);
  const start = Math.min(thisYear - 5, selectedYear);
  const end = Math.max(thisYear + 1, selectedYear);
  const years: number[] = [];
  for (let y = end; y >= start; y--) years.push(y);
  return years;
}

export function MonthSelector() {
  const { monthKey, setMonthKey, goToday } = useMonth();
  const isCurrent = monthKey === currentMonthKey();

  const [selYear, selMonth] = monthKey.split("-").map(Number);

  function setMonth(month: number) {
    setMonthKey(`${selYear}-${String(month).padStart(2, "0")}`);
  }
  function setYear(year: number) {
    setMonthKey(`${year}-${String(selMonth).padStart(2, "0")}`);
  }

  return (
    <div className="month-selector">
      <select
        className="month-select"
        value={selMonth}
        onChange={(e) => setMonth(Number(e.target.value))}
        aria-label="חודש"
      >
        {HEBREW_MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>

      <select
        className="month-select"
        value={selYear}
        onChange={(e) => setYear(Number(e.target.value))}
        aria-label="שנה"
      >
        {yearOptions(selYear).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      {!isCurrent && (
        <button className="month-today" onClick={goToday} title="חזרה לחודש הנוכחי">
          היום
        </button>
      )}
    </div>
  );
}

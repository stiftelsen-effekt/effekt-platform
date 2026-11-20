import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "react-feather";
import { addDays, calendarDays, monthTitle } from "./giftcardForm";
import styles from "./GiftcardCalendar.module.scss";

const WEEKDAYS = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];

/**
 * A month calendar for the send date (the Figma "Når skal SMS-en leveres?"): ‹ Måned år ›, weeks
 * from Monday, days before `min` disabled. Dates are YYYY-MM-DD in Oslo. Arrow keys move the
 * selected day (a week with up/down), Page Up/Down a month.
 */
export const GiftcardCalendar: React.FC<{
  value: string;
  min: string;
  max?: string;
  onChange: (date: string) => void;
  label: string;
}> = ({ value, min, max, onChange, label }) => {
  const [month, setMonth] = useState(value.slice(0, 7));
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef(false);

  useEffect(() => {
    if (value.slice(0, 7) !== month) setMonth(value.slice(0, 7));
    // Only follow the value when it moves to another month
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [value, month]);

  const allowed = (date: string) => date >= min && (!max || date <= max);
  const days = calendarDays(month);
  const shiftMonth = (by: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    return d.toISOString().slice(0, 7);
  };
  const prevMonth = shiftMonth(-1);
  const nextMonth = shiftMonth(1);
  const canPrev = `${prevMonth}-31` >= min;
  const canNext = !max || `${nextMonth}-01` <= max;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const by: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      PageUp: -30,
      PageDown: 30,
    };
    if (!(e.key in by)) return;
    e.preventDefault();
    const next = addDays(value, by[e.key]);
    if (!allowed(next)) return;
    focusAfterMove.current = true;
    onChange(next);
  };

  return (
    <div className={styles.calendar} role="group" aria-label={label}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.nav}
          onClick={() => setMonth(prevMonth)}
          disabled={!canPrev}
          aria-label="Forrige måned"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span className={styles.month} aria-live="polite">
          {monthTitle(month)}
        </span>
        <button
          type="button"
          className={styles.nav}
          onClick={() => setMonth(nextMonth)}
          disabled={!canNext}
          aria-label="Neste måned"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className={styles.grid} ref={gridRef} onKeyDown={onKeyDown}>
        {WEEKDAYS.map((d) => (
          <span key={d} className={styles.weekday} aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((date, i) =>
          date === null ? (
            <span key={`blank-${i}`} />
          ) : (
            <button
              key={date}
              type="button"
              className={styles.day}
              aria-pressed={date === value}
              aria-label={new Date(`${date}T12:00:00Z`).toLocaleDateString("nb-NO", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
              tabIndex={date === value ? 0 : -1}
              disabled={!allowed(date)}
              onClick={() => onChange(date)}
              data-cy={`giftcard-day-${date}`}
            >
              {Number(date.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  );
};

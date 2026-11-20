import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "react-feather";
import { useClickOutsideAlerter } from "../../../../hooks/useClickOutsideAlerter";
import styles from "./EffektSelect.module.scss";

export type EffektSelectOption<T extends string> = { value: T; label: string };

/**
 * A select in the site's design: a field-like button and a list that opens below it. Works as
 * a listbox from the keyboard (arrows, Home/End, Enter/Space to choose, Escape to close).
 * `inlineLabel` puts a label inside the field, left of the value ("Klokka    16:00").
 */
export function EffektSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  inlineLabel,
  dataCy,
}: {
  value: T;
  options: EffektSelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name (visible label elsewhere, or inlineLabel) */
  label: string;
  inlineLabel?: boolean;
  dataCy?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selectedIndex);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useClickOutsideAlerter(wrapperRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const option = listRef.current?.children[active] as HTMLElement | undefined;
    option?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    setActive(selectedIndex);
    setOpen(true);
  };
  const choose = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const move = (to: number) => {
      e.preventDefault();
      if (!open) openList();
      setActive(Math.min(last, Math.max(0, to)));
    };
    switch (e.key) {
      case "ArrowDown":
        return move(open ? active + 1 : selectedIndex);
      case "ArrowUp":
        return move(open ? active - 1 : selectedIndex);
      case "Home":
        return open && move(0);
      case "End":
        return open && move(last);
      case "Enter":
      case " ":
        e.preventDefault();
        return open ? choose(active) : openList();
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  };

  const selected = options[selectedIndex];

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        className={`${styles.field} ${open ? styles.fieldopen : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={inlineLabel ? undefined : label}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        data-cy={dataCy}
      >
        {inlineLabel && <span className={styles.inlinelabel}>{label}</span>}
        <span className={styles.value}>{selected?.label}</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        className={`${styles.list} ${open ? styles.listopen : ""}`}
        hidden={!open}
      >
        {options.map((option, i) => (
          <div
            key={option.value}
            id={`${id}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={option.value === value}
            className={`${styles.option} ${i === active ? styles.optionactive : ""}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            data-cy={dataCy ? `${dataCy}-option-${option.value}` : undefined}
          >
            <span>{option.label}</span>
            {option.value === value && <span aria-hidden="true">✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

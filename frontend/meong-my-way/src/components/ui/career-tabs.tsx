"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import styles from "./career-workspace.module.css";

export function CareerTabs({ label, tabs }: {
  label: string;
  tabs: { id: string; label: string; icon: ReactNode; content: ReactNode }[];
}) {
  const base = useId();
  const [selected, setSelected] = useState(tabs[0]?.id);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = tabs.some((tab) => tab.id === selected) ? selected : tabs[0]?.id;

  return <>
    <div className={styles.tabs} role="tablist" aria-label={label}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab"
        id={`${base}-${tab.id}`} aria-controls={`${base}-${tab.id}-panel`}
        aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
        ref={(node) => { refs.current[index] = node; }}
        onClick={() => setSelected(tab.id)}
        onKeyDown={(event) => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = tabs.length - 1;
          else return;
          event.preventDefault();
          setSelected(tabs[next].id);
          refs.current[next]?.focus();
        }}>
        {tab.icon}{tab.label}
      </button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" tabIndex={0}
      id={`${base}-${tab.id}-panel`} aria-labelledby={`${base}-${tab.id}`}
      hidden={active !== tab.id} className={styles.panel}>{tab.content}</div>)}
  </>;
}

import { ArrowLeft, ArrowLeftRight } from "lucide-react";

import { Button, SectionLabel } from "@/components/ui/primitives";
import styles from "@/components/ui/career-workspace.module.css";

export function ResultsToolbar({
  eyebrow,
  title,
  switchLabel,
  onBack,
  onSwitch,
}: {
  eyebrow: string;
  title: string;
  switchLabel: string;
  onBack: () => void;
  onSwitch: () => void;
}) {
  return (
    <>
      <header className={styles.resultsHeading}>
        <SectionLabel>{eyebrow}</SectionLabel>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
      </header>

      <nav className={styles.resultsToolbarActions} aria-label="Results navigation">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <Button variant="secondary" size="sm" onClick={onSwitch}>
          <ArrowLeftRight aria-hidden="true" />
          {switchLabel}
        </Button>
      </nav>
    </>
  );
}

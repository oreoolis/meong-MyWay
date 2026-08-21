/**
 * Inline icon set. Kept local rather than pulling in an icon package — the app
 * needs a dozen glyphs and they all inherit `currentColor`.
 */

type IconProps = {
  className?: string;
};

const base = "h-4 w-4 shrink-0";

function Svg({
  className,
  children,
  filled = false,
}: IconProps & { children: React.ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? base}
    >
      {children}
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 12h15m0 0-6-6m6 6-6 6" />
    </Svg>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Svg>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z" />
    </Svg>
  );
}

export function RouteIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <path d="M15 6H9.5A3.5 3.5 0 0 0 6 9.5v0A3.5 3.5 0 0 0 9.5 13h5a3.5 3.5 0 0 1 3.5 3.5v0" />
    </Svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

export function TrendUpIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 17.5 9.5 11l4 4L21 7.5" />
      <path d="M15 7.5h6v6" />
    </Svg>
  );
}

/* --- Status glyphs ------------------------------------------------------- *
 * Each severity gets a distinct shape, so severity survives without color.  */

export function CriticalIcon({ className }: IconProps) {
  return (
    <Svg className={className} filled>
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm1 14.25h-2v-2h2Zm0-3.75h-2v-6h2Z" />
    </Svg>
  );
}

export function SeriousIcon({ className }: IconProps) {
  return (
    <Svg className={className} filled>
      <path d="M12.87 3.4a1 1 0 0 0-1.74 0l-8.5 15A1 1 0 0 0 3.5 20h17a1 1 0 0 0 .87-1.5ZM13 17h-2v-2h2Zm0-3.5h-2V9h2Z" />
    </Svg>
  );
}

export function ModerateIcon({ className }: IconProps) {
  return (
    <Svg className={className} filled>
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm-1 5h2v2h-2Zm3 9.5h-4v-1.75h1V12h-1v-1.75h3v5h1Z" />
    </Svg>
  );
}

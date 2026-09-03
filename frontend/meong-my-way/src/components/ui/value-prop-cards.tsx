import type { ReactNode } from "react";

export type ValueProp = {
  icon: ReactNode;
  title: string;
  body: string;
};

/* Cycles through the app's three existing category hues (see --cat-* in
   globals.css) rather than inventing new colors, keeping these cards tied to
   the same palette used for path-kind badges elsewhere. */
const CARD_TOKENS = ["--cat-progression", "--cat-adjacent", "--cat-pivot"] as const;

export function ValuePropCards({ items }: { items: ValueProp[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {items.map((item, index) => {
        const token = CARD_TOKENS[index % CARD_TOKENS.length];
        return (
          <article
            key={item.title}
            className="mw-rise group relative overflow-hidden rounded-3xl p-6"
            style={{
              animationDelay: `${index * 80}ms`,
              background: `linear-gradient(150deg, color-mix(in srgb, var(${token}) 60%, #0f172a) 0%, #0f172a 100%)`,
            }}
          >
            <span
              aria-hidden="true"
              className="mw-halo pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl"
              style={{ background: `color-mix(in srgb, var(${token}) 70%, white)` }}
            />

            <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur">
              {item.icon}
            </span>

            <h3 className="relative z-10 mt-5 text-[16px] font-semibold tracking-tight text-white">
              {item.title}
            </h3>
            <p className="relative z-10 mt-2 text-[13.5px] leading-relaxed text-white/80">
              {item.body}
            </p>
          </article>
        );
      })}
    </div>
  );
}

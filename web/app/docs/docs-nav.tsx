"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/styles";

export type DocsSection = { id: string; label: string };

/** Watches which section is on screen, so the nav can mark it. */
function useActiveSection(sections: DocsSection[]) {
  const [active, setActive] = useState(sections[0].id);
  useEffect(() => {
    let raf = 0;
    // The active section is the last one whose top has scrolled past the sticky header.
    const update = () => {
      raf = 0;
      let current = sections[0].id;
      for (const { id } of sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onScroll);
    };
  }, [sections]);
  return active;
}

function Links({ sections, active, onPick }: { sections: DocsSection[]; active: string; onPick?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            onClick={onPick}
            aria-current={active === s.id ? "location" : undefined}
            className={cx(
              "block rounded-lg px-3 py-1.5 text-sm transition-colors duration-150",
              active === s.id ? "bg-brand-soft font-semibold text-brand-ink" : "text-muted hover:bg-sunken hover:text-ink",
            )}
          >
            {s.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Sticky list on desktop. */
export function DocsSidebar({ sections }: { sections: DocsSection[] }) {
  const active = useActiveSection(sections);
  return (
    <nav aria-label="On this page" className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto pb-8 lg:block">
      <p className="mb-2 px-3 text-[13px] font-medium text-muted">On this page</p>
      <Links sections={sections} active={active} />
    </nav>
  );
}

/** Collapsible list on phones and tablets. Closes after a pick. */
export function DocsMobileNav({ sections }: { sections: DocsSection[] }) {
  const active = useActiveSection(sections);
  const ref = useRef<HTMLDetailsElement>(null);
  const label = sections.find((s) => s.id === active)?.label ?? sections[0].label;
  return (
    <details ref={ref} className="faq glass sticky top-[3.75rem] z-10 -mx-4 border-b border-line px-4 sm:-mx-8 sm:px-8 lg:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm">
        <span className="text-muted">
          On this page: <span className="font-semibold text-ink">{label}</span>
        </span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="max-h-[60dvh] overflow-y-auto overscroll-contain pb-3">
        <Links sections={sections} active={active} onPick={() => ref.current?.removeAttribute("open")} />
      </div>
    </details>
  );
}

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { cx } from "./styles";

/**
 * Light, dark, or follow the system.
 *
 * The site follows the operating system through CSS alone, so there is no inline script (it keeps
 * a strict Content Security Policy simple). Choosing Light or Dark here sets data-theme on <html>
 * and remembers it in this browser. Someone who picked the opposite of their system theme may see
 * the system theme for a moment while the page loads.
 */
export type ThemeChoice = "system" | "light" | "dark";
const KEY = "theme";
const COLORS = { light: "#f6f7f9", dark: "#0a0b0d" };

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  // Keep the phone status bar in step with the page.
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (choice === "system") {
      const media = m.getAttribute("media") ?? "";
      m.setAttribute("content", media.includes("dark") ? COLORS.dark : COLORS.light);
    } else m.setAttribute("content", dark ? COLORS.dark : COLORS.light);
  });
}

/** Applies a saved choice once, as early as the app mounts. Rendered by Providers. */
export function ThemeSync() {
  useEffect(() => {
    apply(read());
  }, []);
  return null;
}

const EVENT = "themechange";
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useTheme() {
  // Every toggle on the page stays in step, and the server render assumes "system".
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, read, () => "system");
  const set = useCallback((c: ThemeChoice) => {
    try {
      if (c === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    apply(c);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { choice, set };
}

const ICONS: Record<ThemeChoice, string> = {
  system: "M4 5h16v11H4zM9 20h6M12 16v4",
  light: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 100-8 4 4 0 000 8z",
  dark: "M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z",
};
const LABELS: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** Three small icon buttons: system, light, dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { choice, set } = useTheme();
  return (
    <div role="radiogroup" aria-label="Colour theme" className={cx("track inline-flex rounded-full p-0.5", className)}>
      {(Object.keys(ICONS) as ThemeChoice[]).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={choice === c}
          aria-label={LABELS[c]}
          title={LABELS[c]}
          onClick={() => set(c)}
          className={cx(
            "grid h-7 w-7 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-150 pointer-coarse:h-9 pointer-coarse:w-9",
            choice === c ? "thumb text-ink" : "text-muted hover:text-ink",
          )}
        >
          <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={ICONS[c]} />
          </svg>
        </button>
      ))}
    </div>
  );
}

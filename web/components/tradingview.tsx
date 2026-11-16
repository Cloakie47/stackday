"use client";

import { useEffect, useRef, useState } from "react";
import { TV_SCRIPT_BASE } from "@/lib/charts";

const scripts = new Map<string, Promise<void>>();

/** Loads one TradingView widget script once per page (shared by every instance). */
function loadWidget(name: string): Promise<void> {
  let p = scripts.get(name);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      if (customElements.get(name)) return resolve();
      const s = document.createElement("script");
      s.type = "module";
      s.src = `${TV_SCRIPT_BASE}/${name}.js`;
      s.onload = () => void customElements.whenDefined(name).then(() => resolve());
      s.onerror = () => {
        scripts.delete(name);
        s.remove();
        reject(new Error(`Could not load ${name}`));
      };
      document.head.appendChild(s);
    });
    scripts.set(name, p);
  }
  return p;
}

export type WidgetState = "waiting" | "loading" | "ready" | "error";

/**
 * Mounts a TradingView web component (for example tv-advanced-chart) inside this box once the box
 * scrolls into view, so pages do not load chart code they never show. Attributes: `true` adds a
 * boolean attribute, `false` leaves it out. Changing attributes rebuilds the widget.
 */
export function TvWidget({
  name,
  attrs,
  className,
  onState,
  retry = 0,
}: {
  name: string;
  attrs: Record<string, string | boolean>;
  className?: string;
  onState?: (s: WidgetState) => void;
  /** Bump to try loading again after an error. */
  retry?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const key = JSON.stringify(attrs);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    const host = box.current;
    if (!visible || !host) return;
    let cancelled = false;
    onState?.("loading");
    loadWidget(name).then(
      () => {
        if (cancelled) return;
        const w = document.createElement(name);
        for (const [k, v] of Object.entries(JSON.parse(key) as Record<string, string | boolean>)) {
          if (v === true) w.setAttribute(k, "");
          else if (v !== false) w.setAttribute(k, v);
        }
        w.style.display = "block";
        w.style.width = "100%";
        w.style.height = "100%";
        host.replaceChildren(w);
        onState?.("ready");
      },
      () => !cancelled && onState?.("error"),
    );
    return () => {
      cancelled = true;
      host.replaceChildren();
    };
    // onState is a callback from the parent; rebuilding only on real changes is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, name, key, retry]);

  return <div ref={box} className={className} />;
}

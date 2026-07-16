"use client";
import * as React from "react";

/**
 * Theme state. The no-flash initial value is set by the inline script in layout.tsx
 * (before paint). This provider just reflects/toggles it and persists to localStorage.
 * masteryColor() needs the mode, so components read it via useTheme().
 */
type Mode = "dark" | "light";
const ThemeCtx = React.createContext<Mode>("dark");
const ToggleCtx = React.createContext<() => void>(() => {});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<Mode>("dark");

  React.useEffect(() => {
    // sync to whatever the pre-paint script already stamped on <html>
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") setMode(attr);
  }, []);

  const toggle = React.useCallback(() => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch {}
      return next;
    });
  }, []);

  return (
    <ThemeCtx.Provider value={mode}>
      <ToggleCtx.Provider value={toggle}>{children}</ToggleCtx.Provider>
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => React.useContext(ThemeCtx);
export const useThemeToggle = () => React.useContext(ToggleCtx);

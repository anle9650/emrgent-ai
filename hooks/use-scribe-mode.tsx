"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ScribeMode = "chat" | "scribe";

const STORAGE_KEY = "scribe-mode";

type ScribeModeContextValue = {
  mode: ScribeMode;
  setMode: (mode: ScribeMode) => void;
};

const ScribeModeContext = createContext<ScribeModeContextValue | null>(null);

export function ScribeProvider({ children }: { children: ReactNode }) {
  // Always render "chat" on the server and first client paint; the stored
  // preference is applied in an effect to avoid a hydration mismatch.
  const [mode, setModeState] = useState<ScribeMode>("chat");

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "scribe") {
      setModeState("scribe");
    }
  }, []);

  const value = useMemo<ScribeModeContextValue>(
    () => ({
      mode,
      setMode: (next) => {
        setModeState(next);
        localStorage.setItem(STORAGE_KEY, next);
      },
    }),
    [mode]
  );

  return (
    <ScribeModeContext.Provider value={value}>
      {children}
    </ScribeModeContext.Provider>
  );
}

export function useScribeMode() {
  const context = useContext(ScribeModeContext);
  if (!context) {
    throw new Error("useScribeMode must be used within ScribeProvider");
  }
  return context;
}

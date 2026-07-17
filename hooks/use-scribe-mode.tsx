"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ScribeMode = "chat" | "scribe";

const STORAGE_KEY = "scribe-mode";

// Same shape as use-active-chat's extractChatId — duplicated because
// importing it would create a module cycle (use-active-chat → sidebar-history
// → use-scribe-mode).
function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

type ScribeModeContextValue = {
  /** The committed mode — flips when a toggle's navigation lands. Drives
   * what the shell and sidebar history render. */
  mode: ScribeMode;
  /** The mode a mid-navigation toggle is heading to, or null. The sidebar
   * control highlights `pendingMode ?? mode` so clicks respond instantly. */
  pendingMode: ScribeMode | null;
  setMode: (mode: ScribeMode) => void;
  /** Navigate back to the scribe new-session page (the recording panel when
   * a session is live) — unlike setMode("scribe"), which would restore
   * scribe mode's remembered chat. */
  returnToScribeSession: () => void;
};

const ScribeModeContext = createContext<ScribeModeContextValue | null>(null);

export function ScribeProvider({ children }: { children: ReactNode }) {
  // Always render "chat" on the server and first client paint; the stored
  // preference is applied in an effect to avoid a hydration mismatch.
  const [mode, setModeState] = useState<ScribeMode>("chat");
  const pathname = usePathname();
  const router = useRouter();

  // Each mode remembers its own selected chat (null = the new-session page),
  // so toggling restores where you left off in each mode. Per-tab memory
  // only: on reload the URL wins and is re-recorded under the restored mode.
  const selectedChatByMode = useRef<Record<ScribeMode, string | null>>({
    chat: null,
    scribe: null,
  });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // A toggle whose navigation hasn't committed yet. The mode state flips
  // only when the target URL lands (see the layout effect below) — flipping
  // it immediately would render the incoming mode against the outgoing URL
  // for a few frames, flashing the new-session page before the selected
  // chat appears. Mirrored in state so the sidebar control can highlight
  // the target segment without waiting for the navigation.
  const pendingModeRef = useRef<ScribeMode | null>(null);
  const [pendingMode, setPendingMode] = useState<ScribeMode | null>(null);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "scribe") {
      modeRef.current = "scribe";
      setModeState("scribe");
    }
  }, []);

  // Commit a pending toggle and record the selection under the ACTIVE mode
  // whenever the URL changes. Layout effect, so the mode flips before the
  // new URL's frame paints. Keyed off pathname alone (mode read from refs)
  // so nothing re-records the outgoing chat under the incoming mode. Within
  // a mode this keeps the remembered chat equal to the visible one, so
  // deleting the active chat (which navigates to "/") also clears the
  // memory.
  useLayoutEffect(() => {
    if (pendingModeRef.current) {
      modeRef.current = pendingModeRef.current;
      pendingModeRef.current = null;
      setModeState(modeRef.current);
      setPendingMode(null);
    }
    selectedChatByMode.current[modeRef.current] = extractChatId(pathname);
  }, [pathname]);

  const value = useMemo<ScribeModeContextValue>(
    () => ({
      mode,
      pendingMode,
      setMode: (next) => {
        const hadPending = pendingModeRef.current !== null;
        if (next === (pendingModeRef.current ?? modeRef.current)) {
          return;
        }
        localStorage.setItem(STORAGE_KEY, next);
        const targetId = selectedChatByMode.current[next];
        // window.location, not a captured pathname — this closure only
        // refreshes when `mode` changes, and ScribeFlow navigates via
        // pushState which updates location synchronously.
        const currentId = extractChatId(window.location.pathname);
        if (targetId === currentId && !hadPending) {
          // Already at the target URL (e.g. both modes on new-session) —
          // no navigation will fire, so flip immediately.
          modeRef.current = next;
          setModeState(next);
          return;
        }
        // A rapid re-toggle mid-navigation still pushes: the in-flight
        // navigation will land first, then this one wins.
        pendingModeRef.current = next;
        setPendingMode(next);
        router.push(targetId ? `/chat/${targetId}` : "/");
      },
      returnToScribeSession: () => {
        localStorage.setItem(STORAGE_KEY, "scribe");
        // The panel IS the new-session page, so it becomes scribe mode's
        // remembered selection.
        selectedChatByMode.current.scribe = null;
        const atNewSession = extractChatId(window.location.pathname) === null;
        const inScribeMode =
          (pendingModeRef.current ?? modeRef.current) === "scribe";
        if (inScribeMode) {
          if (!atNewSession) {
            router.push("/");
          }
          return;
        }
        if (atNewSession && pendingModeRef.current === null) {
          // Already at the target URL — no navigation will fire to commit a
          // pending mode, so flip immediately (same as setMode's early path).
          modeRef.current = "scribe";
          setModeState("scribe");
          return;
        }
        pendingModeRef.current = "scribe";
        setPendingMode("scribe");
        router.push("/");
      },
    }),
    [mode, pendingMode, router]
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

import React, { createContext, useContext, useSyncExternalStore, useRef, useCallback } from "react";
import type { InkRunView } from "./ink-state.js";
import { InkRuntimeStore } from "./ink-runtime-store.js";
import type { UiEvent } from "../event-bus.js";

interface InkRuntimeContextValue {
  store: InkRuntimeStore;
}

const InkRuntimeContext = createContext<InkRuntimeContextValue | null>(null);

export interface InkRuntimeProviderProps {
  store: InkRuntimeStore;
  children: React.ReactNode;
}

export function InkRuntimeProvider({ store, children }: InkRuntimeProviderProps) {
  const value = useRef({ store }).current;
  return React.createElement(InkRuntimeContext.Provider, { value }, children);
}

export function useInkRuntimeState(): InkRunView {
  const ctx = useContext(InkRuntimeContext);
  if (!ctx) {
    throw new Error("useInkRuntimeState must be used inside InkRuntimeProvider");
  }
  const { store } = ctx;
  const getSnapshot = useCallback(() => store.getState(), [store]);
  return useSyncExternalStore((cb) => store.subscribe(cb), getSnapshot, getSnapshot);
}

export function useInkRuntimeDispatch(): (event: UiEvent) => void {
  const ctx = useContext(InkRuntimeContext);
  if (!ctx) {
    throw new Error("useInkRuntimeDispatch must be used inside InkRuntimeProvider");
  }
  return ctx.store.dispatch.bind(ctx.store);
}

import React from "react";
import { render } from "ink";
import type { EventBus } from "../event-bus.js";
import type { UiEvent } from "../event-bus.js";
import { InkRuntimeStore } from "./ink-runtime-store.js";
import { InkRuntimeProvider } from "./InkRuntimeProvider.js";
import { InkApp } from "./InkApp.js";

export class InkRenderer {
  private store: InkRuntimeStore;
  private unsubscribeEventBus: (() => void) | null = null;
  private renderInstance: ReturnType<typeof render> | null = null;

  constructor() {
    this.store = new InkRuntimeStore();
  }

  subscribe(eventBus: EventBus): () => void {
    try {
      this.renderInstance = render(
        React.createElement(InkRuntimeProvider, {
          store: this.store,
          children: React.createElement(InkApp),
        }),
        { exitOnCtrlC: false },
      );
    } catch {
      // Ink unavailable — fallback is handled by the caller
      this.renderInstance = null;
    }

    this.unsubscribeEventBus = eventBus.subscribe((event: UiEvent) => {
      this.store.dispatch(event);
    });

    return () => {
      this.close();
    };
  }

  async close(): Promise<void> {
    if (this.unsubscribeEventBus) {
      this.unsubscribeEventBus();
      this.unsubscribeEventBus = null;
    }
    if (this.renderInstance) {
      this.renderInstance.unmount();
      this.renderInstance = null;
    }
    this.store.close();
  }

  getStore(): InkRuntimeStore {
    return this.store;
  }
}

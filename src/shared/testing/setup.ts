import "@testing-library/jest-dom/vitest";

// jsdom doesn't ship a ResizeObserver — Headless UI's Combobox uses one to
// reposition the listbox panel on resize. A no-op stub is enough for tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

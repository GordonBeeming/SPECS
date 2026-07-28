import "@testing-library/jest-dom/vitest";

// jsdom doesn't ship a ResizeObserver — Headless UI's Combobox uses one to
// reposition the listbox panel on resize. A no-op stub is enough for tests.
//
// It is not enough for React Flow, and the failure is silent. React Flow
// only computes an edge's path once its source and target handles have
// been measured, and that measurement is ResizeObserver-driven — so with
// a stub that never fires, zero edges render in jsdom no matter what the
// component does. A test asserting on `.react-flow__edge` nodes or on
// rendered SVG paths will fail against correct code and look like a
// component bug.
//
// Test the data-shaping function instead: `buildNetworkEdges` in
// `features/network/edgeStyle.ts` exists as a pure function for exactly
// this reason, and is where the parallel-edge behaviour is actually
// covered.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

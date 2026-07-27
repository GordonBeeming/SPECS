import { describe, it, expect } from "vitest";

describe("RAF probe", () => {
  it("times requestAnimationFrame in this jsdom environment", async () => {
    const start = performance.now();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        console.log("RAF fired after ms:", performance.now() - start);
        resolve();
      });
    });
    expect(true).toBe(true);
  });

  it("times RAF under simulated CPU load (busy loop before scheduling check)", async () => {
    const start = performance.now();
    let fired = false;
    requestAnimationFrame(() => {
      fired = true;
      console.log("RAF (under load) fired after ms:", performance.now() - start);
    });
    // Simulate CPU contention: a synchronous busy loop for ~50ms right after scheduling.
    const busyUntil = performance.now() + 50;
    while (performance.now() < busyUntil) { /* spin */ }
    console.log("busy loop done at ms:", performance.now() - start, "fired already?", fired);
    await new Promise((r) => setTimeout(r, 100));
    console.log("fired after 100ms wait:", fired);
  });
});

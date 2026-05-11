import { afterEach, describe, expect, it } from "vitest";
import { useUndoStore } from "./store";

afterEach(() => {
  useUndoStore.getState().reset();
});

describe("undo store", () => {
  it("runs apply when pushed, runs reverse on undo, runs apply again on redo", async () => {
    let value = 0;
    const action = {
      apply: () => {
        value = 1;
      },
      reverse: () => {
        value = 0;
      },
      label: "Set value to 1",
    };
    await useUndoStore.getState().push(action);
    expect(value).toBe(1);

    await useUndoStore.getState().undo();
    expect(value).toBe(0);

    await useUndoStore.getState().redo();
    expect(value).toBe(1);
  });

  it("never lands an action on the stack if apply throws", async () => {
    const action = {
      apply: () => {
        throw new Error("nope");
      },
      reverse: () => {
        throw new Error("must not run");
      },
      label: "Broken",
    };
    await expect(useUndoStore.getState().push(action)).rejects.toThrow("nope");
    expect(useUndoStore.getState().past).toHaveLength(0);
  });

  it("invalidates the redo stack on a fresh push", async () => {
    const noop = (label: string) => ({
      apply: () => {},
      reverse: () => {},
      label,
    });
    await useUndoStore.getState().push(noop("first"));
    await useUndoStore.getState().push(noop("second"));
    await useUndoStore.getState().undo();
    expect(useUndoStore.getState().future).toHaveLength(1);
    await useUndoStore.getState().push(noop("third"));
    expect(useUndoStore.getState().future).toHaveLength(0);
  });

  it("caps the past at 50 actions", async () => {
    const noop = (label: string) => ({
      apply: () => {},
      reverse: () => {},
      label,
    });
    for (let i = 0; i < 60; i += 1) {
      await useUndoStore.getState().push(noop(`action ${i}`));
    }
    expect(useUndoStore.getState().past).toHaveLength(50);
    // The oldest entries are dropped, not the most recent.
    expect(useUndoStore.getState().past[0].label).toBe("action 10");
    expect(useUndoStore.getState().past[49].label).toBe("action 59");
  });
});

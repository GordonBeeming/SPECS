import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { RateInput } from "./RateInput";

describe("<RateInput />", () => {
  it("commits as soon as the typed text is a usable rate", () => {
    const onCommit = vi.fn();
    render(<RateInput value={0} onCommit={onCommit} ariaLabel="rate" />);
    fireEvent.change(screen.getByLabelText("rate"), { target: { value: "2.5" } });
    expect(onCommit).toHaveBeenCalledWith(2.5);
  });

  // Number("2.") === 2, so a naive parse would commit 2 the moment the user
  // types the decimal point while still working toward "2.5" — a real
  // regression this test pins.
  it("treats a trailing decimal point as not-yet-a-rate, not a truncated commit", () => {
    const onCommit = vi.fn();
    const onInvalidChange = vi.fn();
    render(
      <RateInput value={0} onCommit={onCommit} ariaLabel="rate" onInvalidChange={onInvalidChange} />,
    );
    const input = screen.getByLabelText("rate");
    fireEvent.change(input, { target: { value: "2." } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onInvalidChange).toHaveBeenLastCalledWith(true);

    fireEvent.change(input, { target: { value: "2.5" } });
    expect(onCommit).toHaveBeenCalledWith(2.5);
    expect(onInvalidChange).toHaveBeenLastCalledWith(false);
  });
});

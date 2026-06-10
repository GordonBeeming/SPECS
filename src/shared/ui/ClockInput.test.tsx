import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ClockInput } from "./ClockInput";

describe("<ClockInput />", () => {
  it("accepts a precise typed value like 101", () => {
    const onChange = vi.fn();
    render(<ClockInput value={100} onChange={onChange} ariaLabel="Clock percent" />);
    fireEvent.change(screen.getByLabelText("Clock percent"), { target: { value: "101" } });
    expect(onChange).toHaveBeenCalledWith(101);
  });

  it("keeps decimals on the typed input", () => {
    const onChange = vi.fn();
    render(<ClockInput value={100} onChange={onChange} ariaLabel="Clock percent" />);
    fireEvent.change(screen.getByLabelText("Clock percent"), { target: { value: "150.5" } });
    expect(onChange).toHaveBeenCalledWith(150.5);
    // Two decimals is the storage precision; extra digits round.
    fireEvent.change(screen.getByLabelText("Clock percent"), { target: { value: "100.005" } });
    expect(onChange).toHaveBeenLastCalledWith(100.01);
  });

  it("ignores out-of-range values until corrected", () => {
    const onChange = vi.fn();
    render(<ClockInput value={100} onChange={onChange} ariaLabel="Clock percent" />);
    const input = screen.getByLabelText("Clock percent");
    fireEvent.change(input, { target: { value: "999" } });
    expect(onChange).not.toHaveBeenCalled();
    // Correcting to an in-range value commits normally.
    fireEvent.change(input, { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith(99);
  });

  it("slider scrubs in whole steps", () => {
    const onChange = vi.fn();
    render(<ClockInput value={150.5} onChange={onChange} ariaLabel="Clock percent" />);
    const slider = screen.getByLabelText("Clock percent slider");
    expect(slider).toHaveAttribute("step", "1");
    // The slider shows the rounded value but doesn't fire on render.
    expect((slider as HTMLInputElement).value).toBe("151");
    fireEvent.change(slider, { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith(200);
  });

  it("hides the slider when slider={false}", () => {
    render(<ClockInput value={100} onChange={() => {}} slider={false} ariaLabel="Clock percent" />);
    expect(screen.queryByLabelText("Clock percent slider")).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { UncollectedAltsBanner } from "./PlanWarningsBanner";

describe("<UncollectedAltsBanner />", () => {
  it("renders nothing when the solve doesn't lean on any uncollected alt", () => {
    const { container } = render(<UncollectedAltsBanner names={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the count and the recipes, singular for one", () => {
    render(<UncollectedAltsBanner names={["Alternate: Fused Quartz Crystal"]} />);
    expect(screen.getByText("Leans on 1 uncollected alt")).toBeInTheDocument();
    expect(screen.getByText(/Alternate: Fused Quartz Crystal/)).toBeInTheDocument();
  });

  it("pluralises and lists every alt for more than one", () => {
    // #91: a Tier 6 plan looked unbuildable and was actually fine — it
    // leaned on three uncollected alts nobody had scanned yet.
    render(
      <UncollectedAltsBanner
        names={[
          "Alternate: Fused Quartz Crystal",
          "Alternate: Insulated Crystal Oscillator",
          "Alternate: Plastic AI Limiter",
        ]}
      />,
    );
    expect(screen.getByText("Leans on 3 uncollected alts")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Fused Quartz Crystal.*Insulated Crystal Oscillator.*Plastic AI Limiter/,
      ),
    ).toBeInTheDocument();
  });
});

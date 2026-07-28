import { describe, expect, it } from "vitest";

// Vite's `?raw` import loads the file as a plain string at build/test time —
// no Node `fs` access, so this works under the browser-flavoured tsconfig
// these tests otherwise share with the app code (`vite/client`'s ambient
// `*.rs?raw` etc. module declarations cover the typing).
import dtoSource from "../../../src-tauri/src/features/validation/dto.rs?raw";
import typesSource from "./types.ts?raw";
import panelSource from "./components/ValidationPanel.tsx?raw";

/**
 * `FindingKind` in `types.ts` is a hand-maintained mirror of the Rust
 * `FindingKind` enum, and `ValidationPanel.tsx`'s `findingText` switch is
 * hand-maintained again on top of that — nothing in the build compares
 * either to the source of truth. tsc only checks the switch against the
 * TS union it already knows about, so a new Rust variant can ship with no
 * TS member and no findingText case and render as a blank row (#93).
 *
 * This test reads both source files as text and cross-checks variant
 * names directly, so it fails the moment the Rust enum gains a variant
 * that either file hasn't caught up with — independent of what tsc
 * considers exhaustive.
 */
describe("FindingKind stays in sync across Rust and both TS mirrors", () => {
  const enumBody = dtoSource.match(/pub enum FindingKind \{([\s\S]*?)\n\}/)?.[1];
  if (!enumBody) {
    throw new Error("couldn't find `pub enum FindingKind` in dto.rs — did it move or rename?");
  }

  // Every variant in this enum is struct-like ("Name { field: Type, ... }"),
  // so a top-level (4-space-indented) identifier followed by `{` is a variant
  // name; doc comments and nested field lines don't match this indentation.
  const variantNames = [...enumBody.matchAll(/^ {4}(\w+) \{/gm)].map((m) => m[1]);
  // Guards the guard: if the enum's shape changes so the regex stops
  // matching anything, fail loudly instead of passing on an empty list.
  expect(variantNames.length).toBeGreaterThan(0);

  // Scope the search to `findingText`'s own body. `ValidationPanel.tsx` has
  // a second switch (`findingTarget`) over the same `Finding["kind"]` union
  // for routing — matching a bare `case "<kind>":` against the whole file
  // would pass as long as *either* switch has the case, which defeats the
  // point: it's specifically findingText whose gap renders a blank row.
  const findingTextBody = panelSource.match(
    /function findingText\(f: Finding\): string \{([\s\S]*?)\n\}/,
  )?.[1];
  if (!findingTextBody) {
    throw new Error(
      "couldn't find `function findingText(f: Finding): string` in ValidationPanel.tsx — did it move or rename?",
    );
  }

  const toCamelCase = (pascal: string) => pascal[0].toLowerCase() + pascal.slice(1);

  it.each(variantNames)("%s has a TS union member and a findingText case", (variantName) => {
    const kind = toCamelCase(variantName);
    expect(typesSource, `types.ts is missing the "${kind}" union member`).toMatch(
      new RegExp(`kind: "${kind}"`),
    );
    expect(
      findingTextBody,
      `ValidationPanel.tsx's findingText is missing a case for "${kind}"`,
    ).toMatch(new RegExp(`case "${kind}":`));
  });
});

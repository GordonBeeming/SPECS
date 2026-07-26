# Hesitation log — 2026-07-26-first-light

Cleared at each checkpoint once entries are filed.

## Tier 0

Filed and cleared: the game-version stamp (#42), and the alt unlock tiers plus
the Refinery-at-Tier-0 plan they cause (#41).

Still open, both minor, to weigh at the next checkpoint:

- **Screen:** Factories, empty state
  **Doing:** landing on the page before creating the first factory
  **Expected:** a card sized to its content
  **Got:** the empty-state card stretches the full viewport height for a single
  line of text, on a 2488px-wide window. Reads as a rendering glitch rather than
  an intentional empty state.
  **Shot:** not captured — trivially reproducible on any empty playthrough

- **Screen:** New playthrough dialog, and the product picker
  **Doing:** reading them before filling them in
  **Expected:** nothing in particular — noting these as positives worth keeping
  **Got:** the dialog's helper text says what the choice *does* ("Library entries
  above this tier will be marked as locked") rather than just naming the field,
  and the product picker groups results under a TIER 0 heading so you can see
  what's actually reachable. The factory editor's opening prompt ("the production
  graph builds itself… can all change later") lowers the stakes of the first
  decision. These are the patterns the rest of the app should be measured against.

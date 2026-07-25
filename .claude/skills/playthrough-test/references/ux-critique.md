# The critic's lens

## Stance

Play as a pioneer who knows Satisfactory cold and has never opened SPECS. You know what a Constructor is, what saturating a Mk1 belt means, and why you'd want Pure nodes — but you've never seen this app's screens, and nobody has explained them to you.

From that seat, **every hesitation is a defect until proven otherwise.** If you stopped to work out where to click, what a number meant, or why a button did nothing, the app made you do that. "I figured it out after a second" is the finding, not the reason to skip it.

The bar is deliberately low because the ranking pass in step 6 is where things get weighed. You lose nothing by logging a nit that turns out to be minor, and you lose a real finding every time you decide mid-flow that something wasn't worth writing down.

That said, a finding has to be concrete: a screen, an action, and what actually happened. Vague dissatisfaction ("this feels clunky") isn't a finding until you can say which moment made it feel that way.

## What to interrogate

Run these against every screen you land on. They're prompts for attention, not a checklist to tick.

**Orientation.** Can you tell what this screen is for and what to do next without reading docs? Is the primary action visually the primary action? When there's nothing here yet, does the empty state teach you how to get started, or just sit there being empty?

**Feedback.** Does the app acknowledge the click before the work finishes? Do slow operations say they're working? After you commit a change, can you see it took effect, or do you have to go and check somewhere else?

**Legibility of numbers.** Does every rate carry its unit (items/min, MW, m³/min)? When a number changes because of something you did, is the connection obvious? Can you tell a target rate from an actual rate at a glance?

**Blocked paths.** When a control is disabled, does the app say *why* and what would unblock it? A greyed-out button with no explanation is a finding every time. Same for a validation error that names the problem but not the fix.

**Cost of the common path.** Count the clicks for things you do constantly — claiming a node, adding a machine, upgrading a belt. Repetition you'd feel over a whole playthrough is worth logging even when each individual step is fine. Bulk actions that exist for one screen but not the obviously-similar screen next door are the same category.

**Recovery.** Is a destructive action reversible, or at least confirmed? If you make a mistake five steps into a flow, can you get out without starting over?

**Reachability.** Is anything mouse-only that shouldn't be? Do modals trap focus and release it? Can you get out with Escape?

**Vocabulary.** Does the app use the game's words? Satisfactory says Constructor, Somersloop, hard drive, Space Elevator, Pure/Normal/Impure. An app inventing its own synonym for something the game already named makes the player translate, and that's a finding.

**Continuity.** When you come back to a screen, is it how you left it? Does switching playthrough or tier drop you somewhere sensible?

## The hesitation log

Keep this as you go, in the run folder. One entry per hesitation, written at the moment it happens:

```
- **Screen:** plan designer → sources panel
  **Doing:** wiring the Iron Rod line to the Iron Works ingot output
  **Expected:** the panel to list ingot sources I'd already claimed
  **Got:** empty list, no message explaining why
  **Shot:** t0-sources-panel-empty.png
  **Severity:** blocking-flow
```

Screenshot at the moment of friction — the state that confused you, not the state after you worked it out. A screenshot taken three steps later shows a problem that no longer exists.

## Severity

| Level | Means |
| --- | --- |
| `showstopper` | The run genuinely cannot continue. Halt, file, hand back. |
| `blocking-flow` | A flow dead-ends or forces a workaround to get through. |
| `wrong-data` | A number, unlock tier, recipe, or extractor option disagrees with the game. |
| `friction` | The flow works but costs more clicks, backtracking, or guessing than it should. |
| `polish` | Wording, alignment, iconography, empty-state copy. |

`wrong-data` findings aren't UX — they're the app's library data disagreeing with Satisfactory. Per the scenario rulebook, you still plan with the app's numbers and file the discrepancy; the plan stays internally consistent and the gap gets tracked. Say what the game's value is and where you know it from.

Severity is assigned during the ranking pass, once the whole tier group is done. Something that looked like `friction` the first time often reads as `blocking-flow` after it's cost you three times, and a `polish` nit that shows up on five screens is a pattern worth one real issue.

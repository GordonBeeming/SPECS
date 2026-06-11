# validation

Whole-playthrough consistency sweep behind the header's "Validate" button.
One read-only command, `validate_playthrough`, returns a `ValidationReport`:
findings across four categories (tier gating, locked alts, flow consistency,
supply + power), the locked-alt shopping list, and a grid power summary.

No tables. The slice reads other slices' repos and reuses their math —
`planner::commands::saved_plan_graph` for plan recomputes,
`power::commands::power_balance_impl` for balances,
`resource_nodes::domain::allowed_extractors` for claim validity — so a
validation result can never disagree with what those views show.

Validation reports; it never blocks. Planning stays open by design (the
planner offers every alt at or below the current tier, collected or not),
and this is the tool that turns the gap into a to-do list.

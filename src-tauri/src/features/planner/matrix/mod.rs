//! Planner tier matrix — test-only enumeration of every producible item
//! × every tier it's reachable at × alts on/off, solved once and shared
//! across sibling suites (invariants, transport realism, goldens) so the
//! matrix isn't re-solved per test file.

pub(crate) mod harness;

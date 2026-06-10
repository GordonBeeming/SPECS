//! Planner slice — a factory's production plan. "Make 60 Cable/min
//! (and 30 Wire/min)" computes into a full production graph: recipe
//! steps with machine counts and power, raw leaves compared against
//! claimed supply, and inputs cut to arrive from other factories
//! (sourced or not — an unsourced input is a valid planning state).
//! Supply-aware recipe picking: a candidate only wins when every
//! input traces back to claimed raw supply or a cut item. Saving a
//! plan persists the inputs and materialises plan-managed machines +
//! logistics links in one transaction.

pub mod commands;
pub mod domain;
pub mod dto;
pub mod repo;

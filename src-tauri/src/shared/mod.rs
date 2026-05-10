//! Cross-cutting infrastructure shared by 2+ slices.
//!
//! Anything specific to a single feature belongs in `features/<slice>/` instead.

pub mod db;
pub mod error;
pub mod gamedata;
pub mod paths;
pub mod types;

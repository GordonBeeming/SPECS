//! Alt-recipe slice — per-playthrough record of which Hard Drive
//! alternates the player has unlocked. The bundled game data flags each
//! recipe with `is_alt`; this slice tracks which of those alts are
//! actually available to the active playthrough so the recipe picker
//! can hide the locked ones.

pub mod commands;
pub mod dto;
pub mod repo;

# Alts slice

Per-playthrough record of which Hard Drive alternates the player has
unlocked. The bundled game data tags each recipe with `is_alt`; this
slice tracks which of those alts the active playthrough has so the
recipe picker can hide locked alternatives without affecting the base
recipe list.

## Storage

`unlocked_alt_recipe(recipe_id PRIMARY KEY, unlocked_at)` —
ON CONFLICT DO NOTHING on insert means re-unlocking a recipe doesn't
clobber the original `unlocked_at` timestamp.

## Surface

| Command                       | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `list_unlocked_alt_recipes`   | All unlocked alts in the active playthrough        |
| `toggle_alt_recipe`           | Unlock (`unlocked: true`) or lock (`false`)        |

The toggle endpoint validates the recipe id exists in game data AND
that `is_alt = true`; a mistaken non-alt toggle returns `Invalid`
rather than silently writing a row that the UI can't reconcile.

## Tests

`repo.rs` — round-trip insert/list, idempotent unlock, lock returns
1 when present and 0 when missing.

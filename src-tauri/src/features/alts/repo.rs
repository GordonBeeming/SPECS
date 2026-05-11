use anyhow::Result;
use rusqlite::{Connection, params};

use super::dto::UnlockedAltRecipe;

pub fn alt_unlock(conn: &Connection, recipe_id: &str, now: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO unlocked_alt_recipe (recipe_id, unlocked_at)
         VALUES (?, ?)
         ON CONFLICT(recipe_id) DO NOTHING",
        params![recipe_id, now],
    )?;
    Ok(())
}

pub fn alt_lock(conn: &Connection, recipe_id: &str) -> Result<usize> {
    let affected = conn.execute(
        "DELETE FROM unlocked_alt_recipe WHERE recipe_id = ?",
        [recipe_id],
    )?;
    Ok(affected)
}

pub fn alt_list(conn: &Connection) -> Result<Vec<UnlockedAltRecipe>> {
    let mut stmt = conn.prepare(
        "SELECT recipe_id, unlocked_at
         FROM unlocked_alt_recipe
         ORDER BY recipe_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(UnlockedAltRecipe {
            recipe_id: r.get(0)?,
            unlocked_at: r.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    fn db() -> PlaythroughDb {
        PlaythroughDb::open_in_memory().unwrap()
    }

    #[test]
    fn unlock_and_list_round_trip() {
        let pt = db();
        pt.with(|c| {
            alt_unlock(c, "Recipe_Alt_PureIronIngot_C", "2026-05-11T00:00:00Z").unwrap();
            alt_unlock(c, "Recipe_Alt_IronAlloyIngot_C", "2026-05-11T00:00:01Z").unwrap();
            let list = alt_list(c).unwrap();
            assert_eq!(list.len(), 2);
            assert_eq!(list[0].recipe_id, "Recipe_Alt_IronAlloyIngot_C");
            assert_eq!(list[1].recipe_id, "Recipe_Alt_PureIronIngot_C");
        });
    }

    #[test]
    fn unlock_is_idempotent() {
        let pt = db();
        pt.with(|c| {
            alt_unlock(c, "Recipe_Alt_PureIronIngot_C", "2026-05-11T00:00:00Z").unwrap();
            alt_unlock(c, "Recipe_Alt_PureIronIngot_C", "2026-05-11T00:00:05Z").unwrap();
            let list = alt_list(c).unwrap();
            assert_eq!(list.len(), 1);
            // First unlock wins on conflict — the row is preserved as-is.
            assert_eq!(list[0].unlocked_at, "2026-05-11T00:00:00Z");
        });
    }

    #[test]
    fn lock_returns_one_when_present_zero_when_missing() {
        let pt = db();
        pt.with(|c| {
            alt_unlock(c, "Recipe_Alt_PureIronIngot_C", "2026-05-11T00:00:00Z").unwrap();
            assert_eq!(alt_lock(c, "ghost").unwrap(), 0);
            assert_eq!(alt_lock(c, "Recipe_Alt_PureIronIngot_C").unwrap(), 1);
            assert!(alt_list(c).unwrap().is_empty());
        });
    }
}

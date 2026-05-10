//! Tauri state holder for the currently-open playthrough.
//!
//! Wrapped in `parking_lot::RwLock` so reads (every Library tick) don't
//! block each other, while writes (open / close / create) take the
//! exclusive lock.

use std::sync::Arc;

use parking_lot::RwLock;

use crate::shared::db::playthrough_db::PlaythroughDb;

#[derive(Clone)]
pub struct ActivePlaythrough {
    inner: Arc<RwLock<Option<ActiveInner>>>,
}

pub(super) struct ActiveInner {
    pub id: String,
    pub db: PlaythroughDb,
}

impl ActivePlaythrough {
    pub fn empty() -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
        }
    }

    pub fn id(&self) -> Option<String> {
        self.inner.read().as_ref().map(|i| i.id.clone())
    }

    pub fn set(&self, id: String, db: PlaythroughDb) {
        *self.inner.write() = Some(ActiveInner { id, db });
    }

    pub fn clear(&self) {
        *self.inner.write() = None;
    }

    /// Atomically snapshot the active playthrough's id + DB handle under a
    /// single read lock. Use this in commands that need both pieces — calling
    /// `id()` and `with_db()` separately races a concurrent `set` / `clear`
    /// and risks attributing a DB read to a stale id (or vice versa).
    /// `PlaythroughDb` is `Arc`-backed so the clone is cheap (one `Arc::clone`).
    pub fn snapshot(&self) -> Option<(String, PlaythroughDb)> {
        self.inner
            .read()
            .as_ref()
            .map(|i| (i.id.clone(), i.db.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_returns_consistent_pair_or_none() {
        let active = ActivePlaythrough::empty();
        assert!(active.snapshot().is_none());
        let db = PlaythroughDb::open_in_memory().unwrap();
        active.set("abc".into(), db);
        let snap = active.snapshot().unwrap();
        assert_eq!(snap.0, "abc");
        // Cloned handle still works (Arc-backed).
        snap.1.with(|c| {
            c.execute("INSERT INTO meta(key, value) VALUES ('k', 'v')", []).unwrap();
        });
        active.clear();
        assert!(active.snapshot().is_none());
    }
}


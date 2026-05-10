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

    /// Run a closure with the active playthrough DB if one is open.
    pub fn with_db<F, R>(&self, f: F) -> Option<R>
    where
        F: FnOnce(&PlaythroughDb) -> R,
    {
        self.inner.read().as_ref().map(|i| f(&i.db))
    }
}

//! Primitive identifier wrappers shared across slices.
//!
//! Slice DTOs reference these so cross-slice references type-check.

use serde::{Deserialize, Serialize};

macro_rules! id_newtype {
    ($name:ident) => {
        #[allow(dead_code)]
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl From<String> for $name {
            fn from(s: String) -> Self {
                Self(s)
            }
        }
    };
}

id_newtype!(ItemId);
id_newtype!(RecipeId);
id_newtype!(BuildingId);

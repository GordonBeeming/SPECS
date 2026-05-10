use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrainRoute {
    pub id: String,
    pub name: String,
    pub freight_cars: i64,
    pub fluid_cars: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_distance_m: Option<i64>,
    /// Cached estimate from the cycle-time domain function. `None` until
    /// the route has both a distance and at least one stop.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub est_cycle_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrainRouteStop {
    pub route_id: String,
    pub factory_id: String,
    pub ordinal: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrainRouteDetail {
    pub route: TrainRoute,
    pub stops: Vec<TrainRouteStop>,
    /// IDs of `logistics_link` rows attached to this route via
    /// `train_route_link`. The React side resolves them to full link
    /// rows from the logistics list cache.
    pub attached_link_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTrainRouteInput {
    pub name: String,
    pub freight_cars: i64,
    pub fluid_cars: i64,
    /// Factory ids in visit order. Must be ≥ 2 distinct factories;
    /// the same factory can appear twice (back-and-forth shuttle), but
    /// not three in a row at the same position.
    pub stops: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_distance_m: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTrainRouteInput {
    pub id: String,
    pub name: String,
    pub freight_cars: i64,
    pub fluid_cars: i64,
    pub stops: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_distance_m: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachLinkToRouteInput {
    pub link_id: String,
    pub route_id: String,
}

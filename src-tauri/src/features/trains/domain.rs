//! Pure cycle-time math for trains.
//!
//! Real cycle time depends on terrain, signals, locomotive count, and
//! train length, so v1 uses a simplified estimate that's good enough to
//! rank "do I need 1 or 2 trains?" decisions. Calibration against
//! in-game observation can refine the constants later without changing
//! the function signatures.
//!
//! `cycle_s = 2 × distance_m / avg_speed + per_stop_overhead × stops`
//!
//! - `2 ×` because the route is a round trip (out + back is the natural
//!   model; a one-way line still spends the same time empty returning).
//! - `avg_speed` is taken from a constant tuned against the wiki's
//!   ~120 km/h cruising plus signal/curve losses → 25 m/s ≈ 90 km/h
//!   effective.
//! - `per_stop_overhead` covers approach, full stop, load/unload time,
//!   and depart for one stop. ~30s is a defensible round number from
//!   community traces; the function exposes it as a parameter so the
//!   planner can pass a different value once we calibrate.

const AVG_SPEED_M_PER_S: f64 = 25.0;
/// Default per-stop overhead in seconds (approach + dwell + depart).
pub const DEFAULT_STOP_OVERHEAD_S: f64 = 30.0;

/// Estimated round-trip cycle time in seconds, given the round-trip
/// distance and the stop count. Returns `None` when either input is
/// non-positive — the caller (UI, repo) decides whether to fall back to
/// "unknown" or to a placeholder.
pub fn estimate_cycle_seconds(
    total_distance_m: i64,
    stops: usize,
    per_stop_overhead_s: f64,
) -> Option<f64> {
    if total_distance_m <= 0 || stops == 0 || per_stop_overhead_s < 0.0 {
        return None;
    }
    let dwell = per_stop_overhead_s * stops as f64;
    let drive = (2.0 * total_distance_m as f64) / AVG_SPEED_M_PER_S;
    Some(drive + dwell)
}

/// Convenience wrapper using `DEFAULT_STOP_OVERHEAD_S`.
pub fn estimate_cycle_seconds_default(
    total_distance_m: i64,
    stops: usize,
) -> Option<f64> {
    estimate_cycle_seconds(total_distance_m, stops, DEFAULT_STOP_OVERHEAD_S)
}

/// How many trips per minute a single train completes on this route.
/// Returns `None` when `cycle_seconds <= 0`. Used by the planner to
/// translate "train carries N items per trip" into ipm.
pub fn trips_per_minute(cycle_seconds: f64) -> Option<f64> {
    if cycle_seconds <= 0.0 {
        return None;
    }
    Some(60.0 / cycle_seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_returns_none_for_non_positive_inputs() {
        assert!(estimate_cycle_seconds_default(0, 2).is_none());
        assert!(estimate_cycle_seconds_default(-1, 2).is_none());
        assert!(estimate_cycle_seconds_default(1000, 0).is_none());
        assert!(estimate_cycle_seconds(1000, 2, -1.0).is_none());
    }

    #[test]
    fn estimate_is_double_distance_over_speed_plus_per_stop_overhead() {
        // 1 km loop, 2 stops, default 30s/stop overhead.
        // drive = (2 × 1000) / 25 = 80s; dwell = 2 × 30 = 60s; total = 140s.
        let est = estimate_cycle_seconds_default(1000, 2).unwrap();
        assert!((est - 140.0).abs() < 0.001);
    }

    #[test]
    fn longer_distances_dominate_at_low_stop_counts() {
        // 10 km loop, 2 stops: drive = 800s, dwell = 60s; drive dominates.
        let est = estimate_cycle_seconds_default(10_000, 2).unwrap();
        assert!(est > 800.0);
        assert!(est < 900.0);
    }

    #[test]
    fn many_stops_dominate_at_short_distances() {
        // 200m loop, 8 stops: drive = 16s, dwell = 240s; dwell dominates.
        let est = estimate_cycle_seconds_default(200, 8).unwrap();
        assert!(est > 240.0);
        assert!(est < 260.0);
    }

    #[test]
    fn trips_per_minute_is_inverse_of_cycle_in_minutes() {
        // 60s cycle → 1 trip/min; 30s cycle → 2 trips/min; 120s → 0.5.
        assert!((trips_per_minute(60.0).unwrap() - 1.0).abs() < 0.001);
        assert!((trips_per_minute(30.0).unwrap() - 2.0).abs() < 0.001);
        assert!((trips_per_minute(120.0).unwrap() - 0.5).abs() < 0.001);
        assert!(trips_per_minute(0.0).is_none());
        assert!(trips_per_minute(-1.0).is_none());
    }
}

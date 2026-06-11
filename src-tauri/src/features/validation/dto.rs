use serde::Serialize;

use crate::features::planner::dto::PlanWarning;

/// How loud a finding is. Errors mean "you can't actually build this at
/// your tier / the numbers don't add up"; warnings mean "buildable, but
/// you're missing something" (an uncollected alt, a factory leaning on
/// the shared grid). Validation never blocks anything — it reports.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}

/// Report grouping the slide-over renders by.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    TierGating,
    LockedAlts,
    Flow,
    SupplyPower,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    pub category: Category,
    #[serde(flatten)]
    pub kind: FindingKind,
}

/// One inconsistency. Same tagged-enum shape as `PlanWarning` so the
/// React side switches on `kind`. Every variant carries the ids the UI
/// needs to deep-link to the offending thing.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum FindingKind {
    MachineRecipeAboveTier {
        factory_id: String,
        factory_name: String,
        recipe_id: String,
        recipe_name: String,
        unlock_tier: u8,
    },
    MachineBuildingAboveTier {
        factory_id: String,
        factory_name: String,
        building_id: String,
        building_name: String,
        unlock_tier: u8,
    },
    PlanRecipeAboveTier {
        factory_id: String,
        factory_name: String,
        recipe_id: String,
        recipe_name: String,
        unlock_tier: u8,
    },
    /// The saved plan no longer computes (e.g. dataset change since it
    /// was saved). A finding, not a hard error — the rest of the sweep
    /// still runs.
    PlanDoesNotCompute {
        factory_id: String,
        factory_name: String,
        reason: String,
    },
    ClaimExtractorAboveTier {
        node_id: String,
        resource_item_name: String,
        extractor_id: String,
        extractor_name: String,
        unlock_tier: u8,
    },
    ClaimInvalidExtractor {
        node_id: String,
        resource_item_name: String,
        extractor_id: String,
        allowed_names: Vec<String>,
    },
    LinkTransportAboveTier {
        link_id: String,
        from_factory_name: String,
        to_factory_name: String,
        item_name: String,
        transport_kind: String,
        min_unlock_tier: u8,
    },
    /// A plan or machine uses an alt that's tier-reachable but not yet
    /// collected. The rolled-up shopping list lives on the report.
    LockedAltInUse {
        factory_id: String,
        factory_name: String,
        recipe_id: String,
        recipe_name: String,
        in_plan: bool,
        in_machines: bool,
    },
    /// Links draw more of an item than the source factory's export
    /// slice actually produces.
    LinkOverdraw {
        from_factory_id: String,
        from_factory_name: String,
        item_id: String,
        item_name: String,
        drawn_ipm: f32,
        available_ipm: f32,
    },
    /// A link's source factory doesn't plan the item at all.
    LinkSourceMissingProduct {
        link_id: String,
        from_factory_id: String,
        from_factory_name: String,
        to_factory_name: String,
        item_id: String,
        item_name: String,
    },
    /// A per-factory plan warning (unsourced import, raw short, fluid
    /// surplus...) surfaced with factory context.
    PlanIssue {
        factory_id: String,
        factory_name: String,
        warning: PlanWarning,
    },
    /// Factory draws more than it generates. Warning-class: in-game
    /// grids are shared, so a deficit is only fatal playthrough-wide.
    PowerDeficit {
        factory_id: String,
        factory_name: String,
        net_mw: f32,
    },
    GridDeficit {
        generated_mw: f32,
        consumed_mw: f32,
    },
    /// A check couldn't run (bad generator row, missing node id...).
    /// Reported instead of failing the whole sweep.
    CheckFailed {
        area: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        factory_name: Option<String>,
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryRef {
    pub factory_id: String,
    pub factory_name: String,
}

/// "Go find these hard drives" — distinct locked alts in use anywhere,
/// with the factories that want them.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AltToUnlock {
    pub recipe_id: String,
    pub recipe_name: String,
    pub unlock_tier: u8,
    pub wanted_by: Vec<FactoryRef>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridSummary {
    pub generated_mw: f32,
    pub consumed_mw: f32,
    pub net_mw: f32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub current_tier: u8,
    pub findings: Vec<Finding>,
    pub alt_shopping_list: Vec<AltToUnlock>,
    pub grid: GridSummary,
    pub checked_at: String,
}

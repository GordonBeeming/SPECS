use serde::Serialize;

use crate::features::planner::dto::PlanWarning;
use crate::shared::gamedata::types::NodePurity;

/// How loud a finding is. Errors mean "you can't actually build this at
/// your tier / the numbers don't add up"; warnings mean "buildable, but
/// you're missing something" (an uncollected alt, a factory leaning on
/// the shared grid). Validation never blocks anything — it reports.
///
/// `Info` is for something the player should know that no future state
/// of the playthrough will retire. Two shapes qualify: nothing to fix
/// (a hand-fed Biomass Burner works exactly as the game intends, and no
/// amount of claiming nodes changes what the supply check reads for
/// Wood), and nothing the app can see fixed (a segment running 280/min
/// still runs 280/min after the three belts that carry it go down).
/// Either way the finding outlives every action available, so it
/// doesn't belong in the warning count — but staying silent isn't right
/// either: the burner still has to be fed, and the belts still have to
/// be laid.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Report grouping the slide-over renders by.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    TierGating,
    LockedAlts,
    Flow,
    SupplyPower,
    /// Belt/pipe throughput vs. what's unlocked — distinct from
    /// `SupplyPower` (which is "is there enough of the item at all")
    /// because a segment can be over-cap even when supply is ample.
    Capacity,
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
    /// The Alts screen has this recipe ticked "unlocked", but its own
    /// unlock tier is above the playthrough's current one. Warning, not
    /// error — someone may genuinely have the hard drive early — but a
    /// self-reported inventory claim above tier still needs surfacing.
    UnlockedAltAboveTier {
        recipe_id: String,
        recipe_name: String,
        unlock_tier: u8,
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
    /// Factory draws more than it generates. Only reported when the
    /// grid overall is short (alongside `GridDeficit`) — Satisfactory
    /// has one shared grid, so a factory with no generators of its own
    /// is normal as long as the grid covers it, not a per-factory
    /// problem to chase.
    PowerDeficit {
        factory_id: String,
        factory_name: String,
        net_mw: f32,
    },
    GridDeficit {
        generated_mw: f32,
        consumed_mw: f32,
    },
    /// A factory's generators demand more fuel or supplemental fluid
    /// (coal, water, oil...) than its claimed nodes supply. `demand_ipm`
    /// is the combined total — machine recipe draw plus generator
    /// draw — because both pull from the same claimed pool; a factory
    /// whose machine draw alone already exceeded supply is already
    /// covered by `PlanIssue`'s `RawShort`, so this only fires when the
    /// generator side is what tips it over.
    GeneratorFuelShort {
        factory_id: String,
        factory_name: String,
        item_id: String,
        item_name: String,
        demand_ipm: f32,
        claimed_ipm: f32,
    },
    /// A factory's generators burn something this factory has no
    /// supply for and could never have any: a pickup like Wood, or
    /// anything whose every recipe starts at one, which covers Biomass
    /// and Solid Biofuel out of a Constructor and Liquid Biofuel out of
    /// a Refinery.
    ///
    /// The same fuels become a `GeneratorFuelShort` the moment the
    /// factory does report supply for them — a Refinery line making
    /// 60/min against a 270/min burn is a gap the player built and can
    /// close. This one carries no claimed figure on purpose: the number
    /// is zero forever and says nothing about whether they have a
    /// problem. What they do have is a standing chore, and that's what
    /// this reports.
    ///
    /// Named for where the chore sits — the *root* of the chain — not
    /// for how the fuel reaches the generator. Liquid Biofuel is a
    /// fluid: it arrives by pipe out of a Refinery and no player pours
    /// it in by hand, so a message about hand-feeding the generator
    /// describes something physically impossible. What every fuel in
    /// here shares is that somebody has to walk around picking up Wood,
    /// Leaves, Mycelia or Alien Protein to start the chain, however
    /// many machines sit between that and the burn.
    GeneratorFuelHandGathered {
        factory_id: String,
        factory_name: String,
        item_id: String,
        item_name: String,
        demand_ipm: f32,
    },
    /// A plan-graph segment (belt run) carries more than the best belt
    /// tier unlocked at the current playthrough tier moves on its own.
    /// A note rather than a warning: `belts_needed` parallel belts of
    /// that tier carry it, which is ordinary play, and the segment's
    /// rate reads the same once they're laid — so as a warning it could
    /// never be cleared. The count is still what a player has to work
    /// out by hand today, which is why the row exists at all.
    SegmentOverBeltCapacity {
        factory_id: String,
        factory_name: String,
        item_id: String,
        item_name: String,
        ipm: f32,
        belt_mark: u8,
        belt_capacity_ipm: f32,
        belts_needed: u32,
    },
    /// Same as `SegmentOverBeltCapacity` for a fluid segment against
    /// the best pipe tier unlocked. Split from the belt variant because
    /// a fluid needs another header, not just another belt laid
    /// alongside — a distinct build decision worth naming as such.
    SegmentOverPipeCapacity {
        factory_id: String,
        factory_name: String,
        item_id: String,
        item_name: String,
        ipm: f32,
        pipe_mark: u8,
        pipe_capacity_ipm: f32,
        pipes_needed: u32,
    },
    /// A fluid plan-graph segment at a tier before any pipe is
    /// unlocked (Mk1 lands at Tier 3). Unlike the capacity variants
    /// above, there's no "add more" answer yet — the fluid can't move
    /// at all until a pipe tier unlocks.
    FluidSegmentNoPipeAtTier {
        factory_id: String,
        factory_name: String,
        item_id: String,
        item_name: String,
        ipm: f32,
    },
    /// A claimed extractor is clocked past what its one output port can
    /// carry off the node. Unlike `SegmentOverBeltCapacity`/
    /// `SegmentOverPipeCapacity`, there's no "add more belts" fix here —
    /// a splitter after the port can only divide what already made it
    /// through — so the advice is to underclock or claim a different
    /// node instead. That's why this one keeps warning severity while
    /// the segment pair are notes: it names a single extractor, the
    /// underclock is recorded on the claim, and the finding goes away.
    ClaimOverPortCapacity {
        node_id: String,
        resource_item_name: String,
        /// Position within this node's (resource, purity) bucket, same
        /// order Resources lists them in — pairs with `node_purity` and
        /// `node_x`/`node_y` to reproduce that screen's
        /// "#P1 · 1.7km W · 1.5km N" label so the finding names a
        /// specific node among several of the same resource, instead of
        /// leaving it ambiguous.
        node_index: u32,
        /// Carried purely so this finding can render the same label the
        /// Resources row does: the index restarts at 1 per purity, so
        /// "Iron Ore #1" alone names either a Pure or a Normal node and
        /// the purity initial is what separates them.
        node_purity: NodePurity,
        node_x: f32,
        node_y: f32,
        extractor_name: String,
        output_ipm: f32,
        capacity_ipm: f32,
        is_fluid: bool,
        capacity_mark: u8,
        /// Highest clock percent that would land exactly at the port's
        /// capacity, given `output_ipm` scales linearly with clock.
        max_fitting_clock_pct: f32,
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

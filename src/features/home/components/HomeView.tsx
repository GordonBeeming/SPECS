import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Factory as FactoryIcon,
  FlaskConical,
  Gauge,
  Network as NetworkIcon,
  Plus,
  Rocket,
  Share2,
  Sparkles,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";

import { useUnlockedAlts } from "@/features/alts/hooks/useAlts";
import { CreateFactoryModal } from "@/features/factory/components/CreateFactoryModal";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import {
  useLibrarySummary,
  useRecipes,
} from "@/features/library/hooks/useLibrary";
import { AmplifierInventoryPanel } from "@/features/playthrough/components/AmplifierInventoryPanel";
import { CreatePlaythroughModal } from "@/features/playthrough/components/CreatePlaythroughModal";
import { ExportImportModal } from "@/features/playthrough/components/ExportImportModal";
import {
  useAmplifierInventory,
  useCurrentPlaythrough,
  useDeletePlaythrough,
  useSetCurrentTier,
} from "@/features/playthrough/hooks/usePlaythroughs";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";

interface HomeViewProps {
  /** Lets the home tiles deep-link into other tabs. */
  goTo: (route:
    | "factories"
    | "logistics"
    | "trains"
    | "power"
    | "network"
    | "alts"
    | "library") => void;
}

export function HomeView({ goTo }: HomeViewProps) {
  const playthrough = useCurrentPlaythrough();

  if (!playthrough.data) {
    return <EmptyHome />;
  }
  return <ActiveHome goTo={goTo} />;
}

// -----------------------------------------------------------------------
// Empty state — the first thing a brand-new player sees.
// -----------------------------------------------------------------------

const FEATURE_ICON_IDS = [
  "Desc_IronIngot_C",
  "Desc_CopperIngot_C",
  "Desc_IronPlate_C",
  "Desc_Cable_C",
  "Desc_Wire_C",
  "Desc_Rotor_C",
  "Desc_Stator_C",
  "Desc_ModularFrameHeavy_C",
  "Desc_CircuitBoard_C",
  "Desc_MotorLightweight_C",
  "Desc_CrystalOscillator_C",
  "Desc_Computer_C",
];

function EmptyHome() {
  const summary = useLibrarySummary();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-bg-raised to-accent/10 p-8 sm:p-12">
        {/* Floating icon constellation in the background — adds a sense
            of "this app is about Satisfactory" without the text fighting
            the imagery. Hidden on small screens to keep the hero clean. */}
        <div className="pointer-events-none absolute inset-0 hidden opacity-25 sm:block">
          {FEATURE_ICON_IDS.map((id, idx) => (
            <span
              key={id}
              className="absolute"
              style={{
                top: `${15 + (idx % 4) * 22}%`,
                left: `${65 + (idx % 3) * 11}%`,
                transform: `rotate(${(idx % 2 === 0 ? -1 : 1) * 8}deg)`,
              }}
            >
              <Icon itemId={id} alt="" className="h-10 w-10" />
            </span>
          ))}
        </div>

        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Plan the whole playthrough
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-fg sm:text-5xl">
            Welcome to <span className="text-primary">S.P.E.C.S</span>
          </h1>
          <p className="mt-3 max-w-xl text-base text-fg-muted sm:text-lg">
            Satisfactory Production Efficiency & Control System. Map your
            factories, route belts and trucks between them, gate everything
            by tier, and watch the numbers balance — before you place a
            single building in-game.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90"
            >
              <Rocket className="h-4 w-4" />
              Create your first playthrough
            </button>
            <a
              href="https://github.com/GordonBeeming/SPECS"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-fg-muted underline-offset-4 hover:underline"
            >
              Browse the code →
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <FeatureCard
          Icon={NetworkIcon}
          title="Cross-factory logistics"
          body="One factory's output can feed another. SPECS picks belts, pipes, trucks, or drones and explains the maths so you don't have to."
        />
        <FeatureCard
          Icon={Gauge}
          title="Milestone gating"
          body="Only see buildings, recipes, belts, and generators your current tier has actually unlocked. No accidental Mk6 belt at T0."
        />
        <FeatureCard
          Icon={Zap}
          title="Power balance per factory"
          body="Drop generators next to machines, swap fuels, set clocks. Net MW updates as you go — red when you're short."
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div>
            <h3 className="text-sm font-semibold text-fg">~106 Hard Drive alts</h3>
            <p className="mt-1 text-xs text-fg-muted">
              Every Satisfactory alt recipe is in the dataset. Toggle them
              as you scan them — the recipe picker respects what you've
              unlocked.
            </p>
          </div>
        </Card>
        <Card className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <h3 className="text-sm font-semibold text-fg">Somersloops, opt-in</h3>
            <p className="mt-1 text-xs text-fg-muted">
              SPECS never spends your Somersloops or Power Shards
              behind your back. Per-machine toggle, optional supply
              tracker, full inverse maths on the ledger.
            </p>
          </div>
        </Card>
      </section>

      <div className="text-center text-xs text-fg-muted tabular-nums">
        {summary.data ? (
          <>
            dataset <span className="font-mono text-fg">v{summary.data.datasetVersion}</span>{" "}
            · {summary.data.itemCount} items · {summary.data.recipeCount} recipes ·{" "}
            {summary.data.buildingCount} buildings · {summary.data.milestoneCount} tiers
          </>
        ) : (
          "dataset loading…"
        )}
      </div>

      {showCreate && <CreatePlaythroughModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function FeatureCard({
  Icon: IconCmp,
  title,
  body,
}: {
  Icon: typeof NetworkIcon;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <IconCmp className="h-6 w-6 text-primary" />
      <h3 className="mt-3 text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 text-xs text-fg-muted">{body}</p>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Active state — dashboard for the currently-open playthrough.
// -----------------------------------------------------------------------

const TIERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function ActiveHome({ goTo }: HomeViewProps) {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const recipes = useRecipes();
  const alts = useUnlockedAlts();
  const inventory = useAmplifierInventory();
  const setTier = useSetCurrentTier();
  const deleteMut = useDeletePlaythrough();
  const [showShare, setShowShare] = useState(false);
  const [showAmp, setShowAmp] = useState(false);
  const [showAddFactory, setShowAddFactory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const altTotal = useMemo(
    () => (recipes.data ?? []).filter((r) => r.isAlt).length,
    [recipes.data],
  );

  const totalMachines = useMemo(
    () => (factories.data ?? []).reduce((sum, f) => sum + f.machineCount, 0),
    [factories.data],
  );

  if (!playthrough.data) return null;
  const factoryList = factories.data ?? [];
  const tier = playthrough.data.currentTier;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {/* Hero ----------------------------------------------------------- */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-bg-raised to-accent/5 p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-fg-muted">
              Current playthrough
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              {playthrough.data.displayName}
            </h1>
            <div className="mt-2 text-xs text-fg-muted">
              created {formatDate(playthrough.data.createdAt)} · game{" "}
              <span className="font-mono">{playthrough.data.gameVersion}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <label className="text-xs font-medium uppercase tracking-wider text-fg-muted">
              Current tier
            </label>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary px-3 py-1.5 text-2xl font-bold tabular-nums text-white shadow-sm">
                T{tier}
              </span>
              <select
                aria-label="Current tier"
                value={tier}
                disabled={setTier.isPending}
                onChange={(e) => setTier.mutate(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary disabled:opacity-50"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    Tier {t}
                  </option>
                ))}
              </select>
            </div>
            {setTier.isError && (
              <div role="alert" className="text-xs text-danger">
                {setTier.error instanceof Error ? setTier.error.message : "Failed"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stat dashboard ------------------------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          Icon={FactoryIcon}
          tone="primary"
          label="Factories"
          value={factoryList.length}
          hint={factoryList.length === 0 ? "Add your first" : "Click to manage"}
          onClick={() => goTo("factories")}
        />
        <StatTile
          Icon={TrendingUp}
          tone="accent"
          label="Machines"
          value={totalMachines}
          hint={
            totalMachines === 0
              ? "No machines yet"
              : `across ${factoryList.length} factor${factoryList.length === 1 ? "y" : "ies"}`
          }
          onClick={() => goTo("factories")}
        />
        <StatTile
          Icon={FlaskConical}
          tone="warning"
          label="Alts unlocked"
          value={alts.data ? alts.data.size : 0}
          hint={altTotal > 0 ? `of ${altTotal} total` : "Toggle in Alts"}
          onClick={() => goTo("alts")}
        />
        <StatTile
          Icon={Zap}
          tone="success"
          label="Power view"
          value={"⚡"}
          hint="Generators + balance"
          onClick={() => goTo("power")}
        />
      </section>

      {/* Quick actions + amplifier supply ------------------------------- */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">
            Quick actions
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            <ActionRow
              Icon={Plus}
              label="Add a new factory"
              hint="Spin up a build target — Smelter, Constructor, anything"
              onClick={() => setShowAddFactory(true)}
            />
            <ActionRow
              Icon={Share2}
              label="Share or import a playthrough"
              hint=".specsdb files — send to a friend or load theirs"
              onClick={() => setShowShare(true)}
            />
            <ActionRow
              Icon={BookOpen}
              label="Browse the dataset"
              hint="All items, recipes, buildings, milestones at this tier"
              onClick={() => goTo("library")}
            />
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">
                Amplifier supply
              </h2>
              <p className="mt-1 text-xs text-fg-muted">
                Optional — set non-zero to get low-supply warnings on
                amplified machines.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAmp(true)}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-fg hover:bg-border"
            >
              Edit
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <SupplyChip
              label="Somersloops"
              value={inventory.data?.somersloopQuantity ?? 0}
              tone="warning"
            />
            <SupplyChip
              label="Power Shards"
              value={inventory.data?.powerShardQuantity ?? 0}
              tone="primary"
            />
          </div>
        </Card>
      </section>

      {/* Recent factories ---------------------------------------------- */}
      {factoryList.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">
              Factories
            </h2>
            <button
              type="button"
              onClick={() => goTo("factories")}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {factoryList.slice(0, 6).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => goTo("factories")}
                className="flex flex-col items-start gap-1 rounded-lg border border-border bg-bg-raised p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="flex items-center gap-2">
                  <FactoryIcon className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-fg">{f.name}</span>
                </div>
                <span className="text-xs text-fg-muted">
                  {f.machineCount}{" "}
                  {f.machineCount === 1 ? "machine" : "machines"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Danger zone --------------------------------------------------- */}
      <section>
        <details className="rounded-lg border border-border bg-bg-raised">
          <summary className="cursor-pointer list-none px-4 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted hover:text-fg">
            Danger zone
          </summary>
          <div className="border-t border-border p-4">
            {confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg">
                  Delete <strong>{playthrough.data.displayName}</strong>? This
                  can't be undone.
                </span>
                <button
                  type="button"
                  disabled={deleteMut.isPending}
                  onClick={() =>
                    deleteMut.mutate(playthrough.data!.id, {
                      onSuccess: () => setConfirmingDelete(false),
                    })
                  }
                  className="rounded-md bg-danger px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-md border border-border px-3 py-1 text-xs text-fg hover:bg-border"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-2 text-sm text-danger hover:underline"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete this playthrough
              </button>
            )}
          </div>
        </details>
      </section>

      {showShare && <ExportImportModal onClose={() => setShowShare(false)} />}
      {showAmp && <AmplifierInventoryPanel onClose={() => setShowAmp(false)} />}
      {showAddFactory && (
        <CreateFactoryModal onClose={() => setShowAddFactory(false)} />
      )}
    </div>
  );
}

const TONE_CLASSES = {
  primary: { bg: "bg-primary/10", text: "text-primary" },
  accent: { bg: "bg-accent/10", text: "text-accent" },
  success: { bg: "bg-success/10", text: "text-success" },
  warning: { bg: "bg-warning/15", text: "text-warning" },
  danger: { bg: "bg-danger/10", text: "text-danger" },
} as const;

type Tone = keyof typeof TONE_CLASSES;

function StatTile({
  Icon: IconCmp,
  tone,
  label,
  value,
  hint,
  onClick,
}: {
  Icon: typeof FactoryIcon;
  tone: Tone;
  label: string;
  value: number | string;
  hint: string;
  onClick: () => void;
}) {
  const c = TONE_CLASSES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-border bg-bg-raised p-4 text-left transition-all hover:border-primary hover:shadow-sm"
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.bg} ${c.text}`}>
        <IconCmp className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <div className="text-xs font-medium uppercase tracking-wider text-fg-muted">
          {label}
        </div>
        <div className="text-2xl font-bold tabular-nums text-fg">{value}</div>
        <div className="text-[10px] text-fg-muted">{hint}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function ActionRow({
  Icon: IconCmp,
  label,
  hint,
  onClick,
}: {
  Icon: typeof Plus;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-border/40"
    >
      <IconCmp className="h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1">
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="text-xs text-fg-muted">{hint}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function SupplyChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Tone;
}) {
  const c = TONE_CLASSES[tone];
  return (
    <div className={`rounded-md ${c.bg} px-3 py-2`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${c.text}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

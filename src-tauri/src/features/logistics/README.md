# Logistics slice

Cross-factory item flow. The differentiator vs other Satisfactory tools: when
the user wires factory A → factory B for item X at N ipm, SPECS doesn't
validate-and-block — it **plans and explains**. The slice generates a ranked
list of viable transport plans (belts, pipes, vehicles, trains, drones) and
the user picks one. The picked plan persists on the link row.

## Storage

`logistics_link` (per-playthrough DB):

| Column                  | Notes                                                |
| ----------------------- | ---------------------------------------------------- |
| `id`                    | uuid                                                 |
| `from_factory_id`       | FK → `factory(id)`, ON DELETE CASCADE                |
| `to_factory_id`         | FK → `factory(id)`, ON DELETE CASCADE                |
| `item_id`               | game-data ref (no FK; dataset is in-memory)          |
| `items_per_minute_x100` | 100ths of an ipm; CHECK > 0                          |
| `transport_kind`        | CHECK IN ('belt','pipe','truck','tractor','train','drone') |
| `transport_plan_json`   | shape varies per `transport_kind`                    |
| `distance_m`            | optional; nullable; CHECK >= 0 when set              |
| `notes`                 | optional                                             |
| timestamps              | `created_at`, `updated_at` (ISO 8601 UTC)            |

CHECK rejects self-loops (`from_factory_id <> to_factory_id`).

## Surface

| Command                  | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `list_logistics_links`   | All links in the active playthrough                     |
| `get_logistics_link`     | One link by id                                          |
| `create_logistics_link`  | Insert a link with a chosen plan                        |
| `update_logistics_link`  | Edit ipm / plan / distance / notes                      |
| `delete_logistics_link`  | Remove a link                                           |
| `plan_logistics`         | Pure planner — returns ranked plans for given inputs    |

## Tests

`domain.rs` carries the bulk of the tests — capacity formulas pinned to wiki
table values (Mk1 belt = 60 ipm, Mk6 = 1200 ipm, Mk1 pipe = 300 m³/min,
Mk2 = 600). Repo tests live next to the SQLite calls and use the in-memory
playthrough DB harness (same shape as the factory slice tests).

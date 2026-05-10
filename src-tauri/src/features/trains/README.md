# Trains slice

Shared train routes carrying multiple `logistics_link`s. A route is a
loop visiting 2+ factories (`train_route_stop`, ordered); zero or more
links can be attached via `train_route_link` so the player sees them as
carried by an existing route rather than each having a dedicated train.

## Storage

`train_route` (per-playthrough DB):

| Column              | Notes                                              |
| ------------------- | -------------------------------------------------- |
| `id`                | uuid                                               |
| `name`              | human-friendly                                     |
| `freight_cars`      | `>= 0`; `freight + fluid >= 1` (CHECK)             |
| `fluid_cars`        | `>= 0`                                             |
| `total_distance_m`  | optional; `>= 0` when set                          |
| `est_cycle_seconds` | cached output of `domain::estimate_cycle_seconds`  |
| `notes`             | optional                                           |
| timestamps          | `created_at`, `updated_at` (ISO 8601 UTC)          |

`train_route_stop`: composite PK `(route_id, ordinal)`; same factory may
repeat at non-adjacent positions (back-and-forth shuttle).

`train_route_link`: PK on `link_id` only — at-most-one route per link.

## Surface

| Command                 | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `list_train_routes`     | All routes, alphabetised by name                     |
| `get_train_route`       | Route + stops + attached link IDs                    |
| `create_train_route`    | Insert route + stops; computes `est_cycle_seconds`   |
| `update_train_route`    | Replace name/cars/distance/notes/stops; recomputes estimate |
| `delete_train_route`    | Cascades stops + link attachments                    |
| `attach_link_to_route`  | INSERT OR REPLACE — moves a link off any prior route |
| `detach_link_from_route`| Removes the attachment if present                    |

## Tests

`domain.rs` — cycle-time math pinned to representative scenarios (drive
dominates at 10km, dwell dominates at 8 stops over 200m, trips/min is
the inverse of cycle-in-minutes). `repo.rs` — round-trip insert/list,
CHECK enforcement, stops_replace clear-then-insert semantics, route
delete cascade to stops and link attachments, link attach replaces
prior route.

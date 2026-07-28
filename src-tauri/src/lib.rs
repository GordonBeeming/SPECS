//! SPECS — Satisfactory Production Efficiency and Control System.
//!
//! Each user-facing feature is a vertical slice in `features/`.
//! Cross-cutting infrastructure lives in `shared/`.
//! See `docs/vsa/` at the repo root for slice rules.

mod features;
mod shared;

use tauri::{LogicalPosition, LogicalSize, Manager};
use tauri_plugin_window_state::StateFlags;

use features::playthrough::state::ActivePlaythrough;
use shared::db::app_db::AppDb;
use shared::gamedata::GameData;
use shared::paths::{app_data_dir, app_db_path, ensure_dir, playthroughs_dir};

/// Filename for the main window's own geometry record, stored alongside
/// `tauri-plugin-window-state`'s `.window-state.json` in the app data dir.
const WINDOW_GEOMETRY_FILE: &str = "window-geometry.json";

/// The main window's floating size, position, and maximized/fullscreen
/// state, in *logical* pixels.
///
/// `tauri-plugin-window-state` persists and restores size and position
/// in physical pixels, and on macOS that round-trip isn't even
/// self-consistent within a single monitor: `outer_position()` (the
/// save side) reports a window's global desktop position — which macOS
/// itself always tracks in points — multiplied by the window's scale
/// factor, but `set_position(PhysicalPosition)` (the restore side)
/// applies that number back as if it were already in points, with no
/// division. Confirmed by hand: a window sitting at desktop point
/// (1928, 76) on a 2x display saves as physical (3856, 152); restoring
/// that same value lands the window at point (3856, 152) — double the
/// original — and the next save doubles it again. Size has the
/// analogous risk whenever the window reopens on a monitor with a
/// different scale factor than the one it closed on (a Retina panel vs.
/// a non-Retina external, the common laptop-plus-monitor case) — the
/// same physical pixel count no longer describes the same on-screen
/// size. Logical pixels sidestep both: `LogicalSize`/`LogicalPosition`
/// are converted using whatever scale factor the window actually
/// restores onto, so this stays correct across restarts and monitors.
///
/// `maximized`/`fullscreen` travel with position rather than staying on
/// the plugin, because restoring them correctly depends on the window
/// already sitting on the right monitor: `maximize()`/`set_fullscreen()`
/// act on whatever monitor the window currently occupies, so position
/// has to be restored *first*, in the same pass. Splitting that restore
/// across two different lifecycle points (the plugin's own
/// `on_window_ready`, before `setup` runs) reproduced this exactly — a
/// maximized window came back on the wrong monitor, because the
/// plugin's `maximize()` fired before this module's position restore
/// ever ran, from whatever default position a fresh window gets. We
/// manage all four together for exactly this reason (see
/// `restore_main_window_geometry` / `save_main_window_geometry`) and
/// leave visibility/decorations to the plugin, which aren't affected
/// the same way.
#[derive(serde::Serialize, serde::Deserialize)]
struct WindowGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    maximized: bool,
    fullscreen: bool,
}

/// Managed app state: the main window's last-known floating rect, in
/// logical pixels. See the `app.manage` call site for why this exists —
/// `save_main_window_geometry` needs a real floating rect to record even
/// when the window closes while maximized/fullscreen.
struct FloatingGeometryCache(std::sync::Mutex<Option<(f64, f64, f64, f64)>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,specs_lib=debug")),
        )
        .init();

    #[cfg_attr(not(feature = "dev-mcp"), allow(unused_mut))]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Reopen where the app was last used: visibility and
        // decorations. Position, size, maximized and fullscreen are all
        // excluded — `restore_main_window_geometry` restores them
        // together, in logical pixels, once the window exists (see
        // `WindowGeometry` above).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::VISIBLE | StateFlags::DECORATIONS)
                .build(),
        );

    #[cfg(feature = "dev-mcp")]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            // Bundled game data — load once, share across slices via State.
            let game_data = GameData::from_bundled()
                .map_err(|e| format!("loading bundled game data: {e:#}"))?;
            tracing::info!(
                version = game_data.version(),
                game_version = game_data.game_version(),
                items = game_data.items().len(),
                recipes = game_data.recipes().len(),
                "loaded game data"
            );
            app.manage(game_data);

            // App DB — open at the OS-specific app data dir, run migrations.
            let handle = app.handle();
            let db_path = app_db_path(handle)
                .map_err(|e| format!("resolving app db path: {e:#}"))?;
            let pt_dir = playthroughs_dir(handle)
                .map_err(|e| format!("resolving playthroughs dir: {e:#}"))?;
            ensure_dir(&pt_dir).map_err(|e| format!("creating playthroughs dir: {e:#}"))?;
            let app_db =
                AppDb::open(&db_path).map_err(|e| format!("opening app db: {e:#}"))?;
            tracing::info!(path = %db_path.display(), "app db ready");
            app.manage(app_db);

            // No playthrough open at startup — user picks one from the
            // header switcher (or creates a new one) before per-playthrough
            // slices have anything to operate on.
            app.manage(ActivePlaythrough::empty());

            // Last-known floating (non-maximized/fullscreen/minimized)
            // rect for the main window, kept live by the Resized/Moved
            // arm below. Seeded from disk by `restore_main_window_geometry`
            // so a save while maximized/fullscreen always has a real
            // floating rect to fall back on, even before the window has
            // been resized once in this run.
            app.manage(FloatingGeometryCache(std::sync::Mutex::new(None)));

            // Runs after the window-state plugin's own restore (windows
            // are created, and plugins' `on_window_ready` hooks fire,
            // before `setup` runs) — see `restore_main_window_geometry`
            // for why this order matters.
            restore_main_window_geometry(handle);

            // Registered *after* the restore call above, deliberately —
            // `set_position`/`maximize`/`set_fullscreen`/`set_size` all
            // fire their own Resized/Moved events, and a listener already
            // in place would catch those as if the user had resized,
            // overwriting the cache mid-restore with a transient
            // (pre-maximize, wrong-size) rect. Any such event fired as a
            // *synchronous* side effect of those calls has nowhere to go
            // yet; anything the OS delivers after this point reflects the
            // window's settled, fully-restored state.
            //
            // Saving is captured at `CloseRequested`, not `RunEvent::Exit`
            // — by the time `Exit` fires the window has already been
            // destroyed, too late to read its live geometry. This mirrors
            // the window-state plugin's own save point for the flags it
            // still owns.
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = handle.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { .. } => {
                        save_main_window_geometry(&app_handle);
                    }
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                        update_floating_geometry_cache(&app_handle);
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            features::health::commands::health_check,
            features::library::commands::library_summary,
            features::library::commands::library_items,
            features::library::commands::library_buildings,
            features::library::commands::library_recipes,
            features::library::commands::library_milestones,
            features::library::commands::library_belt_tiers,
            features::library::commands::library_pipe_tiers,
            features::library::commands::library_generators,
            features::library::commands::library_transport_vehicles,
            features::playthrough::commands::create_playthrough,
            features::playthrough::commands::list_playthroughs,
            features::playthrough::commands::open_playthrough,
            features::playthrough::commands::close_playthrough,
            features::playthrough::commands::current_playthrough,
            features::playthrough::commands::set_current_tier,
            features::playthrough::commands::delete_playthrough,
            features::playthrough::commands::export_playthrough,
            features::playthrough::commands::import_playthrough,
            features::playthrough::commands::get_amplifier_inventory,
            features::playthrough::commands::set_amplifier_inventory,
            features::factory::commands::list_factories,
            features::factory::commands::get_factory_detail,
            features::factory::commands::create_factory,
            features::factory::commands::rename_factory,
            features::factory::commands::set_factory_icon,
            features::factory::commands::set_factory_position,
            features::factory::commands::set_machine_layout,
            features::factory::commands::list_machine_layouts,
            features::factory::commands::delete_factory,
            features::factory::commands::add_factory_machine,
            features::factory::commands::update_factory_machine,
            features::factory::commands::remove_factory_machine,
            features::factory::commands::factory_ledger,
            features::factory::commands::pop_out_factory,
            features::elevator::commands::elevator_overview,
            features::logistics::commands::list_logistics_links,
            features::logistics::commands::get_logistics_link,
            features::logistics::commands::create_logistics_link,
            features::logistics::commands::update_logistics_link,
            features::logistics::commands::delete_logistics_link,
            features::logistics::commands::plan_logistics,
            features::trains::commands::list_train_routes,
            features::trains::commands::get_train_route,
            features::trains::commands::create_train_route,
            features::trains::commands::update_train_route,
            features::trains::commands::delete_train_route,
            features::trains::commands::attach_link_to_route,
            features::trains::commands::detach_link_from_route,
            features::power::commands::list_power_gens,
            features::power::commands::add_power_gen,
            features::power::commands::update_power_gen,
            features::power::commands::remove_power_gen,
            features::power::commands::factory_power_balance,
            features::power::commands::list_power_balances,
            features::power::commands::list_all_power_gens,
            features::power::commands::set_power_gen_position,
            features::alts::commands::list_unlocked_alt_recipes,
            features::alts::commands::toggle_alt_recipe,
            features::alts::commands::set_alt_recipes,
            features::validation::commands::validate_playthrough,
            features::resource_nodes::commands::list_resource_nodes,
            features::resource_nodes::commands::set_node_claim,
            features::resource_nodes::commands::clear_node_claim,
            features::resource_nodes::commands::get_resource_budget,
            features::resource_nodes::commands::list_water_extractor_groups,
            features::resource_nodes::commands::set_water_extractor_group,
            features::resource_nodes::commands::delete_water_extractor_group,
            features::planner::commands::factory_plan_get,
            features::planner::commands::factory_plan_compute,
            features::planner::commands::factory_plan_save,
            features::planner::commands::factory_plan_layout_set,
            features::planner::commands::list_unsourced_inputs,
            features::planner::commands::list_export_offers,
            features::planner::commands::factory_plan_assign_import_source,
            features::planner::commands::factory_plan_raise_export_target,
            features::planner::commands::list_item_tiers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Applies the saved geometry to the main window: position first
/// (always), then the floating size, then maximized/fullscreen on top if
/// applicable. Position has to go first — `maximize()`/`set_fullscreen()`
/// act on whatever monitor the window is currently on. Size goes before
/// either of those too, even though both override it immediately: it's
/// what gives the OS a "previous frame" to remember, so the window's own
/// native unmaximize / exit-fullscreen gesture (the green button, a
/// double-click, Esc) returns to the real floating rect afterwards
/// instead of the app's built-in default size.
fn restore_main_window_geometry(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(dir) = app_data_dir(app) else {
        return;
    };
    let Ok(bytes) = std::fs::read(dir.join(WINDOW_GEOMETRY_FILE)) else {
        return;
    };
    let Ok(geometry) = serde_json::from_slice::<WindowGeometry>(&bytes) else {
        return;
    };

    // Seed the cache before the restore calls below run, so a close
    // while still maximized/fullscreen this same run has the real
    // floating rect to fall back on rather than falling all the way
    // back to a live (screen-filling) read — see `FloatingGeometryCache`.
    *app.state::<FloatingGeometryCache>().0.lock().unwrap() =
        Some((geometry.x, geometry.y, geometry.width, geometry.height));

    if let Err(e) = window.set_position(LogicalPosition::new(geometry.x, geometry.y)) {
        tracing::warn!(error = %e, "restoring main window position");
    }
    if geometry.width > 0.0 && geometry.height > 0.0 {
        if let Err(e) = window.set_size(LogicalSize::new(geometry.width, geometry.height)) {
            tracing::warn!(error = %e, "restoring main window size");
        }
    }

    if geometry.maximized {
        if let Err(e) = window.maximize() {
            tracing::warn!(error = %e, "restoring main window maximized state");
        }
    } else if geometry.fullscreen {
        if let Err(e) = window.set_fullscreen(true) {
            tracing::warn!(error = %e, "restoring main window fullscreen state");
        }
    }
}

/// Updates `FloatingGeometryCache` with the window's current position
/// and size, but only while it's genuinely floating. Wired to the
/// Resized/Moved window events (registered after the restore-time calls
/// — see the call site) so `save_main_window_geometry` always has an
/// up-to-date floating rect to record, even if the window closes while
/// maximized or fullscreen and its *live* geometry is the screen-filling
/// one rather than the rect the user actually resized it to.
fn update_floating_geometry_cache(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return;
    }
    let (Ok(position), Ok(size), Ok(scale)) =
        (window.outer_position(), window.inner_size(), window.scale_factor())
    else {
        return;
    };
    if size.width == 0 || size.height == 0 {
        return;
    }
    *app.state::<FloatingGeometryCache>().0.lock().unwrap() = Some((
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ));
}

/// Saves the main window's current geometry in logical pixels: position
/// and the maximized/fullscreen booleans always, but size only while
/// floating (neither maximized nor fullscreen) — otherwise un-maximizing
/// later would "restore" to the maximized size instead of the rect the
/// window had before. While maximized/fullscreen, the floating rect
/// comes from `FloatingGeometryCache` rather than a live read, which
/// would just be the current screen-filling geometry. Skipped entirely
/// while minimized, which isn't a geometry worth remembering either.
fn save_main_window_geometry(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);

    let (x, y, width, height) = if maximized || fullscreen {
        let Some(rect) = *app.state::<FloatingGeometryCache>().0.lock().unwrap() else {
            // No floating rect on record at all (e.g. the very first
            // launch landed straight in a maximized/fullscreen saved
            // state) — nothing meaningful to save.
            return;
        };
        rect
    } else {
        let (Ok(position), Ok(size), Ok(scale)) =
            (window.outer_position(), window.inner_size(), window.scale_factor())
        else {
            return;
        };
        if size.width == 0 || size.height == 0 {
            return;
        }
        (
            position.x as f64 / scale,
            position.y as f64 / scale,
            size.width as f64 / scale,
            size.height as f64 / scale,
        )
    };
    if width <= 0.0 || height <= 0.0 {
        return;
    }

    let geometry = WindowGeometry {
        x,
        y,
        width,
        height,
        maximized,
        fullscreen,
    };
    let Ok(dir) = app_data_dir(app) else {
        return;
    };
    if ensure_dir(&dir).is_err() {
        return;
    }
    match serde_json::to_vec_pretty(&geometry) {
        Ok(json) => {
            if let Err(e) = std::fs::write(dir.join(WINDOW_GEOMETRY_FILE), json) {
                tracing::warn!(error = %e, "saving main window geometry");
            }
        }
        Err(e) => tracing::warn!(error = %e, "serializing main window geometry"),
    }
}

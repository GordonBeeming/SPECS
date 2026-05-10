//! SPECS — Satisfactory Production Efficiency and Control System.
//!
//! Each user-facing feature is a vertical slice in `features/`.
//! Cross-cutting infrastructure lives in `shared/`.
//! See `docs/vsa/` at the repo root for slice rules.

mod features;
mod shared;

use tauri::Manager;

use features::playthrough::state::ActivePlaythrough;
use shared::db::app_db::AppDb;
use shared::gamedata::GameData;
use shared::paths::{app_db_path, ensure_dir, playthroughs_dir};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,specs_lib=debug")),
        )
        .init();

    #[cfg_attr(not(feature = "dev-mcp"), allow(unused_mut))]
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

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
            features::playthrough::commands::create_playthrough,
            features::playthrough::commands::list_playthroughs,
            features::playthrough::commands::open_playthrough,
            features::playthrough::commands::close_playthrough,
            features::playthrough::commands::current_playthrough,
            features::playthrough::commands::set_current_tier,
            features::playthrough::commands::delete_playthrough,
            features::factory::commands::list_factories,
            features::factory::commands::get_factory_detail,
            features::factory::commands::create_factory,
            features::factory::commands::rename_factory,
            features::factory::commands::delete_factory,
            features::factory::commands::add_factory_machine,
            features::factory::commands::update_factory_machine,
            features::factory::commands::remove_factory_machine,
            features::factory::commands::factory_ledger,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

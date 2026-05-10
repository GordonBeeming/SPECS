//! SPECS — Satisfactory Production Efficiency and Control System.
//!
//! Each user-facing feature is a vertical slice in `features/`.
//! Cross-cutting infrastructure lives in `shared/`.
//! See `docs/vsa/` at the repo root for slice rules.

mod features;
mod shared;

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
        .invoke_handler(tauri::generate_handler![
            features::health::commands::health_check,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

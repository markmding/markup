mod commands;
mod encoding;
mod error;
mod paths;

pub use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            open_vault,
            read_doc,
            write_doc,
            create_entry,
            rename_entry,
            delete_entry,
            save_attachment,
            read_attachment,
            search_vault,
            watch_vault,
            unwatch_vault,
            write_export_files,
            write_export_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markup");
}

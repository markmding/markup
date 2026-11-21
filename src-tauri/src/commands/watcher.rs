use notify::{RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<notify::RecommendedWatcher>>);

/// Starts (or restarts) recursive watching for the given vault.
/// Emits `vault:changed` with a list of changed absolute paths.
#[tauri::command]
pub fn watch_vault(
    app: AppHandle,
    state: State<'_, WatcherState>,
    root: String,
) -> Result<(), String> {
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err(format!("不是有效的文件夹：{root}"));
    }

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "文件监听状态锁不可用".to_string())?;
    *guard = None;

    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !(event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove()) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .collect();
        let _ = handle.emit("vault:changed", paths);
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_vault(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "文件监听状态锁不可用".to_string())?;
    *guard = None;
    Ok(())
}

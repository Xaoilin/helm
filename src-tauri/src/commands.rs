use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn store_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    fs::create_dir_all(&dir).ok();
    dir
}

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> String {
    store_dir(&app).to_string_lossy().to_string()
}

#[tauri::command]
pub fn read_store(app: tauri::AppHandle, key: String) -> Result<String, String> {
    let path = store_dir(&app).join(format!("{}.json", key));
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("null".to_string())
    }
}

#[tauri::command]
pub fn write_store(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let path = store_dir(&app).join(format!("{}.json", key));
    fs::write(&path, value).map_err(|e| e.to_string())
}

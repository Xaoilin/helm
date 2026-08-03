use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

const ALLOWED_STORE_KEYS: &[&str] = &[
    "assistantActivityLog",
    "assistantCorrections",
    "calendarAccounts",
    "calendarEvents",
    "calendarSources",
    "clock",
    "conversations",
    "dashboardFocusFeedback",
    "device-projectDeviceBindings",
    "device-projectPendingLegacyPaths",
    "financeAccounts",
    "financeBudgets",
    "gamification",
    "healthFastFoodEntries",
    "integrations",
    "inventoryItems",
    "inventoryNeeds",
    "knowledgeEntries",
    "knowledgeTopics",
    "lifestyleItems",
    "prayerTracking",
    "projectPages",
    "projects",
    "savingsGoals",
    "settings",
    "tasks",
    "transactions",
    "tripBookings",
    "tripBudgetEntries",
    "tripItineraryItems",
    "tripLegs",
    "trips",
    "workspaces",
];

fn store_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    fs::create_dir_all(&dir).ok();
    dir
}

fn validate_store_key(key: &str) -> Result<(), String> {
    let has_safe_shape = !key.is_empty()
        && key.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        });
    if !has_safe_shape || !ALLOWED_STORE_KEYS.contains(&key) {
        return Err("That app storage key is not allowed.".to_string());
    }
    Ok(())
}

fn store_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    validate_store_key(key)?;
    Ok(store_dir(app).join(format!("{key}.json")))
}

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> String {
    store_dir(&app).to_string_lossy().to_string()
}

#[tauri::command]
pub fn read_store(app: tauri::AppHandle, key: String) -> Result<String, String> {
    let path = store_path(&app, &key)?;
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("null".to_string())
    }
}

#[tauri::command]
pub fn write_store(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let path = store_path(&app, &key)?;
    fs::write(&path, value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_store(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = store_path(&app, &key)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn pick_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn canonicalize_project_path(path: String) -> Result<String, String> {
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|error| format!("Project folder is unavailable: {error}"))?;
    if !canonical.is_dir() {
        return Err("The selected project path is not a folder.".to_string());
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(&path);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&path);
        cmd
    };

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&path);
        cmd
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_keys_reject_traversal_and_runtime_approval_collisions() {
        for key in [
            "../project-runtime/approved-profiles",
            "project-runtime-profiles",
            "project-runtime",
            "settings/../../approved-profiles",
            "",
        ] {
            assert!(validate_store_key(key).is_err(), "{key} must be rejected");
        }
    }

    #[test]
    fn store_keys_allow_only_declared_app_and_device_stores() {
        assert!(validate_store_key("projects").is_ok());
        assert!(validate_store_key("device-projectDeviceBindings").is_ok());
        assert!(validate_store_key("device-projectPendingLegacyPaths").is_ok());
        assert!(validate_store_key("unknown-but-well-shaped").is_err());
    }
}

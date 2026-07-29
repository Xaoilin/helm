mod commands;
mod prayer_reminders;
mod project_runtime;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(project_runtime::ProjectRuntimeManager::default())
        .manage(prayer_reminders::PrayerReminderScheduler::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_data_dir,
            commands::pick_directory,
            commands::canonicalize_project_path,
            commands::open_path,
            commands::delete_store,
            commands::read_store,
            commands::write_store,
            project_runtime::fingerprint_project_profile,
            project_runtime::approve_project_profile,
            project_runtime::list_project_profiles,
            project_runtime::revoke_project_profile,
            project_runtime::start_project_profile,
            project_runtime::stop_project_session,
            project_runtime::list_project_sessions,
            project_runtime::subscribe_project_session,
            prayer_reminders::schedule_prayer_reminder,
            prayer_reminders::cancel_prayer_reminder,
            prayer_reminders::cancel_all_prayer_reminders,
            prayer_reminders::list_scheduled_prayer_reminders,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                use tauri::Manager;
                app_handle
                    .state::<project_runtime::ProjectRuntimeManager>()
                    .stop_all();
            }
        });
}

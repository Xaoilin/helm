mod commands;
mod prayer_reminders;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
            commands::open_path,
            commands::delete_store,
            commands::read_store,
            commands::write_store,
            prayer_reminders::schedule_prayer_reminder,
            prayer_reminders::cancel_prayer_reminder,
            prayer_reminders::cancel_all_prayer_reminders,
            prayer_reminders::list_scheduled_prayer_reminders,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

pub const PRAYER_REMINDER_FIRED_EVENT: &str = "prayer-reminder-fired";

#[derive(Clone, Default)]
pub struct PrayerReminderScheduler {
    jobs: Arc<Mutex<HashMap<String, ScheduledJob>>>,
}

#[derive(Clone)]
struct ScheduledJob {
    cancel_tx: Sender<()>,
    active: Arc<AtomicBool>,
    generation: Uuid,
    details: ScheduledPrayerReminder,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum PrayerName {
    Fajr,
    Dhuhr,
    Asr,
    Maghrib,
    Isha,
}

impl PrayerName {
    fn as_str(self) -> &'static str {
        match self {
            Self::Fajr => "Fajr",
            Self::Dhuhr => "Dhuhr",
            Self::Asr => "Asr",
            Self::Maghrib => "Maghrib",
            Self::Isha => "Isha",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulePrayerReminderRequest {
    prayer_date: String,
    prayer_name: PrayerName,
    deadline_iso: String,
    fire_at_iso: String,
    title: Option<String>,
    body: Option<String>,
    #[serde(default)]
    test_only: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerReminderIdentity {
    prayer_date: String,
    prayer_name: PrayerName,
    deadline_iso: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPrayerReminder {
    key: String,
    prayer_date: String,
    prayer_name: PrayerName,
    deadline_iso: String,
    fire_at_iso: String,
    test_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrayerReminderScheduleStatus {
    Scheduled,
    Expired,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrayerReminderScheduleResult {
    key: String,
    status: PrayerReminderScheduleStatus,
    deadline_iso: String,
    fire_at_iso: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrayerReminderFiredPayload {
    key: String,
    prayer_date: String,
    prayer_name: PrayerName,
    deadline_iso: String,
    fire_at_iso: String,
    fired_at_iso: String,
    notification_sent: bool,
    error: Option<String>,
    test_only: bool,
}

fn parse_instant(value: &str, field: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|_| format!("{field} must be an RFC 3339 timestamp with an offset"))
}

fn validate_prayer_date(value: &str) -> Result<(), String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| "prayerDate must use YYYY-MM-DD".to_string())
}

fn format_instant(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn reminder_key(prayer_date: &str, prayer_name: PrayerName, deadline: DateTime<Utc>) -> String {
    format!(
        "{prayer_date}:{}:{}",
        prayer_name.as_str(),
        deadline.timestamp_millis()
    )
}

fn cancel_job(job: ScheduledJob) {
    job.active.store(false, Ordering::SeqCst);
    let _ = job.cancel_tx.send(());
}

fn remove_current_job(
    jobs: &Arc<Mutex<HashMap<String, ScheduledJob>>>,
    key: &str,
    generation: Uuid,
) {
    let Ok(mut jobs) = jobs.lock() else {
        log::error!("Prayer reminder scheduler lock poisoned while removing {key}");
        return;
    };

    if jobs
        .get(key)
        .is_some_and(|job| job.generation == generation)
    {
        jobs.remove(key);
    }
}

#[tauri::command]
pub fn schedule_prayer_reminder(
    app: AppHandle,
    scheduler: State<'_, PrayerReminderScheduler>,
    reminder: SchedulePrayerReminderRequest,
) -> Result<PrayerReminderScheduleResult, String> {
    validate_prayer_date(&reminder.prayer_date)?;
    let deadline = parse_instant(&reminder.deadline_iso, "deadlineIso")?;
    let fire_at = parse_instant(&reminder.fire_at_iso, "fireAtIso")?;
    if fire_at >= deadline {
        return Err("fireAtIso must be before deadlineIso".to_string());
    }

    let key = reminder_key(&reminder.prayer_date, reminder.prayer_name, deadline);
    let deadline_iso = format_instant(deadline);
    let fire_at_iso = format_instant(fire_at);
    let now = Utc::now();

    if deadline <= now {
        let existing = scheduler
            .jobs
            .lock()
            .map_err(|_| "Prayer reminder scheduler lock is unavailable".to_string())?
            .remove(&key);
        if let Some(job) = existing {
            cancel_job(job);
        }
        return Ok(PrayerReminderScheduleResult {
            key,
            status: PrayerReminderScheduleStatus::Expired,
            deadline_iso,
            fire_at_iso,
        });
    }

    let title = reminder
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{} prayer due soon", reminder.prayer_name.as_str()));
    let body = reminder
        .body
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "Pray {} before its on-time window closes.",
                reminder.prayer_name.as_str()
            )
        });

    let generation = Uuid::new_v4();
    let active = Arc::new(AtomicBool::new(true));
    let (cancel_tx, cancel_rx) = mpsc::channel();
    let details = ScheduledPrayerReminder {
        key: key.clone(),
        prayer_date: reminder.prayer_date,
        prayer_name: reminder.prayer_name,
        deadline_iso: deadline_iso.clone(),
        fire_at_iso: fire_at_iso.clone(),
        test_only: reminder.test_only,
    };

    {
        let mut jobs = scheduler
            .jobs
            .lock()
            .map_err(|_| "Prayer reminder scheduler lock is unavailable".to_string())?;
        if let Some(existing) = jobs.insert(
            key.clone(),
            ScheduledJob {
                cancel_tx,
                active: active.clone(),
                generation,
                details: details.clone(),
            },
        ) {
            cancel_job(existing);
        }
    }

    let jobs = scheduler.jobs.clone();
    let worker_key = key.clone();
    let worker_details = details;
    let worker_active = active;
    let wait = fire_at
        .signed_duration_since(now)
        .to_std()
        .unwrap_or(Duration::ZERO);

    let spawn_result = std::thread::Builder::new()
        .name(format!("prayer-reminder-{}", reminder.prayer_name.as_str()))
        .spawn(move || {
            match cancel_rx.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => {}
            }

            if !worker_active.swap(false, Ordering::SeqCst) {
                return;
            }
            remove_current_job(&jobs, &worker_key, generation);

            let fired_at = Utc::now();
            if fired_at >= deadline {
                log::info!("Skipping expired prayer reminder {worker_key}");
                return;
            }

            let notification_result = app
                .notification()
                .builder()
                .title(&title)
                .body(&body)
                .show();
            let (notification_sent, error) = match notification_result {
                Ok(()) => (true, None),
                Err(error) => {
                    let message = error.to_string();
                    log::warn!(
                        "Native prayer reminder notification failed for {worker_key}: {message}"
                    );
                    (false, Some(message))
                }
            };

            let payload = PrayerReminderFiredPayload {
                key: worker_details.key,
                prayer_date: worker_details.prayer_date,
                prayer_name: worker_details.prayer_name,
                deadline_iso: worker_details.deadline_iso,
                fire_at_iso: worker_details.fire_at_iso,
                fired_at_iso: format_instant(fired_at),
                notification_sent,
                error,
                test_only: worker_details.test_only,
            };
            if let Err(error) = app.emit(PRAYER_REMINDER_FIRED_EVENT, payload) {
                log::warn!("Prayer reminder UI event failed for {worker_key}: {error}");
            }
        });

    if let Err(error) = spawn_result {
        let job = scheduler
            .jobs
            .lock()
            .map_err(|_| "Prayer reminder scheduler lock is unavailable".to_string())?
            .remove(&key);
        if let Some(job) = job {
            cancel_job(job);
        }
        return Err(format!("Could not start prayer reminder timer: {error}"));
    }

    Ok(PrayerReminderScheduleResult {
        key,
        status: PrayerReminderScheduleStatus::Scheduled,
        deadline_iso,
        fire_at_iso,
    })
}

#[tauri::command]
pub fn cancel_prayer_reminder(
    scheduler: State<'_, PrayerReminderScheduler>,
    reminder: PrayerReminderIdentity,
) -> Result<bool, String> {
    validate_prayer_date(&reminder.prayer_date)?;
    let deadline = parse_instant(&reminder.deadline_iso, "deadlineIso")?;
    let key = reminder_key(&reminder.prayer_date, reminder.prayer_name, deadline);
    let job = scheduler
        .jobs
        .lock()
        .map_err(|_| "Prayer reminder scheduler lock is unavailable".to_string())?
        .remove(&key);
    if let Some(job) = job {
        cancel_job(job);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn cancel_all_prayer_reminders(
    scheduler: State<'_, PrayerReminderScheduler>,
) -> Result<usize, String> {
    let jobs = {
        let mut scheduled = scheduler
            .jobs
            .lock()
            .map_err(|_| "Prayer reminder scheduler lock is unavailable".to_string())?;
        std::mem::take(&mut *scheduled)
    };
    let count = jobs.len();
    for job in jobs.into_values() {
        cancel_job(job);
    }
    Ok(count)
}

#[tauri::command]
pub fn list_scheduled_prayer_reminders(
    scheduler: State<'_, PrayerReminderScheduler>,
) -> Result<Vec<ScheduledPrayerReminder>, String> {
    let mut reminders: Vec<_> = scheduler
        .jobs
        .lock()
        .map_err(|_| "Prayer reminder scheduler lock is unavailable".to_string())?
        .values()
        .map(|job| job.details.clone())
        .collect();
    reminders.sort_by(|left, right| left.fire_at_iso.cmp(&right.fire_at_iso));
    Ok(reminders)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_uses_canonical_deadline_instant() {
        let utc = parse_instant("2026-07-28T05:00:00Z", "deadlineIso").unwrap();
        let offset = parse_instant("2026-07-28T06:00:00+01:00", "deadlineIso").unwrap();

        assert_eq!(
            reminder_key("2026-07-28", PrayerName::Fajr, utc),
            reminder_key("2026-07-28", PrayerName::Fajr, offset)
        );
    }

    #[test]
    fn invalid_local_date_is_rejected() {
        assert!(validate_prayer_date("2026-02-30").is_err());
        assert!(validate_prayer_date("28-07-2026").is_err());
    }
}

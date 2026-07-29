use chrono::Utc;
use command_group::{CommandGroup, GroupChild};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State};
use uuid::Uuid;

const PROFILE_STORE_FILE: &str = "approved-profiles.json";
const MAX_LOG_LINES: usize = 200;
const MAX_ARGUMENTS: usize = 128;
const MAX_ENVIRONMENT_ENTRIES: usize = 32;
const MAX_VALUE_LENGTH: usize = 4_096;
const MAX_LOG_LINE_BYTES: usize = 16_384;

#[cfg(unix)]
const INHERITED_RUNTIME_ENVIRONMENT: &[&str] = &[
    "HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "TERM", "TMPDIR", "USER",
];

#[cfg(windows)]
const INHERITED_RUNTIME_ENVIRONMENT: &[&str] = &[
    "APPDATA",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRunEnvironment {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveProjectProfileInput {
    pub project_id: String,
    pub recipe_id: String,
    pub label: String,
    pub project_root: String,
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub environment: Vec<ProjectRunEnvironment>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedProjectProfile {
    pub id: String,
    pub project_id: String,
    pub recipe_id: String,
    pub label: String,
    pub source_fingerprint: String,
    pub project_root: String,
    pub executable: String,
    pub args: Vec<String>,
    pub environment: Vec<ProjectRunEnvironment>,
    pub working_directory: String,
    pub approved_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeLog {
    pub stream: String,
    pub line: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectRuntimeStatus {
    Running,
    Stopped,
    Exited,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionSnapshot {
    pub session_id: String,
    pub profile_id: String,
    pub project_id: String,
    pub recipe_id: String,
    pub status: ProjectRuntimeStatus,
    pub pid: Option<u32>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub logs: Vec<ProjectRuntimeLog>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ProjectRuntimeEvent {
    Snapshot {
        session: ProjectSessionSnapshot,
    },
    Log {
        profile_id: String,
        log: ProjectRuntimeLog,
    },
}

struct RuntimeSession {
    snapshot: Mutex<ProjectSessionSnapshot>,
    child: Mutex<Option<GroupChild>>,
}

#[derive(Default)]
pub struct ProjectRuntimeManager {
    sessions: Mutex<HashMap<String, Arc<RuntimeSession>>>,
    profile_store_lock: Mutex<()>,
}

impl ProjectRuntimeManager {
    pub fn stop_all(&self) {
        let sessions = self
            .sessions
            .lock()
            .map(|entries| entries.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();

        for session in sessions {
            let _ = stop_session(&session);
        }
    }
}

fn ensure_profile_can_start(
    sessions: &HashMap<String, Arc<RuntimeSession>>,
    profile_id: &str,
) -> Result<(), String> {
    let blocked = sessions.get(profile_id).is_some_and(|session| {
        let has_child = session
            .child
            .lock()
            .map(|child| child.is_some())
            .unwrap_or(true);
        let marked_running = session
            .snapshot
            .lock()
            .map(|snapshot| snapshot.status == ProjectRuntimeStatus::Running)
            .unwrap_or(true);
        has_child || marked_running
    });
    if blocked {
        return Err("This project command is already running.".to_string());
    }
    Ok(())
}

fn runtime_store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("project-runtime");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn profile_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_store_dir(app)?.join(PROFILE_STORE_FILE))
}

fn read_profiles(app: &tauri::AppHandle) -> Result<Vec<ApprovedProjectProfile>, String> {
    let path = profile_store_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("Unable to read project run approvals: {error}"))
}

fn write_profiles(
    app: &tauri::AppHandle,
    profiles: &[ApprovedProjectProfile],
) -> Result<(), String> {
    let path = profile_store_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(profiles).map_err(|error| error.to_string())?;
    fs::write(&temporary, json).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

fn has_path_separator(value: &str) -> bool {
    value.contains('/') || value.contains('\\')
}

fn validate_text(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required."));
    }
    if trimmed.len() > MAX_VALUE_LENGTH || trimmed.contains('\0') {
        return Err(format!("{label} is invalid."));
    }
    Ok(trimmed.to_string())
}

fn validate_raw_value(value: &str, label: &str) -> Result<String, String> {
    if value.len() > MAX_VALUE_LENGTH || value.contains('\0') {
        return Err(format!("{label} is invalid."));
    }
    Ok(value.to_string())
}

fn validate_source_fingerprint(value: &str) -> Result<String, String> {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.len() != 64
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("The project run approval fingerprint is invalid.".to_string());
    }
    Ok(trimmed)
}

fn validate_environment(
    values: Vec<ProjectRunEnvironment>,
) -> Result<Vec<ProjectRunEnvironment>, String> {
    if values.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err("Too many environment flags were supplied.".to_string());
    }

    let forbidden_fragments = [
        "TOKEN",
        "SECRET",
        "PASSWORD",
        "PASSWD",
        "PRIVATE",
        "CREDENTIAL",
        "API_KEY",
    ];
    let mut normalized = Vec::with_capacity(values.len());

    for value in values {
        let name = validate_text(&value.name, "Environment flag name")?;
        let upper_name = name.to_ascii_uppercase();
        if !name.chars().enumerate().all(|(index, character)| {
            character == '_'
                || character.is_ascii_alphanumeric() && (index > 0 || !character.is_ascii_digit())
        }) {
            return Err(format!("Environment flag '{name}' has an invalid name."));
        }
        if forbidden_fragments
            .iter()
            .any(|fragment| upper_name.contains(fragment))
        {
            return Err(format!(
                "Environment flag '{name}' looks sensitive and cannot be stored in a project run profile."
            ));
        }
        let flag_value = validate_raw_value(&value.value, "Environment flag value")?;
        normalized.push(ProjectRunEnvironment {
            name,
            value: flag_value,
        });
    }

    normalized.sort_by(|left, right| left.name.cmp(&right.name));
    normalized.dedup_by(|left, right| left.name == right.name);
    Ok(normalized)
}

fn inherited_runtime_environment() -> Vec<ProjectRunEnvironment> {
    INHERITED_RUNTIME_ENVIRONMENT
        .iter()
        .filter_map(|name| {
            let value = env::var(name).ok()?;
            let value = validate_raw_value(&value, "Inherited environment value").ok()?;
            Some(ProjectRunEnvironment {
                name: (*name).to_string(),
                value,
            })
        })
        .collect()
}

fn resolve_working_directory(root: &Path, requested: Option<&str>) -> Result<PathBuf, String> {
    let candidate = match requested.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                root.join(path)
            }
        }
        None => root.to_path_buf(),
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Working directory is unavailable: {error}"))?;
    if !canonical.starts_with(root) {
        return Err(
            "The working directory must stay inside the linked project folder.".to_string(),
        );
    }
    if !canonical.is_dir() {
        return Err("The working directory is not a folder.".to_string());
    }
    Ok(canonical)
}

fn executable_search_paths() -> Vec<PathBuf> {
    let mut paths = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();

    #[cfg(target_os = "macos")]
    {
        paths.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
        if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
            paths.extend([
                home.join(".local/bin"),
                home.join(".volta/bin"),
                home.join("Library/pnpm"),
            ]);
            if let Ok(versions) = fs::read_dir(home.join(".nvm/versions/node")) {
                let mut nvm_bins = versions
                    .filter_map(Result::ok)
                    .map(|entry| entry.path().join("bin"))
                    .collect::<Vec<_>>();
                nvm_bins.sort();
                nvm_bins.reverse();
                paths.extend(nvm_bins);
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    paths.push(PathBuf::from("/usr/local/bin"));

    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(directory) = env::var_os(variable) {
                paths.push(PathBuf::from(directory).join("nodejs"));
            }
        }
        if let Some(app_data) = env::var_os("APPDATA") {
            paths.push(PathBuf::from(app_data).join("npm"));
        }
    }

    let mut unique = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

fn device_runtime_path() -> Result<String, String> {
    env::join_paths(executable_search_paths())
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| format!("Unable to construct the device executable path: {error}"))
}

fn find_executable_on_path(executable: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let extensions = {
        let has_extension = Path::new(executable).extension().is_some();
        if has_extension {
            vec![String::new()]
        } else {
            env::var("PATHEXT")
                .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
                .split(';')
                .filter(|extension| !extension.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        }
    };

    #[cfg(not(target_os = "windows"))]
    let extensions = vec![String::new()];

    for directory in executable_search_paths() {
        for extension in &extensions {
            let candidate = directory.join(format!("{executable}{extension}"));
            if candidate.is_file() {
                if let Ok(canonical) = candidate.canonicalize() {
                    return Some(canonical);
                }
            }
        }
    }
    None
}

fn resolve_executable(
    executable: &str,
    working_directory: &Path,
    project_root: &Path,
) -> Result<String, String> {
    let executable = validate_text(executable, "Executable")?;
    if !has_path_separator(&executable) {
        return find_executable_on_path(&executable)
            .map(|path| path.to_string_lossy().to_string())
            .ok_or_else(|| format!("Executable '{executable}' was not found on this device."));
    }

    let candidate = PathBuf::from(&executable);
    let was_relative = !candidate.is_absolute();
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        working_directory.join(candidate)
    };
    let canonical = resolved
        .canonicalize()
        .map_err(|error| format!("Executable is unavailable: {error}"))?;
    if !canonical.is_file() {
        return Err("The selected executable is not a file.".to_string());
    }
    if was_relative && !canonical.starts_with(project_root) {
        return Err(
            "A relative executable must stay inside the linked project folder.".to_string(),
        );
    }
    Ok(canonical.to_string_lossy().to_string())
}

fn calculate_profile_fingerprint(profile: &ApprovedProjectProfile) -> Result<String, String> {
    let material = serde_json::to_vec(&(
        &profile.project_id,
        &profile.recipe_id,
        &profile.label,
        &profile.project_root,
        &profile.executable,
        &profile.args,
        &profile.environment,
        &profile.working_directory,
    ))
    .map_err(|error| format!("Unable to fingerprint the project run profile: {error}"))?;
    let digest = Sha256::digest(material);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn normalize_approval(input: ApproveProjectProfileInput) -> Result<ApprovedProjectProfile, String> {
    if input.args.len() > MAX_ARGUMENTS {
        return Err("Too many command arguments were supplied.".to_string());
    }
    let project_root = PathBuf::from(validate_text(&input.project_root, "Project folder")?)
        .canonicalize()
        .map_err(|error| format!("Project folder is unavailable: {error}"))?;
    if !project_root.is_dir() {
        return Err("The linked project path is not a folder.".to_string());
    }
    let working_directory =
        resolve_working_directory(&project_root, input.working_directory.as_deref())?;
    let executable = resolve_executable(&input.executable, &working_directory, &project_root)?;
    let args = input
        .args
        .into_iter()
        .map(|argument| validate_raw_value(&argument, "Command argument"))
        .collect::<Result<Vec<_>, _>>()?;

    let mut environment = validate_environment(input.environment)?;
    environment.retain(|entry| !entry.name.eq_ignore_ascii_case("PATH"));
    for inherited in inherited_runtime_environment() {
        if !environment
            .iter()
            .any(|entry| entry.name.eq_ignore_ascii_case(&inherited.name))
        {
            environment.push(inherited);
        }
    }
    environment.push(ProjectRunEnvironment {
        name: "PATH".to_string(),
        value: device_runtime_path()?,
    });
    environment.sort_by(|left, right| left.name.cmp(&right.name));

    let mut profile = ApprovedProjectProfile {
        id: Uuid::new_v4().to_string(),
        project_id: validate_text(&input.project_id, "Project id")?,
        recipe_id: validate_text(&input.recipe_id, "Run recipe id")?,
        label: validate_text(&input.label, "Run recipe label")?,
        source_fingerprint: String::new(),
        project_root: project_root.to_string_lossy().to_string(),
        executable,
        args,
        environment,
        working_directory: working_directory.to_string_lossy().to_string(),
        approved_at: Utc::now().to_rfc3339(),
    };
    profile.source_fingerprint = calculate_profile_fingerprint(&profile)?;
    Ok(profile)
}

fn revalidate_approved_profile(
    profile: ApprovedProjectProfile,
) -> Result<ApprovedProjectProfile, String> {
    let expected_root = PathBuf::from(&profile.project_root);
    let project_root = expected_root
        .canonicalize()
        .map_err(|error| format!("The approved project folder is unavailable: {error}"))?;
    if !project_root.is_dir() || project_root != expected_root {
        return Err(
            "The approved project folder changed. Link and approve the command again.".to_string(),
        );
    }

    let expected_working_directory = PathBuf::from(&profile.working_directory);
    let working_directory = expected_working_directory
        .canonicalize()
        .map_err(|error| format!("The approved working directory is unavailable: {error}"))?;
    if !working_directory.is_dir()
        || !working_directory.starts_with(&project_root)
        || working_directory != expected_working_directory
    {
        return Err(
            "The approved working directory changed or escaped the project folder. Approve it again."
                .to_string(),
        );
    }

    let expected_executable = PathBuf::from(&profile.executable);
    let executable = expected_executable
        .canonicalize()
        .map_err(|error| format!("The approved executable is unavailable: {error}"))?;
    if !executable.is_file() || executable != expected_executable {
        return Err("The approved executable changed. Approve the command again.".to_string());
    }

    let fingerprint = calculate_profile_fingerprint(&profile)?;
    if fingerprint != profile.source_fingerprint {
        return Err(
            "The approved project command changed. Review and approve it again.".to_string(),
        );
    }
    Ok(profile)
}

fn project_profile_confirmation(profile: &ApprovedProjectProfile) -> (String, String) {
    let arguments = if profile.args.is_empty() {
        "(none)".to_string()
    } else {
        profile
            .args
            .iter()
            .enumerate()
            .map(|(index, argument)| format!("[{index}] {argument:?}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let environment = if profile.environment.is_empty() {
        "(none)".to_string()
    } else {
        profile
            .environment
            .iter()
            .map(|entry| format!("{}={:?}", entry.name, entry.value))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let description = format!(
        "HELM will trust this exact local command on this device.\n\n\
Executable:\n{:?}\n\n\
Arguments:\n{}\n\n\
Working directory:\n{:?}\n\n\
Non-secret environment flags:\n{}\n\n\
Any executable, argument, environment, or path change requires approval again.",
        profile.executable, arguments, profile.working_directory, environment
    );
    (format!("Trust {:?}?", profile.label), description)
}

fn confirm_project_profile(profile: &ApprovedProjectProfile) -> Result<(), String> {
    let (title, description) = project_profile_confirmation(profile);
    let result = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title(title)
        .set_description(description)
        .set_buttons(MessageButtons::YesNo)
        .show();
    if result == MessageDialogResult::Yes {
        Ok(())
    } else {
        Err("Project command approval was cancelled.".to_string())
    }
}

fn append_log(
    session: &Arc<RuntimeSession>,
    profile_id: &str,
    stream: &str,
    line: String,
    channel: &Channel<ProjectRuntimeEvent>,
) {
    let log = ProjectRuntimeLog {
        stream: stream.to_string(),
        line,
        timestamp: Utc::now().to_rfc3339(),
    };
    if let Ok(mut snapshot) = session.snapshot.lock() {
        let mut bounded = VecDeque::from(std::mem::take(&mut snapshot.logs));
        bounded.push_back(log.clone());
        while bounded.len() > MAX_LOG_LINES {
            bounded.pop_front();
        }
        snapshot.logs = bounded.into();
        snapshot.revision = snapshot.revision.saturating_add(1);
    }
    let _ = channel.send(ProjectRuntimeEvent::Log {
        profile_id: profile_id.to_string(),
        log,
    });
}

fn stream_output<R: Read + Send + 'static>(
    reader: R,
    stream: &'static str,
    profile_id: String,
    session: Arc<RuntimeSession>,
    channel: Channel<ProjectRuntimeEvent>,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut pending = Vec::new();
        let mut truncated = false;

        loop {
            let available = match reader.fill_buf() {
                Ok(available) => available,
                Err(error) => {
                    append_log(
                        &session,
                        &profile_id,
                        "system",
                        format!("Unable to read {stream}: {error}"),
                        &channel,
                    );
                    return;
                }
            };
            if available.is_empty() {
                if !pending.is_empty() || truncated {
                    let mut line = String::from_utf8_lossy(&pending).to_string();
                    if truncated {
                        line.push_str(" … [truncated]");
                    }
                    append_log(&session, &profile_id, stream, line, &channel);
                }
                return;
            }

            let newline = available.iter().position(|byte| *byte == b'\n');
            let segment_length = newline.unwrap_or(available.len());
            let remaining = MAX_LOG_LINE_BYTES.saturating_sub(pending.len());
            let retained = segment_length.min(remaining);
            pending.extend_from_slice(&available[..retained]);
            if retained < segment_length {
                truncated = true;
            }
            reader.consume(segment_length + usize::from(newline.is_some()));

            if newline.is_some() {
                if pending.last() == Some(&b'\r') {
                    pending.pop();
                }
                let mut line = String::from_utf8_lossy(&pending).to_string();
                if truncated {
                    line.push_str(" … [truncated]");
                }
                append_log(&session, &profile_id, stream, line, &channel);
                pending.clear();
                truncated = false;
            }
        }
    });
}

fn stop_session(session: &Arc<RuntimeSession>) -> Result<ProjectSessionSnapshot, String> {
    {
        let mut child_slot = session
            .child
            .lock()
            .map_err(|_| "Project process state is unavailable.".to_string())?;
        if let Some(child) = child_slot.as_mut() {
            let cleanup = match child.kill() {
                Ok(()) => child.wait().map(|_| ()),
                Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {
                    child.wait().map(|_| ())
                }
                Err(error) => Err(error),
            };
            cleanup.map_err(|error| {
                format!(
                    "Unable to stop the project process tree; its runtime reservation was retained: {error}"
                )
            })?;
        }
        *child_slot = None;
    }

    let mut snapshot = session
        .snapshot
        .lock()
        .map_err(|_| "Project session state is unavailable.".to_string())?;
    if snapshot.status == ProjectRuntimeStatus::Running {
        snapshot.status = ProjectRuntimeStatus::Stopped;
        snapshot.ended_at = Some(Utc::now().to_rfc3339());
        snapshot.revision = snapshot.revision.saturating_add(1);
    }
    Ok(snapshot.clone())
}

fn build_project_command(profile: &ApprovedProjectProfile) -> Command {
    let mut command = Command::new(&profile.executable);
    command
        .args(&profile.args)
        .current_dir(&profile.working_directory)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for entry in &profile.environment {
        command.env(&entry.name, &entry.value);
    }
    command
}

#[tauri::command]
pub fn fingerprint_project_profile(input: ApproveProjectProfileInput) -> Result<String, String> {
    Ok(normalize_approval(input)?.source_fingerprint)
}

#[tauri::command]
pub fn approve_project_profile(
    app: tauri::AppHandle,
    state: State<'_, ProjectRuntimeManager>,
    input: ApproveProjectProfileInput,
) -> Result<ApprovedProjectProfile, String> {
    let mut profile = normalize_approval(input)?;
    confirm_project_profile(&profile)?;
    let _store_guard = state
        .profile_store_lock
        .lock()
        .map_err(|_| "Project approval storage is unavailable.".to_string())?;
    let mut profiles = read_profiles(&app)?;
    if let Some(existing) = profiles.iter().find(|existing| {
        existing.project_id == profile.project_id && existing.recipe_id == profile.recipe_id
    }) {
        profile.id = existing.id.clone();
    }
    profiles.retain(|existing| existing.id != profile.id);
    profiles.push(profile.clone());
    write_profiles(&app, &profiles)?;
    Ok(profile)
}

#[tauri::command]
pub fn list_project_profiles(
    app: tauri::AppHandle,
    state: State<'_, ProjectRuntimeManager>,
) -> Result<Vec<ApprovedProjectProfile>, String> {
    let _store_guard = state
        .profile_store_lock
        .lock()
        .map_err(|_| "Project approval storage is unavailable.".to_string())?;
    read_profiles(&app)
}

#[tauri::command]
pub fn revoke_project_profile(
    app: tauri::AppHandle,
    state: State<'_, ProjectRuntimeManager>,
    profile_id: String,
) -> Result<(), String> {
    let _store_guard = state
        .profile_store_lock
        .lock()
        .map_err(|_| "Project approval storage is unavailable.".to_string())?;
    let mut profiles = read_profiles(&app)?;
    profiles.retain(|profile| profile.id != profile_id);
    write_profiles(&app, &profiles)
}

#[tauri::command]
pub fn start_project_profile(
    app: tauri::AppHandle,
    state: State<'_, ProjectRuntimeManager>,
    profile_id: String,
    expected_fingerprint: String,
    on_event: Channel<ProjectRuntimeEvent>,
) -> Result<ProjectSessionSnapshot, String> {
    let expected_fingerprint = validate_source_fingerprint(&expected_fingerprint)?;
    let profile = {
        let _store_guard = state
            .profile_store_lock
            .lock()
            .map_err(|_| "Project approval storage is unavailable.".to_string())?;
        read_profiles(&app)?
            .into_iter()
            .find(|profile| profile.id == profile_id)
            .ok_or_else(|| "This project run profile is not approved on this device.".to_string())?
    };
    let profile = revalidate_approved_profile(profile)?;
    if profile.source_fingerprint != expected_fingerprint {
        return Err(
            "This project command or linked folder changed. Review and approve it again."
                .to_string(),
        );
    }

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Project runtime is unavailable.".to_string())?;
    ensure_profile_can_start(&sessions, &profile.id)?;

    let mut child = build_project_command(&profile)
        .group_spawn()
        .map_err(|error| format!("Unable to start '{}': {error}", profile.label))?;
    let stdout = child.inner().stdout.take();
    let stderr = child.inner().stderr.take();
    let snapshot = ProjectSessionSnapshot {
        session_id: Uuid::new_v4().to_string(),
        profile_id: profile.id.clone(),
        project_id: profile.project_id.clone(),
        recipe_id: profile.recipe_id.clone(),
        status: ProjectRuntimeStatus::Running,
        pid: Some(child.id()),
        started_at: Utc::now().to_rfc3339(),
        ended_at: None,
        exit_code: None,
        logs: Vec::new(),
        revision: 1,
    };
    let session = Arc::new(RuntimeSession {
        snapshot: Mutex::new(snapshot.clone()),
        child: Mutex::new(Some(child)),
    });

    sessions.insert(profile.id.clone(), session.clone());
    drop(sessions);

    let _ = on_event.send(ProjectRuntimeEvent::Snapshot {
        session: snapshot.clone(),
    });
    if let Some(stdout) = stdout {
        stream_output(
            stdout,
            "stdout",
            profile.id.clone(),
            session.clone(),
            on_event.clone(),
        );
    }
    if let Some(stderr) = stderr {
        stream_output(
            stderr,
            "stderr",
            profile.id.clone(),
            session.clone(),
            on_event.clone(),
        );
    }

    let monitor_session = session.clone();
    let monitor_channel = on_event.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(150));
        let exit_status = {
            let mut child_slot = match monitor_session.child.lock() {
                Ok(child_slot) => child_slot,
                Err(_) => return,
            };
            let Some(child) = child_slot.as_mut() else {
                return;
            };
            match child.try_wait() {
                Ok(status) => status,
                Err(error) => {
                    let cleanup = child.kill().and_then(|_| child.wait().map(|_| ()));
                    if let Err(cleanup_error) = cleanup {
                        drop(child_slot);
                        append_log(
                            &monitor_session,
                            &profile.id,
                            "system",
                            format!(
                                "Unable to monitor project process: {error}. Cleanup also failed: \
                                 {cleanup_error}. The runtime reservation was retained; use Stop to retry."
                            ),
                            &monitor_channel,
                        );
                        return;
                    }
                    *child_slot = None;
                    if let Ok(mut snapshot) = monitor_session.snapshot.lock() {
                        snapshot.status = ProjectRuntimeStatus::Failed;
                        snapshot.ended_at = Some(Utc::now().to_rfc3339());
                        snapshot.revision = snapshot.revision.saturating_add(1);
                        let failed = snapshot.clone();
                        drop(snapshot);
                        let _ =
                            monitor_channel.send(ProjectRuntimeEvent::Snapshot { session: failed });
                    }
                    append_log(
                        &monitor_session,
                        &profile.id,
                        "system",
                        format!(
                            "Unable to monitor project process: {error}. The process group was stopped."
                        ),
                        &monitor_channel,
                    );
                    return;
                }
            }
        };

        if let Some(status) = exit_status {
            if let Ok(mut child_slot) = monitor_session.child.lock() {
                *child_slot = None;
            }
            if let Ok(mut snapshot) = monitor_session.snapshot.lock() {
                snapshot.status = ProjectRuntimeStatus::Exited;
                snapshot.ended_at = Some(Utc::now().to_rfc3339());
                snapshot.exit_code = status.code();
                snapshot.revision = snapshot.revision.saturating_add(1);
                let finished = snapshot.clone();
                drop(snapshot);
                let _ = monitor_channel.send(ProjectRuntimeEvent::Snapshot { session: finished });
            }
            return;
        }
    });

    Ok(snapshot)
}

#[tauri::command]
pub fn stop_project_session(
    state: State<'_, ProjectRuntimeManager>,
    profile_id: String,
) -> Result<ProjectSessionSnapshot, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "Project runtime is unavailable.".to_string())?
        .get(&profile_id)
        .cloned()
        .ok_or_else(|| "No project session exists for that profile.".to_string())?;
    stop_session(&session)
}

#[tauri::command]
pub fn list_project_sessions(
    state: State<'_, ProjectRuntimeManager>,
) -> Result<Vec<ProjectSessionSnapshot>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Project runtime is unavailable.".to_string())?;
    let mut snapshots = sessions
        .values()
        .filter_map(|session| {
            session
                .snapshot
                .lock()
                .ok()
                .map(|snapshot| snapshot.clone())
        })
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    Ok(snapshots)
}

#[tauri::command]
pub fn subscribe_project_session(
    state: State<'_, ProjectRuntimeManager>,
    profile_id: String,
    on_event: Channel<ProjectRuntimeEvent>,
) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "Project runtime is unavailable.".to_string())?
        .get(&profile_id)
        .cloned()
        .ok_or_else(|| "No project session exists for that profile.".to_string())?;

    thread::spawn(move || {
        let mut last_revision = 0;
        loop {
            thread::sleep(Duration::from_millis(150));
            let snapshot = match session.snapshot.lock() {
                Ok(snapshot) => snapshot.clone(),
                Err(_) => return,
            };
            if snapshot.revision != last_revision {
                last_revision = snapshot.revision;
                let terminal = snapshot.status != ProjectRuntimeStatus::Running;
                if on_event
                    .send(ProjectRuntimeEvent::Snapshot { session: snapshot })
                    .is_err()
                {
                    return;
                }
                if terminal {
                    return;
                }
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Barrier,
    };

    fn temporary_directory() -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("helm-project-runtime-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create temp project");
        directory
    }

    fn base_input(root: &Path) -> ApproveProjectProfileInput {
        ApproveProjectProfileInput {
            project_id: "project-1".to_string(),
            recipe_id: "dev".to_string(),
            label: "Development server".to_string(),
            project_root: root.to_string_lossy().to_string(),
            executable: "npm".to_string(),
            args: vec!["run".to_string(), "dev".to_string()],
            environment: Vec::new(),
            working_directory: None,
        }
    }

    fn running_session(profile_id: &str, child: Option<GroupChild>) -> Arc<RuntimeSession> {
        Arc::new(RuntimeSession {
            snapshot: Mutex::new(ProjectSessionSnapshot {
                session_id: Uuid::new_v4().to_string(),
                profile_id: profile_id.to_string(),
                project_id: "project".to_string(),
                recipe_id: "dev".to_string(),
                status: ProjectRuntimeStatus::Running,
                pid: child.as_ref().map(GroupChild::id),
                started_at: Utc::now().to_rfc3339(),
                ended_at: None,
                exit_code: None,
                logs: Vec::new(),
                revision: 1,
            }),
            child: Mutex::new(child),
        })
    }

    const UNAPPROVED_ENVIRONMENT_SENTINEL: &str =
        "HELM_PROJECT_RUNTIME_UNAPPROVED_ENVIRONMENT_SENTINEL";
    const ENVIRONMENT_PROBE_STAGE: &str = "HELM_PROJECT_RUNTIME_ENVIRONMENT_PROBE_STAGE";

    #[test]
    fn approved_command_does_not_inherit_unapproved_environment() {
        if env::var(ENVIRONMENT_PROBE_STAGE).as_deref() == Ok("approved-command") {
            assert!(
                env::var_os(UNAPPROVED_ENVIRONMENT_SENTINEL).is_none(),
                "the approved command inherited an environment value outside its profile"
            );
            return;
        }

        if env::var_os(UNAPPROVED_ENVIRONMENT_SENTINEL).is_none() {
            let output = Command::new(env::current_exe().expect("current test executable"))
                .arg("approved_command_does_not_inherit_unapproved_environment")
                .arg("--nocapture")
                .env(UNAPPROVED_ENVIRONMENT_SENTINEL, "must-not-leak")
                .env_remove(ENVIRONMENT_PROBE_STAGE)
                .output()
                .expect("spawn isolated test driver");
            assert!(
                output.status.success(),
                "isolated test driver failed:\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let current_executable = env::current_exe().expect("current test executable");
        let working_directory = current_executable
            .parent()
            .expect("test executable directory")
            .to_path_buf();
        let profile = ApprovedProjectProfile {
            id: "profile".to_string(),
            project_id: "project".to_string(),
            recipe_id: "environment-probe".to_string(),
            label: "Environment probe".to_string(),
            source_fingerprint: "unused".to_string(),
            project_root: working_directory.to_string_lossy().to_string(),
            executable: current_executable.to_string_lossy().to_string(),
            args: vec![
                "approved_command_does_not_inherit_unapproved_environment".to_string(),
                "--nocapture".to_string(),
            ],
            environment: [
                inherited_runtime_environment(),
                vec![ProjectRunEnvironment {
                    name: ENVIRONMENT_PROBE_STAGE.to_string(),
                    value: "approved-command".to_string(),
                }],
            ]
            .concat(),
            working_directory: working_directory.to_string_lossy().to_string(),
            approved_at: Utc::now().to_rfc3339(),
        };

        let output = build_project_command(&profile)
            .output()
            .expect("spawn approved environment probe");
        assert!(
            output.status.success(),
            "approved environment probe failed:\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn approval_rejects_sensitive_environment_values() {
        let root = temporary_directory();
        let mut input = base_input(&root);
        input.environment = vec![ProjectRunEnvironment {
            name: "API_KEY".to_string(),
            value: "do-not-store".to_string(),
        }];

        let error = normalize_approval(input).expect_err("sensitive env must fail");
        assert!(error.contains("looks sensitive"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn approval_rejects_working_directory_escape() {
        let root = temporary_directory();
        let outside = temporary_directory();
        let mut input = base_input(&root);
        input.working_directory = Some(outside.to_string_lossy().to_string());

        let error = normalize_approval(input).expect_err("outside cwd must fail");
        assert!(error.contains("inside the linked project folder"));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn approval_preserves_structured_argument_and_environment_whitespace() {
        let root = temporary_directory();
        let mut input = base_input(&root);
        input.args = vec![
            "run".to_string(),
            "value with spaces ".to_string(),
            "".to_string(),
        ];
        input.environment = vec![ProjectRunEnvironment {
            name: "DASHBOARD_MODE".to_string(),
            value: " enabled ".to_string(),
        }];

        let profile =
            normalize_approval(input).expect("approval should preserve structured values");
        assert_eq!(profile.args[1], "value with spaces ");
        assert_eq!(profile.args[2], "");
        let dashboard_mode = profile
            .environment
            .iter()
            .find(|entry| entry.name == "DASHBOARD_MODE")
            .expect("approved environment entry");
        assert_eq!(dashboard_mode.value, " enabled ");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn approval_receipt_escapes_control_characters() {
        let root = temporary_directory();
        let mut input = base_input(&root);
        input.label = "Development\nExecutable: fake".to_string();
        input.environment = vec![ProjectRunEnvironment {
            name: "DISPLAY_MODE".to_string(),
            value: "safe\nExecutable: fake".to_string(),
        }];
        let profile = normalize_approval(input).expect("profile");
        let (title, description) = project_profile_confirmation(&profile);

        assert!(!title.contains('\n'));
        assert!(!description.contains("safe\nExecutable: fake"));
        assert!(title.contains("\\nExecutable"));
        assert!(description.contains("safe\\nExecutable"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn native_fingerprint_changes_with_structured_recipe_material() {
        let root = temporary_directory();
        let first = normalize_approval(base_input(&root)).expect("first profile");
        let mut changed_input = base_input(&root);
        changed_input.args.push("--host".to_string());
        let changed = normalize_approval(changed_input).expect("changed profile");

        assert_eq!(first.source_fingerprint.len(), 64);
        assert_ne!(first.source_fingerprint, changed.source_fingerprint);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn approval_binds_the_device_runtime_path() {
        let root = temporary_directory();
        let profile = normalize_approval(base_input(&root)).expect("profile");
        let runtime_path = profile
            .environment
            .iter()
            .find(|entry| entry.name == "PATH")
            .expect("device PATH");

        assert_eq!(
            runtime_path.value,
            device_runtime_path().expect("runtime PATH")
        );
        assert!(!runtime_path.value.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn packaged_macos_path_runs_the_resolved_npm_shebang() {
        let root = temporary_directory();
        let profile = normalize_approval(base_input(&root)).expect("profile");
        let mut command = Command::new(&profile.executable);
        command.arg("--version").env_clear();
        if let Some(home) = env::var_os("HOME") {
            command.env("HOME", home);
        }
        for entry in &profile.environment {
            command.env(&entry.name, &entry.value);
        }

        let status = command.status().expect("run npm with approved environment");
        assert!(status.success());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_duplicate_start_reservation_allows_only_one_profile() {
        let sessions = Arc::new(Mutex::new(HashMap::<String, Arc<RuntimeSession>>::new()));
        let barrier = Arc::new(Barrier::new(3));
        let successful_reservations = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();

        for _ in 0..2 {
            let sessions = sessions.clone();
            let barrier = barrier.clone();
            let successful_reservations = successful_reservations.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                let mut sessions = sessions.lock().expect("sessions");
                if ensure_profile_can_start(&sessions, "profile").is_ok() {
                    sessions.insert("profile".to_string(), running_session("profile", None));
                    successful_reservations.fetch_add(1, Ordering::SeqCst);
                }
            }));
        }

        barrier.wait();
        for handle in handles {
            handle.join().expect("reservation thread");
        }
        assert_eq!(successful_reservations.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn retained_child_handle_blocks_restart_after_a_failed_status() {
        let rustc = env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
        let child = Command::new(rustc)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .group_spawn()
            .expect("spawn child");
        let session = running_session("profile", Some(child));
        session.snapshot.lock().expect("snapshot").status = ProjectRuntimeStatus::Failed;
        let mut sessions = HashMap::new();
        sessions.insert("profile".to_string(), session.clone());

        let error = ensure_profile_can_start(&sessions, "profile")
            .expect_err("retained child must keep the profile reserved");
        assert!(error.contains("already running"));
        stop_session(&session).expect("reap retained child");
    }

    #[cfg(unix)]
    #[test]
    fn exit_cleanup_stops_the_whole_process_group() {
        let root = temporary_directory();
        let pid_file = root.join("child.pid");
        let script = format!(
            "sleep 30 & child=$!; printf '%s' \"$child\" > {}; wait \"$child\"",
            pid_file.to_string_lossy()
        );
        let child = Command::new("sh")
            .args(["-c", &script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .group_spawn()
            .expect("spawn process group");
        let session = running_session("profile", Some(child));
        let manager = ProjectRuntimeManager::default();
        manager
            .sessions
            .lock()
            .expect("sessions")
            .insert("profile".to_string(), session.clone());

        for _ in 0..50 {
            if pid_file.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let descendant_pid = fs::read_to_string(&pid_file).expect("descendant pid");
        manager.stop_all();

        let mut descendant_alive = true;
        for _ in 0..50 {
            descendant_alive = Command::new("kill")
                .args(["-0", descendant_pid.trim()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if !descendant_alive {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        assert!(!descendant_alive, "descendant process should be stopped");
        assert_eq!(
            session.snapshot.lock().expect("snapshot").status,
            ProjectRuntimeStatus::Stopped
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn exit_cleanup_stops_a_windows_descendant_process() {
        let root = temporary_directory();
        let started_file = root.join("descendant-started.txt");
        let completed_file = root.join("descendant-completed.txt");
        let child_script = root.join("child.cmd");
        let parent_script = root.join("parent.cmd");
        fs::write(
            &child_script,
            "@echo off\r\n\
             > \"%HELM_TEST_STARTED%\" echo started\r\n\
             ping -n 4 127.0.0.1 >nul\r\n\
             > \"%HELM_TEST_COMPLETED%\" echo completed\r\n",
        )
        .expect("write child script");
        fs::write(
            &parent_script,
            "@echo off\r\n\
             start \"\" /b cmd.exe /d /c call \"%HELM_TEST_CHILD%\"\r\n\
             ping -n 30 127.0.0.1 >nul\r\n",
        )
        .expect("write parent script");

        let child = Command::new("cmd.exe")
            .args(["/d", "/c"])
            .arg(&parent_script)
            .env("HELM_TEST_CHILD", &child_script)
            .env("HELM_TEST_STARTED", &started_file)
            .env("HELM_TEST_COMPLETED", &completed_file)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .group_spawn()
            .expect("spawn Windows process group");
        let session = running_session("profile", Some(child));
        let manager = ProjectRuntimeManager::default();
        manager
            .sessions
            .lock()
            .expect("sessions")
            .insert("profile".to_string(), session);

        for _ in 0..40 {
            if started_file.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(started_file.exists(), "descendant process should start");
        manager.stop_all();
        thread::sleep(Duration::from_secs(4));

        assert!(
            !completed_file.exists(),
            "descendant process should be stopped with its Windows job"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn start_time_validation_rejects_a_working_directory_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = temporary_directory();
        let outside = temporary_directory();
        let working_directory = root.join("work");
        fs::create_dir_all(&working_directory).expect("create work directory");
        let mut input = base_input(&root);
        input.working_directory = Some("work".to_string());
        let profile = normalize_approval(input).expect("profile");

        fs::remove_dir(&working_directory).expect("remove original work directory");
        symlink(&outside, &working_directory).expect("replace work directory with symlink");

        let error = revalidate_approved_profile(profile).expect_err("symlink escape must fail");
        assert!(error.contains("escaped the project folder"));
        let _ = fs::remove_file(working_directory);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn relative_executable_cannot_escape_the_project_root() {
        let root = temporary_directory();
        let outside = temporary_directory();
        let executable = outside.join("tool");
        fs::write(&executable, b"tool").expect("write executable");
        let relative = PathBuf::from("..")
            .join(outside.file_name().expect("outside name"))
            .join("tool");

        let error = resolve_executable(&relative.to_string_lossy(), &root, &root)
            .expect_err("relative executable escape must fail");
        assert!(error.contains("inside the linked project folder"));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn streamed_log_lines_are_byte_bounded() {
        use std::io::Cursor;

        let snapshot = ProjectSessionSnapshot {
            session_id: "session".to_string(),
            profile_id: "profile".to_string(),
            project_id: "project".to_string(),
            recipe_id: "dev".to_string(),
            status: ProjectRuntimeStatus::Running,
            pid: None,
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            logs: Vec::new(),
            revision: 0,
        };
        let session = Arc::new(RuntimeSession {
            snapshot: Mutex::new(snapshot),
            child: Mutex::new(None),
        });
        let channel = Channel::new(|_| Ok(()));
        let mut bytes = vec![b'x'; MAX_LOG_LINE_BYTES * 2];
        bytes.push(b'\n');
        stream_output(
            Cursor::new(bytes),
            "stdout",
            "profile".to_string(),
            session.clone(),
            channel,
        );

        for _ in 0..50 {
            if session
                .snapshot
                .lock()
                .map(|snapshot| !snapshot.logs.is_empty())
                .unwrap_or(false)
            {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let snapshot = session.snapshot.lock().expect("snapshot");
        assert_eq!(snapshot.logs.len(), 1);
        assert!(snapshot.logs[0].line.len() <= MAX_LOG_LINE_BYTES + " … [truncated]".len());
        assert!(snapshot.logs[0].line.ends_with("[truncated]"));
    }

    #[test]
    fn logs_are_bounded_to_latest_two_hundred_lines() {
        let snapshot = ProjectSessionSnapshot {
            session_id: "session".to_string(),
            profile_id: "profile".to_string(),
            project_id: "project".to_string(),
            recipe_id: "dev".to_string(),
            status: ProjectRuntimeStatus::Running,
            pid: None,
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            exit_code: None,
            logs: Vec::new(),
            revision: 0,
        };
        let session = Arc::new(RuntimeSession {
            snapshot: Mutex::new(snapshot),
            child: Mutex::new(None),
        });
        let channel = Channel::new(|_| Ok(()));

        for index in 0..250 {
            append_log(
                &session,
                "profile",
                "stdout",
                format!("line {index}"),
                &channel,
            );
        }

        let snapshot = session.snapshot.lock().expect("snapshot");
        assert_eq!(snapshot.logs.len(), MAX_LOG_LINES);
        assert_eq!(
            snapshot.logs.first().map(|log| log.line.as_str()),
            Some("line 50")
        );
        assert_eq!(
            snapshot.logs.last().map(|log| log.line.as_str()),
            Some("line 249")
        );
    }
}

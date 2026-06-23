use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

#[derive(Debug, Serialize)]
struct RunResult {
    run_id: Option<String>,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn emit_status(app: &AppHandle, message: &str) {
    let _ = app.emit("agent://status", message);
}

#[tauri::command]
async fn claim_and_run(app: AppHandle, token: String, api_origin: String) -> Result<RunResult, String> {
    let origin = api_origin.trim_end_matches('/');
    emit_status(&app, "Échange du token avec le serveur…");

    let client = reqwest::Client::new();
    let claim_url = format!("{origin}/api/agent/claim");
    let res = client
        .post(&claim_url)
        .json(&serde_json::json!({ "token": token }))
        .send()
        .await
        .map_err(|e| format!("Réseau : {e}"))?;

    let status = res.status();
    let raw = res
        .text()
        .await
        .map_err(|e| format!("Réseau : {e}"))?;
    let body: Value = serde_json::from_str(&raw).map_err(|_| {
        let snippet: String = raw.chars().take(120).collect();
        format!("Serveur injoignable ({status}) à {claim_url}. Réponse : {snippet}")
    })?;

    if let Some(err) = body.get("error").and_then(|v| v.as_str()) {
        return Ok(RunResult {
            run_id: body.get("runId").and_then(|v| v.as_str()).map(String::from),
            message: err.to_string(),
            error: Some(err.to_string()),
        });
    }

    if !status.is_success() {
        let err = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Erreur serveur");
        return Ok(RunResult {
            run_id: None,
            message: err.to_string(),
            error: Some(err.to_string()),
        });
    }

    let run_id = body
        .get("runId")
        .and_then(|v| v.as_str())
        .ok_or("runId manquant")?
        .to_string();
    let user_id = body
        .get("userId")
        .and_then(|v| v.as_str())
        .ok_or("userId manquant")?
        .to_string();

    let engine_env: HashMap<String, String> = body
        .get("engineEnv")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    emit_status(&app, "Lancement du moteur Python…");

    let app_clone = app.clone();
    let run_id_clone = run_id.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = spawn_engine(&app_clone, &user_id, &run_id_clone, engine_env).await {
            let _ = app_clone.emit(
                "agent://status",
                format!("Erreur moteur : {e}"),
            );
        }
    });

    Ok(RunResult {
        run_id: Some(run_id),
        message: "Chromium va s'ouvrir sur votre écran. Vérifiez chaque formulaire puis cliquez Submit.".to_string(),
        error: None,
    })
}

fn playwright_cache_dir() -> Option<String> {
    if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .ok()
            .map(|h| format!("{h}/Library/Caches/ms-playwright"))
    } else if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|p| format!("{p}\\ms-playwright"))
    } else {
        std::env::var("HOME")
            .ok()
            .map(|h| format!("{h}/.cache/ms-playwright"))
    }
}

async fn spawn_engine(
    app: &AppHandle,
    user_id: &str,
    run_id: &str,
    engine_env: HashMap<String, String>,
) -> Result<(), String> {
    let args = vec![
        "--user-id".to_string(),
        user_id.to_string(),
        "--run-id".to_string(),
        run_id.to_string(),
        "--mode".to_string(),
        "autoapply".to_string(),
    ];

    let mut env = engine_env;
    if let Some(cache) = playwright_cache_dir() {
        env.insert("PLAYWRIGHT_BROWSERS_PATH".to_string(), cache);
    }

    let sidecar_result = app.shell().sidecar("blowmyjob-engine");
    if let Ok(sidecar) = sidecar_result {
        let (mut rx, _child) = sidecar
            .args(args.clone())
            .envs(env.clone())
            .spawn()
            .map_err(|e| format!("Spawn sidecar échoué : {e}"))?;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let _ = app.emit("agent://status", trimmed.to_string());
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code.unwrap_or(1) != 0 {
                        return Err(format!("Moteur terminé avec code {:?}", payload.code));
                    }
                    let _ = app.emit(
                        "agent://status",
                        "Auto-apply terminé. Revenez sur le dashboard.".to_string(),
                    );
                    return Ok(());
                }
                _ => {}
            }
        }
        return Ok(());
    }

    // Dev fallback : python engine/venv (si sidecar pas encore buildé)
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir : {e}"))?;
    let engine_root = resource_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("engine"))
        .filter(|p| p.exists())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.join("../../engine"))
                .filter(|p| p.exists())
        });

    let (engine_dir, python) = match engine_root {
        Some(dir) => {
            let unix_venv_py = dir.join("venv/bin/python");
            let windows_venv_py = dir.join("venv").join("Scripts").join("python.exe");
            let py = if unix_venv_py.exists() {
                unix_venv_py
            } else if windows_venv_py.exists() {
                windows_venv_py
            } else if cfg!(target_os = "windows") {
                std::path::PathBuf::from("python")
            } else {
                std::path::PathBuf::from("python3")
            };
            (dir, py)
        }
        None => {
            return Err(
                "Sidecar blowmyjob-engine introuvable. Exécutez desktop/scripts/build-sidecar.sh"
                    .to_string(),
            );
        }
    };

    let script = engine_dir.join("run_for_user.py");
    let cmd = app
        .shell()
        .command(python)
        .args([
            script.to_string_lossy().to_string(),
            "--user-id".to_string(),
            user_id.to_string(),
            "--run-id".to_string(),
            run_id.to_string(),
            "--mode".to_string(),
            "autoapply".to_string(),
        ])
        .envs(env)
        .current_dir(engine_dir);

    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("Spawn python échoué : {e}"))?;

    while let Some(event) = rx.recv().await {
        if let CommandEvent::Terminated(payload) = event {
            if payload.code.unwrap_or(1) != 0 {
                return Err(format!("Moteur terminé avec code {:?}", payload.code));
            }
            let _ = app.emit(
                "agent://status",
                "Auto-apply terminé. Revenez sur le dashboard.".to_string(),
            );
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![claim_and_run])
        .setup(|app| {
            // macOS enregistre le scheme via Info.plist (bundle config).
            // register() runtime n'existe que sur Linux/Windows.
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("blowmyjob");
            }
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

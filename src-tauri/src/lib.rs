use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[tauri::command]
fn save_datapack_export(app: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
  let safe_name = file_name
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
      c if c.is_control() => '-',
      c => c,
    })
    .collect::<String>();
  let docs = app.path().document_dir().map_err(|e| e.to_string())?;
  let out_dir: PathBuf = docs.join("PRISM Worldgen Lab").join("Datapacks");
  fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
  let out_path = out_dir.join(safe_name);
  fs::write(&out_path, bytes).map_err(|e| e.to_string())?;

  #[cfg(target_os = "windows")]
  {
    let _ = Command::new("explorer").arg(&out_dir).spawn();
  }
  #[cfg(target_os = "macos")]
  {
    let _ = Command::new("open").arg(&out_dir).spawn();
  }
  #[cfg(all(unix, not(target_os = "macos")))]
  {
    let _ = Command::new("xdg-open").arg(&out_dir).spawn();
  }

  Ok(out_path.display().to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  if !(url.starts_with("https://github.com/") || url.starts_with("https://discord.gg/")) {
    return Err("URL is not allowed".to_string());
  }

  #[cfg(target_os = "windows")]
  {
    Command::new("cmd")
      .args(["/C", "start", "", &url])
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(all(unix, not(target_os = "macos")))]
  {
    Command::new("xdg-open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
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
    .invoke_handler(tauri::generate_handler![save_datapack_export, open_external_url])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

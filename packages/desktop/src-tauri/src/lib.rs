use std::env;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

const PORT: u16 = 3001;
const POLL_INTERVAL: Duration = Duration::from_millis(300);
const POLL_TIMEOUT: Duration = Duration::from_secs(30);

struct ServerProcess(Mutex<Option<Child>>);

impl Drop for ServerProcess {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn find_project_root() -> PathBuf {
    // En mode dev, on est dans packages/desktop/src-tauri/
    // En mode build, le binaire peut être n'importe où
    if let Ok(root) = env::var("OLDPHOTOS_ROOT") {
        return PathBuf::from(root);
    }

    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let mut dir = PathBuf::from(manifest_dir);
    for _ in 0..5 {
        if dir.join("ai").is_dir() {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }

    // Fallback: 3 niveaux au-dessus de src-tauri/
    PathBuf::from(manifest_dir)
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(manifest_dir))
}

fn spawn_server(root: &PathBuf) -> std::io::Result<Child> {
    let entry = root.join("packages").join("core").join("index.js");

    Command::new("node")
        .arg(&entry)
        .env("PORT", PORT.to_string())
        .env("OLDPHOTOS_ROOT", root)
        .current_dir(root)
        .spawn()
}

fn wait_for_server() -> bool {
    let url = format!("http://localhost:{}/api/status", PORT);
    let start = std::time::Instant::now();

    while start.elapsed() < POLL_TIMEOUT {
        if let Ok(resp) = ureq::get(&url).call() {
            if resp.status() == 200 {
                return true;
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = find_project_root();
    let skip_server = env::var("TAURI_DEV_SERVER_RUNNING").is_ok();

    let server_process = if skip_server {
        ServerProcess(Mutex::new(None))
    } else {
        let child = spawn_server(&root).expect("Impossible de lancer le serveur Node.js");
        ServerProcess(Mutex::new(Some(child)))
    };

    if !skip_server && !wait_for_server() {
        eprintln!("Le serveur n'a pas démarré dans les {} secondes", POLL_TIMEOUT.as_secs());
        std::process::exit(1);
    }

    tauri::Builder::default()
        .manage(server_process)
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de l'application Tauri");
}

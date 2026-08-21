// Exemple Rust : polypm lance `cargo build` puis supervise directement le binaire produit.
use std::env;
use std::process;
use std::thread;
use std::time::Duration;

fn main() {
    let name = env::var("HEARTBEAT_NAME").unwrap_or_else(|_| "heartbeat".to_string());
    println!("[rs] {} démarré (pid {})", name, process::id());

    let mut beat: u64 = 0;
    loop {
        beat += 1;
        println!("[rs] {} battement {}", name, beat);
        thread::sleep(Duration::from_secs(2));
    }
}

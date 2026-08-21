use std::thread;
use std::time::Duration;

fn main() {
    println!("hello-from-rust");
    loop {
        thread::sleep(Duration::from_secs(1));
    }
}

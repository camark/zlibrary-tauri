#![windows_subsystem = "windows"]

#[cfg(feature = "gui")]
fn main() {
    zlibrary_core::run();
}

#[cfg(not(feature = "gui"))]
fn main() {
    panic!("This binary requires the 'gui' feature to be enabled");
}

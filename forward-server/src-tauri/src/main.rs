// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ble;
mod http;

use serde::Deserialize;

#[derive(Deserialize)]
pub struct ImuData {
    pub ax: f32,
    pub ay: f32,
    pub az: f32,
    pub gx: f32,
    pub gy: f32,
    pub gz: f32,
}

/*
 * button/wheel consts
*/
pub const BUTTON_MAP: &[(u8, &str)] = &[(1, "upper"), (2, "lower"), (3, "something_else")];

pub const WHEEL_DIRECTION_MAP: &[(u8, &str)] = &[(0, "left"), (1, "right")];

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/*
 * main tauri + api stuff
*/
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_handle_http = app_handle.clone();
            let app_handle_ble = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http::start_server(app_handle_http).await {
                    eprintln!("HTTP Server error: {e}");
                }
            });
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ble::start_ble(app_handle_ble).await {
                    eprintln!("BLE error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use actix_web::{App, HttpResponse, HttpServer, Responder, get, post, web::{self}};
use serde::Deserialize;
use std::io::Result;
use tauri::{Emitter, Manager};

/*
 * consts
*/
#[derive(Deserialize)]
struct ImuData {
    ax: f32,
    ay: f32,
    az: f32,
    gx: f32,
    gy: f32,
    gz: f32,
}

/*
 * button/wheel consts
*/
const BUTTON_MAP: &[(u8, &str)] = &[(1, "upper"), (2, "lower"), (3, "something_else")];

const WHEEL_DIRECTION_MAP: &[(u8, &str)] = &[(0, "left"), (1, "right")];

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
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_server(app_handle).await {
                    eprintln!("Server error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn start_server(app_handle: tauri::AppHandle) -> Result<()> {
    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(app_handle.clone()))
            .service(hello)
            .service(imu_data)
            .service(press)
            .service(wheel)
    })
    .bind(("localhost", 5001))?
    .run();

    server.await
}

/*
 * api endpoints
 */

// TODO: change these so these are all POST requests? to support ids for multi-devices
// or add query param for device id
#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[get("/imu")]
async fn imu_data(query: web::Query<ImuData>, app_handle: web::Data<tauri::AppHandle>) -> impl Responder {
    println!("IMU endpoint hit");
    println!("Received IMU data: ax={}, ay={}, az={}, gx={}, gy={}, gz={}", 
        query.ax, query.ay, query.az, query.gx, query.gy, query.gz);
    let imu_json = serde_json::json!({
        "accel": { "x": query.ax, "y": query.ay, "z": query.az },
        "gyro": { "x": query.gx, "y": query.gy, "z": query.gz }
    });
    let response = format!("IMU data received: {}", imu_json.to_string());
    let _ = app_handle.emit("imu-data", imu_json);
    HttpResponse::Ok().body(response)
}

#[get("/button/{button}")]
async fn press(button: web::Path<u8>, app_handle: web::Data<tauri::AppHandle>) -> impl Responder {
    println!("Button endpoint hit");
    println!("Button value: {}", button);
    let button = button.into_inner();
    let response;
    match BUTTON_MAP.iter().find(|(b, _)| *b == button) {
        Some((_, name)) => {
            println!("Button pressed: {}", name);
            response = format!("Button pressed: {}", name);
            let _ = app_handle.emit("button-pressed", serde_json::json!({ "button": name }));
        }
        None => {
            println!("Unknown button pressed: {}", button);
            response = format!("Unknown button pressed: {}", button);
        }
    }

    HttpResponse::Ok().body(response)
}

#[get("/wheel/{direction}")]
async fn wheel(direction: web::Path<u8>, app_handle: web::Data<tauri::AppHandle>) -> impl Responder {
    println!("Wheel endpoint hit");
    println!("Wheel direction value: {}", direction);
    let direction = direction.into_inner();
    let response;
    match WHEEL_DIRECTION_MAP.iter().find(|(d, _)| *d == direction) {
        Some((_, name)) => {
            println!("Wheel turned: {}", name);
            response = format!("Wheel turned: {}", name);
            let _ = app_handle.emit("wheel-turned", serde_json::json!({ "direction": name }));
        }
        None => {
            println!("Unknown wheel direction: {}", direction);
            response = format!("Unknown wheel direction: {}", direction);
        }
    }

    HttpResponse::Ok().body(response)
}
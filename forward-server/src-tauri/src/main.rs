// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};
use std::io::Result;

/*
 * consts
*/
const BUTTON_MAP: &[(u8, &str)] = &[(1, "upper"), (2, "lower"), (3, "something_else")];

const WHEEL_DIRECTION_MAP: &[(u8, &str)] = &[(0, "left"), (1, "right")];

/*
 * main tauri + api stuff
*/
fn main() {
    let rt = tokio::runtime::Runtime::new().unwrap();

    rt.spawn(async {
        match start_server().await {
            Ok(_) => {}
            Err(e) => eprintln!("Server error: {e}"),
        }
    });

    zeppslime_server_lib::run();
}

async fn start_server() -> Result<()> {
    let server = HttpServer::new(|| {
        App::new()
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
#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[get("/imu/{body}")]
async fn imu_data(body: web::Json<serde_json::Value>) -> impl Responder {
    println!("IMU endpoint hit");
    println!("Received IMU data: {}", body);
    HttpResponse::Ok().body(format!("IMU data received: {}", body.to_string()))
}

#[get("/button/{button}")]
async fn press(button: web::Path<u8>) -> impl Responder {
    println!("Button endpoint hit");
    println!("Button value: {}", button);
    let button = button.into_inner();
    let response;
    match BUTTON_MAP.iter().find(|(b, _)| *b == button) {
        Some((_, name)) => {
            println!("Button pressed: {}", name);
            response = format!("Button pressed: {}", name);
        }
        None => {
            println!("Unknown button pressed: {}", button);
            response = format!("Unknown button pressed: {}", button);
        }
    }

    HttpResponse::Ok().body(response)
}

#[get("/wheel/{direction}")]
async fn wheel(direction: web::Path<u8>) -> impl Responder {
    println!("Wheel endpoint hit");
    println!("Wheel direction value: {}", direction);
    let direction = direction.into_inner();
    let response;
    match WHEEL_DIRECTION_MAP.iter().find(|(d, _)| *d == direction) {
        Some((_, name)) => {
            println!("Wheel turned: {}", name);
            response = format!("Wheel turned: {}", name);
        }
        None => {
            println!("Unknown wheel direction: {}", direction);
            response = format!("Unknown wheel direction: {}", direction);
        }
    }

    HttpResponse::Ok().body(response)
}

use crate::{ImuData, BUTTON_MAP, WHEEL_DIRECTION_MAP};
use actix_web::{
    get,
    web::{self},
    App, HttpResponse, HttpServer, Responder,
};
use std::io::Result;
use tauri::Emitter;

pub async fn start_server(app_handle: tauri::AppHandle) -> Result<()> {
    println!("[HTTP] Starting HTTP server - http://0.0.0.0:5001"); // will allow to be changed
    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(app_handle.clone()))
            .service(hello)
            .service(imu_data)
            .service(press)
            .service(wheel)
    })
    .bind("0.0.0.0:5001")?
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

#[get("/imu")]
async fn imu_data(
    query: web::Query<ImuData>,
    app_handle: web::Data<tauri::AppHandle>,
) -> impl Responder {
    println!("[HTTP] IMU endpoint hit");
    println!(
        "Received IMU data: ax={}, ay={}, az={}, gx={}, gy={}, gz={}",
        query.ax, query.ay, query.az, query.gx, query.gy, query.gz
    );
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
    println!("[HTTP] Button endpoint hit");
    println!("[HTTP] Button value: {}", button);
    let button = button.into_inner();
    let response;
    match BUTTON_MAP.iter().find(|(b, _)| *b == button) {
        Some((_, name)) => {
            println!("[HTTP] Button pressed: {}", name);
            response = format!("Button pressed: {}", name);
            let _ = app_handle.emit("button-pressed", serde_json::json!({ "button": name }));
        }
        None => {
            println!("[HTTP] Unknown button pressed: {}", button);
            response = format!("Unknown button pressed: {}", button);
        }
    }

    HttpResponse::Ok().body(response)
}

#[get("/wheel/{direction}")]
async fn wheel(
    direction: web::Path<u8>,
    app_handle: web::Data<tauri::AppHandle>,
) -> impl Responder {
    println!("[HTTP] Wheel endpoint hit");
    println!("[HTTP] Wheel direction value: {}", direction);
    let direction = direction.into_inner();
    let response;
    match WHEEL_DIRECTION_MAP.iter().find(|(d, _)| *d == direction) {
        Some((_, name)) => {
            println!("[HTTP] Wheel turned: {}", name);
            response = format!("Wheel turned: {}", name);
            let _ = app_handle.emit("wheel-turned", serde_json::json!({ "direction": name }));
        }
        None => {
            println!("[HTTP] Unknown wheel direction: {}", direction);
            response = format!("Unknown wheel direction: {}", direction);
        }
    }

    HttpResponse::Ok().body(response)
}

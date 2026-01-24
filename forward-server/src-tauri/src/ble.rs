use ble_peripheral_rust::{
    gatt::{
        characteristic::Characteristic,
        peripheral_event::{PeripheralEvent, RequestResponse, WriteRequestResponse},
        properties::{AttributePermission, CharacteristicProperty},
        service::Service,
    },
    uuid::ShortUuid,
    Peripheral, PeripheralImpl,
};
use serde_json::json;
use std::io::{Error, ErrorKind, Result};
use tauri::Emitter;
use tokio::sync::mpsc::channel;
use uuid::Uuid;

pub async fn start_ble(app_handle: tauri::AppHandle) -> Result<()> {
    println!("[BLE] Starting up BLE peripheral stuff");

    let service = Service {
        uuid: Uuid::from_string("fb0e0c26-a91d-4df7-9b52-692b023c63b3"),
        primary: true,
        characteristics: vec![
            Characteristic {
                // IMU characteristic
                uuid: Uuid::from_string("fb0e0c27-a91d-4df7-9b52-692b023c63b3"),
                properties: vec![CharacteristicProperty::Write],
                permissions: vec![AttributePermission::Writeable],
                value: None,
                descriptors: vec![],
            },
            Characteristic {
                // Button characteristic
                uuid: Uuid::from_string("fb0e0c28-a91d-4df7-9b52-692b023c63b3"),
                properties: vec![CharacteristicProperty::Write],
                permissions: vec![AttributePermission::Writeable],
                value: None,
                descriptors: vec![],
            },
            Characteristic {
                // Wheel characteristic
                uuid: Uuid::from_string("fb0e0c29-a91d-4df7-9b52-692b023c63b3"),
                properties: vec![CharacteristicProperty::Write],
                permissions: vec![AttributePermission::Writeable],
                value: None,
                descriptors: vec![],
            },
        ],
    };

    let (sender_tx, mut receiver_rx) = channel::<PeripheralEvent>(256);
    let mut peripheral = Peripheral::new(sender_tx).await.unwrap();

    let imu_uuid = Uuid::from_string("fb0e0c27-a91d-4df7-9b52-692b023c63b3");
    let button_uuid = Uuid::from_string("fb0e0c28-a91d-4df7-9b52-692b023c63b3");
    let wheel_uuid = Uuid::from_string("fb0e0c29-a91d-4df7-9b52-692b023c63b3");

    // handle updates
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        while let Some(event) = receiver_rx.recv().await {
            handle_updates(
                event,
                &app_handle_clone,
                &imu_uuid,
                &button_uuid,
                &wheel_uuid,
            );
        }
    });

    while !peripheral.is_powered().await.unwrap() {}

    if let Err(err) = peripheral.add_service(&service).await {
        println!("[BLE] Error adding service: {}", err);
        return Err(Error::new(ErrorKind::Other, err.to_string()));
    }
    println!("[BLE] Service added");

    if let Err(err) = peripheral
        .start_advertising("ZeppSlime Server", &[service.uuid])
        .await
    {
        println!("[BLE] Error starting advertising: {}", err);
        return Err(Error::new(ErrorKind::Other, err.to_string()));
    }
    println!("[BLE] Advertising started");

    Ok(())
}

pub fn handle_updates(
    update: PeripheralEvent,
    app_handle: &tauri::AppHandle,
    imu_uuid: &Uuid,
    button_uuid: &Uuid,
    wheel_uuid: &Uuid,
) {
    match update {
        PeripheralEvent::StateUpdate { is_powered } => {
            println!("[BLE] Power: {is_powered:?}")
        }
        PeripheralEvent::CharacteristicSubscriptionUpdate {
            request,
            subscribed,
        } => {
            println!(
                "[BLE] CharacteristicSubscriptionUpdate: subscribed {subscribed} -- {request:?}"
            )
        }
        PeripheralEvent::ReadRequest {
            request,
            offset,
            responder: _,
        } => {
            // probably use this for something later
            println!("[BLE] ReadRequest: {request:?} -- offset: {offset}");
        }
        PeripheralEvent::WriteRequest {
            request,
            offset: _,
            value,
            responder,
        } => {
            println!(
                "WriteRequest received on characteristic: {}",
                request.characteristic
            );

            if request.characteristic == *imu_uuid {
                println!("[BLE] IMU data received via BLE");
                if let Ok(data_str) = String::from_utf8(value.clone()) {
                    println!("[BLE] IMU data: {}", data_str);
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data_str) {
                        println!("[BLE] Parsed IMU JSON: {}", json);
                        let _ = app_handle.emit("imu-data", json);
                    }
                } else {
                    println!("[BLE] Raw IMU bytes: {:?}", value);
                }
            } else if request.characteristic == *button_uuid {
                println!("[BLE] Button data received via BLE");
                if let Ok(data_str) = String::from_utf8(value.clone()) {
                    println!("[BLE] Button pressed: {}", data_str);
                    let _ = app_handle.emit("button-pressed", json!({ "button": data_str }));
                } else if !value.is_empty() {
                    let button_num = value[0];
                    println!("[BLE] Button pressed: {}", button_num);
                    let _ = app_handle.emit("button-pressed", json!({ "button": button_num }));
                }
            } else if request.characteristic == *wheel_uuid {
                println!("[BLE] Wheel data received via BLE");
                if let Ok(data_str) = String::from_utf8(value.clone()) {
                    println!("[BLE] Wheel turned: {}", data_str);
                    let _ = app_handle.emit("wheel-turned", json!({ "direction": data_str }));
                } else if !value.is_empty() {
                    let direction = value[0];
                    println!("[BLE] Wheel turned: {}", direction);
                    let _ = app_handle.emit("wheel-turned", json!({ "direction": direction }));
                }
            } else {
                println!("[BLE] Unknown characteristic write: {:?}", value);
            }

            responder
                .send(WriteRequestResponse {
                    response: RequestResponse::Success,
                })
                .unwrap();
        }
    }
}

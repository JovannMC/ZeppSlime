use std::io::Result;

use ble_peripheral_rust::{Peripheral, PeripheralImpl, gatt::peripheral_event::PeripheralEvent};
use tokio::sync::mpsc::channel;

pub async fn start_ble(app_handle: tauri::AppHandle) -> Result<()> {
    println!("Starting BLE peripheral advertising");

    let (sender_tx, mut receiver_rx) = channel::<PeripheralEvent>(256);
    let mut peripheral = Peripheral::new(sender_tx).await.unwrap();

    while !peripheral.is_powered().await.unwrap() {}
    Ok(())
}

// receive the data from tauri backend here

// listen to tauri events and forward them to the appropriate emulated tracker
import { listen } from "@tauri-apps/api/event";

export async function setupBackendListeners() {
	await listen("button-pressed", (event) => {
		console.log(`[Backend] Button pressed: ${event.payload.button}`);
	});

	await listen("wheel-turned", (event) => {
		console.log(`[Backend] Wheel turned: ${event.payload.direction}`);
	});

    await listen("imu", (event) => {
        console.log(`[Backend] IMU data received: ${event.payload.data}`);
    });
}

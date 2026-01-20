import * as hmUI from "@zos/ui";
import { log as Logger } from "@zos/utils";
import VisLog from "@silver-zepp/vis-log";
import { checkSensor, Accelerometer, Gyroscope, Battery } from "@zos/sensor";
import { MACAddress, Quaternion, Vector } from "@slimevr/common";
import {
	BoardType,
	FirmwareFeatureFlags,
	MCUType,
	RotationDataType,
	SensorStatus,
	SensorType,
	UserAction,
} from "@slimevr/firmware-protocol";

import { getText } from "@zos/i18n";
import { getDeviceInfo } from "@zos/device";
import { px } from "@zos/utils";
import { BasePage } from "@zeppos/zml/base-page";

let text = null;
let sensorText = {
	battery: "none",
	accel: "none",
	gyro: "none",
};

function round2(value) {
	if (typeof value !== "number") return value;
	return Math.round(value * 100) / 100;
}

function renderSensors() {
	if (!text) return;
	text.setProperty(
		hmUI.prop.TEXT,
		`Accel: ${sensorText.accel}\nGyro: ${sensorText.gyro}`,
	);
}

// UDP communication not possible with ZeppOS and app, so alternate approaches needed

// idea 1
// - app -> side service (ble) -> http server (pc/phone) -> slimevr server
// - running the app, connect to a side service via BLE on the phone relaying data to an HTTP server running on the phone/pc
// which redirects the data via UDP to the slimevr server

// idea 2
// - app -> ble peripheral server -> slimevr server
// - the watch can act as a ble central, so connect to a peripheral server running on the phone/pc which relays data to the slimevr server
// via UDP, which should have much lower latency than idea 1

const log = Logger.getLogger("ZeppSlime");
const vis = new VisLog("index.js");
let DEVICE_WIDTH = 0;
let DEVICE_HEIGHT = 0;

Page(
	BasePage({
		onInit() {
			vis.debug("page onInit invoked");
			const deviceInfo = getDeviceInfo();
			DEVICE_WIDTH = deviceInfo.width;
			DEVICE_HEIGHT = deviceInfo.height;
			vis.info(`Device: ${DEVICE_WIDTH}x${DEVICE_HEIGHT}`);
			vis.info(`MAC Address: ${MACAddress.random().toString()}`);
		},
		build() {
			vis.debug("page build invoked");
			text = hmUI.createWidget(hmUI.widget.TEXT, {
				text: getText("appName"),
				x: px(42),
				y: px(200),
				w: DEVICE_WIDTH - px(42) * 2,
				h: px(150),
				color: 0xffffff,
				text_size: px(24),
				align_h: hmUI.align.CENTER_H,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.WRAP,
			});

			this.sensorData();
			this.fetchButton();
		},
		onDestroy() {
			vis.debug("page onDestroy invoked");
		},
		sensorData() {
			renderSensors();

			// check sensor data
			const accelAvailable = checkSensor(Accelerometer);
			const gyroAvailable = checkSensor(Gyroscope);
			const batteryAvailable = checkSensor(Battery);

			vis.info(`Accelerometer available: ${accelAvailable}`);
			vis.info(`Gyroscope available: ${gyroAvailable}`);
			vis.info(`Battery available: ${batteryAvailable}`);

			let accel = null;
			let gyro = null;
			let battery = null;

			if (accelAvailable) {
				try {
					accel = new Accelerometer({ frequency: 50 });
					accel.start();
				} catch (e) {
					vis.warn(`Failed to start accelerometer: ${e}`);
					sensorText.accel = "none";
					renderSensors();
				}
			}

			if (gyroAvailable) {
				try {
					gyro = new Gyroscope({ frequency: 50 });
					gyro.start();
				} catch (e) {
					vis.warn(`Failed to start gyroscope: ${e}`);
					sensorText.gyro = "none";
					renderSensors();
				}
			}

			if (batteryAvailable) {
				battery = new Battery();
				try {
					const initialBatteryLevel = battery.getCurrent();
					vis.info(`Battery level: ${initialBatteryLevel}%`);
					sensorText.battery = `${initialBatteryLevel}%`;
					renderSensors();
				} catch (e) {
					vis.warn(`Failed to read battery: ${e}`);
					sensorText.battery = "none";
					renderSensors();
				}

				battery.onChange((level) => {
					vis.info(`Battery level: ${level}%`);
					sensorText.battery = `${level}%`;
					renderSensors();
				});
			} else {
				sensorText.battery = "none";
				renderSensors();
			}

			if (accel) {
				try {
					const accelData = accel.getCurrent();
					const { x, y, z } = accelData;
					const roundX = round2(x);
					const roundY = round2(y);
					const roundZ = round2(z);
					sensorText.accel = `${roundX} ${roundY} ${roundZ}`;
					renderSensors();
				} catch (e) {
					vis.warn(`Failed to read accelerometer: ${e}`);
					sensorText.accel = "none";
					renderSensors();
				}

				accel.onChange((data) => {
					sensorText.accel = `${round2(data.x)} ${round2(data.y)} ${round2(data.z)}`;
					renderSensors();
				});
			} else {
				sensorText.accel = "none";
				renderSensors();
			}

			if (gyro) {
				try {
					const gyroData = gyro.getCurrent();
					const { x, y, z } = gyroData;
					const roundX = round2(x);
					const roundY = round2(y);
					const roundZ = round2(z);
					sensorText.gyro = `${roundX} ${roundY} ${roundZ}`;
					renderSensors();
				} catch (e) {
					vis.warn(`Failed to read gyroscope: ${e}`);
					sensorText.gyro = "none";
					renderSensors();
				}

				gyro.onChange((data) => {
					sensorText.gyro = `${round2(data.x)} ${round2(data.y)} ${round2(data.z)}`;
					renderSensors();
				});
			} else {
				sensorText.gyro = "none";
				renderSensors();
			}
		},
		fetchButton() {
			hmUI.createWidget(hmUI.widget.BUTTON, {
				x: (DEVICE_WIDTH - px(360)) / 2,
				y: px(325),
				w: px(360),
				h: px(80),
				text_size: px(36),
				radius: px(12),
				normal_color: 0xfc6950,
				press_color: 0xfeb4a8,
				text: "Fetch Data",
				click_func: () => {
					log.info("Fetch Data button clicked");
					this.httpRequest({
						method: "get",
						url: "http://localhost:5001/button/1",
					})
						.then((result) => {
							console.log("result.status", result.status);
							console.log("result.statusText", result.statusText);
							console.log("result.headers", result.headers);
							console.log("result.body", result.body);
						})
						.catch((error) => {
							console.error("error=>", error);
						});
				},
			});
		},
	}),
);

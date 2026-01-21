import * as hmUI from "@zos/ui";
import { log as Logger } from "@zos/utils";
import VisLog from "@silver-zepp/vis-log";
import { checkSensor, Accelerometer, Gyroscope, Battery } from "@zos/sensor";

import { getText } from "@zos/i18n";
import { getDeviceInfo } from "@zos/device";
import { px } from "@zos/utils";
import { BasePage } from "@zeppos/zml/base-page";

let text = null;
let forwardButton = null;
let sensorText = {
	battery: "none",
	accel: "none",
	gyro: "none",
};
let accelData = null;
let gyroData = null;
let lastSendTime = 0;
let sendPending = false;
const SEND_INTERVAL_MS = 40; // 25hz
const QUEUE_THROTTLED_DATA = false; // if true, queue throttled data; if false, drop it

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

// idea 3
// - app -> ble -> slimevr server
// - the watch app acts as a ble peripheral, and the forward app on the pc/phone connects to it as a central to relay data to slimevr server
// this can only be worked on once zeppos supports ble peripheral mode - https://discord.com/channels/1202787457456799784/1257851403897143306/1451325882328285304 ("Zepp Health" Discord server)

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
		},
		build() {
			vis.debug("page build invoked");
			text = hmUI.createWidget(hmUI.widget.TEXT, {
				text: getText("appName"),
				x: px(42),
				y: px(120),
				w: DEVICE_WIDTH - px(42) * 2,
				h: px(150),
				color: 0xffffff,
				text_size: px(24),
				align_h: hmUI.align.CENTER_H,
				align_v: hmUI.align.CENTER_V,
				text_style: hmUI.text_style.WRAP,
			});

			this.forwardButton();
			this.fetchButton();
		},
		onDestroy() {
			vis.debug("page onDestroy invoked");
		},
		forwardButton() {
			forwardButton = hmUI.createWidget(hmUI.widget.BUTTON, {
				x: (DEVICE_WIDTH - px(360)) / 2,
				y: px(290),
				w: px(360),
				h: px(80),
				text_size: px(28),
				radius: px(12),
				normal_color: 0x2ecc71,
				press_color: 0xa9f5c9,
				text: "Start Streaming",
				click_func: () => {
					this.isStreaming ? this.stopStreaming() : this.startStreaming();
					this.updateForwardButton();
				},
			});
		},

		updateForwardButton() {
			if (!forwardButton) return;
			const nextText = this.isStreaming ? "Stop Streaming" : "Start Streaming";

			forwardButton.setProperty(hmUI.prop.MORE, { text: nextText });
			forwardButton.setProperty(hmUI.prop.TEXT, nextText);
		},

		initSensors() {
			if (this.sensorsInitialized) return;

			const accelAvailable = checkSensor(Accelerometer);
			const gyroAvailable = checkSensor(Gyroscope);
			const batteryAvailable = checkSensor(Battery);

			vis.info(`Accelerometer available: ${accelAvailable}`);
			vis.info(`Gyroscope available: ${gyroAvailable}`);
			vis.info(`Battery available: ${batteryAvailable}`);

			this.accel = null;
			this.gyro = null;
			this.battery = null;

			if (accelAvailable) {
				try {
					this.accel = new Accelerometer();
					this.accel.setFreqMode(1);
					this.accel.onChange((data) => {
						accelData = data;
						this.sendIMUData();
					});
				} catch (e) {
					vis.warn(`Failed to init accelerometer: ${e}`);
					sensorText.accel = "none";
					renderSensors();
				}
			}

			if (gyroAvailable) {
				try {
					this.gyro = new Gyroscope();
					this.gyro.setFreqMode(1);
					this.gyro.onChange((data) => {
						gyroData = data;
						this.sendIMUData();
					});
				} catch (e) {
					vis.warn(`Failed to init gyroscope: ${e}`);
					sensorText.gyro = "none";
					renderSensors();
				}
			}

			// if (batteryAvailable) {
			// 	try {
			// 		this.battery = new Battery();
			// 		this.battery.onChange((level) => {
			// 			vis.info(`Battery level: ${level}%`);
			// 		});
			// 	} catch (e) {
			// 		vis.warn(`Failed to init battery: ${e}`);
			// 	}
			// }

			this.sensorsInitialized = true;
		},

		startStreaming() {
			this.isStreaming = true;
			this.initSensors();

			accelData = null;
			gyroData = null;
			lastSendTime = 0;
			sendPending = false;

			if (this.accel) {
				try {
					this.accel.start();
				} catch (e) {
					vis.warn(`Failed to start accelerometer: ${e}`);
				}
			}

			if (this.gyro) {
				try {
					this.gyro.start();
				} catch (e) {
					vis.warn(`Failed to start gyroscope: ${e}`);
				}
			}

			vis.info("Streaming enabled");
		},

		stopStreaming() {
			this.isStreaming = false;
			accelData = null;
			gyroData = null;
			lastSendTime = 0;
			sendPending = false;

			if (this.accel) {
				try {
					this.accel.stop();
				} catch (e) {
					vis.warn(`Failed to stop accelerometer: ${e}`);
				}
			}

			if (this.gyro) {
				try {
					this.gyro.stop();
				} catch (e) {
					vis.warn(`Failed to stop gyroscope: ${e}`);
				}
			}

			vis.info("Streaming disabled");
		},

		sensorData() {
			//renderSensors();

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
					// xyz for accelerometer is in cm/s^2
					accel = new Accelerometer();
					accel.setFreqMode(1);
					accel.start();
				} catch (e) {
					vis.warn(`Failed to start accelerometer: ${e}`);
					sensorText.accel = "none";
					renderSensors();
				}
			}

			if (gyroAvailable) {
				try {
					// xyz is angular velocity in deg/s
					gyro = new Gyroscope();
					gyro.setFreqMode(1);
					gyro.start();
				} catch (e) {
					vis.warn(`Failed to start gyroscope: ${e}`);
					sensorText.gyro = "none";
					renderSensors();
				}
			}

			if (batteryAvailable) {
				battery = new Battery();
				// try {
				// 	const initialBatteryLevel = battery.getCurrent();
				// 	vis.info(`Battery level: ${initialBatteryLevel}%`);
				// 	sensorText.battery = `${initialBatteryLevel}%`;
				// 	renderSensors();
				// } catch (e) {
				// 	vis.warn(`Failed to read battery: ${e}`);
				// 	sensorText.battery = "none";
				// 	renderSensors();
				// }

				battery.onChange((level) => {
					vis.info(`Battery level: ${level}%`);
					// sensorText.battery = `${level}%`;
					// renderSensors();
				});
			} else {
				//sensorText.battery = "none";
				//renderSensors();
			}

			if (accel) {
				// try {
				// 	const accelData = accel.getCurrent();
				// 	const { x, y, z } = accelData;
				// 	const roundX = round2(x);
				// 	const roundY = round2(y);
				// 	const roundZ = round2(z);
				// 	sensorText.accel = `${roundX} ${roundY} ${roundZ}`;
				// 	renderSensors();
				// } catch (e) {
				// 	vis.warn(`Failed to read accelerometer: ${e}`);
				// 	sensorText.accel = "none";
				// 	renderSensors();
				// }

				accel.onChange((data) => {
					accelData = data;
					// sensorText.accel = `${round2(data.x)} ${round2(data.y)} ${round2(data.z)}`;
					// renderSensors();
					this.sendIMUData();
				});
			} else {
				// sensorText.accel = "none";
				//renderSensors();
			}

			if (gyro) {
				// try {
				// 	const gyroData = gyro.getCurrent();
				// 	const { x, y, z } = gyroData;
				// 	const roundX = round2(x);
				// 	const roundY = round2(y);
				// 	const roundZ = round2(z);
				// 	sensorText.gyro = `${roundX} ${roundY} ${roundZ}`;
				// 	renderSensors();
				// } catch (e) {
				// 	vis.warn(`Failed to read gyroscope: ${e}`);
				// 	sensorText.gyro = "none";
				// 	renderSensors();
				// }

				gyro.onChange((data) => {
					gyroData = data;
					// sensorText.gyro = `${round2(data.x)} ${round2(data.y)} ${round2(data.z)}`;
					// renderSensors();
					this.sendIMUData();
				});
			} else {
				// sensorText.gyro = "none";
				// renderSensors();
			}
		},

		fetchButton() {
			hmUI.createWidget(hmUI.widget.BUTTON, {
				x: (DEVICE_WIDTH - px(360)) / 2,
				y: px(380),
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
						url: "http://192.168.1.127:5001/button/1",
					})
						.then((result) => {
							vis.log("result.status", result.status);
							vis.log("result.statusText", result.statusText);
							vis.log("result.headers", result.headers);
							vis.log("result.body", result.body);
						})
						.catch((error) => {
							vis.log("error=>", error);
						});
				},
			});
		},

		sendIMUData() {
			if (!this.isStreaming) return;
			if (!accelData || !gyroData) return; // wait until both have data

			const now = Date.now();
			const timeSinceLastSend = now - lastSendTime;

			if (timeSinceLastSend < SEND_INTERVAL_MS) {
				if (QUEUE_THROTTLED_DATA) {
					if (!sendPending) {
						sendPending = true;
						setTimeout(() => {
							sendPending = false;
							this.sendIMUData();
						}, SEND_INTERVAL_MS - timeSinceLastSend);
					}
				}
				return;
			}

			lastSendTime = now;
			const endpoint = `/imu?ax=${accelData.x}&ay=${accelData.y}&az=${accelData.z}&gx=${gyroData.x}&gy=${gyroData.y}&gz=${gyroData.z}`;
			this.forwardData(endpoint);
		},

		// api endpoints:
		// GET - /button/:button
		// GET - /wheel/:direction
		// GET - /imu w/ query params - ax/ay/az = accel, gx/gy/gz = gyro
		forwardData(endpoint) {
			if (!this.isStreaming) return;

			this.httpRequest({
				method: "get",
				url: `http://192.168.1.127:5001${endpoint}`,
			}).catch(() => {});
		},
	}),
);

import * as hmUI from "@zos/ui";
import { log as Logger } from "@zos/utils";
import VisLog from "@silver-zepp/vis-log";
import { checkSensor, Accelerometer, Gyroscope, Battery } from "@zos/sensor";

import { getText } from "@zos/i18n";
import { getDeviceInfo } from "@zos/device";
import { px } from "@zos/utils";
import { BasePage } from "@zeppos/zml/base-page";

import { BLEMaster } from "@silver-zepp/easy-ble";

let forwardButton = null;
let accelData = null;
let gyroData = null;
let lastSendTime = 0;
let sendPending = false;
const SEND_INTERVAL_MS = 40; // 25hz
const QUEUE_THROTTLED_DATA = false; // if true, queue throttled data; if false, drop it -- temporary, to see what works best

let serviceUuid = "fb0e0c26-a91d-4df7-9b52-692b023c63b3".toUpperCase();
let imuUuid = "fb0e0c27-a91d-4df7-9b52-692b023c63b3".toUpperCase();
let buttonUuid = "fb0e0c28-a91d-4df7-9b52-692b023c63b3".toUpperCase();
let wheelUuid = "fb0e0c29-a91d-4df7-9b52-692b023c63b3".toUpperCase();

const service = {
	[serviceUuid]: {
		[imuUuid]: [],
		[buttonUuid]: [],
		[wheelUuid]: [],
	},
};

let ble = null;
let bleProfile = null;
let bleMac = null;
let bleReady = false;

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
				}
			}

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

			if (!ble) {
				bleReady = false;
				ble = new BLEMaster();
				vis.log("[BLE] initialized BLE master");
			}

			ble.startScan((device) => {
				vis.log(`[BLE] found device: ${device.dev_name} - ${device.dev_addr}`);
				if (ble.get.hasService(serviceUuid)) {
					ble.stopScan();

					vis.log(`[BLE] device has IMU service: ${device.dev_addr}`);

					bleMac = device.dev_addr;

					ble.connect(bleMac, (result) => {
						if (result.connected) {
							vis.log(`[BLE] connected to device: ${bleMac}`);
							bleProfile = ble.generateProfileObject(service);

							ble.startListener(bleProfile, (response) => {
								if (response.success) {
									bleReady = true;
									vis.log("[BLE] BLE profile listener started");
								} else {
									vis.warn(
										`[BLE] BLE profile listener error: ${response.message}`,
									);
								}
							});
						} else {
							vis.warn(
								`[BLE] failed to connect to device: ${bleMac} -- ${result.status}`,
							);
						}
					});
				}
			});

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

			if (ble) {
				try {
					ble.quit();
				} catch (e) {
					vis.warn(`BLE quit error: ${e}`);
				}
				bleReady = false;
				bleProfile = null;
				ble = null; // should i be doing this and re-initializing every time streaming starts?
			}

			vis.info("Streaming disabled");
		},

		sensorData() {
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
				}
			}

			if (batteryAvailable) {
				battery = new Battery();
				battery.onChange((level) => {
					vis.info(`Battery level: ${level}%`);
				});
			}

			if (accel) {
				accel.onChange((data) => {
					accelData = data;
					this.sendIMUData();
				});
			}

			if (gyro) {
				gyro.onChange((data) => {
					gyroData = data;
					this.sendIMUData();
				});
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

			// http
			// const endpoint = `/imu?ax=${accelData.x}&ay=${accelData.y}&az=${accelData.z}&gx=${gyroData.x}&gy=${gyroData.y}&gz=${gyroData.z}`;
			// this.forwardData(endpoint);

			// ble
			const payload = JSON.stringify({
				ax: accelData.x,
				ay: accelData.y,
				az: accelData.z,
				gx: gyroData.x,
				gy: gyroData.y,
				gz: gyroData.z,
			});

			try {
				if (bleReady) ble.write.characteristic(imuUuid, payload, true);
			} catch (e) {
				vis.warn(`[BLE] write error: ${e}`);
			}
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

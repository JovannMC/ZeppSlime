import { MACAddress } from "@slimevr/common";
import { FirmwareFeatureFlags, BoardType, MCUType, SensorType, SensorStatus } from "@slimevr/firmware-protocol";
import { EmulatedTracker } from "@slimevr/tracker-emulation";
import { app } from "@tauri-apps/api";
import Rand from "rand-seed";

let foundSlimeVR = false;
let serverAddress = "255.255.255.255";
let serverPort = 6969;
let randomizeMacAddress = false;
let loggingMode = 0;

let trackerQueue: string[] = [];
let isProcessingQueue = false;

let connectedDevices: Map<string, EmulatedTracker> = new Map();

async function addTracker(trackerName: string) {
	trackerQueue.push(trackerName);
	processQueue();
}

function MacAddressFromName(name: string) {
	if (randomizeMacAddress) {
		// random MAC address
		return MACAddress.random();
	} else {
		// get MAC address from name
		const rand = new Rand(name);
		return new MACAddress(
			new Array(6).fill(0).map(() => Math.floor(rand.next() * 256)) as any,
		);
	}
}

async function processQueue() {
	if (isProcessingQueue || trackerQueue.length === 0) return;
	isProcessingQueue = true;

	while (trackerQueue.length > 0) {
		const trackerName = trackerQueue.shift();

        if (!trackerName) continue;
		if (connectedDevices.get(trackerName) !== undefined) return;

		let macAddress = MacAddressFromName(trackerName);

		let newTracker = new EmulatedTracker(
			macAddress,
			`ZeppSlime v${await app.getVersion()}`,
			new FirmwareFeatureFlags(new Map([])),
			BoardType.UNKNOWN,
			MCUType.UNKNOWN,
			serverAddress,
			serverPort,
		);

		await newTracker.init();
		await newTracker.addSensor(SensorType.UNKNOWN, SensorStatus.OK);

		connectedDevices.set(trackerName, newTracker);

		setupTrackerEvents(newTracker);

		log(`Connected to tracker: ${trackerName}`, "tracker");
	}

	connectedDevices = new Map([...connectedDevices.entries()].sort());

	const trackers = JSON.stringify(
		Array.from(connectedDevices.keys()).filter((key) =>
			connectedDevices.get(key),
		),
	);
	log(`Connected devices: ${trackers}`, "tracker");

	isProcessingQueue = false;
}

/*
 * SlimeVR Forwarding
 */

function setupTrackerEvents(tracker: EmulatedTracker, isHeartbeat = false) {
	const trackerName = isHeartbeat
		? "(HEARTBEAT)"
		: Array.from(connectedDevices.keys()).find(
				(key) => connectedDevices.get(key) === tracker,
			);

	tracker.on("ready", () => {
		log(
			`Tracker "${trackerName}" is ready to search for SlimeVR server...`,
			"@slimevr/emulated-tracker",
		);
	});

	tracker.on("searching-for-server", () => {
		log(
			`Tracker "${trackerName}" is searching for SlimeVR server...`,
			"@slimevr/emulated-tracker",
		);
	});

	tracker.on("connected-to-server", (ip: string, port: number) => {
		if (isHeartbeat) return;
		log(
			`Tracker "${trackerName}" connected to SlimeVR server on ${ip}:${port}`,
			"@slimevr/emulated-tracker",
		);

		tracker.sendTemperature(0, 420.69);
		tracker.sendSignalStrength(0, 69);

		foundSlimeVR = true;
	});

	tracker.on("disconnected-from-server", (reason) => {
		log(
			`Tracker "${trackerName}" disconnected from SlimeVR server due to: ${reason}`,
			"@slimevr/emulated-tracker",
		);
	});

	tracker.on("error", (err) => {
		error(`Tracker "${trackerName}" error`, "@slimevr/emulated-tracker", err);
	});

	tracker.on("unknown-incoming-packet", (packet: any) => {
		warn(
			`Tracker "${trackerName}" unknown packet type: ${packet.type}`,
			"@slimevr/emulated-tracker",
		);
	});

	tracker.on("unknown-incoming-packet", (buf: Buffer) =>
		warn(
			`Tracker "${trackerName}" unknown incoming packet: ${buf.toString()}`,
			"@slimevr/emulated-tracker",
		),
	);

	if (loggingMode === 3) {
		tracker.on("outgoing-packet", (packet: any) => {
			log(
				`Tracker "${trackerName}" outgoing packet: ${packet}`,
				"@slimevr/emulated-tracker",
			);
		});
		tracker.on("incoming-packet", (packet: any) => {
			log(
				`Tracker "${trackerName}" incoming packet: ${packet}`,
				"@slimevr/emulated-tracker",
			);
		});
	}
}

const heartbeatTracker = new EmulatedTracker(
	new MACAddress([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
	`ZeppSlime v${await app.getVersion()} heartbeat`,
	new FirmwareFeatureFlags(new Map([])),
	BoardType.UNKNOWN,
	MCUType.UNKNOWN,
	serverAddress,
	serverPort,
);

setupTrackerEvents(heartbeatTracker, true);
await heartbeatTracker.init();

log(
	`Looking for SlimeVR server on: ${serverAddress}:${serverPort}`,
	"connection",
);

function log(message: string, context: string, err?: any) {
	if (err) {
		console.error(`[${context}] ${message}`, err);
	} else {
		console.log(`[${context}] ${message}`);
	}
}

function warn(message: string, context: string) {
	console.warn(`[${context}] ${message}`);
}

function error(message: string, context: string, err?: any) {
	if (err) {
		console.error(`[${context}] ${message}`, err);
	} else {
		console.error(`[${context}] ${message}`);
	}
}

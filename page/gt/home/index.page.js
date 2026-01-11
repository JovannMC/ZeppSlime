import * as hmUI from "@zos/ui";
import { log as Logger } from "@zos/utils";
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

let text = null;

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
let DEVICE_WIDTH = 0;
let DEVICE_HEIGHT = 0;

Page({
  onInit() {
    log.debug("page onInit invoked");
    const deviceInfo = getDeviceInfo();
    DEVICE_WIDTH = deviceInfo.width;
    DEVICE_HEIGHT = deviceInfo.height;
    log.info(`Device: ${DEVICE_WIDTH}x${DEVICE_HEIGHT}`);
    log.info(`MAC Address: ${MACAddress.random().toString()}`);
  },
  build() {
    log.debug("page build invoked");
    text = hmUI.createWidget(hmUI.widget.TEXT, {
      text: getText("appName"),
      x: px(42),
      y: px(200),
      w: DEVICE_WIDTH - px(42) * 2,
      h: px(100),
      color: 0xffffff,
      text_size: px(36),
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.WRAP,
    });

    setInterval(() => {
      const date = new Date();
      const timeString = date.toLocaleTimeString();
      text.setProperty(hmUI.prop.TEXT, getText("appName") + "\n" + timeString);
    }, 1000);
  },
  onDestroy() {
    log.debug("page onDestroy invoked");
  },
});

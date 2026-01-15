/********************************
 * MQTT CONFIG (CLOUD)
 ********************************/
const MQTT_URL = "wss://c7abeea905dd4cddb3fea5f06b9e0405.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "smartbridge";
const MQTT_PASS = "Atituch168";

/* Device ID ต้องตรงกับที่ ESP32 ใช้ publish */
const DEVICE_ID = "SmartBridge-23C0";

/********************************
 * PROTOCOL CONST
 ********************************/
const PKT_HEADER = 0xA5;

const CMD = {
  STATUS_FRAME: 0x01,
  SCAN_FRAME: 0x02,
  DEVICE_ADDR_FRAME: 0x03,
  BATT_INFO_FRAME: 0x04,

  CMD_GET_BATT_DETAIL: 0x40,
  GET_STATUS: 0x32,
  GET_DEVICE_ADDR: 0x31,
  SAVE_DEVICE_ADDR: 0x30,
  WIFI_SAVE: 0x20,
  SCAN_START: 0x10
};

const MAX_BATTERY_MODULE = 8;
const MAX_CELLS_PER_MODULE = 15;

/********************************
 * MQTT CLIENT
 ********************************/
const mqttClient = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
  clean: true,
  keepalive: 30,
  reconnectPeriod: 3000
});

/********************************
 * GLOBAL STATE
 ********************************/
let statusTimer = null;
let battPollTimer = null;
let batteryEls = [];
let cellEls = [];

/********************************
 * MQTT EVENTS
 ********************************/
mqttClient.on("connect", () => {
  console.log("MQTT connected");

  mqttClient.subscribe(`smartbridge/${DEVICE_ID}/status`);
  mqttClient.subscribe(`smartbridge/${DEVICE_ID}/battery/+`);
  mqttClient.subscribe(`smartbridge/${DEVICE_ID}/device`);
});

mqttClient.on("message", (topic, payload) => {
  console.log("RX", topic, payload);
  const data = new Uint8Array(payload);
  const dv = new DataView(payload.buffer);
  if (dv.getUint8(0) !== PKT_HEADER) return;

  const type = dv.getUint8(1);

  if (type === CMD.STATUS_FRAME) parseStatus(dv);
  else if (type === CMD.BATT_INFO_FRAME) parseBatteryDetail(dv);
  else if (type === CMD.DEVICE_ADDR_FRAME) parseDeviceAddress(dv);
});

/********************************
 * PAGE DETECT
 ********************************/
function isIndexPage() {
  return location.pathname.endsWith("/") || location.pathname.endsWith("index.html");
}
function isBatteryPage() {
  return location.pathname.endsWith("battery.html");
}
function isSettingPage() {
  return location.pathname.endsWith("setting.html");
}

/********************************
 * VISIBILITY HANDLING
 ********************************/
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopStatusPoll();
    stopBattPoll();
  } else {
    if (isIndexPage()) startStatusPoll();
    if (isBatteryPage()) startBattPoll();
  }
});

/********************************
 * POLLING
 ********************************/
function startStatusPoll() {
  if (statusTimer) return;
  statusTimer = setInterval(() => {
    sendCmd([PKT_HEADER, CMD.GET_STATUS]);
  }, 1000);
}

function stopStatusPoll() {
  clearInterval(statusTimer);
  statusTimer = null;
}

function startBattPoll() {
  if (battPollTimer) return;
  battPollTimer = setInterval(() => {
    sendCmd([
      PKT_HEADER,
      CMD.CMD_GET_BATT_DETAIL,
      getBatteryIndex()
    ]);
  }, 1000);
}

function stopBattPoll() {
  clearInterval(battPollTimer);
  battPollTimer = null;
}

/********************************
 * SEND COMMAND (BINARY)
 ********************************/
function sendCmd(arr) {
  mqttClient.publish(
    `smartbridge/${DEVICE_ID}/cmd`,
    new Uint8Array(arr)
  );
}

/********************************
 * COMMON
 ********************************/
function socClass(soc) {
  if (soc >= 70) return "soc-high";
  if (soc >= 40) return "soc-mid";
  if (soc >= 30) return "soc-low";
  return "soc-critical";
}

function getBatteryIndex() {
  return Number(new URLSearchParams(location.search).get("batt") ?? 0);
}

/********************************
 * INDEX PAGE
 ********************************/
function initBatteryList() {
  const list = document.getElementById("batteryList");
  batteryEls = [];
  list.innerHTML = "";

  for (let i = 0; i < MAX_BATTERY_MODULE; i++) {
    const d = document.createElement("div");
    d.className = "battery";
    d.onclick = () => location.href = `battery.html?batt=${i}`;
    d.innerHTML = `
      Batt.No ${String(i + 1).padStart(2, "0")}
      | <span class="bv">--</span>V
      | <span class="bc">--</span>A
      | <span class="bs">--</span>%
      <div class="soc-bar-bg">
        <div class="soc-bar"></div>
      </div>
    `;
    list.appendChild(d);
    batteryEls.push(d);
  }
}

function parseStatus(dv) {
  if (!batteryEls.length) return;

  let i = 2;
  const soc = dv.getUint8(i++);
  const packV = dv.getUint16(i, true) / 100; i += 2;
  const packI = dv.getInt16(i, true) / 10; i += 2;

  document.getElementById("soc").innerText = soc + "%";
  document.getElementById("voltage").innerText = packV.toFixed(2) + "V";
  document.getElementById("current").innerText = packI.toFixed(1) + "A";

  for (let n = 0; n < MAX_BATTERY_MODULE; n++) {
    const v = dv.getUint16(i, true) / 100; i += 2;
    const c = dv.getInt16(i, true) / 10; i += 2;
    const bs = dv.getUint8(i++); i++;

    const el = batteryEls[n];
    el.querySelector(".bv").innerText = v.toFixed(2);
    el.querySelector(".bc").innerText = c.toFixed(1);
    el.querySelector(".bs").innerText = bs;

    const bar = el.querySelector(".soc-bar");
    bar.style.width = bs + "%";
    bar.className = "soc-bar " + socClass(bs);
  }
}

/********************************
 * BATTERY DETAIL PAGE
 ********************************/
function initCellList() {
  const list = document.getElementById("cellList");
  cellEls = [];
  list.innerHTML = "";

  for (let i = 0; i < MAX_CELLS_PER_MODULE; i++) {
    const d = document.createElement("div");
    d.className = "cell";
    list.appendChild(d);
    cellEls.push(d);
  }
}

function parseBatteryDetail(dv) {
  if (!cellEls.length) return;

  let i = 2;
  const battNo = dv.getUint8(i++) + 1;
  const soc = dv.getUint8(i++);
  const volt = dv.getUint16(i, true) / 100; i += 2;
  const curr = dv.getInt16(i, true) / 10; i += 2;

  document.getElementById("title").innerText = `Battery ${battNo}`;
  document.getElementById("soc").innerText = soc + "%";
  document.getElementById("voltage").innerText = volt.toFixed(2) + "V";
  document.getElementById("current").innerText = curr.toFixed(1) + "A";

  for (let c = 0; c < MAX_CELLS_PER_MODULE; c++) {
    const v = dv.getUint16(i, true) / 1000; i += 2;
    cellEls[c].innerText = `Cell ${c + 1}: ${v.toFixed(3)} V`;
  }
}

/********************************
 * INIT ON LOAD
 ********************************/
window.addEventListener("load", () => {
  if (isIndexPage()) {
    initBatteryList();
    startStatusPoll();
  }

  if (isBatteryPage()) {
    initCellList();
    startBattPoll();
  }

  if (isSettingPage()) {
    sendCmd([PKT_HEADER, CMD.GET_DEVICE_ADDR]);
  }
});

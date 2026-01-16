/********************************
 * AUTH CHECK
 ********************************/
const USER_ID = localStorage.getItem("USER_ID");

if (!USER_ID) {
  if (!location.pathname.endsWith("login.html")) {
    location.href = "login.html";
  }
}

/********************************
 * MQTT CONFIG (CLOUD)
 ********************************/
const MQTT_URL = "wss://c7abeea905dd4cddb3fea5f06b9e0405.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "smartbridge";
const MQTT_PASS = "Atituch168";

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
 * MULTI DEVICE STATE
 ********************************/
const devices = {};
let activeDevice = null;
const DEVICE_TIMEOUT_MS = 5000;
let deviceSelectEl = null;

/********************************
 * UI STATE
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

  //mqttClient.subscribe("smartbridge/+/status");
  //mqttClient.subscribe("smartbridge/+/battery/+");
  //mqttClient.subscribe("smartbridge/+/device");
  mqttClient.subscribe(`smartbridge/user/${USER_ID}/device/+/status`);
  mqttClient.subscribe(`smartbridge/user/${USER_ID}/device/+/battery/+`);
  mqttClient.subscribe(`smartbridge/user/${USER_ID}/device/+/device`);
});

mqttClient.on("message", (topic, payload) => {
  console.log("MQTT message:", topic, payload);
  const parts = topic.split("/");
  //if (parts.length < 3) return;
  //const deviceId = parts[1];

  // smartbridge/user/{user}/device/{deviceId}/...
  if (
    parts.length < 6 ||
    parts[0] !== "smartbridge" ||
    parts[1] !== "user" ||
    parts[3] !== "device"
  ) return;
  const userId   = parts[2];
  const deviceId = parts[4];
  //const channel  = parts[5]; // status | device | scan | battery
  // register device 
  if (!devices[deviceId]) {
    devices[deviceId] = { lastSeen: Date.now() };
    updateDeviceDropdown(); 
    if (!activeDevice) activeDevice = deviceId;
  }
  devices[deviceId].lastSeen = Date.now();
  // process only active device
  if (deviceId !== activeDevice) return;

  //const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const data = new Uint8Array(payload);
  const dv = new DataView(data.buffer);
  if (dv.getUint8(0) !== PKT_HEADER) return;

  const type = dv.getUint8(1);
  if (type === CMD.STATUS_FRAME) parseStatus(dv);
  else if (type === CMD.BATT_INFO_FRAME) parseBatteryDetail(dv);
  else if (type === CMD.DEVICE_ADDR_FRAME) parseDeviceAddress(dv);
  else if (type === CMD.SCAN_FRAME) parseScan(dv);
});

/********************************
 * PAGE DETECT
 ********************************/
function isIndexPage()   { return location.pathname.endsWith("/") || location.pathname.endsWith("index.html"); }
function isBatteryPage() { return location.pathname.endsWith("battery.html"); }
function isSettingPage() { return location.pathname.endsWith("setting.html"); }

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
    sendCmd([PKT_HEADER, CMD.CMD_GET_BATT_DETAIL, getBatteryIndex()]);
  }, 1000);
}

function stopBattPoll() {
  clearInterval(battPollTimer);
  battPollTimer = null;
}

/********************************
 * PERIODIC DEVICE CLEANUP
 ********************************/
setInterval(() => {
  updateDeviceDropdown();
}, 2000);


/********************************
 * SEND COMMAND
 ********************************/
function sendCmd(arr) {
  if (!activeDevice) return;
  //mqttClient.publish(
  //  `smartbridge/${activeDevice}/cmd`,
  //  new Uint8Array(arr)
  //);
  mqttClient.publish(
    `smartbridge/user/${USER_ID}/device/${activeDevice}/cmd`,
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
function updateDeviceDropdown() {
  if (!deviceSelectEl) return;

  const now = Date.now();
  const onlineDevices = Object.keys(devices)
    .filter(id => now - devices[id].lastSeen < DEVICE_TIMEOUT_MS);

  // ลบ device ที่ offline
  Object.keys(devices).forEach(id => {
    if (!onlineDevices.includes(id)) {
      delete devices[id];
      if (id === activeDevice) activeDevice = null;
    }
  });

  // rebuild dropdown
  deviceSelectEl.innerHTML = "";

  onlineDevices.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    deviceSelectEl.appendChild(opt);
  });

  // auto select ตัวแรก
  if (!activeDevice && onlineDevices.length) {
    activeDevice = onlineDevices[0];
  }

  deviceSelectEl.value = activeDevice ?? "";
}

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

    const maxCellV = dv.getUint16(i, true) / 1000; i += 2;
    const minCellV = dv.getUint16(i, true) / 1000; i += 2;
    const maxBMST = dv.getInt8(i++);
    const maxCellT = dv.getInt8(i++);

    /* Pack SOC */
    const socEl = document.getElementById("soc");
    socEl.innerText = soc + "%";
    socEl.classList.remove("soc-green", "soc-yellow", "soc-red");

    if (soc >= 50) socEl.classList.add("soc-green");
    else if (soc >= 30) socEl.classList.add("soc-yellow");
    else socEl.classList.add("soc-red");

    const fg = document.querySelector(".fg");
    fg.style.stroke =
        soc >= 50 ? "#3cff5a" :
            soc >= 30 ? "#ffd000" :
                "#ff4c4c";

    fg.style.strokeDashoffset = 502 - soc * 5.02;

    /* Pack info */
    document.getElementById("voltage").innerText = packV.toFixed(2) + "V";
    //document.getElementById("current").innerText = packI.toFixed(1) + "A";
    const currEl = document.getElementById("current");
    // reset classes
    currEl.classList.remove("current-pos", "current-neg", "current-idle");
    // set text + arrow + color
    if (packI > 0) {
        currEl.innerText = `${packI.toFixed(1)}A ↑`;
        currEl.classList.add("current-pos");
    } else if (packI < 0) {
        currEl.innerText = `${packI.toFixed(1)}A ↓`;
        currEl.classList.add("current-neg");
    } else {
        currEl.innerText = `0.0A —`;
        currEl.classList.add("current-idle");
    }

    document.getElementById("maxCellV").innerText = maxCellV.toFixed(3) + "V";
    document.getElementById("minCellV").innerText = minCellV.toFixed(3) + "V";
    document.getElementById("maxBMSTemp").innerText = maxBMST + "°C";
    document.getElementById("maxCellTemp").innerText = maxCellT + "°C";
    /* Battery Module List */
   for (let n = 0; n < MAX_BATTERY_MODULE; n++) {
        const v = dv.getUint16(i, true) / 100; i += 2;
        const c = dv.getInt16(i, true) / 10; i += 2;
        const bs = dv.getUint8(i++);
        i++;

        const el = batteryEls[n];
        if (!el) continue;

        el.querySelector(".bv").innerText = v.toFixed(2);
        el.querySelector(".bc").innerText = c.toFixed(1);
        el.querySelector(".bs").innerText = bs;

        const bar = el.querySelector(".soc-bar");
        bar.style.width = bs + "%";
        bar.className = "soc-bar " + socClass(bs);
    }

}

/********************************
 * SETTING PAGE
 ********************************/
function parseScan(dv) {
  const txt = document.getElementById("scanText");
  const bar = document.getElementById("scanBar");
  if (txt) txt.innerText = "Scanning Battery ID " + dv.getUint8(2);
  if (bar) bar.style.width = dv.getUint8(3) + "%";
}

function startScan() {
    sendCmd([PKT_HEADER, CMD.SCAN_START]);
}

function saveDeviceAddr() {
  sendCmd([PKT_HEADER, CMD.SAVE_DEVICE_ADDR, Number(deviceAddr.value)]);
  alert("Device address saved");
}

function parseDeviceAddress(dv) {
  const el = document.getElementById("deviceAddr");
  if (el) el.value = dv.getUint8(2);
}

function saveWifi() {
    const s = ssid.value;
    const p = pass.value;
    const enc = new TextEncoder();
    const sb = enc.encode(s);
    const pb = enc.encode(p);
    const buf = new Uint8Array(4 + sb.length + pb.length);
    let i = 0;

    buf[i++] = PKT_HEADER;
    buf[i++] = CMD.WIFI_SAVE;
    buf[i++] = sb.length;
    buf.set(sb, i); i += sb.length;
    buf[i++] = pb.length;
    buf.set(pb, i);
    sendCmd(buf);
    alert("Wi-Fi saved");
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
    const bmsT = dv.getInt8(i++);
    const cellT = dv.getInt8(i++);
    const soh = dv.getUint8(i++);
    const cycle = dv.getUint16(i, true); i += 2;
    // update UI
    document.getElementById("title").innerText = `Battery Status ${battNo}`;
    document.getElementById("soc").innerText = soc + "%";
    document.getElementById("voltage").innerText = volt.toFixed(2) + "V";

    const currEl = document.getElementById("current");
    currEl.innerText = curr.toFixed(1) + "A";
    // reset class
    currEl.classList.remove("current-pos", "current-neg");
    // apply color
    if (curr < 0) {
        currEl.classList.add("current-neg");
    } else {
        currEl.classList.add("current-pos");
    }

    document.getElementById("bmsTemp").innerText = bmsT + "°C";
    document.getElementById("cellTemp").innerText = cellT + "°C";
    document.getElementById("soh").innerText = soh + "%";
    document.getElementById("cycle").innerText = cycle;
    // ---- read all cells voltage ----
    const cellVolt = [];

    for (let c = 0; c < MAX_CELLS_PER_MODULE; c++) {
        cellVolt[c] = dv.getUint16(i, true) / 1000;
        i += 2;
    }
    // find max / min + first index found
    let maxV = -Infinity, minV = Infinity;
    let maxIdx = -1, minIdx = -1;

    for (let c = 0; c < cellVolt.length; c++) {
        const v = cellVolt[c];
        if (v > maxV) {
            maxV = v;
            maxIdx = c;
        }
        if (v < minV) {
            minV = v;
            minIdx = c;
        }
    }
    // update UI
    for (let c = 0; c < MAX_CELLS_PER_MODULE; c++) {
        const el = cellEls[c];
        if (!el) continue;

        const v = cellVolt[c];
        el.innerText = `Cell ${c + 1}: ${v.toFixed(3)} V`;
        // reset max/min classes
        el.classList.remove("max", "min");
        if (c === maxIdx) {
            el.classList.add("max");   // 🔵 สูงสุดตัวแรก
        } else if (c === minIdx) {
            el.classList.add("min");   // 🔴 ต่ำสุดตัวแรก
        }
    }
}

/********************************
 * INIT ON LOAD
 ********************************/
/*
window.addEventListener("load", () => {
  if (isIndexPage())   { initBatteryList(); startStatusPoll(); }
  if (isBatteryPage()) { initCellList();    startBattPoll(); }
  if (isSettingPage()) sendCmd([PKT_HEADER, CMD.GET_DEVICE_ADDR]);
});
*/

window.addEventListener("load", () => {

  /********************************
   * INDEX PAGE
   ********************************/
  if (isIndexPage()) {
    // init device dropdown
    deviceSelectEl = document.getElementById("deviceSelect");

    if (deviceSelectEl) {
      deviceSelectEl.addEventListener("change", () => {
        activeDevice = deviceSelectEl.value;

        // reset UI for new device
        initBatteryList();
      });
    }

    // init UI
    initBatteryList();
    startStatusPoll();
  }

  /********************************
   * BATTERY DETAIL PAGE
   ********************************/
  if (isBatteryPage()) {
    initCellList();
    startBattPoll();
  }

  /********************************
   * SETTING PAGE
   ********************************/
  if (isSettingPage()) {
    // request device address of current device
    sendCmd([PKT_HEADER, CMD.GET_DEVICE_ADDR]);
  }
});


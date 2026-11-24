/* ====== CONFIG: paste your Firebase RTDB URL ====== */
const DB_URL = "https://florapulse-87200-default-rtdb.firebaseio.com";
const T = { SOIL_ON: 30, SOIL_OFF: 40, WATER: 2 },
    MAXPTS = 60;
const $ = (id) => document.getElementById(id);
const st = {
    d: null,
    pump: false,
    sim: false,
    muted: false,
    prev: {},
    live: false,
    boostUntil: 0,
    db: null,
};
const simD = { soilPct: 50, lightPct: 60, waterPct: 70, temp: 25, hum: 55 };

/* ---------- firmware-matching logic ---------- */
const score = (v, lo, hi) =>
    Number.isFinite(v) && v >= lo && v <= hi ? 100 : 50;
const calcPHI = (d) =>
    0.4 * d.soilPct +
    0.2 * d.lightPct +
    0.2 * score(d.temp, 20, 30) +
    0.2 * score(d.hum, 40, 70);
const label = (p) => (p < 40 ? "LOW" : p < 75 ? "MED" : "GOOD");
function stepPump(d, pump) {
    if (d.waterPct <= T.WATER) return false;
    if (d.soilPct <= T.SOIL_ON) return true;
    if (d.soilPct >= T.SOIL_OFF) return false;
    return pump;
}

/* ---------- alerts ---------- */
let ac;
function chime(f = 880) {
    if (st.muted) return;
    try {
        ac = ac || new AudioContext();
        const o = ac.createOscillator(),
            g = ac.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.15, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
        o.connect(g).connect(ac.destination);
        o.start();
        o.stop(ac.currentTime + 0.5);
    } catch (e) {}
}
function alertUser(msg, f) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    $("toasts").append(t);
    setTimeout(() => t.remove(), 6000);
    chime(f);
    if ("Notification" in window && Notification.permission === "granted")
        new Notification("FloraPulse", { body: msg });
}
function log(msg) {
    const li = document.createElement("li");
    li.innerHTML = `<time>${new Date().toLocaleTimeString()}</time>${msg}`;
    $("log").prepend(li);
    while ($("log").children.length > 100) $("log").lastChild.remove();
}

/* ---------- charts ---------- */
const mk = (id, ds, extra = {}) =>
    new Chart($(id), {
        type: "line",
        data: { labels: [], datasets: ds },
        options: {
            animation: false,
            maintainAspectRatio: false,
            pointRadius: 0,
            tension: 0.3,
            scales: { y: { min: 0, max: 100 }, ...extra },
            plugins: { legend: { labels: { boxWidth: 10 } } },
        },
    });
const dash = (l, v, c) => ({
    label: l,
    data: [],
    borderColor: c,
    borderDash: [6, 4],
    borderWidth: 1,
});
const ln = (l, c, o = {}) => ({
    label: l,
    data: [],
    borderColor: c,
    borderWidth: 2,
    ...o,
});
const ch = [
    mk("c1", [
        ln("Soil %", "#10b981"),
        dash("Pump ON 30%", "#f59e0b"),
        dash("Pump OFF 40%", "#38bdf8"),
    ]),
    mk("c2", [
        ln("PHI %", "#10b981"),
        ln("Light %", "#facc15"),
        ln("Temp °C", "#ef4444"),
        ln("Humidity %", "#38bdf8"),
    ]),
    mk(
        "c3",
        [
            ln("Water %", "#38bdf8"),
            ln("Pump (1/0)", "#a78bfa", { stepped: true, yAxisID: "y2" }),
            dash("Empty 2%", "#ef4444"),
        ],
        {
            y2: {
                position: "right",
                min: 0,
                max: 1.2,
                grid: { drawOnChartArea: false },
                ticks: { stepSize: 1 },
            },
        },
    ),
];
function pushCharts(d, phi, pump) {
    const t = new Date().toLocaleTimeString();
    const rows = [
        [d.soilPct, 30, 40],
        [phi, d.lightPct, d.temp, d.hum],
        [d.waterPct, pump ? 1 : 0, T.WATER],
    ];
    ch.forEach((c, i) => {
        c.data.labels.push(t);
        c.data.datasets.forEach((s, j) =>
            s.data.push(Number.isFinite(rows[i][j]) ? rows[i][j] : null),
        );
        if (c.data.labels.length > MAXPTS) {
            c.data.labels.shift();
            c.data.datasets.forEach((s) => s.data.shift());
        }
        c.update();
    });
}

/* ---------- render ---------- */
function render(d, pumpIn) {
    const phi = calcPHI(d),
        lbl = label(phi),
        empty = d.waterPct <= T.WATER,
        pump = empty ? false : pumpIn;
    const col =
        phi < 40 ? "var(--red)" : phi < 75 ? "var(--amb)" : "var(--grn)";
    $("arc").style.strokeDashoffset = 326.7 * (1 - phi / 100);
    $("arc").style.stroke = col;
    $("phi").textContent = phi.toFixed(1) + "%";
    $("lvl").textContent = lbl;
    $("lvl").style.color = col;
    $("ts").textContent = new Date().toLocaleString();
    $("soil").textContent = d.soilPct.toFixed(0) + "%";
    $("soilBar").style.width = d.soilPct + "%";
    $("pumpTxt").textContent = pump ? "ON" : empty ? "LOCKED OFF" : "OFF";
    const tOk = score(d.temp, 20, 30) === 100,
        hOk = score(d.hum, 40, 70) === 100;
    $("temp").textContent = Number.isFinite(d.temp)
        ? d.temp.toFixed(1) + " °C"
        : "-- °C";
    $("hum").textContent = Number.isFinite(d.hum)
        ? d.hum.toFixed(0) + " %"
        : "-- %";
    [
        ["tB", tOk],
        ["hB", hOk],
    ].forEach(([id, ok]) => {
        $(id).textContent = ok ? "Optimal" : "Outside range";
        $(id).className = "badge " + (ok ? "ok" : "bad");
    });
    $("light").textContent = d.lightPct.toFixed(0) + "%";
    $("lightBar").style.width = d.lightPct + "%";
    $("lightTxt").textContent =
        d.lightPct < 33
            ? "Low shade"
            : d.lightPct < 66
              ? "Moderate light"
              : "Bright sun";
    $("water").style.height = d.waterPct + "%";
    $("water").classList.toggle("crit", empty);
    $("waterTxt").textContent = d.waterPct.toFixed(0) + "%";
    $("tankSt").textContent = empty ? "EMPTY — pump locked" : "Tank OK";
    $("ledDot").className = "ledDot " + lbl;
    $("ledDot").title = "Status LED: " + lbl;
    $("boost").disabled = empty;

    const b = $("banner");
    if (empty) {
        b.hidden = false;
        b.className = "banner crit";
        b.textContent =
            "CRITICAL: Tank Empty (<= 2%) — Pump Locked OFF & Buzzer Alarm Active";
    } else if (d.soilPct <= T.SOIL_ON || pump) {
        b.hidden = false;
        b.className = "banner info";
        b.textContent =
            "IRRIGATION ACTIVE: Soil Moisture <= 30% — Watering Until 40%";
    } else b.hidden = true;

    const p = st.prev;
    if (p.empty !== undefined) {
        if (empty && !p.empty) {
            log("🚨 Tank empty — pump locked, buzzer ON");
            alertUser("Tank empty! Pump locked off.", 440);
        }
        if (!empty && p.empty) log("✅ Tank refilled — lockout released");
        if (pump && !p.pump) {
            log("💧 Pump ON (soil " + d.soilPct.toFixed(0) + "%)");
            alertUser(
                "Irrigation started — soil at " + d.soilPct.toFixed(0) + "%",
                660,
            );
        }
        if (!pump && p.pump)
            log("⏹ Pump OFF (soil " + d.soilPct.toFixed(0) + "%)");
        if (lbl !== p.lbl) log("💡 Status LED " + p.lbl + " → " + lbl);
    } else log("Dashboard started — status " + lbl);
    st.prev = { empty, pump, lbl };
    st.pump = pump;
    pushCharts(d, phi, pump);
}
function badge() {
    const c = $("conn");
    c.className = "badge " + (st.sim ? "sim" : st.live ? "live" : "");
    c.textContent = st.sim
        ? "SIMULATION MODE"
        : st.live
          ? "LIVE • Synced with ESP32"
          : "CONNECTING…";
}

/* ---------- Firebase ---------- */
try {
    firebase.initializeApp({ databaseURL: DB_URL });
    st.db = firebase.database();
    st.db.ref("florapulse/telemetry").on("value", (s) => {
        const v = s.val();
        if (!v) return;
        st.live = true;
        badge();
        if (st.sim) return;
        const d = {
            soilPct: +v.soilPct,
            lightPct: +v.lightPct,
            waterPct: +v.waterPct,
            temp: v.temp == null ? NaN : +v.temp,
            hum: v.hum == null ? NaN : +v.hum,
        };
        render(d, v.pump !== undefined ? !!v.pump : stepPump(d, st.pump));
    });
} catch (e) {
    log("Firebase not configured — use Simulation mode");
}

/* ---------- boost ---------- */
$("boost").onclick = () => {
    const d = st.sim ? simD : st.d;
    const w = st.sim
        ? simD.waterPct
        : +$("waterTxt").textContent.replace("%", "");
    if (w <= T.WATER) return alertUser("Boost blocked: tank empty", 440);
    log("🖐 Manual 3 s water boost requested");
    alertUser("Water boost sent (3 s)", 660);
    if (st.sim) {
        st.boostUntil = Date.now() + 3000;
        render(simD, true);
        setTimeout(() => render(simD, stepPump(simD, false)), 3100);
    } else if (st.db)
        st.db
            .ref("florapulse/boost")
            .set({ active: true, ms: 3000, ts: Date.now() });
};

/* ---------- simulation sandbox ---------- */
const defs = [
    ["soilPct", "Soil %", 0, 100, 1],
    ["lightPct", "Light %", 0, 100, 1],
    ["temp", "Temp °C", 0, 50, 0.5],
    ["hum", "Humidity %", 0, 100, 1],
    ["waterPct", "Water %", 0, 100, 1],
];
defs.forEach(([k, n, mn, mx, s]) => {
    const l = document.createElement("label"),
        o = document.createElement("output");
    o.textContent = simD[k];
    l.innerHTML = `<span>${n}</span>`;
    const i = document.createElement("input");
    Object.assign(i, {
        type: "range",
        min: mn,
        max: mx,
        step: s,
        value: simD[k],
    });
    i.oninput = () => {
        simD[k] = +i.value;
        o.textContent = i.value;
        if (st.sim) render(simD, stepPump(simD, st.pump));
    };
    l.append(i, o);
    $("sliders").append(l);
});
$("sliders").classList.add("off");
$("sim").onchange = (e) => {
    st.sim = e.target.checked;
    $("sliders").classList.toggle("off", !st.sim);
    badge();
    st.prev = {};
    log(st.sim ? "🧪 Simulation ON" : "Simulation OFF — back to live data");
    if (st.sim) render(simD, stepPump(simD, false));
};
setInterval(() => {
    if (st.sim && Date.now() > st.boostUntil)
        render(simD, stepPump(simD, st.pump));
}, 2000);

/* ---------- UI controls ---------- */
$("theme").onclick = () => {
    const h = document.documentElement;
    h.dataset.theme = h.dataset.theme === "dark" ? "light" : "dark";
};
$("mute").onclick = () => {
    st.muted = !st.muted;
    $("mute").textContent = st.muted ? "🔕 Muted" : "🔔 Sound on";
};
$("notif").onclick = () =>
    "Notification" in window &&
    Notification.requestPermission().then((r) => {
        $("notif").textContent =
            r === "granted" ? "Notifications on" : "Notifications blocked";
    });
badge();

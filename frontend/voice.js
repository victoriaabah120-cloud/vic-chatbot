/* ============================================================
   VICORA VOICE MODE
   A full-screen spoken conversation with the same backend, the
   same account and the same conversation as the text chat.

   Speech in:  the browser's SpeechRecognition (the dictation
               button's API, used continuously here).
   Speech out: speechSynthesis, so no key or server audio service
               is involved and nothing secret reaches the page.
   Thinking:   the existing POST /chat endpoint.
   ============================================================ */

const VOICE_API_URL = location.hostname.endsWith(".app.github.dev")
    ? location.origin.replace("-5500.", "-8000.")
    : location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "http://127.0.0.1:8000"
      : "https://vic-chatbot-3.onrender.com";

const SpeechRecognitionImpl =
    window.SpeechRecognition || window.webkitSpeechRecognition;

const PHASE_LABEL = {
    idle: "Tap the microphone to begin",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    error: "Something went wrong"
};

const voiceState = {
    open: false,
    phase: "idle",
    muted: false,
    speakerMuted: false,
    transcriptOpen: false,
    conversationId: null,
    turns: [],
    amplitude: 0,
    targetAmplitude: 0,
    recognition: null,
    listening: false,
    stream: null,
    analyser: null,
    audioContext: null,
    frequencies: null,
    rafId: 0,
    startedAt: 0,
    speakingKick: 0,
    errorText: "",
    engine: "speech",
    starting: false,
    restartTimer: null,
    startWatchdog: null,
    speakWatchdog: null,
    hearingProblems: 0,
    recorder: null,
    recording: false,
    recorderStarting: false,
    vadRaf: 0,
    hintText: ""
};

let voiceNodes = null;

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function vEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text) {
        node.textContent = text;
    }
    return node;
}

function vIcon(paths, viewBox = "0 0 24 24") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    paths.forEach((d) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    });
    return svg;
}

async function voiceToken() {
    const client = window.vicSupabase;
    if (!client) {
        return null;
    }
    try {
        const { data } = await client.auth.getSession();
        return data?.session?.access_token || null;
    } catch (error) {
        return null;
    }
}

async function voiceApi(path, options = {}) {
    const token = await voiceToken();
    if (!token) {
        throw new Error("Please sign in again to use voice mode.");
    }
    const response = await fetch(`${VOICE_API_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        }
    });
    const text = await response.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        data = {};
    }
    if (!response.ok) {
        throw new Error(data.detail || "Vicora could not answer that just now.");
    }
    return data;
}

/* ------------------------------------------------------------------ */
/* the orb                                                             */
/* ------------------------------------------------------------------ */

const ORB_BARS = 108;
const ORB_PARTICLES = 26;
const orbBars = new Float32Array(ORB_BARS);
const orbParticles = [];

for (let i = 0; i < ORB_PARTICLES; i += 1) {
    orbParticles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.72 + Math.random() * 0.42,
        speed: 0.12 + Math.random() * 0.3,
        size: 0.6 + Math.random() * 1.6,
        alpha: 0.25 + Math.random() * 0.5
    });
}

function orbPalette() {
    const styles = getComputedStyle(document.documentElement);
    return {
        accent: styles.getPropertyValue("--accent").trim() || "#8B5CF6",
        magenta: "#C026D3",
        violet: "#7C3AED",
        light: styles.getPropertyValue("--text").trim() || "#FFFFFF",
        dark: document.documentElement.dataset.theme === "light"
    };
}

function orbTargetAmplitude(now) {
    const t = (now - voiceState.startedAt) / 1000;

    if (voiceState.phase === "listening") {
        return Math.max(voiceState.targetAmplitude, 0.18);
    }
    if (voiceState.phase === "thinking") {
        return 0.16 + 0.06 * Math.sin(t * 2.2);
    }
    if (voiceState.phase === "speaking") {
        const kick = Math.max(0, voiceState.speakingKick);
        const wave = 0.34 + 0.22 * Math.sin(t * 7.5) + 0.12 * Math.sin(t * 3.1);
        return Math.min(1, wave + kick);
    }
    return 0.12 + 0.05 * Math.sin(t * 1.1);
}

function drawOrb(now) {
    const canvas = voiceNodes?.canvas;
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height) * 0.27;
    const palette = orbPalette();
    const t = (now - voiceState.startedAt) / 1000;

    // amplitude easing, so nothing snaps
    voiceState.targetAmplitude = orbTargetAmplitude(now);
    voiceState.amplitude += (voiceState.targetAmplitude - voiceState.amplitude) * 0.12;
    voiceState.speakingKick *= 0.9;

    const amp = voiceState.amplitude;
    const radius = base * (1 + amp * 0.14);

    // outer halo
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 2.35);
    halo.addColorStop(0, `rgba(139, 92, 246, ${0.26 + amp * 0.24})`);
    halo.addColorStop(0.55, "rgba(124, 58, 237, 0.14)");
    halo.addColorStop(1, "rgba(10, 10, 31, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.35, 0, Math.PI * 2);
    ctx.fill();

    // breathing rings
    for (let ring = 0; ring < 3; ring += 1) {
        const spin = t * (voiceState.phase === "thinking" ? 0.9 : 0.28) * (ring % 2 ? -1 : 1);
        const ringRadius = radius * (1.16 + ring * 0.14) + Math.sin(t * 1.4 + ring) * 5 + amp * 12;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);
        ctx.strokeStyle = `rgba(${ring === 1 ? "192, 38, 211" : "139, 92, 246"}, ${0.3 - ring * 0.07})`;
        ctx.lineWidth = 1.4;
        ctx.setLineDash(ring === 2 ? [2, 9] : []);
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // waveform petals
    const freq = voiceState.frequencies;
    for (let i = 0; i < ORB_BARS; i += 1) {
        const angle = (i / ORB_BARS) * Math.PI * 2 - Math.PI / 2;
        let sample;
        if (freq && freq.length) {
            sample = freq[Math.floor((i / ORB_BARS) * freq.length * 0.6)] / 255;
        } else {
            sample =
                0.5 +
                0.5 *
                    Math.sin(i * 0.42 + t * (voiceState.phase === "speaking" ? 6.4 : 2.1)) *
                    Math.sin(i * 0.13 + t * 0.9);
        }
        const target = 0.16 + sample * (0.55 + amp * 1.5);
        orbBars[i] += (target - orbBars[i]) * 0.22;

        const inner = radius * 1.02;
        const length = radius * (0.12 + orbBars[i] * 0.42);
        const x1 = cx + Math.cos(angle) * inner;
        const y1 = cy + Math.sin(angle) * inner;
        const x2 = cx + Math.cos(angle) * (inner + length);
        const y2 = cy + Math.sin(angle) * (inner + length);

        ctx.strokeStyle = `rgba(${i % 3 === 0 ? "192, 38, 211" : "168, 85, 247"}, ${0.2 + orbBars[i] * 0.6})`;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // core sphere
    const core = ctx.createRadialGradient(
        cx - radius * 0.3,
        cy - radius * 0.35,
        radius * 0.15,
        cx,
        cy,
        radius
    );
    core.addColorStop(0, palette.dark ? "#EDE9FE" : "#FFFFFF");
    core.addColorStop(0.32, palette.accent);
    core.addColorStop(0.78, palette.violet);
    core.addColorStop(1, palette.magenta);
    ctx.save();
    ctx.shadowColor = "rgba(139, 92, 246, 0.75)";
    ctx.shadowBlur = 40 + amp * 60;
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // soft highlight
    const shine = ctx.createRadialGradient(
        cx - radius * 0.36,
        cy - radius * 0.42,
        0,
        cx - radius * 0.36,
        cy - radius * 0.42,
        radius * 0.9
    );
    shine.addColorStop(0, "rgba(255, 255, 255, 0.5)");
    shine.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // orbiting dust
    orbParticles.forEach((particle) => {
        particle.angle += particle.speed * 0.006 * (1 + amp * 2);
        const orbit = radius * particle.radius * (1 + amp * 0.12);
        const px = cx + Math.cos(particle.angle) * orbit;
        const py = cy + Math.sin(particle.angle) * orbit * 0.96;
        ctx.fillStyle = `rgba(233, 213, 255, ${particle.alpha * (0.5 + amp)})`;
        ctx.beginPath();
        ctx.arc(px, py, particle.size, 0, Math.PI * 2);
        ctx.fill();
    });

    voiceState.rafId = requestAnimationFrame(drawOrb);
}

function startOrb() {
    if (voiceState.rafId) {
        return;
    }
    voiceState.startedAt = performance.now();
    voiceState.rafId = requestAnimationFrame(drawOrb);
}

function stopOrb() {
    if (voiceState.rafId) {
        cancelAnimationFrame(voiceState.rafId);
        voiceState.rafId = 0;
    }
}

/* ------------------------------------------------------------------ */
/* microphone level (drives the orb while the user talks)              */
/* ------------------------------------------------------------------ */

async function startMeter() {
    if (voiceState.analyser) {
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            return;
        }
        const context = new AudioCtx();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        voiceState.stream = stream;
        voiceState.audioContext = context;
        voiceState.analyser = analyser;
        voiceState.frequencies = new Uint8Array(analyser.frequencyBinCount);
    } catch (error) {
        // No microphone meter: the orb still animates from the phase.
        voiceState.analyser = null;
    }
}

function readMeter() {
    if (!voiceState.analyser || !voiceState.frequencies) {
        return;
    }
    voiceState.analyser.getByteFrequencyData(voiceState.frequencies);
    let sum = 0;
    const count = Math.min(48, voiceState.frequencies.length);
    for (let i = 0; i < count; i += 1) {
        sum += voiceState.frequencies[i];
    }
    const level = sum / (count * 255);
    voiceState.targetAmplitude = Math.min(1, level * 1.9);
}

function stopMeter() {
    if (voiceState.stream) {
        voiceState.stream.getTracks().forEach((track) => track.stop());
    }
    if (voiceState.audioContext) {
        voiceState.audioContext.close().catch(() => {});
    }
    voiceState.stream = null;
    voiceState.audioContext = null;
    voiceState.analyser = null;
    voiceState.frequencies = null;
}

setInterval(() => {
    if (voiceState.open && voiceState.phase === "listening") {
        readMeter();
    }
}, 90);

/* ------------------------------------------------------------------ */
/* phase painting                                                      */
/* ------------------------------------------------------------------ */

function paintPhase() {
    if (!voiceNodes) {
        return;
    }
    const label = voiceState.errorText && voiceState.phase === "error"
        ? voiceState.errorText
        : PHASE_LABEL[voiceState.phase] || "";
    voiceNodes.status.textContent = label;
    voiceNodes.root.dataset.phase = voiceState.phase;
    voiceNodes.status.setAttribute("aria-label", label);
}

function setPhase(phase, errorText = "") {
    voiceState.phase = phase;
    voiceState.errorText = phase === "error" ? (errorText || "Something went wrong.") : "";
    paintPhase();
}

/* ------------------------------------------------------------------ */
/* speech in                                                           */
/*                                                                     */
/* Two engines, chosen automatically. The browser's own recognition    */
/* gives live words when it works; when it is missing, blocked, or     */
/* silent for too long, Voice Mode records a clip and the server       */
/* transcribes it with Whisper. Either way the text lands in the same  */
/* handleUserSpeech(), so a turn behaves identically.                  */
/* ------------------------------------------------------------------ */

const RESTART_DELAY = 350;
const HEARING_HINT = "Vicora can't hear you yet. Tap the circle to try again.";
const SPEAK_WATCHDOG_MS = 25000;

function voiceLog(...args) {
    if (window.__VICORA_VOICE_DEBUG__ === false) {
        return;
    }
    try {
        console.info("[voice]", ...args);
    } catch (error) {
        /* logging must never break a turn */
    }
}

function clearTimer(name) {
    if (voiceState[name]) {
        clearTimeout(voiceState[name]);
        voiceState[name] = null;
    }
}

function showHint(text) {
    voiceState.hintText = text || "";
    if (!voiceNodes || !voiceNodes.hint) {
        return;
    }
    voiceNodes.hint.textContent = voiceState.hintText;
    voiceNodes.hint.hidden = !voiceState.hintText;
}

function scheduleRestart(delay = RESTART_DELAY) {
    clearTimer("restartTimer");
    voiceState.restartTimer = setTimeout(() => {
        voiceState.restartTimer = null;
        if (
            voiceState.open &&
            !voiceState.muted &&
            voiceState.phase === "listening" &&
            !voiceState.listening &&
            !voiceState.recording
        ) {
            startListening();
        }
    }, delay);
}

function switchEngine(next, message) {
    if (voiceState.engine === next) {
        return;
    }
    voiceLog("engine ->", next);
    voiceState.engine = next;
    voiceState.hearingProblems = 0;
    try {
        localStorage.setItem("vicora.voiceEngine", next);
    } catch (error) {
        /* private mode */
    }
    stopListening();
    if (next === "recorder") {
        startMeter();
    } else {
        stopMeter();
    }
    showHint(message || "");
    if (voiceState.open && voiceState.phase === "listening") {
        setTimeout(() => {
            if (voiceState.open && voiceState.phase === "listening") {
                startListening();
            }
        }, 320);
    }
}

function noteHearingProblem() {
    voiceState.hearingProblems += 1;
    voiceLog("nothing heard yet", voiceState.hearingProblems, "engine", voiceState.engine);

    if (voiceState.engine === "speech" && voiceState.hearingProblems >= 2) {
        switchEngine(
            "recorder",
            "Built-in recognition is not picking you up, so Vicora is transcribing your voice on the server instead."
        );
        return;
    }

    showHint(HEARING_HINT);
    if (voiceState.open && voiceState.phase === "listening") {
        scheduleRestart(600);
    }
}

function ensureRecognition() {
    if (!SpeechRecognitionImpl) {
        return null;
    }
    if (voiceState.recognition) {
        return voiceState.recognition;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        voiceState.starting = false;
        voiceState.listening = true;
        clearTimer("startWatchdog");
        showHint("");
        voiceLog("recognition started");
    };

    recognition.onaudiostart = () => {
        voiceLog("microphone audio is flowing");
    };

    recognition.onspeechstart = () => {
        showHint("");
    };

    recognition.onresult = (event) => {
        let finalText = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) {
                finalText += result[0].transcript;
            } else {
                interim += result[0].transcript;
            }
        }
        if (interim && voiceNodes) {
            voiceNodes.heard.textContent = interim.trim();
        }
        if (finalText.trim()) {
            voiceState.hearingProblems = 0;
            showHint("");
            voiceNodes.heard.textContent = "";
            voiceLog("heard:", finalText.trim());
            handleUserSpeech(finalText.trim());
        }
    };

    recognition.onerror = (event) => {
        const code = event.error || "unknown";
        voiceLog("recognition error:", code);
        voiceState.listening = false;
        voiceState.starting = false;
        clearTimer("startWatchdog");

        if (code === "no-speech" || code === "aborted") {
            scheduleRestart();
            return;
        }

        if (code === "not-allowed" || code === "service-not-allowed") {
            setPhase("error", "Microphone permission is blocked. Allow it in your browser, then tap the circle.");
            return;
        }

        if (code === "audio-capture") {
            // Another capture may still hold the microphone; release it and retry once.
            stopMeter();
            voiceState.hearingProblems += 1;
            if (voiceState.hearingProblems <= 2) {
                setPhase("listening", "");
                showHint("Reconnecting to the microphone…");
                scheduleRestart(700);
                return;
            }
            setPhase("error", "Vicora could not reach the microphone. Check that no other app is using it.");
            return;
        }

        if (code === "network") {
            switchEngine(
                "recorder",
                "The browser's speech service is unreachable, so Vicora is transcribing on the server instead."
            );
            return;
        }

        setPhase("error", "Vicora could not hear that. Tap the circle to try again.");
    };

    recognition.onend = () => {
        voiceState.listening = false;
        voiceState.starting = false;
        voiceLog("recognition ended, phase:", voiceState.phase);
        // Chrome throws if start() runs inside onend, so the restart is
        // always deferred; the guard above keeps it from looping while
        // Vicora is thinking or speaking.
        if (voiceState.open && !voiceState.muted && voiceState.phase === "listening") {
            scheduleRestart();
        }
    };

    voiceState.recognition = recognition;
    return recognition;
}

function startListening() {
    if (!voiceState.open || voiceState.muted || voiceState.phase !== "listening") {
        return;
    }

    if (voiceState.engine === "recorder") {
        startRecorder();
        return;
    }

    const recognition = ensureRecognition();
    if (!recognition) {
        switchEngine(
            "recorder",
            "This browser has no built-in speech recognition, so Vicora records and transcribes your voice instead."
        );
        return;
    }

    if (voiceState.listening || voiceState.starting) {
        return;
    }

    voiceState.starting = true;
    try {
        recognition.start();
    } catch (error) {
        voiceState.starting = false;
        voiceLog("start threw:", error && error.name);
        // Chrome throws when the previous session has not finished closing, so
        // one quiet retry is normal. A run of failures means the engine cannot
        // run here and the recorder takes over instead of retrying forever.
        voiceState.hearingProblems += 1;
        if (voiceState.hearingProblems >= 2) {
            noteHearingProblem();
            return;
        }
        scheduleRestart(500);
        return;
    }

    clearTimer("startWatchdog");
    voiceState.startWatchdog = setTimeout(() => {
        voiceState.startWatchdog = null;
        if (
            voiceState.open &&
            voiceState.phase === "listening" &&
            !voiceState.listening &&
            !voiceState.recording
        ) {
            noteHearingProblem();
        }
    }, 9000);
}

function stopListening() {
    clearTimer("startWatchdog");
    clearTimer("restartTimer");
    if (voiceState.engine === "recorder") {
        stopRecorder();
        return;
    }
    if (voiceState.recognition && voiceState.listening) {
        try {
            voiceState.recognition.stop();
        } catch (error) {
            /* already stopped */
        }
    }
    voiceState.listening = false;
    voiceState.starting = false;
}

/* ------------------------------------------------------------------ */
/* recorder engine                                                     */
/* ------------------------------------------------------------------ */

function recorderMime() {
    if (!window.MediaRecorder) {
        return "";
    }
    const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (const type of options) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return "";
}

async function ensureStream() {
    if (voiceState.stream && voiceState.stream.getAudioTracks().some((track) => track.readyState === "live")) {
        return voiceState.stream;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("This browser cannot reach a microphone.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceState.stream = stream;
    return stream;
}

async function startRecorder() {
    if (voiceState.recording || voiceState.recorderStarting || !voiceState.open) {
        return;
    }
    if (!window.MediaRecorder) {
        setPhase("error", "Recording is not supported in this browser.");
        return;
    }

    voiceState.recorderStarting = true;
    try {
        await startMeter();
        const stream = await ensureStream();
        if (!voiceState.open || voiceState.phase !== "listening") {
            voiceState.recorderStarting = false;
            return;
        }
        const mime = recorderMime();
        const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        const chunks = [];

        recorder.ondataavailable = (event) => {
            if (event.data && event.data.size) {
                chunks.push(event.data);
            }
        };
        recorder.onstop = () => {
            voiceState.recording = false;
            voiceState.recorder = null;
            finishRecording(chunks, recorder.mimeType || mime || "audio/webm");
        };

        recorder.start();
        voiceState.recorder = recorder;
        voiceState.recording = true;
        voiceState.recorderStarting = false;
        showHint("");
        voiceLog("recording started");
        watchForSilence();
    } catch (error) {
        voiceState.recorderStarting = false;
        voiceLog("recorder failed:", error && error.name);
        const name = error && error.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
            setPhase("error", "Microphone permission is blocked. Allow it in your browser, then tap the circle.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
            setPhase("error", "No microphone was found. Check that one is connected.");
        } else {
            setPhase("error", "Vicora could not start recording. Tap the circle to try again.");
        }
    }
}

function stopRecorder() {
    cancelAnimationFrame(voiceState.vadRaf);
    voiceState.vadRaf = 0;
    if (voiceState.recorder && voiceState.recording) {
        try {
            voiceState.recorder.stop();
        } catch (error) {
            /* already stopped */
        }
    }
    voiceState.recording = false;
}

function watchForSilence() {
    const analyser = voiceState.analyser;
    if (!analyser || !voiceState.frequencies) {
        // No meter: keep the clip short and predictable.
        setTimeout(() => {
            if (voiceState.recording) {
                stopRecorder();
            }
        }, 7000);
        return;
    }

    let spoke = false;
    let quietSince = 0;
    const started = performance.now();

    const tick = () => {
        if (!voiceState.recording) {
            return;
        }
        analyser.getByteFrequencyData(voiceState.frequencies);
        let sum = 0;
        for (let i = 0; i < voiceState.frequencies.length; i += 1) {
            const value = voiceState.frequencies[i] / 255;
            sum += value * value;
        }
        const rms = Math.sqrt(sum / voiceState.frequencies.length);
        const now = performance.now();

        if (rms > 0.05) {
            spoke = true;
            quietSince = 0;
        } else if (spoke) {
            if (!quietSince) {
                quietSince = now;
            }
            if (now - quietSince > 1100) {
                stopRecorder();
                return;
            }
        }

        // Nothing said yet: stop early instead of holding a 30 second clip.
        if (!spoke && now - started > 8000) {
            stopRecorder();
            return;
        }

        if (now - started > 30000) {
            stopRecorder();
            return;
        }
        voiceState.vadRaf = requestAnimationFrame(tick);
    };

    voiceState.vadRaf = requestAnimationFrame(tick);
}

async function finishRecording(chunks, mime) {
    if (!voiceState.open) {
        return;
    }
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) {
        noteHearingProblem();
        return;
    }

    setPhase("thinking");
    try {
        const text = await transcribeBlob(blob);
        if (!voiceState.open) {
            return;
        }
        if (!text) {
            setPhase("listening");
            showHint("Vicora heard nothing in that clip. Tap the circle and speak again.");
            scheduleRestart(700);
            return;
        }
        voiceLog("transcribed:", text);
        handleUserSpeech(text);
    } catch (error) {
        voiceLog("transcription failed:", error && error.message);
        setPhase("error", error.message || "Vicora could not transcribe that. Tap the circle to try again.");
    }
}

async function transcribeBlob(blob) {
    const token = await voiceToken();
    if (!token) {
        throw new Error("Please sign in again to use voice mode.");
    }
    const form = new FormData();
    form.append("file", blob, blob.type.includes("mp4") ? "voice.mp4" : "voice.webm");
    const response = await fetch(`${VOICE_API_URL}/voice/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
    if (!response.ok) {
        let detail = "";
        try {
            const body = await response.json();
            detail = body && body.detail ? String(body.detail) : "";
        } catch (error) {
            /* not json */
        }
        throw new Error(detail || "Vicora could not transcribe that. Please try again.");
    }
    const data = await response.json();
    return (data && data.text ? String(data.text) : "").trim();
}

/* ------------------------------------------------------------------ */
/* speech out                                                          */
/* ------------------------------------------------------------------ */

let cachedVoices = [];
let voiceListenerBound = false;

function refreshVoices() {
    if (!("speechSynthesis" in window)) {
        return [];
    }
    try {
        cachedVoices = window.speechSynthesis.getVoices() || [];
    } catch (error) {
        cachedVoices = [];
    }
    if (!voiceListenerBound && "speechSynthesis" in window) {
        voiceListenerBound = true;
        window.speechSynthesis.addEventListener?.("voiceschanged", () => {
            try {
                cachedVoices = window.speechSynthesis.getVoices() || [];
            } catch (error) {
                /* ignore */
            }
        });
    }
    return cachedVoices;
}

/** Prefer a natural English voice, fall back to whatever the device has. */
function pickVoice() {
    const voices = refreshVoices().filter((voice) => /^en(-|_)?/i.test(voice.lang || ""));
    if (!voices.length) {
        return null;
    }
    const score = (voice) => {
        const name = (voice.name || "").toLowerCase();
        const lang = (voice.lang || "").toLowerCase();
        let points = 0;
        if (lang.startsWith("en")) points += 4;
        if (lang.startsWith("en-us") || lang.startsWith("en_us")) points += 2;
        if (name.includes("google")) points += 4;
        if (name.includes("natural") || name.includes("premium") || name.includes("enhanced")) points += 3;
        if (name.includes("microsoft")) points += 2;
        if (name.includes("female") || name.includes("aria") || name.includes("zira") || name.includes("samantha")) points += 1;
        return points;
    };
    return voices.sort((a, b) => score(b) - score(a))[0];
}

function stopSpeaking() {
    clearTimer("speakWatchdog");
    if ("speechSynthesis" in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (error) {
            /* ignore */
        }
    }
}

function backToListening(delay = 260) {
    if (!voiceState.open) {
        return;
    }
    setPhase("listening", "");
    setTimeout(() => {
        if (voiceState.open && voiceState.phase === "listening") {
            startListening();
        }
    }, delay);
}

function speak(text) {
    const clean = String(text || "")
        .replace(/```[\s\S]*?```/g, " (code block) ")
        .replace(/[#*_>`]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (voiceState.speakerMuted || !clean || !("speechSynthesis" in window)) {
        backToListening(120);
        return;
    }

    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 1400));
    utterance.lang = "en-US";
    utterance.rate = 1.02;
    utterance.pitch = 1;
    const voice = pickVoice();
    if (voice) {
        utterance.voice = voice;
    }

    let settled = false;
    const settle = (reason) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimer("speakWatchdog");
        voiceLog("speech finished:", reason);
        backToListening();
    };

    utterance.onstart = () => {
        clearTimer("speakWatchdog");
        setPhase("speaking");
        // Some browsers never fire onend; this keeps the turn moving.
        voiceState.speakWatchdog = setTimeout(() => {
            voiceLog("speech watchdog fired");
            stopSpeaking();
            showHint("Audio playback stalled, so here is the reply as text.");
            settle("watchdog");
        }, SPEAK_WATCHDOG_MS);
    };
    utterance.onboundary = () => {
        voiceState.speakingKick = Math.min(1, voiceState.speakingKick + 0.35);
    };
    utterance.onend = () => settle("end");
    utterance.onerror = (event) => {
        voiceLog("speech error:", event && event.error);
        showHint("The device voice failed, so the reply is shown as text.");
        settle("error");
    };

    setPhase("speaking");
    try {
        // Voices can be empty for the first moment after load.
        if (!refreshVoices().length) {
            setTimeout(() => {
                if (!settled && voiceState.open && voiceState.phase === "speaking") {
                    const lateVoice = pickVoice();
                    if (lateVoice) {
                        utterance.voice = lateVoice;
                    }
                }
            }, 400);
        }
        window.speechSynthesis.speak(utterance);
        voiceState.speakWatchdog = setTimeout(() => {
            if (!settled && voiceState.phase === "speaking") {
                voiceLog("speech never started");
                showHint("The device voice did not start, so the reply is shown as text.");
                stopSpeaking();
                settle("never-started");
            }
        }, 6000);
    } catch (error) {
        voiceLog("speak threw:", error && error.message);
        showHint("This device could not play the reply aloud, so it is shown as text.");
        settle("throw");
    }
}

/* ------------------------------------------------------------------ */
/* one turn                                                            */
/* ------------------------------------------------------------------ */

function addTurn(role, text) {
    voiceState.turns.push({ role, text });
    if (!voiceNodes) {
        return;
    }
    const row = vEl("div", `voice-turn voice-turn-${role === "user" ? "user" : "vic"}`);
    row.appendChild(vEl("span", "voice-turn-who", role === "user" ? "You" : "Vicora"));
    row.appendChild(vEl("p", "voice-turn-text", text));
    voiceNodes.transcriptList.appendChild(row);
    voiceNodes.transcriptList.scrollTop = voiceNodes.transcriptList.scrollHeight;
}

async function handleUserSpeech(text) {
    if (!voiceState.open) {
        return;
    }
    // Speaking over Vicora interrupts him immediately.
    stopSpeaking();
    stopListening();

    addTurn("user", text);
    setPhase("thinking");
    voiceNodes.heard.textContent = "";

    try {
        const conversationId = await ensureConversation();
        const data = await voiceApi("/chat", {
            method: "POST",
            body: JSON.stringify({
                conversation_id: conversationId,
                message: text
            })
        });
        const answer = (data && data.message) || "I did not catch that.";
        addTurn("vic", answer);
        speak(answer);
    } catch (error) {
        setPhase("error", error.message || "Vicora could not answer that just now.");
        voiceNodes.status.textContent = error.message || "Vicora could not answer that just now.";
        setTimeout(() => {
            if (voiceState.open && voiceState.phase === "error") {
                setPhase("listening", "");
                startListening();
            }
        }, 2600);
    }
}

async function ensureConversation() {
    if (voiceState.conversationId) {
        return voiceState.conversationId;
    }
    if (window.vicCurrentConversationId) {
        voiceState.conversationId = window.vicCurrentConversationId;
        return voiceState.conversationId;
    }
    const data = await voiceApi("/conversation", { method: "POST" });
    voiceState.conversationId = data.conversation_id;
    // Let the text chat adopt the same thread.
    window.dispatchEvent(
        new CustomEvent("vic:conversation", { detail: { id: data.conversation_id } })
    );
    return voiceState.conversationId;
}

/* ------------------------------------------------------------------ */
/* interface                                                           */
/* ------------------------------------------------------------------ */

function buildOverlay() {
    const root = vEl("div", "voice-mode");
    root.id = "voiceMode";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Voice mode");

    const top = vEl("header", "voice-top");
    const title = vEl("div", "voice-title");
    const mark = document.createElement("img");
    mark.className = "voice-title-mark";
    mark.src = "assets/vicora-logo-96.png";
    mark.alt = "";
    mark.setAttribute("aria-hidden", "true");
    mark.width = 22;
    mark.height = 22;
    title.appendChild(mark);
    title.appendChild(vEl("span", "", "VICORA AI"));
    const closeButton = vEl("button", "voice-close", "End");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "End voice conversation");
    top.append(title, closeButton);

    const stage = vEl("div", "voice-stage");
    const canvas = document.createElement("canvas");
    canvas.className = "voice-orb";
    canvas.setAttribute("aria-hidden", "true");
    const heard = vEl("p", "voice-heard");
    heard.setAttribute("aria-live", "off");
    stage.append(canvas, heard);
    stage.addEventListener("click", () => {
        if (!voiceState.open || voiceState.muted) {
            return;
        }
        if (voiceState.phase === "error" || voiceState.phase === "idle") {
            setPhase("listening", "");
        }
        if (voiceState.phase === "listening" && !voiceState.listening && !voiceState.recording) {
            startListening();
        }
    });

    const status = vEl("p", "voice-status", PHASE_LABEL.idle);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const hint = vEl("p", "voice-hint");
    hint.hidden = true;
    hint.setAttribute("aria-live", "polite");

    const controls = vEl("div", "voice-controls");
    const micButton = vEl("button", "voice-control");
    micButton.type = "button";
    micButton.dataset.action = "mute";
    micButton.setAttribute("aria-pressed", "false");
    micButton.setAttribute("aria-label", "Mute microphone");
    micButton.append(vIcon(["M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z", "M5.5 11.5a6.5 6.5 0 0 0 13 0", "M12 18v3"]));
    micButton.appendChild(vEl("span", "voice-control-label", "Mute"));

    const speakerButton = vEl("button", "voice-control");
    speakerButton.type = "button";
    speakerButton.dataset.action = "speaker";
    speakerButton.setAttribute("aria-pressed", "false");
    speakerButton.setAttribute("aria-label", "Mute Vicora's voice");
    speakerButton.append(vIcon(["M4 9.5h3l4-3.5v12l-4-3.5H4z", "M15.5 9a4 4 0 0 1 0 6"]));
    speakerButton.appendChild(vEl("span", "voice-control-label", "Sound"));

    const transcriptButton = vEl("button", "voice-control");
    transcriptButton.type = "button";
    transcriptButton.dataset.action = "transcript";
    transcriptButton.setAttribute("aria-pressed", "false");
    transcriptButton.setAttribute("aria-label", "Show transcript");
    transcriptButton.append(vIcon(["M5 6h14", "M5 11h14", "M5 16h9"]));
    transcriptButton.appendChild(vEl("span", "voice-control-label", "Text"));

    controls.append(micButton, speakerButton, transcriptButton);

    const transcript = vEl("section", "voice-transcript");
    transcript.hidden = true;
    transcript.setAttribute("aria-label", "Voice transcript");
    const transcriptList = vEl("div", "voice-transcript-list");
    transcript.appendChild(transcriptList);

    // A real input, so the conversation can continue by typing in Voice Mode.
    const compose = vEl("form", "voice-compose");
    compose.setAttribute("novalidate", "");
    const input = document.createElement("textarea");
    input.className = "voice-input";
    input.id = "voiceTextInput";
    input.rows = 1;
    input.placeholder = "Type a message";
    input.setAttribute("aria-label", "Message Vicora");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "sentences");
    input.setAttribute("enterkeyhint", "send");
    input.setAttribute("inputmode", "text");
    const sendButton = vEl("button", "voice-send");
    sendButton.type = "submit";
    sendButton.setAttribute("aria-label", "Send message");
    sendButton.append(vIcon(["M12 19V5", "M6 11l6-6 6 6"]));
    compose.append(input, sendButton);
    transcript.appendChild(compose);

    root.append(top, stage, status, hint, controls, transcript);

    closeButton.addEventListener("click", closeVoiceMode);
    micButton.addEventListener("click", () => {
        voiceState.muted = !voiceState.muted;
        micButton.setAttribute("aria-pressed", String(voiceState.muted));
        micButton.classList.toggle("is-active", voiceState.muted);
        micButton.setAttribute("aria-label", voiceState.muted ? "Unmute microphone" : "Mute microphone");
        if (voiceState.muted) {
            stopListening();
            setPhase("idle", "");
            voiceNodes.status.textContent = "Microphone muted";
        } else {
            setPhase("listening", "");
            startListening();
        }
    });
    speakerButton.addEventListener("click", () => {
        voiceState.speakerMuted = !voiceState.speakerMuted;
        speakerButton.setAttribute("aria-pressed", String(voiceState.speakerMuted));
        speakerButton.classList.toggle("is-active", voiceState.speakerMuted);
        speakerButton.setAttribute("aria-label", voiceState.speakerMuted ? "Unmute Vicora's voice" : "Mute Vicora's voice");
        if (voiceState.speakerMuted) {
            stopSpeaking();
            if (voiceState.phase === "speaking") {
                setPhase("listening", "");
                startListening();
            }
        }
    });
    transcriptButton.addEventListener("click", () => {
        voiceState.transcriptOpen = !voiceState.transcriptOpen;
        transcript.hidden = !voiceState.transcriptOpen;
        transcriptButton.setAttribute("aria-pressed", String(voiceState.transcriptOpen));
        transcriptButton.classList.toggle("is-active", voiceState.transcriptOpen);
        if (voiceState.transcriptOpen) {
            // Focus inside the tap, so Android opens the keyboard.
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
            transcriptList.scrollTop = transcriptList.scrollHeight;
        }
    });

    const sendTypedMessage = () => {
        const text = input.value.trim();
        if (!text) {
            input.focus({ preventScroll: true });
            return;
        }
        input.value = "";
        input.style.height = "";
        showHint("");
        stopSpeaking();
        stopListening();
        handleUserSpeech(text);
    };

    compose.addEventListener("submit", (event) => {
        event.preventDefault();
        sendTypedMessage();
    });

    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey) {
            return;
        }
        // A physical keyboard sends; a touch keyboard adds a line.
        const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
        if (!touch) {
            event.preventDefault();
            sendTypedMessage();
        }
    });

    input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
    });

    document.body.appendChild(root);

    voiceNodes = { root, canvas, status, hint, heard, transcriptList, transcript, compose, input, sendButton, micButton, speakerButton, transcriptButton };
    return voiceNodes;
}

function buildLauncher() {
    const bar = document.getElementById("composerBar");
    const sendButton = document.getElementById("sendButton");
    if (!bar || document.getElementById("voiceModeButton")) {
        return;
    }
    const button = vEl("button", "voice-launcher");
    button.id = "voiceModeButton";
    button.type = "button";
    button.setAttribute("aria-label", "Start voice conversation");
    button.title = "Voice mode";
    button.append(
        vIcon([
            "M4 12h1.6",
            "M8.2 8v8",
            "M12 5.5v13",
            "M15.8 8v8",
            "M19.6 10.5v3"
        ])
    );
    bar.insertBefore(button, sendButton || null);
    button.addEventListener("click", openVoiceMode);
}

async function openVoiceMode() {
    if (voiceState.open) {
        return;
    }
    if (!voiceNodes) {
        buildOverlay();
    }
    voiceState.open = true;
    voiceState.errorText = "";
    voiceState.turns = [];
    voiceNodes.transcriptList.textContent = "";
    voiceNodes.root.hidden = false;
    document.body.classList.add("voice-open");
    startOrb();
    paintPhase();

    voiceState.hearingProblems = 0;
    voiceState.engine = "speech";
    try {
        if (localStorage.getItem("vicora.voiceEngine") === "recorder") {
            voiceState.engine = "recorder";
        }
    } catch (error) {
        /* private mode */
    }

    if (voiceState.engine === "recorder") {
        await startMeter();
    }
    if (window.vicCurrentConversationId) {
        voiceState.conversationId = window.vicCurrentConversationId;
    }
    showHint("");
    setPhase("listening");
    startListening();
    voiceNodes.micButton.focus({ preventScroll: true });
}

function closeVoiceMode() {
    voiceState.open = false;
    clearTimer("restartTimer");
    clearTimer("startWatchdog");
    clearTimer("speakWatchdog");
    cancelAnimationFrame(voiceState.vadRaf);
    voiceState.vadRaf = 0;
    if (voiceState.recorder && voiceState.recording) {
        try {
            voiceState.recorder.stop();
        } catch (error) {
            /* already stopped */
        }
    }
    voiceState.recording = false;
    voiceState.recorder = null;
    stopListening();
    stopSpeaking();
    stopMeter();
    stopOrb();
    if (voiceNodes) {
        voiceNodes.root.hidden = true;
        voiceNodes.heard.textContent = "";
    }
    document.body.classList.remove("voice-open");
    const launcher = document.getElementById("voiceModeButton");
    if (launcher) {
        launcher.focus({ preventScroll: true });
    }
}

document.addEventListener("keydown", (event) => {
    if (!voiceState.open) {
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        closeVoiceMode();
    }
    if (event.key.toLowerCase() === "m") {
        voiceNodes?.micButton.click();
    }
});

// Keep the orb crisp when the window changes size or the theme flips.
window.addEventListener("resize", () => {
    if (voiceState.open) {
        startOrb();
    }
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildLauncher);
} else {
    buildLauncher();
}

window.vicVoice = {
    open: openVoiceMode,
    close: closeVoiceMode,
    state: voiceState,
    supportsSpeech: Boolean(SpeechRecognitionImpl)
};

/* ------------------------------------------------------------------ */
/* diagnostics                                                         */
/* ------------------------------------------------------------------ */

window.vicoraVoice = {
    diagnose() {
        const stream = voiceState.stream;
        return {
            open: voiceState.open,
            phase: voiceState.phase,
            engine: voiceState.engine,
            listening: voiceState.listening,
            recording: voiceState.recording,
            muted: voiceState.muted,
            speakerMuted: voiceState.speakerMuted,
            speechRecognition: Boolean(SpeechRecognitionImpl),
            speechSynthesis: "speechSynthesis" in window,
            voices: refreshVoices().length,
            microphoneTracks: stream
                ? stream.getAudioTracks().map((track) => track.readyState)
                : [],
            hearingProblems: voiceState.hearingProblems,
            hint: voiceState.hintText,
            turns: voiceState.turns.length,
            conversationId: voiceState.conversationId || window.vicCurrentConversationId || null
        };
    },
    retry() {
        if (!voiceState.open) {
            return "Voice mode is closed.";
        }
        setPhase("listening", "");
        startListening();
        return "Listening again.";
    },
    useServerTranscription() {
        switchEngine("recorder", "Server transcription is on.");
        return "Recorder engine on.";
    },
    open() {
        openVoiceMode();
        return "Opening voice mode.";
    },
    close() {
        closeVoiceMode();
        return "Voice mode closed.";
    }
};

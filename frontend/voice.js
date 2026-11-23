/* ============================================================
   VIC VOICE MODE
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
    errorText: ""
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
        throw new Error(data.detail || "Vic could not answer that just now.");
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
/* speech in                                                           */
/* ------------------------------------------------------------------ */

function setPhase(phase, message) {
    voiceState.phase = phase;
    if (message !== undefined) {
        voiceState.errorText = message;
    }
    paintPhase();
}

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
            voiceNodes.heard.textContent = "";
            handleUserSpeech(finalText.trim());
        }
    };

    recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") {
            return;
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setPhase("error", "Microphone permission is blocked. Allow it in your browser.");
            return;
        }
        if (event.error === "network") {
            setPhase("error", "Speech recognition needs a connection.");
            return;
        }
        setPhase("error", "I could not hear that. Try again.");
    };

    recognition.onend = () => {
        voiceState.listening = false;
        // Continuous conversation: start again unless Vic is busy or muted.
        if (
            voiceState.open &&
            !voiceState.muted &&
            voiceState.phase === "listening"
        ) {
            startListening();
        }
    };

    voiceState.recognition = recognition;
    return recognition;
}

function startListening() {
    const recognition = ensureRecognition();
    if (!recognition) {
        setPhase("error", "Voice mode needs Chrome, Edge or Safari.");
        return;
    }
    if (voiceState.muted || voiceState.listening) {
        return;
    }
    try {
        recognition.start();
        voiceState.listening = true;
        setPhase("listening", "");
    } catch (error) {
        // start() throws if it is already running; that is fine.
        voiceState.listening = true;
    }
}

function stopListening() {
    if (voiceState.recognition && voiceState.listening) {
        try {
            voiceState.recognition.stop();
        } catch (error) {
            /* already stopped */
        }
    }
    voiceState.listening = false;
}

/* ------------------------------------------------------------------ */
/* speech out                                                          */
/* ------------------------------------------------------------------ */

function stopSpeaking() {
    if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
    }
}

function speak(text) {
    if (voiceState.speakerMuted || !text) {
        setPhase("listening");
        startListening();
        return;
    }
    if (!("speechSynthesis" in window)) {
        setPhase("listening");
        startListening();
        return;
    }
    const clean = String(text)
        .replace(/```[\s\S]*?```/g, " (code block) ")
        .replace(/[#*_>`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!clean) {
        setPhase("listening");
        startListening();
        return;
    }

    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 1400));
    utterance.lang = "en-US";
    utterance.rate = 1.02;
    utterance.pitch = 1;

    utterance.onstart = () => {
        setPhase("speaking");
    };
    utterance.onboundary = () => {
        voiceState.speakingKick = Math.min(1, voiceState.speakingKick + 0.35);
    };
    utterance.onend = () => {
        if (voiceState.open && voiceState.phase === "speaking") {
            setPhase("listening");
            startListening();
        }
    };
    utterance.onerror = () => {
        if (voiceState.open) {
            setPhase("listening");
            startListening();
        }
    };

    setPhase("speaking");
    window.speechSynthesis.speak(utterance);
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
    row.appendChild(vEl("span", "voice-turn-who", role === "user" ? "You" : "Vic"));
    row.appendChild(vEl("p", "voice-turn-text", text));
    voiceNodes.transcriptList.appendChild(row);
    voiceNodes.transcriptList.scrollTop = voiceNodes.transcriptList.scrollHeight;
}

async function handleUserSpeech(text) {
    if (!voiceState.open) {
        return;
    }
    // Speaking over Vic interrupts him immediately.
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
        setPhase("error", error.message || "Vic could not answer that just now.");
        voiceNodes.status.textContent = error.message || "Vic could not answer that just now.";
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
    title.appendChild(vEl("span", "voice-title-dot"));
    title.appendChild(vEl("span", "", "Vic Voice"));
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

    const status = vEl("p", "voice-status", PHASE_LABEL.idle);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

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
    speakerButton.setAttribute("aria-label", "Mute Vic's voice");
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

    root.append(top, stage, status, controls, transcript);

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
        speakerButton.setAttribute("aria-label", voiceState.speakerMuted ? "Unmute Vic's voice" : "Mute Vic's voice");
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
    });

    document.body.appendChild(root);

    voiceNodes = { root, canvas, status, heard, transcriptList, transcript, micButton, speakerButton, transcriptButton };
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

    if (!SpeechRecognitionImpl) {
        setPhase("error", "Voice mode needs Chrome, Edge or Safari.");
        return;
    }

    await startMeter();
    if (window.vicCurrentConversationId) {
        voiceState.conversationId = window.vicCurrentConversationId;
    }
    startListening();
    voiceNodes.micButton.focus({ preventScroll: true });
}

function closeVoiceMode() {
    voiceState.open = false;
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

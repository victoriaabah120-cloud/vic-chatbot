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
            setPhase("error", "No microphone was found. Check that one is connected.");
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
    const token = await authToken();
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

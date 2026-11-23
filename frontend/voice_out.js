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

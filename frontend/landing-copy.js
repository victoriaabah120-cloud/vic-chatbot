// The promotional copy: navigation, scroll reveals, and the presentation that
// walks through each message in step with the robot. Deliberately free of any
// import so it starts the moment the page does, whatever the 3D scene is doing.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ */
/* navigation                                                          */
/* ------------------------------------------------------------------ */

const navToggle = document.getElementById("navToggle");
const mobileNav = document.getElementById("mobileNav");

if (navToggle && mobileNav) {
    navToggle.addEventListener("click", () => {
        const open = mobileNav.hasAttribute("hidden");
        mobileNav.toggleAttribute("hidden", !open);
        navToggle.setAttribute("aria-expanded", String(open));
    });

    mobileNav.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
            mobileNav.setAttribute("hidden", "");
            navToggle.setAttribute("aria-expanded", "false");
        }
    });
}

/* ------------------------------------------------------------------ */
/* scroll reveal                                                       */
/* ------------------------------------------------------------------ */

const revealables = Array.from(document.querySelectorAll("[data-reveal]"));

if (reduceMotion || !("IntersectionObserver" in window)) {
    revealables.forEach((el) => el.classList.add("is-revealed"));
} else {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }

            entry.target.classList.add("is-revealed");
            revealObserver.unobserve(entry.target);
        });
    }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });

    revealables.forEach((el) => revealObserver.observe(el));
}

// Shared with the robot loop: each cue is the timestamp of a gesture.
const cues = { nod: null, wave: null, present: null };

// Handed to landing.js, which drives the robot gestures from these stamps.
window.vicCues = cues;

/* ------------------------------------------------------------------ */
/* the copy presents itself, one message at a time                     */
/* ------------------------------------------------------------------ */

// The robot introduces each line in turn: one message types or fades in, rests
// long enough to read, leaves, and the next one follows. Never all at once, and
// never fast enough to feel like a ticker.
const HEADLINE = "A Brighter Way to Think and Learn";
const TYPE_MS = 62;
const SPACE_PAUSE_MS = 100;
const FADE_MS = 520;
const LEAD_MS = 140;
const GAP_MS = 470;

const stageEl = document.getElementById("heroMessages");
const headlineEl = document.getElementById("heroHeadline");

const messages = [
    { el: document.getElementById("messageHeadline"), type: true, hold: 2250 },
    { el: document.getElementById("messageSub"), hold: 2050 },
    { el: document.getElementById("messageStatement"), hold: 2050 },
    { el: document.getElementById("messageChips"), hold: 2600 }
].filter((message) => message.el);

// How long each character of the headline waits its turn.
const charTimes = [];
let typedSoFar = LEAD_MS;

for (const char of HEADLINE) {
    typedSoFar += char === " " ? SPACE_PAUSE_MS : TYPE_MS;
    charTimes.push(typedSoFar);
}

const typingMs = charTimes.length ? charTimes[charTimes.length - 1] - LEAD_MS : 0;

// Lay the whole loop out on a single clock: start typing, read it, leave, then
// the next message, and round again.
const phases = [];
let cursor = LEAD_MS;

for (const message of messages) {
    const start = cursor;
    const end = start + (message.type ? typingMs : 0) + message.hold;

    phases.push({ el: message.el, type: Boolean(message.type), start, end });
    cursor = end + FADE_MS + GAP_MS;
}

const loopMs = cursor;

let stageDirty = false;

function measureStage() {
    // Pin the tallest message so the buttons underneath never move while the
    // messages come and go. Measured with every message in place, in one frame.
    if (!stageEl || reduceMotion || !messages.length) {
        return;
    }

    stageEl.classList.add("is-animating");
    messages.forEach((message) => message.el.classList.add("is-on"));

    if (headlineEl) {
        headlineEl.textContent = HEADLINE;
    }

    let tallest = 0;

    messages.forEach((message) => {
        tallest = Math.max(tallest, message.el.scrollHeight);
    });

    stageEl.style.minHeight = `${Math.ceil(tallest)}px`;

    messages.forEach((message) => message.el.classList.remove("is-on"));

    if (headlineEl) {
        headlineEl.textContent = "";
    }

    // Measuring strips the state classes; tell the loop to put them back.
    stageDirty = true;
}

function runPresentation() {
    if (!stageEl || !messages.length) {
        return;
    }

    if (reduceMotion) {
        // Everyone gets the whole message, statically.
        if (headlineEl) {
            headlineEl.textContent = HEADLINE;
        }

        messages.forEach((message) => message.el.classList.add("is-on"));
        return;
    }

    stageEl.classList.add("is-animating");

    // Start from a clean slate so the first message types in rather than
    // appearing whole, no matter how long the rest of the page takes to wake up.
    if (headlineEl) {
        headlineEl.textContent = "";
    }

    let began = null;
    let showing = -2;

    function tick() {
        // The clock starts on the first frame that actually runs, so a slow
        // startup cannot swallow the opening message.
        if (began === null) {
            began = performance.now();
        }

        if (stageDirty) {
            stageDirty = false;
            showing = -2;
        }

        const elapsed = (performance.now() - began) % loopMs;
        const index = phases.findIndex((phase) => elapsed >= phase.start && elapsed < phase.end);

        if (index === 0 && headlineEl) {
            // Type against the clock, not against a chain of timers, so a slow
            // frame never makes the words lag behind the robot.
            const typedFor = elapsed - phases[0].start;
            let count = 0;

            while (count < HEADLINE.length && charTimes[count] - LEAD_MS <= typedFor) {
                count += 1;
            }

            if (headlineEl.textContent.length !== count) {
                headlineEl.textContent = HEADLINE.slice(0, count);
            }
        }

        if (index !== showing) {
            messages.forEach((message, messageIndex) => {
                message.el.classList.toggle("is-on", messageIndex === index);
            });

            if (index === 0 && headlineEl) {
                headlineEl.textContent = "";
            }

            if (index >= 0) {
                const isPhrases = phases[index].el === messages[messages.length - 1].el;

                cues.nod = performance.now();

                if (index === 2) {
                    cues.present = performance.now();
                }

                if (isPhrases) {
                    cues.wave = performance.now();
                }
            }

            showing = index;
        }

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

measureStage();
runPresentation();

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measureStage);
}

let resizeTimer = null;

window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(measureStage, 180);
});


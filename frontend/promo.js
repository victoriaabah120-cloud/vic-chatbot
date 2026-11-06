// Presentation only: paces the supporting statements and the robot gestures.
// Nothing here touches authentication.

const promoLines = Array.from(document.querySelectorAll(".promo-lines li"));
const robot = document.querySelector(".robot");

const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The headline is set in the markup now instead of typing a character at a
// time, but the panel keeps the exact beat of the typing build so the robot's
// gestures keep the rhythm they had before: same lead-in, same spacing, same
// restart gap. Do not shorten this without changing the robot's choreography.
const TYPE_MS = 42;
const SPACE_PAUSE_MS = TYPE_MS * 2.6;
const LEGACY_HEADLINE = "AI IS A TOOL, NOT YOUR BRAIN.";
const TYPING_LEAD_MS = 320;
const TYPING_TAIL_MS = 520;

const TYPING_PAUSE_MS = LEGACY_HEADLINE
    .split("")
    .reduce(
        (total, char) => total + (char === " " ? SPACE_PAUSE_MS : TYPE_MS),
        0
    );

const REVEAL_MS = TYPING_LEAD_MS + TYPING_PAUSE_MS + TYPING_TAIL_MS;

const LINE_MS = 1650;
const HOLD_MS = 3600;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the animation from running while the tab is hidden.
async function waitUntilVisible() {
    while (document.hidden) {
        await sleep(600);
    }
}

function setStep(step) {
    if (robot) {
        robot.dataset.step = String(step);
    }
}

function resetPromo() {
    promoLines.forEach((line) => {
        line.classList.remove("is-active", "is-done");
    });
    setStep(0);
}

async function runPromo() {
    if (promoLines.length === 0) {
        return;
    }

    while (true) {
        await waitUntilVisible();

        resetPromo();

        // The copy block fades in during this pause, so the first gesture still
        // lands where it did in the typing build.
        await sleep(REVEAL_MS);

        for (let index = 0; index < promoLines.length; index += 1) {
            const line = promoLines[index];

            promoLines
                .slice(0, index)
                .forEach((previous) => {
                    previous.classList.remove("is-active");
                    previous.classList.add("is-done");
                });

            line.classList.add("is-active");
            setStep(index + 1);

            await sleep(LINE_MS);
        }

        await sleep(HOLD_MS);
    }
}

if (reducedMotion) {
    // Respect the preference: no entrance animation, everything readable.
    if (robot) {
        robot.dataset.step = "3";
    }
    promoLines.forEach((line) => line.classList.add("is-active"));
} else {
    runPromo();
}

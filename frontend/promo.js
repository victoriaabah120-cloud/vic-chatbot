// Presentation only: types the promo headline, paces the supporting
// statements and the robot gestures. Nothing here touches authentication.

const HEADLINE = "A Brighter Way to Think and Learn";

const headlineText = document.getElementById("promoHeadlineText");
const promoLines = Array.from(document.querySelectorAll(".promo-lines li"));
const robot = document.querySelector(".robot");

const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TYPE_MS = 42;
const SPACE_PAUSE_MS = TYPE_MS * 2.6;
const LEAD_MS = 320;
const TAIL_MS = 520;
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
    if (headlineText) {
        headlineText.textContent = "";
    }
    promoLines.forEach((line) => {
        line.classList.remove("is-active", "is-done");
    });
    setStep(0);
}

async function typeHeadline() {
    if (!headlineText) {
        return;
    }

    for (let index = 1; index <= HEADLINE.length; index += 1) {
        headlineText.textContent = HEADLINE.slice(0, index);

        // Pause briefly at spaces so it reads like speech, not a printer.
        const justTyped = HEADLINE[index - 1];
        await sleep(
            justTyped === " " ? SPACE_PAUSE_MS : TYPE_MS
        );
    }
}

async function runPromo() {
    if (!headlineText || promoLines.length === 0) {
        return;
    }

    while (true) {
        await waitUntilVisible();

        resetPromo();
        await sleep(LEAD_MS);
        await typeHeadline();
        await sleep(TAIL_MS);

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
    // Respect the preference: no typing, no gestures, everything readable.
    if (headlineText) {
        headlineText.textContent = HEADLINE;
    }
    promoLines.forEach((line) => line.classList.add("is-active"));
    setStep(3);
} else {
    runPromo();
}

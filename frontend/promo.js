// Presentation only: paces the supporting statements and the robot gestures.
// Nothing here touches authentication.

const promoLines = Array.from(document.querySelectorAll(".promo-lines li"));
const robot = document.querySelector(".robot");

const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const REVEAL_MS = 900;
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

        // Let the copy block fade in before the statements start cycling.
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

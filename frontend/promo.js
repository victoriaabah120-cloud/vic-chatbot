// Presentation only: the promo copy types in, clears away and comes back, and
// the supporting statements pace the robot's gestures.
// Nothing here touches authentication.

const HEADLINE = "A Brighter Way to Think and Learn";
const SUBHEAD = "AI Is a Tool, Not Your Brain.";

const headlineBox = document.querySelector(".promo-headline");
const subheadBox = document.querySelector(".promo-subhead");
const headlineText = document.getElementById("promoHeadlineText");
const subheadText = document.getElementById("promoSubheadText");
const promoLines = Array.from(document.querySelectorAll(".promo-lines li"));
const robot = document.querySelector(".robot");

const reducedMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Middle pace: about 62ms a character with a slightly longer breath at spaces,
// so each line reads like speech instead of a printer.
const TYPE_MS = 62;
const SPACE_PAUSE_MS = 100;
const HOLD_MS = 1700; // written and resting for a beat before it goes
const FADE_MS = 420; // must match the CSS transition
const GAP_MS = 600; // blank beat before the next line writes in
const LINE_MS = 1650; // supporting lines and the robot gestures they drive
const LINES_HOLD_MS = 3600;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the loop from running while the tab is hidden.
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

// The copy block must not change height while it types, or the robot underneath
// would drift. Fill both lines in for one synchronous measurement, pin that
// height, then put the live text back. Measuring the real elements keeps the
// panel's own responsive font sizes in play; offsetHeight is used because it is
// the layout height, unaffected by any transform.
function reserveCopySpace() {
    if (!headlineBox || !subheadBox) {
        return;
    }

    const liveHeadline = headlineText.textContent;
    const liveSubhead = subheadText.textContent;

    headlineText.textContent = HEADLINE;
    subheadText.textContent = SUBHEAD;
    headlineBox.style.minHeight = "";
    subheadBox.style.minHeight = "";

    const headlineHeight = headlineBox.offsetHeight;
    const subheadHeight = subheadBox.offsetHeight;

    headlineBox.style.minHeight = headlineHeight + "px";
    subheadBox.style.minHeight = subheadHeight + "px";

    headlineText.textContent = liveHeadline;
    subheadText.textContent = liveSubhead;
}

async function typeLine(box, textElement, text) {
    box.classList.remove("is-away");
    textElement.textContent = "";

    for (let index = 1; index <= text.length; index += 1) {
        textElement.textContent = text.slice(0, index);

        const justTyped = text[index - 1];
        await sleep(justTyped === " " ? SPACE_PAUSE_MS : TYPE_MS);
    }
}

async function clearLine(box, textElement) {
    box.classList.add("is-away");
    await sleep(FADE_MS);
    textElement.textContent = "";
}

async function runCopyLoop() {
    // Start blank so the first pass types from nothing.
    headlineText.textContent = "";
    subheadText.textContent = "";
    headlineBox.classList.add("is-away");
    subheadBox.classList.add("is-away");

    while (true) {
        await waitUntilVisible();

        await typeLine(headlineBox, headlineText, HEADLINE);
        await sleep(HOLD_MS);
        await clearLine(headlineBox, headlineText);
        await sleep(GAP_MS);

        await typeLine(subheadBox, subheadText, SUBHEAD);
        await sleep(HOLD_MS);
        await clearLine(subheadBox, subheadText);
        await sleep(GAP_MS);
    }
}

async function runLineCycle() {
    while (true) {
        await waitUntilVisible();

        promoLines.forEach((line) => {
            line.classList.remove("is-active", "is-done");
        });
        setStep(0);

        for (let index = 0; index < promoLines.length; index += 1) {
            promoLines.slice(0, index).forEach((previous) => {
                previous.classList.remove("is-active");
                previous.classList.add("is-done");
            });

            promoLines[index].classList.add("is-active");
            setStep(index + 1);

            await sleep(LINE_MS);
        }

        await sleep(LINES_HOLD_MS);
    }
}

if (reducedMotion) {
    // Respect the preference: everything written out, nothing moving.
    headlineBox?.classList.remove("is-away");
    subheadBox?.classList.remove("is-away");
    promoLines.forEach((line) => line.classList.add("is-active"));
    setStep(3);
} else if (headlineText && subheadText && headlineBox && subheadBox) {
    reserveCopySpace();

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(reserveCopySpace, 200);
    });

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(reserveCopySpace).catch(() => {});
    }

    runCopyLoop();
    runLineCycle();
}

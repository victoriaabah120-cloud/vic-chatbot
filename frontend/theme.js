// Theme switching: dark violet (default) and a matching light violet.
//
// The saved choice is applied by a tiny inline script in each page's <head>,
// before the stylesheet loads, so the first paint is already correct. This
// module only handles the buttons and the switch itself.

const STORAGE_KEY = "vic-theme";
const DARK = "dark";
const LIGHT = "light";

function storedTheme() {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === LIGHT || value === DARK ? value : null;
    } catch (error) {
        return null;
    }
}

function currentTheme() {
    return document.documentElement.dataset.theme === LIGHT ? LIGHT : DARK;
}

function paintButtons(theme) {
    const isLight = theme === LIGHT;

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.setAttribute("aria-pressed", String(isLight));
        button.setAttribute(
            "aria-label",
            isLight ? "Switch to dark mode" : "Switch to light mode"
        );
        button.setAttribute(
            "title",
            isLight ? "Switch to dark mode" : "Switch to light mode"
        );

        const next = button.querySelector("[data-theme-next]");
        if (next) {
            next.textContent = isLight ? "Dark mode" : "Light mode";
        }
    });
}

function apply(theme, persist) {
    const next = theme === LIGHT ? LIGHT : DARK;

    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute("content", next === LIGHT ? "#F7F5FF" : "#0A0A1F");
    }

    if (persist) {
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch (error) {
            /* private mode: the theme still applies for this page */
        }
    }

    paintButtons(next);
}

function toggle() {
    apply(currentTheme() === LIGHT ? DARK : LIGHT, true);
}

// Start from the saved value, or the system preference on a first visit.
const saved = storedTheme();

// Dark is the brand default; a visitor's saved choice always wins.
apply(saved || DARK, false);

document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-toggle]");
    if (!button) {
        return;
    }
    event.preventDefault();
    toggle();
});

// Keep a second open tab in step.
window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
        apply(event.newValue, false);
    }
});

paintButtons(currentTheme());

window.vicTheme = { apply, toggle, current: currentTheme, KEY: STORAGE_KEY };

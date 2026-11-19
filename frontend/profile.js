// The signed-in person: display name, initials avatar, welcome card, and the
// profile row in Supabase. Display only; authentication itself stays in
// script.js, which hands this module the session after login.

const PROFILE_TABLE = "profiles";
const PREFERENCES_TABLE = "email_preferences";

const GREETING_DEFAULT = "Hello! 👋";
const SUBTITLE_DEFAULT = "Turn your curiosity into clarity. Start a conversation with Vic.";

const state = {
    session: null,
    user: null,
    name: "",
    initials: "",
    isAdmin: false,
    announcements: true,
    profileExists: false
};

/* ------------------------------------------------------------------ */
/* name handling                                                       */
/* ------------------------------------------------------------------ */

const NAME_SPLIT = /[._\-+\s]+/;

function titleCase(word) {
    if (!word) {
        return "";
    }
    const lower = word.toLocaleLowerCase();
    return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

/** "victoria.abah" -> "Victoria Abah", "MICHAEL" -> "Michael", "v.abah" -> "Abah". */
function formatName(raw) {
    if (!raw) {
        return "";
    }

    const tokens = String(raw)
        .replace(/\d+/g, " ")
        .split(NAME_SPLIT)
        .map((word) => word.trim())
        .filter(Boolean);

    // Lone letters (from "v.abah@..." style addresses) only survive when they
    // are all we have.
    let words = tokens.filter((word) => word.length > 1);
    if (!words.length) {
        words = tokens;
    }

    return words.map(titleCase).join(" ");
}

/** Victoria Abah -> VA, John David -> JD, Michael -> MI. */
function initialsFor(name) {
    const clean = String(name || "").trim();
    if (!clean) {
        return "?";
    }

    const words = clean.split(/\s+/).filter(Boolean);

    if (words.length >= 2) {
        return (words[0].charAt(0) + words[1].charAt(0)).toLocaleUpperCase();
    }

    return clean.slice(0, 2).toLocaleUpperCase();
}

/** Metadata first, then the email local part, never the whole address. */
function nameFromUser(user) {
    if (!user) {
        return "";
    }

    const meta = user.user_metadata || {};
    const candidates = [
        meta.full_name,
        meta.name,
        meta.display_name,
        meta.given_name
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return formatName(candidate);
        }
    }

    const email = user.email || "";
    const local = email.includes("@") ? email.split("@")[0] : email;
    return formatName(local);
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

function avatarNode(element) {
    return element;
}

function render() {
    const name = state.name || "Vic member";
    const initials = state.initials || initialsFor(name);

    const firstName = state.name ? state.name.split(" ")[0] : "";
    const greeting = firstName ? `Hello, ${firstName} 👋` : GREETING_DEFAULT;

    document.querySelectorAll("[data-profile-initials]").forEach((node) => {
        node.textContent = initials;
    });

    document.querySelectorAll("[data-profile-name]").forEach((node) => {
        node.textContent = name;
    });

    document.querySelectorAll("[data-profile-greeting]").forEach((node) => {
        node.textContent = greeting;
    });

    document.querySelectorAll("[data-profile-subtitle]").forEach((node) => {
        node.textContent = SUBTITLE_DEFAULT;
    });

    document.querySelectorAll("[data-profile-avatar]").forEach((node) => {
        node.setAttribute("aria-label", `${name} profile avatar`);
        node.dataset.initials = initials;
    });

    const nameInput = document.getElementById("profileNameInput");
    if (nameInput && document.activeElement !== nameInput) {
        nameInput.value = state.name;
    }

    const optIn = document.getElementById("announcementOptIn");
    if (optIn) {
        optIn.checked = state.announcements;
    }
}

function setStatus(message, kind) {
    const node = document.getElementById("profileStatus");
    if (!node) {
        return;
    }
    node.textContent = message || "";
    node.dataset.kind = kind || "";
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

function client() {
    return window.vicSupabase || null;
}

async function loadProfileRow(userId) {
    const supabase = client();
    if (!supabase) {
        return null;
    }

    const { data, error } = await supabase
        .from(PROFILE_TABLE)
        .select("display_name,full_name,avatar_initials")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        // A missing table (migration not run yet) must not break the chat.
        return null;
    }

    return data;
}

async function ensureProfileRow(userId, fallbackName) {
    const supabase = client();
    if (!supabase) {
        return null;
    }

    // ignoreDuplicates keeps an existing row untouched: a name the person
    // corrected themselves must survive every later sign-in.
    const { error } = await supabase
        .from(PROFILE_TABLE)
        .upsert(
            {
                id: userId,
                display_name: fallbackName || null,
                avatar_initials: initialsFor(fallbackName)
            },
            { onConflict: "id", ignoreDuplicates: true }
        );

    if (error) {
        return null;
    }

    state.profileExists = true;
    return loadProfileRow(userId);
}

async function loadPreferences(userId) {
    const supabase = client();
    if (!supabase) {
        return;
    }

    const { data, error } = await supabase
        .from(PREFERENCES_TABLE)
        .select("announcements")
        .eq("user_id", userId)
        .maybeSingle();

    if (!error && data) {
        state.announcements = data.announcements !== false;
    }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

async function load(session) {
    if (!session || !session.user) {
        return;
    }

    state.session = session;
    state.user = session.user;
    state.isAdmin = session.user.app_metadata?.role === "admin";

    // Paint straight away from the session so the greeting is never blank.
    const fromSession = nameFromUser(session.user);
    state.name = fromSession;
    state.initials = initialsFor(fromSession);
    render();

    const userId = session.user.id;

    try {
        let row = await loadProfileRow(userId);

        if (!row) {
            row = await ensureProfileRow(userId, fromSession);
        }

        // Priority: the person's own correction, then the name Google handed
        // Supabase, then whatever the row already holds, then the email guess.
        const stored = (row?.display_name || "").trim();
        const isCustom = row?.display_name_is_custom === true;

        if (isCustom && stored) {
            state.name = formatName(stored) || stored;
            state.initials = initialsFor(state.name);
            render();
        } else if (fromSession) {
            // Google metadata already covers this account; keep the row in step.
            if (stored !== fromSession) {
                await ensureProfileRow(userId, fromSession);
            }
            state.name = fromSession;
            state.initials = initialsFor(fromSession);
            render();
        } else if (stored) {
            state.name = formatName(stored) || stored;
            state.initials = initialsFor(state.name);
            render();
        }

        await loadPreferences(userId);
        render();
    } catch (error) {
        // Offline or migration pending: the session-derived name stands.
    }
}

function clear() {
    state.session = null;
    state.user = null;
    state.name = "";
    state.initials = "";
    state.isAdmin = false;
    state.announcements = true;
    setStatus("");
    render();
}

async function saveName(rawName) {
    const name = formatName(rawName) || String(rawName || "").trim();

    if (name.length < 2) {
        setStatus("Use at least two characters.", "error");
        return false;
    }

    const supabase = client();
    if (!supabase || !state.user) {
        setStatus("You need to be signed in.", "error");
        return false;
    }

    setStatus("Saving...", "");

    let { error } = await supabase
        .from(PROFILE_TABLE)
        .update({
            display_name: name,
            avatar_initials: initialsFor(name),
            display_name_is_custom: true
        })
        .eq("id", state.user.id);

    if (error && /display_name_is_custom/.test(error.message || "")) {
        // The 002 migration has not been applied yet; the name still saves.
        ({ error } = await supabase
            .from(PROFILE_TABLE)
            .update({
                display_name: name,
                avatar_initials: initialsFor(name)
            })
            .eq("id", state.user.id));
    }

    if (error) {
        setStatus("Could not save your name. Please try again.", "error");
        return false;
    }

    // Keep the auth metadata in step for other tools that read it.
    try {
        await supabase.auth.updateUser({ data: { full_name: name } });
    } catch (error) {
        /* profile row already saved; metadata is a convenience copy */
    }

    state.name = name;
    state.initials = initialsFor(name);
    render();
    setStatus("Saved.", "ok");
    return true;
}

async function saveAnnouncements(enabled) {
    const supabase = client();
    if (!supabase || !state.user) {
        return;
    }

    const { error } = await supabase
        .from(PREFERENCES_TABLE)
        .upsert(
            { user_id: state.user.id, announcements: Boolean(enabled) },
            { onConflict: "user_id" }
        );

    state.announcements = error ? state.announcements : Boolean(enabled);
    render();
    setStatus(
        error ? "Could not update email preferences." : "Email preferences saved.",
        error ? "error" : "ok"
    );
}

function bindControls() {
    const form = document.getElementById("profileEditForm");
    const editButton = document.getElementById("profileEditButton");
    const cancel = document.getElementById("profileCancelButton");
    const input = document.getElementById("profileNameInput");
    const optIn = document.getElementById("announcementOptIn");

    if (editButton && form) {
        editButton.addEventListener("click", () => {
            const open = form.hasAttribute("hidden");
            form.toggleAttribute("hidden", !open);
            editButton.setAttribute("aria-expanded", String(open));
            if (open && input) {
                input.focus();
                input.select();
            }
        });
    }

    if (cancel && form) {
        cancel.addEventListener("click", () => {
            form.setAttribute("hidden", "");
            editButton?.setAttribute("aria-expanded", "false");
            setStatus("");
            render();
        });
    }

    if (form) {
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const saveButton = document.getElementById("profileSaveButton");
            if (saveButton) {
                saveButton.disabled = true;
            }
            const ok = await saveName(input ? input.value : "");
            if (saveButton) {
                saveButton.disabled = false;
            }
            if (ok) {
                form.setAttribute("hidden", "");
                editButton?.setAttribute("aria-expanded", "false");
            }
        });
    }

    if (optIn) {
        optIn.addEventListener("change", () => saveAnnouncements(optIn.checked));
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls);
} else {
    bindControls();
}

render();

window.vicProfile = {
    load,
    clear,
    saveName,
    initialsFor,
    formatName,
    nameFromUser,
    state
};

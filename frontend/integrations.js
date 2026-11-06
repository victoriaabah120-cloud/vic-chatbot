import {
    createClient
} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";


// ==============================
// SUPABASE
// ==============================

const SUPABASE_URL =
    "https://ibsyrfulsxlnitilxcaa.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_LQE8u0QjUgfAHfT3iHpbYA_miu-Dnxk";

const supabaseClient =
    createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    );


// ==============================
// FASTAPI BACKEND
// ==============================

const API_URL = location.hostname.endsWith(".app.github.dev")
    ? location.origin.replace("-5500.", "-8000.")
    : location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "http://127.0.0.1:8000"
      : "https://vic-chatbot-3.onrender.com";


const pluginList =
    document.getElementById("pluginList");

const statusLine =
    document.getElementById("pluginsStatus");


// ==============================
// HELPERS
// ==============================

function setStatus(message, tone = "") {
    statusLine.textContent = message || "";
    statusLine.className = tone;
}

async function getToken() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token || null;
}

async function api(path, options = {}) {
    const token = await getToken();

    if (!token) {
        throw new Error("Please log in again.");
    }

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
        });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(payload.detail || `Request failed (${response.status})`);
    }

    return payload;
}


// ==============================
// RENDER
// ==============================

function renderIntegration(integration) {
    const card = document.createElement("div");
    card.className = "plugin-card";

    const heading = document.createElement("h2");
    heading.textContent = integration.name;
    card.appendChild(heading);

    const description = document.createElement("p");
    description.textContent = integration.description;
    card.appendChild(description);

    const status = document.createElement("p");
    status.className = "plugin-status";

    if (!integration.configured) {
        status.textContent = "Not configured on the server yet.";
        status.classList.add("off");
    } else if (!integration.connected) {
        status.textContent = "Not connected.";
    } else if (integration.enabled) {
        status.textContent = integration.account_label
            ? `Connected as ${integration.account_label}`
            : "Connected";
        status.classList.add("connected");
    } else {
        status.textContent = "Connected but switched off.";
        status.classList.add("off");
    }

    card.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "plugin-actions";

    if (!integration.connected) {
        const connect = document.createElement("button");
        connect.type = "button";
        connect.className = "primary";
        connect.textContent = "Connect";
        connect.disabled = !integration.configured;
        connect.addEventListener("click", () => startConnection(integration));
        actions.appendChild(connect);
    } else {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "ghost";
        toggle.textContent = integration.enabled ? "Switch off" : "Switch on";
        toggle.addEventListener("click", () => toggleIntegration(integration));
        actions.appendChild(toggle);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "Disconnect";
        remove.addEventListener("click", () => disconnect(integration));
        actions.appendChild(remove);
    }

    card.appendChild(actions);
    return card;
}

async function loadIntegrations() {
    setStatus("Loading plugins...");

    try {
        const data = await api("/integrations");
        pluginList.replaceChildren(
            ...data.integrations.map(renderIntegration)
        );
        setStatus("");
    } catch (error) {
        console.error("Could not load plugins:", error);
        setStatus(error.message, "off");
    }
}

async function startConnection(integration) {
    setStatus(`Opening ${integration.name}...`);

    try {
        const data = await api(`/integrations/${integration.id}/start`);

        // Bot providers (Telegram) link through a deep link instead of OAuth.
        if (data.link_url) {
            window.open(data.link_url, "_blank", "noopener");

            setStatus(
                data.instructions ||
                    `Press Start in ${integration.name}, then refresh this page.`,
                "off"
            );

            const refresh = document.createElement("button");
            refresh.type = "button";
            refresh.className = "ghost";
            refresh.textContent = "I pressed Start";
            refresh.addEventListener("click", () => loadIntegrations());

            const actions = document.createElement("div");
            actions.className = "plugin-actions";
            actions.appendChild(refresh);
            pluginList.prepend(actions);

            return;
        }

        if (!data.authorize_url) {
            throw new Error("The server did not return a login link.");
        }

        window.location.href = data.authorize_url;
    } catch (error) {
        setStatus(error.message, "off");
    }
}

async function toggleIntegration(integration) {
    try {
        await api(`/integrations/${integration.id}/enable`, {
            method: "POST",
            body: JSON.stringify({ enabled: !integration.enabled }),
        });
        await loadIntegrations();
    } catch (error) {
        setStatus(error.message, "off");
    }
}

async function disconnect(integration) {
    const confirmed = window.confirm(
        `Disconnect ${integration.name}? Vic Chatbot will lose access straight away.`
    );

    if (!confirmed) {
        return;
    }

    try {
        await api(`/integrations/${integration.id}`, {
            method: "DELETE",
        });
        await loadIntegrations();
        setStatus(`${integration.name} disconnected.`, "connected");
    } catch (error) {
        setStatus(error.message, "off");
    }
}


// ==============================
// START
// ==============================

async function init() {
    const token = await getToken();

    if (!token) {
        setStatus("Please log in to manage plugins.", "off");
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const result = params.get("status");

    if (result === "connected") {
        setStatus("Connected. You can use it in the chat now.", "connected");
    } else if (result === "error") {
        setStatus(
            params.get("message") || "The connection did not complete.",
            "off"
        );
    }

    await loadIntegrations();
}

init();

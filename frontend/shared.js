/* Read-only viewer for a shared conversation. No account data is shown. */

const API_URL = location.hostname.endsWith(".app.github.dev")
    ? location.origin.replace("-5500.", "-8000.")
    : location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "http://127.0.0.1:8000"
      : "https://vic-chatbot-3.onrender.com";

const thread = document.getElementById("sharedThread");
const stateBox = document.getElementById("sharedState");
const titleNode = document.getElementById("sharedTitle");
const metaNode = document.getElementById("sharedMeta");

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/* Minimal Markdown: paragraphs, fenced code, inline code and bold. */
function renderMarkdown(text) {
    const blocks = String(text || "").split(/```/);
    return blocks
        .map((block, index) => {
            if (index % 2 === 1) {
                return `<pre><code>${escapeHtml(block.replace(/^\w*\n/, ""))}</code></pre>`;
            }
            return block
                .split(/\n{2,}/)
                .map((chunk) => chunk.trim())
                .filter(Boolean)
                .map((chunk) => {
                    let html = escapeHtml(chunk).replace(/\n/g, "<br>");
                    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
                    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
                    return `<p>${html}</p>`;
                })
                .join("");
        })
        .join("");
}

function formatDate(value) {
    if (!value) {
        return "";
    }
    try {
        return new Date(value).toLocaleString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch (error) {
        return "";
    }
}

async function load() {
    const token = new URLSearchParams(location.search).get("t");
    if (!token) {
        stateBox.textContent = "This link is missing its share token.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/shared/${encodeURIComponent(token)}`);
        if (!response.ok) {
            stateBox.textContent = "This link is no longer available.";
            metaNode.textContent = "The owner may have turned sharing off.";
            return;
        }
        const data = await response.json();
        titleNode.textContent = data.title || "Shared conversation";
        metaNode.textContent = data.created_at
            ? `Started ${formatDate(data.created_at)} · ${data.messages.length} messages`
            : `${data.messages.length} messages`;

        stateBox.hidden = true;
        thread.hidden = false;
        thread.textContent = "";

        data.messages.forEach((message) => {
            const wrap = document.createElement("article");
            wrap.className = `shared-message ${message.role === "user" ? "user" : "vic"}`;

            const who = document.createElement("span");
            who.className = "shared-who";
            who.textContent = message.role === "user" ? "You" : "Vic";
            wrap.appendChild(who);

            const bubble = document.createElement("div");
            bubble.className = "shared-bubble";
            bubble.innerHTML = renderMarkdown(message.content);
            wrap.appendChild(bubble);

            if (Array.isArray(message.sources) && message.sources.length) {
                const list = document.createElement("ul");
                list.className = "shared-sources";
                message.sources.forEach((source) => {
                    const item = document.createElement("li");
                    const link = document.createElement("a");
                    link.href = source.url;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = source.title || source.url;
                    item.appendChild(link);
                    list.appendChild(item);
                });
                wrap.appendChild(list);
            }

            thread.appendChild(wrap);
        });
    } catch (error) {
        stateBox.textContent = "The conversation could not be loaded.";
    }
}

load();

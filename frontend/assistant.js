/* ============================================================
   VICORA AI assistant features
   Attachments, web search, memories, export and sharing.

   Every call goes to the existing FastAPI backend with the current
   Supabase access token; no key or secret is ever held in the browser.
   ============================================================ */

const API_URL = location.hostname.endsWith(".app.github.dev")
    ? location.origin.replace("-5500.", "-8000.")
    : location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "http://127.0.0.1:8000"
      : "https://vic-chatbot-3.onrender.com";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED = [
    "pdf", "docx", "txt", "md", "png", "jpg", "jpeg", "webp"
];

const state = {
    attachments: [],
    useSearch: false,
    searchReady: null,
    busy: false
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function icon(paths, size = 16) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    paths.forEach((d) => {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        svg.appendChild(p);
    });
    return svg;
}

function formatSize(bytes) {
    if (!bytes && bytes !== 0) {
        return "";
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function authToken() {
    try {
        const client = window.vicSupabase;
        if (!client) {
            return null;
        }
        const { data } = await client.auth.getSession();
        return data?.session?.access_token || null;
    } catch (error) {
        return null;
    }
}

async function api(path, options = {}) {
    const token = await authToken();
    if (!token) {
        throw new Error("Your session expired. Please log in again.");
    }
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`
        }
    });
    return response;
}

function currentConversationId() {
    return window.vicCurrentConversationId || null;
}

function notify(text, tone = "info") {
    let region = document.getElementById("assistantToast");
    if (!region) {
        region = el("div", "assistant-toast");
        region.id = "assistantToast";
        region.setAttribute("role", "status");
        document.body.appendChild(region);
    }
    region.textContent = text;
    region.dataset.tone = tone;
    region.classList.add("is-visible");
    window.clearTimeout(region._timer);
    region._timer = window.setTimeout(() => {
        region.classList.remove("is-visible");
    }, 4200);
}

/* ------------------------------------------------------------------ */
/* attachments                                                         */
/* ------------------------------------------------------------------ */

function validate(file) {
    const name = (file.name || "").toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() : "";
    if (!ALLOWED.includes(ext)) {
        return "Only PDF, DOCX, TXT, MD, PNG, JPG and WEBP files can be attached.";
    }
    const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext);
    const limit = isImage ? MAX_IMAGE_BYTES : MAX_BYTES;
    if (file.size > limit) {
        return `${file.name} is ${formatSize(file.size)}. The limit is ${formatSize(limit)}.`;
    }
    if (file.size === 0) {
        return `${file.name} is empty.`;
    }
    return null;
}

function trayNode() {
    return document.getElementById("attachmentTray");
}

function renderTray() {
    const tray = trayNode();
    if (!tray) {
        return;
    }
    tray.textContent = "";
    tray.hidden = state.attachments.length === 0;

    state.attachments.forEach((item) => {
        const chip = el("div", "attachment-chip");
        chip.dataset.status = item.status;

        const preview = el("div", "attachment-preview");
        if (item.previewUrl) {
            const img = el("img");
            img.src = item.previewUrl;
            img.alt = "";
            preview.appendChild(img);
        } else {
            preview.appendChild(icon(["M14 3v5h5", "M6 3h8l5 5v13H6z"], 16));
        }
        chip.appendChild(preview);

        const meta = el("div", "attachment-meta");
        meta.appendChild(el("span", "attachment-name", item.file.name));
        meta.appendChild(
            el(
                "span",
                "attachment-sub",
                item.status === "uploading"
                    ? `Uploading ${item.progress}%`
                    : item.status === "error"
                      ? item.error || "Upload failed"
                      : `${formatSize(item.file.size)} · ready`
            )
        );
        if (item.status === "uploading") {
            const bar = el("div", "attachment-progress");
            const fill = el("span");
            fill.style.width = `${item.progress}%`;
            bar.appendChild(fill);
            meta.appendChild(bar);
        }
        chip.appendChild(meta);

        const remove = el("button", "attachment-remove", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${item.file.name}`);
        remove.addEventListener("click", () => {
            if (item.previewUrl) {
                URL.revokeObjectURL(item.previewUrl);
            }
            if (item.id) {
                api(`/documents/${item.id}`, { method: "DELETE" }).catch(() => {});
            }
            state.attachments = state.attachments.filter((entry) => entry !== item);
            renderTray();
        });
        chip.appendChild(remove);

        tray.appendChild(chip);
    });
}

function uploadOne(item) {
    return new Promise((resolve) => {
        const token = authToken();
        token.then((accessToken) => {
            if (!accessToken) {
                item.status = "error";
                item.error = "Please log in again.";
                renderTray();
                resolve();
                return;
            }
            const form = new FormData();
            form.append("file", item.file);
            const conversationId = currentConversationId();
            if (conversationId) {
                form.append("conversation_id", conversationId);
            }

            const request = new XMLHttpRequest();
            request.open("POST", `${API_URL}/documents`);
            request.setRequestHeader("Authorization", `Bearer ${accessToken}`);

            request.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) {
                    item.progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
                    renderTray();
                }
            });

            request.addEventListener("load", () => {
                if (request.status >= 200 && request.status < 300) {
                    try {
                        const payload = JSON.parse(request.responseText);
                        item.id = payload.id;
                        item.status = "ready";
                        item.progress = 100;
                    } catch (error) {
                        item.status = "error";
                        item.error = "The server sent an unexpected reply.";
                    }
                } else {
                    item.status = "error";
                    try {
                        item.error = JSON.parse(request.responseText).detail;
                    } catch (error) {
                        item.error = "Upload failed. Please try again.";
                    }
                }
                renderTray();
                resolve();
            });

            request.addEventListener("error", () => {
                item.status = "error";
                item.error = "Network error during upload.";
                renderTray();
                resolve();
            });

            request.send(form);
        });
    });
}

function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
        return;
    }
    if (state.attachments.length + files.length > 5) {
        notify("You can attach up to 5 files per message.", "error");
        return;
    }

    files.forEach((file) => {
        const problem = validate(file);
        if (problem) {
            notify(problem, "error");
            return;
        }
        const item = { file, status: "uploading", progress: 0, id: null, error: null };
        if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
            item.previewUrl = URL.createObjectURL(file);
        }
        state.attachments.push(item);
        uploadOne(item);
    });
    renderTray();
}

function initAttachments() {
    const bar = document.getElementById("composerBar");
    if (!bar || document.getElementById("attachButton")) {
        return;
    }

    const input = el("input");
    input.type = "file";
    input.id = "attachmentInput";
    input.multiple = true;
    input.accept = ".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp";
    input.hidden = true;
    input.addEventListener("change", () => {
        addFiles(input.files);
        input.value = "";
    });
    document.body.appendChild(input);

    const button = el("button", "composer-icon-button");
    button.id = "attachButton";
    button.type = "button";
    button.setAttribute("aria-label", "Attach a file");
    button.appendChild(icon(["M20 12.5 12.6 20a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.5 7.5a1.5 1.5 0 0 1-2.2-2.2l6.8-6.8"]));
    button.addEventListener("click", () => input.click());

    const plus = document.getElementById("composerPlusButton");
    if (plus && plus.parentElement === bar) {
        bar.insertBefore(button, plus.nextSibling);
    } else {
        bar.insertBefore(button, bar.firstChild);
    }

    const tray = el("div", "attachment-tray");
    tray.id = "attachmentTray";
    tray.hidden = true;
    bar.parentElement.insertBefore(tray, bar);

    ["dragenter", "dragover"].forEach((name) => {
        bar.addEventListener(name, (event) => {
            event.preventDefault();
            bar.classList.add("is-dragging");
        });
    });
    ["dragleave", "drop"].forEach((name) => {
        bar.addEventListener(name, (event) => {
            event.preventDefault();
            bar.classList.remove("is-dragging");
        });
    });
    bar.addEventListener("drop", (event) => {
        addFiles(event.dataTransfer?.files);
    });
}

/* ------------------------------------------------------------------ */
/* web search                                                          */
/* ------------------------------------------------------------------ */

function initSearch() {
    const actions = document.getElementById("composerActions");
    if (!actions || document.getElementById("searchToggle")) {
        return;
    }
    const button = el("button", "composer-pill");
    button.id = "searchToggle";
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.appendChild(icon(["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M16.5 16.5 21 21"]));
    button.appendChild(el("span", "composer-pill-label", "Web search"));
    button.addEventListener("click", () => {
        if (state.searchReady === false) {
            notify("Web search needs a search API key on the server first.", "error");
            return;
        }
        state.useSearch = !state.useSearch;
        button.setAttribute("aria-pressed", String(state.useSearch));
        button.classList.toggle("is-active", state.useSearch);
        notify(state.useSearch ? "Vicora will search the web for this message." : "Web search off.");
    });
    actions.insertBefore(button, actions.firstChild);

    // Only offer the switch when the backend actually has a search key.
    api("/search/status")
        .then((data) => {
            state.searchReady = data.configured !== false;
            if (!state.searchReady) {
                button.classList.add("is-unavailable");
                button.title = "Add TAVILY_API_KEY on the server to turn this on.";
                button.setAttribute("aria-label", "Web search is not configured on the server");
            }
        })
        .catch(() => {});
}

let searchRow = null;

function searchStatus(show) {
    const chat = document.getElementById("chat");
    if (!chat) {
        return;
    }
    if (!show) {
        if (searchRow) {
            searchRow.remove();
            searchRow = null;
        }
        return;
    }
    if (searchRow) {
        return;
    }
    searchRow = el("div", "assistant-message search-status");
    const box = el("div", "search-status-box");
    box.appendChild(el("span", "search-dot"));
    box.appendChild(el("span", "", "Searching the web..."));
    searchRow.appendChild(box);
    chat.appendChild(searchRow);
    chat.scrollTop = chat.scrollHeight;
}

function renderSources(container, sources) {
    if (!Array.isArray(sources) || !sources.length) {
        return;
    }
    const block = el("div", "sources-block");
    block.appendChild(el("p", "sources-heading", "Sources"));
    const list = el("ol", "sources-list");
    sources.forEach((source) => {
        const item = el("li");
        const link = el("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.appendChild(el("span", "source-title", source.title || source.url));
        link.appendChild(el("span", "source-site", source.site || ""));
        item.appendChild(link);
        list.appendChild(item);
    });
    block.appendChild(list);
    container.appendChild(block);
}

function decorate(messageElement, data) {
    if (!messageElement || !data) {
        return;
    }
    renderSources(messageElement, data.sources);
    if (Array.isArray(data.attachments) && data.attachments.length) {
        const note = el("p", "attachment-note", `Read: ${data.attachments.map((a) => a.file_name).join(", ")}`);
        messageElement.appendChild(note);
    }
    const chat = document.getElementById("chat");
    if (chat) {
        chat.scrollTop = chat.scrollHeight;
    }
}

/* ------------------------------------------------------------------ */
/* dialog                                                              */
/* ------------------------------------------------------------------ */

function dialog() {
    let node = document.getElementById("assistantDialog");
    if (node) {
        return node;
    }
    node = el("dialog", "assistant-dialog");
    node.id = "assistantDialog";
    node.innerHTML = `
        <div class="assistant-dialog-head">
            <h2 id="assistantDialogTitle">Assistant</h2>
            <button type="button" class="assistant-dialog-close" aria-label="Close">×</button>
        </div>
        <div class="assistant-dialog-body" id="assistantDialogBody"></div>`;
    document.body.appendChild(node);
    node.querySelector(".assistant-dialog-close").addEventListener("click", () => node.close());
    node.addEventListener("click", (event) => {
        if (event.target === node) {
            node.close();
        }
    });
    return node;
}

function openDialog(title, bodyBuilder) {
    const node = dialog();
    node.querySelector("#assistantDialogTitle").textContent = title;
    const body = node.querySelector("#assistantDialogBody");
    body.textContent = "";
    bodyBuilder(body, node);
    if (!node.open) {
        node.showModal();
    }
}

/* ------------------------------------------------------------------ */
/* memory                                                              */
/* ------------------------------------------------------------------ */

async function openMemory() {
    openDialog("Memory", async (body) => {
        body.appendChild(el("p", "dialog-note", "Loading what Vicora remembers..."));

        let payload = { memories: [], enabled: true };
        try {
            const response = await api("/memory");
            if (response.ok) {
                payload = await response.json();
            }
        } catch (error) {
            body.textContent = "";
            body.appendChild(el("p", "dialog-error", "Could not load your memories right now."));
            return;
        }

        body.textContent = "";

        const toggleRow = el("label", "memory-toggle");
        const toggle = el("input");
        toggle.type = "checkbox";
        toggle.checked = payload.enabled !== false;
        toggle.addEventListener("change", async () => {
            try {
                await api("/memory/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: toggle.checked })
                });
                notify(toggle.checked ? "Memory is on." : "Memory is off. Vicora will not save new memories.");
            } catch (error) {
                notify("Could not update memory settings.", "error");
            }
        });
        toggleRow.appendChild(toggle);
        toggleRow.appendChild(el("span", "", "Let Vicora remember useful details between chats"));
        body.appendChild(toggleRow);

        const addRow = el("form", "memory-add");
        const input = el("input");
        input.type = "text";
        input.placeholder = "Something Vicora should remember";
        input.maxLength = 400;
        const addButton = el("button", "dialog-primary", "Save");
        addButton.type = "submit";
        addRow.append(input, addButton);
        addRow.addEventListener("submit", async (event) => {
            event.preventDefault();
            const text = input.value.trim();
            if (text.length < 3) {
                return;
            }
            try {
                const response = await api("/memory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: text })
                });
                if (!response.ok) {
                    throw new Error("save failed");
                }
                input.value = "";
                notify("Saved to memory.");
                openMemory();
            } catch (error) {
                notify("Could not save that memory.", "error");
            }
        });
        body.appendChild(addRow);

        const list = el("ul", "memory-list");
        if (!payload.memories.length) {
            list.appendChild(el("li", "memory-empty", "Nothing saved yet. Ask Vicora to remember something, or add it above."));
        }
        payload.memories.forEach((memory) => {
            const item = el("li", "memory-item");
            const text = el("div", "memory-text");
            text.appendChild(el("p", "", memory.content));
            text.appendChild(el("span", "memory-meta", (memory.category || "general")));
            item.appendChild(text);

            const remove = el("button", "memory-delete", "Delete");
            remove.type = "button";
            remove.addEventListener("click", async () => {
                try {
                    await api(`/memory/${memory.id}`, { method: "DELETE" });
                    item.remove();
                    notify("Memory deleted.");
                } catch (error) {
                    notify("Could not delete that memory.", "error");
                }
            });
            item.appendChild(remove);
            list.appendChild(item);
        });
        body.appendChild(list);

        if (payload.memories.length) {
            const clear = el("button", "dialog-danger", "Clear all memories");
            clear.type = "button";
            clear.addEventListener("click", async () => {
                try {
                    await api("/memory", { method: "DELETE" });
                    notify("All memories cleared.");
                    openMemory();
                } catch (error) {
                    notify("Could not clear memories.", "error");
                }
            });
            body.appendChild(clear);
        }
    });
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

async function downloadExport(format) {
    const conversationId = currentConversationId();
    if (!conversationId) {
        notify("Open a conversation first.", "error");
        return;
    }
    try {
        const response = await api(`/export/${conversationId}?format=${format}`);
        if (!response.ok) {
            throw new Error("export failed");
        }
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="([^"]+)"/);
        const name = match ? match[1] : `vic-chat.${format}`;
        const url = URL.createObjectURL(blob);
        const link = el("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        notify(`Downloaded ${name}.`);
    } catch (error) {
        notify("The export could not be prepared.", "error");
    }
}

function openExport() {
    openDialog("Export conversation", (body) => {
        body.appendChild(el("p", "dialog-note", "Download this conversation with its title, messages, dates and code blocks intact."));
        const row = el("div", "export-row");
        [["pdf", "PDF"], ["md", "Markdown"], ["txt", "Text"]].forEach(([format, label]) => {
            const button = el("button", "dialog-primary", label);
            button.type = "button";
            button.addEventListener("click", () => downloadExport(format));
            row.appendChild(button);
        });
        body.appendChild(row);
    });
}

/* ------------------------------------------------------------------ */
/* sharing                                                             */
/* ------------------------------------------------------------------ */

async function openShare() {
    openDialog("Share conversation", async (body) => {
        const conversationId = currentConversationId();
        if (!conversationId) {
            body.appendChild(el("p", "dialog-error", "Open a conversation first."));
            return;
        }
        body.appendChild(el("p", "dialog-note", "Anyone with the link can read this conversation. Revoke it at any time."));

        let status = { shared: false };
        try {
            const response = await api(`/conversations/${conversationId}/share`);
            if (response.ok) {
                status = await response.json();
            }
        } catch (error) {
            body.appendChild(el("p", "dialog-error", "Could not check the sharing state."));
            return;
        }

        const field = el("div", "share-field");
        const input = el("input");
        input.type = "text";
        input.readOnly = true;
        input.value = status.shared ? status.url : "";
        input.placeholder = "No link yet";
        field.appendChild(input);

        const copy = el("button", "dialog-primary", "Copy");
        copy.type = "button";
        copy.disabled = !status.shared;
        copy.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(input.value);
                notify("Link copied.");
            } catch (error) {
                input.select();
                notify("Press Ctrl+C to copy the link.");
            }
        });
        field.appendChild(copy);
        body.appendChild(field);

        const actions = el("div", "export-row");
        if (!status.shared) {
            const create = el("button", "dialog-primary", "Create share link");
            create.type = "button";
            create.addEventListener("click", async () => {
                try {
                    const response = await api(`/conversations/${conversationId}/share`, { method: "POST" });
                    const payload = await response.json();
                    if (!response.ok) {
                        throw new Error(payload.detail || "failed");
                    }
                    notify("Share link created.");
                    openShare();
                } catch (error) {
                    notify("Could not create a share link.", "error");
                }
            });
            actions.appendChild(create);
        } else {
            const revoke = el("button", "dialog-danger", "Revoke link");
            revoke.type = "button";
            revoke.addEventListener("click", async () => {
                try {
                    await api(`/conversations/${conversationId}/share`, { method: "DELETE" });
                    notify("Sharing turned off.");
                    openShare();
                } catch (error) {
                    notify("Could not revoke the link.", "error");
                }
            });
            actions.appendChild(revoke);
        }
        body.appendChild(actions);
    });
}

/* ------------------------------------------------------------------ */
/* sidebar controls                                                    */
/* ------------------------------------------------------------------ */

function initSidebar() {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer || document.getElementById("memoryButton")) {
        return;
    }
    const entries = [
        ["memoryButton", "Memory", ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 12a8 8 0 1 1 3 6.2"], openMemory],
        ["exportButton", "Export", ["M12 4v10", "M8 11l4 4 4-4", "M5 20h14"], openExport],
        ["shareButton", "Share", ["M8.5 13.5 15.5 17", "M15.5 7 8.5 10.5", "M6 12a2.5 2.5 0 1 0 0-.1z"], openShare]
    ];

    entries.forEach(([id, label, paths, handler]) => {
        const button = el("button", "sidebar-action");
        button.id = id;
        button.type = "button";
        button.appendChild(icon(paths, 15));
        button.appendChild(el("span", "", label));
        button.addEventListener("click", handler);
        const logout = document.getElementById("logoutButton");
        if (logout) {
            footer.insertBefore(button, logout);
        } else {
            footer.appendChild(button);
        }
    });
}

/* ------------------------------------------------------------------ */
/* public api                                                          */
/* ------------------------------------------------------------------ */

window.vicAssistant = {
    payload() {
        return {
            attachment_ids: state.attachments
                .filter((item) => item.status === "ready" && item.id)
                .map((item) => item.id),
            use_search: state.useSearch
        };
    },
    hasAttachments() {
        return state.attachments.length > 0;
    },
    async ready() {
        const pending = state.attachments.some((item) => item.status === "uploading");
        if (!pending) {
            return true;
        }
        notify("Waiting for your files to finish uploading...");
        const started = Date.now();
        while (state.attachments.some((item) => item.status === "uploading") && Date.now() - started < 45000) {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
        const failed = state.attachments.some((item) => item.status === "error");
        if (failed) {
            notify("Some files did not upload. Remove them and try again.", "error");
            return false;
        }
        return true;
    },
    searchStatus,
    decorate,
    reset() {
        state.attachments.forEach((item) => {
            if (item.previewUrl) {
                URL.revokeObjectURL(item.previewUrl);
            }
        });
        state.attachments = [];
        renderTray();
        searchStatus(false);
    },
    notify
};

function boot() {
    initAttachments();
    initSearch();
    initSidebar();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}

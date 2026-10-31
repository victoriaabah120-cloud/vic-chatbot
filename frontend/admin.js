import {
    createClient
} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";


const SUPABASE_URL =
    "https://ibsyrfulsxlnitilxcaa.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_LQE8u0QjUgfAHfT3iHpbYA_miu-Dnxk";

const API_URL =
    "https://vic-chatbot-56hw.onrender.com";

const supabaseClient =
    createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    );

const adminStatus =
    document.getElementById("adminStatus");

const adminDashboard =
    document.getElementById("adminDashboard");

const adminActionStatus =
    document.getElementById("adminActionStatus");

const userConversationPanel =
    document.getElementById("userConversationPanel");

const userConversationHeading =
    document.getElementById("userConversationHeading");

const userConversationStatus =
    document.getElementById("userConversationStatus");

const adminConversationList =
    document.getElementById("adminConversationList");

const adminMessagePanel =
    document.getElementById("adminMessagePanel");

const adminMessageHeading =
    document.getElementById("adminMessageHeading");

const adminMessageStatus =
    document.getElementById("adminMessageStatus");

const adminConversationMessages =
    document.getElementById("adminConversationMessages");

let accessToken = null;


function redirectToMainPage() {
    window.location.replace("index.html");
}


async function adminFetch(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            ...options.headers,
            "Authorization": `Bearer ${accessToken}`,
        },
    });

    if (response.status === 401 || response.status === 403) {
        redirectToMainPage();
        return null;
    }

    return response;
}


async function getErrorDetail(response) {
    const data = await response.json().catch(() => ({}));
    return typeof data.detail === "string"
        ? data.detail
        : "The admin request failed. Please try again.";
}


function formatTimestamp(value) {
    if (!value) {
        return "Never";
    }

    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime())
        ? value
        : timestamp.toLocaleString();
}


function formatCount(value) {
    return Number(value ?? 0).toLocaleString();
}


function renderStats(stats) {
    document.getElementById("totalUsers").textContent =
        formatCount(stats.total_users);
    document.getElementById("totalConversations").textContent =
        formatCount(stats.total_conversations);
    document.getElementById("totalMessages").textContent =
        formatCount(stats.total_messages);

    const messagesPerDay =
        document.getElementById("messagesPerDay");
    messagesPerDay.replaceChildren();

    stats.messages_per_day.forEach(day => {
        const item = document.createElement("li");
        item.textContent = `${day.date}: ${formatCount(day.count)}`;
        messagesPerDay.appendChild(item);
    });
}


function renderUsers(users) {
    const rows =
        document.getElementById("adminUserRows");
    rows.replaceChildren();

    users.forEach(user => {
        const row = document.createElement("tr");
        const values = [
            user.id,
            user.email || "No email",
            formatTimestamp(user.created_at),
            formatTimestamp(user.last_sign_in_at),
            formatCount(user.conversation_count),
            user.is_banned ? "Banned" : "Active",
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });

        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "admin-action-buttons";

        const banButton = document.createElement("button");
        banButton.className = user.is_banned ? "unban-button" : "ban-button";
        banButton.type = "button";
        banButton.textContent = user.is_banned ? "Unban" : "Ban";
        banButton.addEventListener("click", () =>
            changeUserBan(user, user.is_banned ? "unban" : "ban")
        );

        const conversationsButton = document.createElement("button");
        conversationsButton.className = "conversations-button";
        conversationsButton.type = "button";
        conversationsButton.textContent = "View conversations";
        conversationsButton.addEventListener("click", () =>
            viewConversations(user)
        );

        actions.append(banButton, conversationsButton);
        actionsCell.appendChild(actions);
        row.appendChild(actionsCell);
        rows.appendChild(row);
    });
}


async function changeUserBan(user, action) {
    const shouldBan = action === "ban";
    const userLabel = user.email || user.id;
    const actionLabel = shouldBan ? "ban" : "unban";
    const confirmation = shouldBan
        ? `Ban ${userLabel}? They will lose access to the chat.`
        : `Unban ${userLabel}? They will be able to use the chat again.`;

    if (!window.confirm(confirmation)) {
        return;
    }

    adminActionStatus.textContent =
        `${shouldBan ? "Banning" : "Unbanning"} user...`;

    try {
        const response = await adminFetch(
            `/admin/users/${encodeURIComponent(user.id)}/${action}`,
            { method: "POST" }
        );
        if (!response) {
            return;
        }
        if (!response.ok) {
            throw new Error(await getErrorDetail(response));
        }

        adminActionStatus.textContent =
            shouldBan ? "User banned." : "User unbanned.";
        await loadDashboard();
    } catch (error) {
        console.error(`Could not ${actionLabel} user:`, error);
        adminActionStatus.textContent = error.message;
    }
}


async function viewConversations(user) {
    userConversationPanel.hidden = false;
    adminMessagePanel.hidden = true;
    userConversationHeading.textContent =
        `Conversations for ${user.email || user.id}`;
    userConversationStatus.textContent =
        "Loading conversations...";
    adminConversationList.replaceChildren();

    try {
        const response = await adminFetch(
            `/admin/users/${encodeURIComponent(user.id)}/conversations`
        );
        if (!response) {
            return;
        }
        if (!response.ok) {
            throw new Error(await getErrorDetail(response));
        }

        const data = await response.json();
        data.conversations.forEach(conversation => {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.textContent =
                `${conversation.title || "New conversation"} ` +
                `(${formatCount(conversation.message_count)} messages, ` +
                `${formatTimestamp(conversation.created_at)})`;
            button.addEventListener("click", () =>
                viewMessages(conversation)
            );
            item.appendChild(button);
            adminConversationList.appendChild(item);
        });

        userConversationStatus.textContent = data.conversations.length
            ? ""
            : "This user has no conversations.";
    } catch (error) {
        console.error("Could not load user conversations:", error);
        userConversationStatus.textContent = error.message;
    }
}


async function viewMessages(conversation) {
    adminMessagePanel.hidden = false;
    adminMessageHeading.textContent =
        conversation.title || "Conversation messages";
    adminMessageStatus.textContent =
        "Loading messages...";
    adminConversationMessages.replaceChildren();

    try {
        const response = await adminFetch(
            `/admin/conversations/${encodeURIComponent(conversation.id)}/messages`
        );
        if (!response) {
            return;
        }
        if (!response.ok) {
            throw new Error(await getErrorDetail(response));
        }

        const data = await response.json();
        data.messages.forEach(message => {
            const article = document.createElement("article");
            article.className = "admin-message";

            const heading = document.createElement("h3");
            heading.textContent =
                `${message.role} · ${formatTimestamp(message.created_at)}`;

            const content = document.createElement("p");
            content.textContent = message.content ?? "";

            article.append(heading, content);
            adminConversationMessages.appendChild(article);
        });

        adminMessageStatus.textContent = data.messages.length
            ? ""
            : "This conversation has no messages.";
    } catch (error) {
        console.error("Could not load conversation messages:", error);
        adminMessageStatus.textContent = error.message;
    }
}


async function loadDashboard() {
    try {
        const {
            data: { session },
            error: sessionError,
        } = await supabaseClient.auth.getSession();

        if (sessionError || !session) {
            redirectToMainPage();
            return;
        }

        accessToken = session.access_token;

        const [statsResponse, usersResponse] = await Promise.all([
            adminFetch("/admin/stats"),
            adminFetch("/admin/users"),
        ]);

        if (!statsResponse || !usersResponse) {
            return;
        }

        if (!statsResponse.ok || !usersResponse.ok) {
            throw new Error("The admin API returned an error.");
        }

        const [stats, users] = await Promise.all([
            statsResponse.json(),
            usersResponse.json(),
        ]);

        renderStats(stats);
        renderUsers(users.users);
        adminStatus.hidden = true;
        adminDashboard.hidden = false;
    } catch (error) {
        console.error("Admin dashboard error:", error);
        adminStatus.textContent =
            "Could not load the dashboard. Please try again.";
    }
}


loadDashboard();
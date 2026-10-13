import {
    createClient
} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";


const SUPABASE_URL =
    "https://ibsyrfulsxlnitilxcaa.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_LQE8u0QjUgfAHfT3iHpbYA_miu-Dnxk";

const API_URL =
    "https://cuddly-capybara-p7jrpwgv547gh7v6p-8000.app.github.dev";

const supabaseClient =
    createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
    );

const adminStatus =
    document.getElementById("adminStatus");

const adminDashboard =
    document.getElementById("adminDashboard");


function redirectToMainPage() {
    window.location.replace("index.html");
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
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });

        rows.appendChild(row);
    });
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

        const headers = {
            "Authorization": `Bearer ${session.access_token}`,
        };

        const [statsResponse, usersResponse] = await Promise.all([
            fetch(`${API_URL}/admin/stats`, { headers }),
            fetch(`${API_URL}/admin/users`, { headers }),
        ]);

        if ([statsResponse, usersResponse].some(response =>
            response.status === 401 || response.status === 403
        )) {
            redirectToMainPage();
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
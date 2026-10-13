import {
    createClient
} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

import { marked } from "https://cdn.jsdelivr.net/npm/marked@15.0.12/+esm";

import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/+esm";


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

const API_URL =
    "https://cuddly-capybara-p7jrpwgv547gh7v6p-8000.app.github.dev";


// ==============================
// HTML ELEMENTS
// ==============================

const authSection =
    document.getElementById("authSection");

const chatSection =
    document.getElementById("chatSection");

const emailInput =
    document.getElementById("emailInput");

const passwordInput =
    document.getElementById("passwordInput");

const signUpButton =
    document.getElementById("signUpButton");

const loginButton =
    document.getElementById("loginButton");

const logoutButton =
    document.getElementById("logoutButton");

const authMessage =
    document.getElementById("authMessage");

const chat =
    document.getElementById("chat");

const messageInput =
    document.getElementById("messageInput");

const sendButton =
    document.getElementById("sendButton");

const conversationList =
    document.getElementById("conversationList");

const newConversationButton =
    document.getElementById("newConversationButton");

const conversationHistoryMessage =
    document.getElementById("conversationHistoryMessage");

const adminDashboardLink =
    document.getElementById("adminDashboardLink");

const loginForm =
    document.getElementById("loginForm");

const forgotPasswordLink =
    document.getElementById("forgotPasswordLink");

const resetRequestSection =
    document.getElementById("resetRequestSection");

const resetRequestForm =
    document.getElementById("resetRequestForm");

const resetEmailInput =
    document.getElementById("resetEmailInput");

const requestPasswordResetButton =
    document.getElementById("requestPasswordResetButton");

const passwordResetMessage =
    document.getElementById("passwordResetMessage");

const backToLoginButton =
    document.getElementById("backToLoginButton");


// ==============================
// CURRENT CONVERSATION
// ==============================

let conversationId = null;

let conversationLoadSequence = 0;


// ==============================
// AUTHENTICATION
// ==============================

async function signUp() {

    const email =
        emailInput.value.trim();

    const password =
        passwordInput.value;

    if (!email || !password) {

        authMessage.textContent =
            "Please enter your email and password.";

        return;
    }

    authMessage.textContent =
        "Creating your account...";

    const {
        data,
        error
    } =
        await supabaseClient.auth.signUp({
            email: email,
            password: password
        });

    if (error) {

        authMessage.textContent =
            error.message;

        return;
    }

    if (data.session) {

        authMessage.textContent =
            "Account created successfully.";

        showChat(data.session);

    } else {

        authMessage.textContent =
            "Account created. Check your email if confirmation is required.";
    }
}


// ==============================
// LOGIN
// ==============================

async function login() {

    const email =
        emailInput.value.trim();

    const password =
        passwordInput.value;

    if (!email || !password) {

        authMessage.textContent =
            "Please enter your email and password.";

        return;
    }

    authMessage.textContent =
        "Logging in...";

    const {
        data,
        error
    } =
        await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

    if (error) {

        authMessage.textContent =
            error.message;

        return;
    }

    if (data.session) {

        authMessage.textContent =
            "";

        showChat(data.session);
    }
}


// ==============================
// LOGOUT
// ==============================

async function logout() {

    const {
        error
    } =
        await supabaseClient.auth.signOut();

    if (error) {

        console.error(
            "Logout error:",
            error
        );

        return;
    }

    conversationId = null;

    showAuth();
}


// ==============================
// SHOW AUTH / CHAT
// ==============================

function showChat(session) {

    authSection.style.display =
        "none";

    chatSection.style.display =
        "block";

    adminDashboardLink.hidden =
        session?.user?.app_metadata?.role !== "admin";

    loadConversationHistory(true);
}


function showAuth() {

    authSection.style.display =
        "block";

    chatSection.style.display =
        "none";

    adminDashboardLink.hidden =
        true;

    loginForm.hidden =
        false;

    resetRequestSection.hidden =
        true;

    chat.innerHTML =
        "";

    emailInput.value =
        "";

    passwordInput.value =
        "";

    authMessage.textContent =
        "";

    conversationId = null;

    conversationList.replaceChildren();

    conversationHistoryMessage.textContent =
        "";
}


async function handleAccountSuspended(response) {
    if (response.status !== 403) {
        return false;
    }

    const data = await response.clone().json().catch(() => ({}));
    if (data.detail !== "Account suspended") {
        return false;
    }

    await supabaseClient.auth.signOut({ scope: "local" });
    conversationId = null;
    showAuth();
    authMessage.textContent = data.detail;
    return true;
}


function showPasswordResetRequest() {
    resetEmailInput.value =
        emailInput.value.trim();
    passwordResetMessage.textContent =
        "";
    loginForm.hidden =
        true;
    resetRequestSection.hidden =
        false;
}


async function requestPasswordReset(event) {
    event.preventDefault();
    requestPasswordResetButton.disabled =
        true;
    passwordResetMessage.textContent =
        "Sending reset instructions...";

    try {
        const { error } =
            await supabaseClient.auth.resetPasswordForEmail(
                resetEmailInput.value.trim(),
                {
                    redirectTo: `${window.location.origin}/reset.html`,
                }
            );

        if (error) {
            passwordResetMessage.textContent =
                "We couldn't process that request right now. Please try again later.";
            return;
        }

        passwordResetMessage.textContent =
            "If an account exists for that email, reset instructions will be sent shortly.";
    } catch (error) {
        console.error("Password reset request error:", error);
        passwordResetMessage.textContent =
            "We couldn't process that request right now. Please try again later.";
    } finally {
        requestPasswordResetButton.disabled =
            false;
    }
}


// ==============================
// CHECK EXISTING SESSION
// ==============================

async function checkSession() {

    const passwordResetCompleted =
        new URLSearchParams(window.location.search)
            .get("password_reset") === "success";

    if (passwordResetCompleted) {
        await supabaseClient.auth.signOut({ scope: "local" });
        showAuth();
        authMessage.textContent =
            "Your password has been updated. Log in with your new password.";
        window.history.replaceState(
            {},
            "",
            window.location.pathname
        );
        return;
    }

    const {
        data: {
            session
        }
    } =
        await supabaseClient.auth.getSession();

    if (session) {

        showChat(session);

    } else {

        showAuth();
    }
}


// ==============================
// ESCAPE HTML
// ==============================

function escapeHtml(text) {

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ==============================
// CREATE TABLE
// ==============================

function createTable(rows) {

    if (!rows.length) {

        return "";
    }

    const header =
        rows[0];

    const body =
        rows.slice(1);

    let html =
        '<table class="chat-table">';

    html +=
        "<thead><tr>";

    header.forEach(cell => {

        html +=
            `<th>${escapeHtml(cell.trim())}</th>`;
    });

    html +=
        "</tr></thead>";

    html +=
        "<tbody>";

    body.forEach(row => {

        html +=
            "<tr>";

        row.forEach(cell => {

            html +=
                `<td>${escapeHtml(cell.trim())}</td>`;
        });

        html +=
            "</tr>";
    });

    html +=
        "</tbody></table>";

    return html;
}


// ==============================
// FORMAT VIC'S RESPONSE
// ==============================

function formatResponse(message) {

    let text =
        escapeHtml(message);


    // Code blocks
    text =
        text.replace(
            /```([\s\S]*?)```/g,
            function(match, code) {

                return `<pre><code>${code.trim()}</code></pre>`;
            }
        );


    // Bold
    text =
        text.replace(
            /\*\*(.*?)\*\*/g,
            "<strong>$1</strong>"
        );


    // Italic
    text =
        text.replace(
            /(?<!\*)\*([^*]+)\*(?!\*)/g,
            "<em>$1</em>"
        );


    // Headings
    text =
        text.replace(
            /^### (.*)$/gm,
            "<h4>$1</h4>"
        );

    text =
        text.replace(
            /^## (.*)$/gm,
            "<h3>$1</h3>"
        );

    text =
        text.replace(
            /^# (.*)$/gm,
            "<h2>$1</h2>"
        );


    // Tables
    const lines =
        text.split("\n");

    let result = [];

    let i = 0;

    while (i < lines.length) {

        if (
            lines[i].includes("|") &&
            i + 1 < lines.length &&
            lines[i + 1].includes("|")
        ) {

            const tableLines = [];

            while (
                i < lines.length &&
                lines[i].includes("|")
            ) {

                const currentLine =
                    lines[i].trim();

                if (
                    /^[-|:\s]+$/.test(
                        currentLine
                    )
                ) {

                    i++;

                    continue;
                }

                const cells =
                    currentLine
                        .replace(/^\|/, "")
                        .replace(/\|$/, "")
                        .split("|");

                tableLines.push(cells);

                i++;
            }

            if (tableLines.length > 0) {

                result.push(
                    createTable(tableLines)
                );
            }

        } else {

            result.push(
                lines[i]
            );

            i++;
        }
    }


    text =
        result.join("\n");


    // Bullet lists
    text =
        text.replace(
            /(?:^|\n)([-*]) (.+)(?=\n|$)/g,
            "<li>$2</li>"
        );

    text =
        text.replace(
            /(<li>.*<\/li>\n?)+/g,
            function(match) {

                return `<ul>${match}</ul>`;
            }
        );


    // Numbered lists
    text =
        text.replace(
            /(?:^|\n)\d+\. (.+)(?=\n|$)/g,
            "<li>$1</li>"
        );


    // Line breaks
    text =
        text.replace(
            /\n/g,
            "<br>"
        );


    return text;
}


// ==============================
// ADD MESSAGE TO CHAT
// ==============================

function addMessage(
    sender,
    message
) {

    const messageElement =
        document.createElement("div");

    messageElement.className =
        sender === "Vic"
            ? "assistant-message"
            : "user-message";

    const contentElement =
        document.createElement("div");

    if (sender === "Vic") {

        contentElement.innerHTML =
            DOMPurify.sanitize(
                marked.parse(message, { breaks: true })
            );

    } else {

        contentElement.textContent =
            message;
    }

    messageElement.appendChild(
        contentElement
    );

    chat.appendChild(
        messageElement
    );

    chat.scrollTop =
        chat.scrollHeight;
}


// ==============================
// CREATE CONVERSATION
// ==============================

async function createConversation(
    accessToken
) {

    const response =
        await fetch(
            `${API_URL}/conversation`,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${accessToken}`
                }
            }
        );

    if (!response.ok) {
        await handleAccountSuspended(response);

        throw new Error(
            "Could not create conversation."
        );
    }

    const data =
        await response.json();

    conversationId =
        data.conversation_id;

    await loadConversationHistory();

    return conversationId;
}


function showEmptyChat() {
    const emptyMessage =
        document.createElement("p");
    emptyMessage.className =
        "empty-chat-message";
    emptyMessage.textContent =
        "Start chatting by sending a message.";
    chat.replaceChildren(emptyMessage);
}


function startNewConversation() {
    conversationLoadSequence += 1;
    conversationId = null;
    showEmptyChat();

    conversationList
        .querySelectorAll("button[data-conversation-id]")
        .forEach(button => {
            button.setAttribute("aria-pressed", "false");
        });
}


// ==============================
// LOAD CONVERSATION HISTORY
// ==============================

async function loadConversationHistory(openMostRecent = false) {

    const loadSequence =
        conversationLoadSequence;

    conversationList.replaceChildren();

    conversationHistoryMessage.textContent =
        "Loading conversations...";

    try {

        const {
            data: {
                session
            },
            error
        } =
            await supabaseClient.auth.getSession();

        if (error) {

            throw error;
        }

        if (!session) {

            conversationHistoryMessage.textContent =
                "Log in to view your conversations.";

            return;
        }

        const response =
            await fetch(
                `${API_URL}/conversations`,
                {
                    headers: {
                        "Authorization":
                            "Bearer " + session.access_token
                    }
                }
            );

        if (!response.ok) {
            await handleAccountSuspended(response);

            throw new Error(
                "Could not load conversation history."
            );
        }

        const data =
            await response.json();

        if (!Array.isArray(data.conversations)) {

            throw new Error(
                "The conversation-history response was invalid."
            );
        }

        data.conversations.forEach(conversation => {

            const item =
                document.createElement("li");

            const button =
                document.createElement("button");

            button.type =
                "button";

            button.className =
                "conversation-button";

            button.dataset.conversationId =
                conversation.id;

            button.setAttribute(
                "aria-pressed",
                String(conversation.id === conversationId)
            );

            button.textContent =
                typeof conversation.title === "string" &&
                conversation.title.trim()
                    ? conversation.title.trim()
                    : "New conversation";

            button.addEventListener(
                "click",
                () => openConversation(conversation.id)
            );

            item.appendChild(button);

            conversationList.appendChild(item);
        });

        conversationHistoryMessage.textContent =
            data.conversations.length
                ? ""
                : "No conversations yet.";

        if (loadSequence !== conversationLoadSequence) {
            return;
        }

        if (openMostRecent && data.conversations.length) {
            await openConversation(data.conversations[0].id);
        } else if (openMostRecent) {
            conversationId = null;
            showEmptyChat();
        }

    } catch (error) {

        console.error(
            "Conversation history error:",
            error
        );

        conversationList.replaceChildren();

        conversationHistoryMessage.textContent =
            "Could not load conversation history. Please try again later.";
    }
}


// ==============================
// OPEN CONVERSATION
// ==============================

async function openConversation(selectedConversationId) {

    conversationId =
        selectedConversationId;

    const requestedConversationId =
        selectedConversationId;

    const loadSequence =
        ++conversationLoadSequence;

    conversationList
        .querySelectorAll("button[data-conversation-id]")
        .forEach(button => {

            button.setAttribute(
                "aria-pressed",
                String(button.dataset.conversationId === requestedConversationId)
            );
        });

    chat.replaceChildren();

    const loadingMessage =
        document.createElement("p");

    loadingMessage.textContent =
        "Loading conversation...";

    chat.appendChild(loadingMessage);

    try {

        const {
            data: {
                session
            },
            error
        } =
            await supabaseClient.auth.getSession();

        if (error) {

            throw error;
        }

        if (!session) {

            throw new Error(
                "You are no longer logged in."
            );
        }

        const response =
            await fetch(
                `${API_URL}/conversation/${encodeURIComponent(requestedConversationId)}/messages`,
                {
                    headers: {
                        "Authorization":
                            "Bearer " + session.access_token
                    }
                }
            );

        if (!response.ok) {
            await handleAccountSuspended(response);

            throw new Error(
                "Could not load this conversation."
            );
        }

        const data =
            await response.json();

        if (!Array.isArray(data.messages)) {

            throw new Error(
                "The conversation response was invalid."
            );
        }

        if (loadSequence !== conversationLoadSequence) {

            return;
        }

        chat.replaceChildren();

        data.messages.forEach(message => {

            if (
                message.role !== "user" &&
                message.role !== "assistant"
            ) {

                throw new Error(
                    "The conversation contained an unsupported message role."
                );
            }

            addMessage(
                message.role === "assistant" ? "Vic" : "You",
                message.content
            );
        });

    } catch (error) {

        console.error(
            "Conversation loading error:",
            error
        );

        if (loadSequence === conversationLoadSequence) {

            chat.replaceChildren();

            const errorMessage =
                document.createElement("p");

            errorMessage.textContent =
                "Could not load this conversation. Please try again.";

            chat.appendChild(errorMessage);
        }
    }
}


// ==============================
// SEND MESSAGE
// ==============================

async function sendMessage() {

    const message =
        messageInput.value.trim();

    if (!message) {

        return;
    }

    addMessage(
        "You",
        message
    );

    messageInput.value =
        "";

    sendButton.disabled =
        true;

    try {

        // Get logged-in user's session
        const {
            data: {
                session
            }
        } =
            await supabaseClient.auth.getSession();


        // Make sure user is logged in
        if (!session) {

            alert(
                "You are not logged in."
            );

            return;
        }


        // Get access token
        const accessToken =
            session.access_token;


        // Create conversation if needed
        if (!conversationId) {

            await createConversation(
                accessToken
            );
        }


        // Send message to FastAPI
        const response =
            await fetch(
                `${API_URL}/chat`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            `Bearer ${accessToken}`
                    },

                    body: JSON.stringify({

                        conversation_id:
                            conversationId,

                        message:
                            message
                    })
                }
            );


        if (!response.ok) {

            if (await handleAccountSuspended(response)) {
                return;
            }

            const errorText =
                await response.text();

            console.error(
                "Backend error:",
                errorText
            );

            throw new Error(
                "The chatbot server returned an error."
            );
        }


        const data =
            await response.json();


        addMessage(
            "Vic",
            data.message
        );


    } catch (error) {

        console.error(
            "Chat error:",
            error
        );

        addMessage(
            "Vic",
            "Sorry, something went wrong. Please try again."
        );


    } finally {

        sendButton.disabled =
            false;
    }
}


// ==============================
// BUTTON EVENTS
// ==============================

signUpButton.addEventListener(
    "click",
    signUp
);


loginButton.addEventListener(
    "click",
    login
);


logoutButton.addEventListener(
    "click",
    logout
);

forgotPasswordLink.addEventListener(
    "click",
    function(event) {
        event.preventDefault();
        showPasswordResetRequest();
    }
);

resetRequestForm.addEventListener(
    "submit",
    requestPasswordReset
);

backToLoginButton.addEventListener(
    "click",
    showAuth
);


newConversationButton.addEventListener(
    "click",
    startNewConversation
);


sendButton.addEventListener(
    "click",
    sendMessage
);


messageInput.addEventListener(
    "keydown",
    function(event) {

        if (
            event.key === "Enter"
        ) {

            sendMessage();
        }
    }
);


// ==============================
// START APPLICATION
// ==============================

checkSession();

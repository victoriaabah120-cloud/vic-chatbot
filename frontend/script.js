console.log("JavaScript is working");

const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const chat = document.getElementById("chat");

sendButton.addEventListener("click", sendMessage);

async function sendMessage() {
    const message = messageInput.value;

    if (message === "") {
        return;
    }

    messageInput.value = "";

    const response = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            conversation_id: conversationId,
            message: message
        })
    });

    const data = await response.json();

    chat.innerHTML += `<p class="user-message">You: ${message}</p>`;
    chat.innerHTML += `<p class="vic-message">Vic: ${data.message}</p>`;
}

let conversationId = null;

async function createConversation() {
    const response = await fetch("http://127.0.0.1:8000/conversation", {
        method: "POST"
    });

    const data = await response.json();

    conversationId = data.conversation_id;
}

createConversation();
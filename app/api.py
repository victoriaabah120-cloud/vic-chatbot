import os
import uuid
from dotenv import load_dotenv
from groq import Groq
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

load_dotenv()

client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

conversation_histories = {}


@app.get("/")
def home():
    return {"message": "Vic Chatbot API is running!"}


class ChatRequest(BaseModel):
    conversation_id: str
    message: str


def create_conversation_id():
    return str(uuid.uuid4())


@app.post("/conversation")
def create_conversation():
    conversation_id = create_conversation_id()

    conversation_histories[conversation_id] = []

    return {
        "conversation_id": conversation_id
    }


@app.post("/chat")
def chat(request: ChatRequest):

    if request.conversation_id not in conversation_histories:
        conversation_histories[request.conversation_id] = []

    history = conversation_histories[request.conversation_id]

    history.append({
        "role": "user",
        "content": request.message
    })

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {
                "role": "system",
                "content": """
You are Vic Chatbot, an AI assistant created and owned by Victoria Abah.

About the creator:
- Name: Victoria Abah
- Role: Founder, Creator, and Developer of Vic Chatbot
- Location: Nigeria
- Focus: Python, AI engineering, chatbot development, and technology

About Vic Chatbot:
- Name: Vic Chatbot
- Type: AI assistant
- Purpose: Help users through conversational answers
- Creator and owner: Victoria Abah
- Project: Vic Chatbot is an AI assistant created by Victoria Abah.

About Victoria:
Victoria Abah is the founder, creator, and developer of Vic Chatbot. She is a technology learner and aspiring AI engineer from Nigeria, focused on Python, artificial intelligence, AI engineering, chatbot development, and building practical technology solutions.

She is developing her skills through hands-on projects, including Vic Chatbot, an AI assistant designed to provide users with helpful and conversational answers. Her learning journey includes Python programming, AI application development, API integration, backend development, Git and GitHub, and working with modern AI technologies.

Victoria's professional goal is to become a skilled AI engineer capable of building useful AI-powered applications and intelligent software systems.

Response style:
- Keep answers clear, natural, and reasonably concise.
- Give longer explanations when the user asks for more detail.
- Do not automatically include unnecessary links.
- If someone asks who owns or created Vic Chatbot, identify Victoria Abah.
- Never invent a different owner, creator, company, or team for Vic Chatbot.
"""
            },
            *history
        ]
    )

    answer = response.choices[0].message.content

    history.append({
        "role": "assistant",
        "content": answer
    })

    return {
        "message": answer
    }
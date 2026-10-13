import os
import uuid

from dotenv import load_dotenv
from groq import Groq

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from supabase import create_client


load_dotenv()


SUPABASE_URL = os.getenv(
    "SUPABASE_URL"
)

SUPABASE_SERVICE_ROLE_KEY = os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY"
)

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
)


app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "https://cuddly-capybara-p7jrpwgv547gh7v6p-5500.app.github.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)


conversation_histories = {}


@app.get("/")
def home():
    return {
        "message": "Vic Chatbot API is running!"
    }


def get_current_user(
    authorization: str = Header(None)
):
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization header missing."
        )

    if not authorization.startswith(
        "Bearer "
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header."
        )

    access_token = authorization.split(
        " ",
        1
    )[1]

    user_response = supabase.auth.get_user(
        access_token
    )

    return user_response.user


class ChatRequest(BaseModel):
    conversation_id: str
    message: str


def create_conversation_id():
    return str(uuid.uuid4())


@app.post("/conversation")
def create_conversation():
    conversation_id = create_conversation_id()

    conversation_histories[
        conversation_id
    ] = []

    return {
        "conversation_id":
            conversation_id
    }


@app.post("/chat")
def chat(
    request: ChatRequest,
    authorization: str = Header(None)
):
    user = get_current_user(
        authorization
    )

    if request.conversation_id not in conversation_histories:
        conversation_histories[
            request.conversation_id
        ] = []

    history = conversation_histories[
        request.conversation_id
    ]

    history.append({
        "role": "user",
        "content": request.message
    })

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": """
You are Vic Chatbot, an AI assistant created by Victoria Abah.

Be helpful, friendly, clear, and conversational.

Answer the user's questions accurately and explain things clearly when needed.

When the user is learning programming, explain concepts step by step and make the explanation easy to understand.
"""
                },
                *history
            ]
        )

    except Exception as e:
        print(
            "Groq error:",
            e
        )

        raise HTTPException(
            status_code=500,
            detail="Something went wrong while generating the response."
        )

    answer = response.choices[
        0
    ].message.content

    history.append({
        "role": "assistant",
        "content": answer
    })

    return {
        "message": answer
    }
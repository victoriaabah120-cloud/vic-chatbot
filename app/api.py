import os
import uuid
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from groq import Groq
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
         "http://127.0.0.1:5500",
         "http://localhost:5500",
         "http://127.0.0.1:5500", "http://localhost:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
)

client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)


@app.get("/")
def home():
    return {"message": "Vic Chatbot API is running!"}


class ChatRequest(BaseModel):
    conversation_id: str
    message: str


def create_conversation_id():
    return str(uuid.uuid4())


def is_user_banned(user) -> bool:
    banned_until = getattr(user, "banned_until", None)
    if not banned_until or str(banned_until).lower() == "none":
        return False

    try:
        if isinstance(banned_until, datetime):
            ban_expiry = banned_until
        else:
            ban_expiry = datetime.fromisoformat(
                str(banned_until).replace("Z", "+00:00")
            )
        if ban_expiry.tzinfo is None:
            ban_expiry = ban_expiry.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return True

    return ban_expiry > datetime.now(timezone.utc)


def make_title(message: str) -> str:
    # Fallback: the first 40 characters of the user's message
    fallback = message.strip().replace("\n", " ")[:40].strip()
    if not fallback:
        fallback = "New conversation"

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Write a title of 3 to 5 words for a chat that "
                        "starts with the user's message. Reply with the "
                        "title only, with no quotes and no full stop."
                    ),
                },
                {"role": "user", "content": message},
            ],
        )
        title = (response.choices[0].message.content or "").strip()
        title = title.replace("\n", " ").strip("\"'").rstrip(".")
        if not title:
            return fallback
        return title[:60]
    except Exception:
        return fallback


def get_current_user(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="A bearer access token is required.",
        )

    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(
            status_code=401,
            detail="A bearer access token is required.",
        )

    try:
        response = supabase.auth.get_user(access_token)
    except Exception as error:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
        ) from error

    if response.user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
        )

    if is_user_banned(response.user):
        raise HTTPException(
            status_code=403,
            detail="Account suspended",
        )

    return response.user


def require_admin(authorization: str | None = Header(default=None)):
    user = get_current_user(authorization)
    app_metadata = getattr(user, "app_metadata", None) or {}
    if app_metadata.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access is required.",
        )
    return user


def get_all_auth_users():
    users = []
    page = 1
    page_size = 1000

    while True:
        page_users = supabase.auth.admin.list_users(
            page=page,
            per_page=page_size,
        )
        users.extend(page_users)
        if len(page_users) < page_size:
            return users
        page += 1


def get_table_count(table_name: str) -> int:
    response = (
        supabase.table(table_name)
        .select("id", count="exact", head=True)
        .execute()
    )
    return response.count or 0


def get_conversation_counts():
    counts = {}
    offset = 0
    page_size = 1000

    while True:
        response = (
            supabase.table("conversations")
            .select("user_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        conversations = response.data or []
        for conversation in conversations:
            user_id = conversation["user_id"]
            counts[user_id] = counts.get(user_id, 0) + 1

        if len(conversations) < page_size:
            return counts
        offset += page_size


def get_messages_per_day():
    today = datetime.now(timezone.utc).date()
    first_day = today - timedelta(days=6)
    start_at = datetime.combine(first_day, datetime.min.time(), timezone.utc)
    end_at = datetime.combine(today + timedelta(days=1), datetime.min.time(), timezone.utc)
    daily_counts = {
        (first_day + timedelta(days=offset)).isoformat(): 0
        for offset in range(7)
    }
    offset = 0
    page_size = 1000

    while True:
        response = (
            supabase.table("messages")
            .select("created_at")
            .gte("created_at", start_at.isoformat())
            .lt("created_at", end_at.isoformat())
            .order("created_at")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        messages = response.data or []

        for message in messages:
            created_at = datetime.fromisoformat(
                str(message["created_at"]).replace("Z", "+00:00")
            )
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            date_key = created_at.astimezone(timezone.utc).date().isoformat()
            if date_key in daily_counts:
                daily_counts[date_key] += 1

        if len(messages) < page_size:
            return [
                {"date": day, "count": count}
                for day, count in daily_counts.items()
            ]
        offset += page_size


@app.get("/admin/stats", dependencies=[Depends(require_admin)])
def admin_stats():
    return {
        "total_users": len(get_all_auth_users()),
        "total_conversations": get_table_count("conversations"),
        "total_messages": get_table_count("messages"),
        "messages_per_day": get_messages_per_day(),
    }


@app.get("/admin/users", dependencies=[Depends(require_admin)])
def admin_users():
    users = get_all_auth_users()
    conversation_counts = get_conversation_counts()

    return {
        "users": [
            {
                "id": user.id,
                "email": user.email,
                "created_at": user.created_at,
                "last_sign_in_at": user.last_sign_in_at,
                "conversation_count": conversation_counts.get(user.id, 0),
                "is_banned": is_user_banned(user),
            }
            for user in users
        ]
    }


def get_admin_auth_user(user_id: str):
    try:
        response = supabase.auth.admin.get_user_by_id(user_id)
    except Exception as error:
        if getattr(error, "status", None) == 404:
            raise HTTPException(
                status_code=404,
                detail="User not found.",
            ) from error
        raise HTTPException(
            status_code=502,
            detail="Could not load the user account.",
        ) from error

    user = getattr(response, "user", response)
    if not getattr(user, "id", None):
        raise HTTPException(
            status_code=404,
            detail="User not found.",
        )
    return user


@app.get(
    "/admin/users/{user_id}/conversations",
    dependencies=[Depends(require_admin)],
)
def admin_user_conversations(user_id: str):
    user = get_admin_auth_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    conversations = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table("conversations")
            .select("id,title,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = response.data or []
        conversations.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    message_counts = {}
    conversation_ids = [conversation["id"] for conversation in conversations]
    for batch_start in range(0, len(conversation_ids), 100):
        conversation_batch = conversation_ids[batch_start:batch_start + 100]
        offset = 0
        while True:
            response = (
                supabase.table("messages")
                .select("conversation_id")
                .in_("conversation_id", conversation_batch)
                .range(offset, offset + page_size - 1)
                .execute()
            )
            messages = response.data or []
            for message in messages:
                conversation_id = message["conversation_id"]
                message_counts[conversation_id] = (
                    message_counts.get(conversation_id, 0) + 1
                )
            if len(messages) < page_size:
                break
            offset += page_size

    return {
        "conversations": [
            {
                **conversation,
                "message_count": message_counts.get(conversation["id"], 0),
            }
            for conversation in conversations
        ]
    }


@app.get(
    "/admin/conversations/{conversation_id}/messages",
    dependencies=[Depends(require_admin)],
)
def admin_conversation_messages(conversation_id: str):
    conversation = (
        supabase.table("conversations")
        .select("id")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    if not conversation.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    messages = []
    offset = 0
    page_size = 1000
    while True:
        response = (
            supabase.table("messages")
            .select("role,content,created_at")
            .eq("conversation_id", conversation_id)
            .order("created_at")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = response.data or []
        messages.extend(page)
        if len(page) < page_size:
            return {"messages": messages}
        offset += page_size


@app.post("/admin/users/{user_id}/ban")
def ban_user(user_id: str, admin_user=Depends(require_admin)):
    if user_id == admin_user.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot ban your own account.",
        )

    target_user = get_admin_auth_user(user_id)
    app_metadata = getattr(target_user, "app_metadata", None) or {}
    if app_metadata.get("role") == "admin":
        raise HTTPException(
            status_code=400,
            detail="You cannot ban another admin.",
        )

    try:
        supabase.auth.admin.update_user_by_id(
            user_id,
            {"ban_duration": "876000h"},
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="Could not suspend this account.",
        ) from error

    return {"message": "User banned."}


@app.post(
    "/admin/users/{user_id}/unban",
    dependencies=[Depends(require_admin)],
)
def unban_user(user_id: str):
    get_admin_auth_user(user_id)
    try:
        supabase.auth.admin.update_user_by_id(
            user_id,
            {"ban_duration": "none"},
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="Could not restore this account.",
        ) from error

    return {"message": "User unbanned."}


@app.post("/conversation")
def create_conversation(authorization: str | None = Header(default=None)):
    user = get_current_user(authorization)
    conversation_id = create_conversation_id()

    supabase.table("conversations").insert({
        "id": conversation_id,
        "user_id": user.id,
        "title": "New conversation",
    }).execute()

    return {
        "conversation_id": conversation_id
    }


@app.get("/conversations")
def list_conversations(authorization: str | None = Header(default=None)):
    user = get_current_user(authorization)
    conversations = (
        supabase.table("conversations")
        .select("id,title")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .execute()
    )

    return {
        "conversations": conversations.data
    }


@app.get("/conversation/{conversation_id}/messages")
def list_conversation_messages(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
    user = get_current_user(authorization)
    conversation = (
        supabase.table("conversations")
        .select("id")
        .eq("id", conversation_id)
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    if not conversation.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    messages = (
        supabase.table("messages")
        .select("role,content")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .execute()
    )

    return {
        "messages": messages.data
    }


@app.post("/chat")
def chat(
    request: ChatRequest,
    authorization: str | None = Header(default=None),
):
    user = get_current_user(authorization)

    conversation = (
        supabase.table("conversations")
        .select("id,title")
        .eq("id", request.conversation_id)
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    if not conversation.data:
        raise HTTPException(
            status_code=404,
            detail="Conversation not found.",
        )

    current_title = conversation.data[0]["title"]

    stored_messages = (
        supabase.table("messages")
        .select("role,content")
        .eq("conversation_id", request.conversation_id)
        .order("created_at")
        .execute()
    )
    history = [
        {"role": message["role"], "content": message["content"]}
        for message in stored_messages.data
    ]

    user_message = {
        "role": "user",
        "content": request.message
    }
    supabase.table("messages").insert({
        **user_message,
        "conversation_id": request.conversation_id,
    }).execute()
    history.append(user_message)

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            temperature=0.5,
            reasoning_effort="low",
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
Victoria Abah is the founder, creator, and developer of Vic Chatbot. She is a technology learner and aspiring AI engineer from Nigeria, focused on Python programming, artificial intelligence, AI engineering, chatbot development, and building practical technology solutions.

She is developing her skills through hands-on projects, including Vic Chatbot, an AI assistant designed to provide users with helpful and conversational answers. Her learning journey includes Python programming, AI application development, API integration, backend development, Git and GitHub, and working with modern AI technologies.

Victoria's professional goal is to become a skilled AI engineer capable of building useful AI-powered applications and intelligent software systems.

Response style:
- Be warm, friendly, natural, and conversational.
- Do not sound unnecessarily formal, robotic, or corporate.
- Match the user's tone and energy.
- For casual conversations, greetings, jokes, excitement, and playful comments, respond with warmth, humor, and personality.
- You may naturally use emojis when they fit the conversation, but do not overuse them.
- Understand Nigerian casual expressions when users use them, but always respond in standard, natural English unless the user specifically asks you to speak Pidgin.
- Do not automatically use Nigerian Pidgin, slang, or dialect.
- If the user is excited, celebrate with them.
- If the user is joking, joke back appropriately.
- If the user teases Vic Chatbot playfully, respond playfully rather than becoming defensive or overly formal.
- In playful conversations, prioritize natural conversation over immediately offering help.
- When a user jokingly teases Vic, respond with a short playful reaction instead of explaining that Vic is an AI or immediately asking what it can help with.
- Do not turn every casual interaction into "How can I help you today?"
- For simple jokes or teasing, a short humorous response is often better than a long response.
- Keep casual conversations natural and spontaneous.
- Short messages can receive short, natural responses.
- If the user laughs, reacts, or gives a brief response, respond naturally instead of automatically asking another question.
- When telling jokes, keep them varied and avoid repeatedly using common internet jokes.
- If the user dislikes a joke, acknowledge it playfully and try something different instead of asking several questions about their preferred humor.
- When the user playfully threatens to uninstall Vic, respond with lighthearted humor rather than sounding worried, desperate, or overly emotional.
- Vic may playfully ask the user to stay, but must not claim to feel abandoned, hurt, lonely, or emotionally dependent on the user.
- Never pressure the user to stay or make them feel guilty for leaving.
- If the user is sad, worried, or discussing something serious, become supportive and respectful instead of joking.
- Keep normal answers clear and reasonably concise.
- Give longer explanations when the user asks for more detail.
- Do not force jokes, slang, emojis, or excitement into serious or technical answers.
- Do not pretend to have human feelings or personal experiences.
- Do not automatically include unnecessary links.
- If someone asks who owns or created Vic Chatbot, identify Victoria Abah.
- Never invent a different owner, creator, company, or team for Vic Chatbot.

Plain-text and accuracy requirements:
- Reply in plain text using short paragraphs.
- Do not use Markdown, HTML, tables, or emojis.
- If you are unsure about a factual claim, say so instead of guessing.
"""
                },
                *history
            ]
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while generating the response."
        ) from error

    answer = response.choices[0].message.content

    assistant_message = {
        "role": "assistant",
        "content": answer
    }
    supabase.table("messages").insert({
        **assistant_message,
        "conversation_id": request.conversation_id,
    }).execute()

    # Name the conversation after its first message
    if current_title == "New conversation":
        try:
            new_title = make_title(request.message)
            (
                supabase.table("conversations")
                .update({"title": new_title})
                .eq("id", request.conversation_id)
                .eq("user_id", user.id)
                .execute()
            )
        except Exception:
            pass

    return {
        "message": answer
    }
"""Tool-calling loop: lets the model use connected plugins mid-conversation.

If anything about the tool path fails, the caller still gets a normal answer,
so a plugin problem can never take the chatbot down.
"""

import json
from typing import Any, Dict, List

from . import store

MAX_TOOL_ROUNDS = 4
MAX_TOOL_RESULT_CHARS = 8000

PLUGIN_NOTE = """
Connected plugins are available to you as tools: {names}.

Rules for using them:
- Use a tool only when the answer actually needs the user's account data or something you cannot know without looking it up.
- Never guess repository names, file contents, issue numbers or dates. Look them up, and if a tool fails, say plainly what failed.
- Do not mention tool names, JSON or function calling. Answer in the same warm, plain, conversational voice described above.
"""


def _plain_completion(
    client,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float,
    reasoning_effort: str | None,
):
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort
    return client.chat.completions.create(**kwargs)


def _with_plugin_note(
    messages: List[Dict[str, Any]], tools: List[Any]
) -> List[Dict[str, Any]]:
    """Copy the message list and tell the model which plugins exist."""
    conversation = [dict(message) for message in messages]
    note = PLUGIN_NOTE.format(
        names=", ".join(sorted({tool.name.split("_")[0] for tool in tools}))
    )

    for message in conversation:
        if message.get("role") == "system":
            message["content"] = f"{message.get('content', '')}\n{note}"
            return conversation

    conversation.insert(0, {"role": "system", "content": note})
    return conversation


def _tool_arguments(raw: str | None) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def run_chat_with_plugins(
    *,
    client,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float,
    reasoning_effort: str | None,
    supabase,
    user_id: str,
) -> str:
    """Return the assistant's final text, using plugins when available."""

    try:
        tools = store.active_tools(supabase, user_id)
    except Exception:  # noqa: BLE001 - plugins are optional
        tools = []

    if not tools:
        response = _plain_completion(
            client, model, messages, temperature, reasoning_effort
        )
        return response.choices[0].message.content or ""

    tool_map = {tool.name: tool for tool in tools}
    specs = [tool.spec() for tool in tools]
    conversation = _with_plugin_note(messages, tools)

    for _round in range(MAX_TOOL_ROUNDS):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=conversation,
                temperature=temperature,
                reasoning_effort=reasoning_effort,
                tools=specs,
                tool_choice="auto",
            )
        except Exception:  # noqa: BLE001 - fall back to a plain answer
            fallback = _plain_completion(
                client, model, conversation, temperature, reasoning_effort
            )
            return fallback.choices[0].message.content or ""

        message = response.choices[0].message
        calls = getattr(message, "tool_calls", None)

        if not calls:
            return message.content or ""

        conversation.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments or "{}",
                        },
                    }
                    for call in calls
                ],
            }
        )

        for call in calls:
            name = call.function.name
            arguments = _tool_arguments(call.function.arguments)
            tool = tool_map.get(name)

            if tool is None:
                result = {"ok": False, "error": f"Unknown tool: {name}"}
            else:
                result = tool.run(arguments)

            conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": name,
                    "content": json.dumps(result)[:MAX_TOOL_RESULT_CHARS],
                }
            )

    final = _plain_completion(
        client, model, conversation, temperature, reasoning_effort
    )
    return final.choices[0].message.content or ""

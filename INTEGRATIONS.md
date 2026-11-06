# Plugins

Vic Chatbot can act on a user's connected accounts. Each provider plugs into
the same layer, so adding the next service is one file plus one registry line.

GitHub (OAuth) and Telegram (bot) are implemented. Google Calendar and
WhatsApp reuse the same slots (see the roadmap at the bottom).

## How it works

```
frontend/integrations.html      Plugins screen: connect, switch off, disconnect
frontend/integrations.js        Talks to the backend with the user's token

app/integrations/router.py      /integrations endpoints and the OAuth callback
app/integrations/crypto.py      Encrypts tokens, signs the OAuth state
app/integrations/store.py       Reads and writes the integrations tables
app/integrations/agent.py       Tool-calling loop used by /chat
app/integrations/registry.py    The provider catalogue
app/integrations/providers/     One module per service (github.py today)
```

Two connection styles share one interface: `auth="oauth2"` providers redirect to
the service, `auth="bot"` providers (Telegram) link a chat through a one-time
deep link. The router, storage, UI and chat loop are identical for both.

When a user sends a chat message, `/chat` calls `run_chat_with_plugins`. If that
user has no enabled plugins it makes exactly the same Groq call as before. If
they do, the model is offered those tools and may call them; results go back to
the model and the final answer is stored as usual.

A plugin problem can never break the chat: if the tool call itself fails, the
code falls back to a plain completion.

## Setup

### 1. Create the table

Run `app/integrations/schema.sql` in the Supabase SQL editor.

### 2. Generate an encryption key

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3. Create a GitHub OAuth app

<https://github.com/settings/developers> -> New OAuth App

- Application name: Vic Chatbot
- Homepage URL: `https://vic-chatbot-frontend.onrender.com`
- Authorization callback URL:
  `https://vic-chatbot-3.onrender.com/integrations/github/callback`

Copy the client ID, then generate a client secret.

### 4. Set the backend environment

| Variable | Value |
| --- | --- |
| `PLUGIN_ENCRYPTION_KEY` | the key from step 2 |
| `GITHUB_CLIENT_ID` | from step 3 |
| `GITHUB_CLIENT_SECRET` | from step 3 |
| `FRONTEND_URL` | `https://vic-chatbot-frontend.onrender.com` |
| `INTEGRATION_REDIRECT_BASE` | `https://vic-chatbot-3.onrender.com` |

`INTEGRATION_REDIRECT_BASE` must match the callback URL in step 3 exactly, and
must be https in production.

Redeploy after saving the variables.

## Using it

1. Log in, open **Plugins** in the sidebar.
2. Connect GitHub, approve the scopes.
3. Ask in the chat: "what did I push last?" or "read app/api.py in vic-chatbot".

### Telegram setup

Telegram has no per-user OAuth. One bot serves the app, and each user links
their own chat with a one-time code.

1. Open [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
   Note the bot's username too, without the `@`.
2. Set these variables on the backend and redeploy:

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_BOT_USERNAME` | the bot username, e.g. `VicChatBot` |
| `TELEGRAM_WEBHOOK_SECRET` | any long random string |

3. Point the bot at your server, once, as an admin:

```bash
curl -X POST https://vic-chatbot-3.onrender.com/integrations/telegram/register-webhook \
  -H "Authorization: Bearer <your admin access token>"
```

That calls `setWebhook` with your `TELEGRAM_WEBHOOK_SECRET`, so the webhook
rejects any request that does not carry it.

### How Telegram linking works

1. User presses **Connect** on the Plugins page.
2. The backend creates a single-use code that expires in 15 minutes and returns
   `https://t.me/<bot>?start=<code>`.
3. The user presses Start. Telegram calls the webhook with `/start <code>`.
4. The webhook checks the secret header, burns the code, and stores the chat id
   for that user.

Codes live in `integration_link_codes` and are marked used on first success, so
a leaked link cannot be replayed.

### Telegram tools available to the model

| Tool | Purpose |
| --- | --- |
| `telegram_send_message` | send a message to the user's linked chat (write) |

### GitHub tools available to the model

| Tool | Purpose |
| --- | --- |
| `github_list_repos` | repositories, most recently updated first |
| `github_read_file` | read a file or list a directory |
| `github_search_code` | code search across the account |
| `github_list_issues` | issues in a repo |
| `github_create_issue` | open an issue (write) |

Write actions are marked `write=True` on the tool and the prompt tells the model
to use them only when the user clearly asks.

## Security notes

- Tokens are encrypted with Fernet before they reach the database.
- The OAuth `state` is HMAC signed and expires after 15 minutes, so a callback
  cannot be replayed or pointed at another account.
- The API never returns a token to the browser.
- Row level security on `integrations` lets a user read and delete only their own
  rows; there is deliberately no insert or update policy, so only the backend can
  write tokens.
- Tokens are still usable by the backend with the service role key, so
  `PLUGIN_ENCRYPTION_KEY` belongs in the environment, never in the repo.

## Adding the next provider

1. Create `app/integrations/providers/<name>.py` subclassing `Provider`.
2. Implement `is_configured`, `build_authorize_url`, `exchange_code`,
   `fetch_account_label` and `tools`.
3. Register it in `app/integrations/registry.py`.
4. Add its env vars to `render.yaml` or the Render dashboard.

Nothing else changes: the router, storage, UI and chat loop are generic.

### Roadmap

| Service | Auth | Effort |
| --- | --- | --- |
| Google Calendar | Google Cloud OAuth client, refresh tokens | Medium |
| WhatsApp | Meta Cloud API, business account, webhook | Large |

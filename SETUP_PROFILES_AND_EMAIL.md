# Profiles, themes and Brevo email

Everything in this document is additive. Authentication, the chat, image
generation and the plugin layer are untouched; the only edits to existing files
are a few lines in `script.js` (two hook calls and exposing the Supabase client),
markup in `app.html`, and new rules at the end of `style.css` / `auth.css`.

## 1. Files

New:

| File | Purpose |
| --- | --- |
| `frontend/theme.js` | Dark/light switching, saved in `localStorage` under `vic-theme`. |
| `frontend/profile.js` | Display name, initials avatar, welcome card, profile row, announcement opt-in. |
| `app/sql/profiles_and_announcements.sql` | Profiles, RLS, signup trigger, email preferences, announcement log. |
| `app/announcements.py` | Admin-only Brevo announcement sender + one-click unsubscribe. |

Changed:

| File | Change |
| --- | --- |
| `frontend/app.html` | Profile card and edit form in the sidebar, personal welcome card in the header, theme toggles (sidebar, header, sign-in), theme boot script, new module tags. |
| `frontend/script.js` | `window.vicSupabase = supabaseClient`; `vicProfile.load(session)` in `showChat`, `vicProfile.clear()` in `showAuth`. |
| `frontend/style.css` | Light theme tokens plus `.profile-*`, `.theme-toggle` and light-mode surface overrides. |
| `frontend/auth.css` | Sign-in toggle, light sign-in card. |
| `frontend/admin.html`, `frontend/admin.js` | Announcements panel that posts to the backend. |
| `frontend/reset.html`, `frontend/integrations.html`, `frontend/admin.html` | Theme boot script + `theme.js`. |
| `app/api.py` | Mounts the announcements router. |

## 2. Supabase

### 2.1 Run the migration

Dashboard → SQL → New query → paste `app/sql/profiles_and_announcements.sql` → Run.
It is idempotent, so running it twice is safe. It creates:

- `profiles` — one row per user, `id` references `auth.users`, RLS on, policies
  limited to `auth.uid() = id` for select/insert/update. There is no role or
  privilege column, so a profile update can never change admin rights.
- `handle_new_user()` + trigger on `auth.users` — every new signup gets a profile.
- A backfill `insert ... select` for accounts that existed before the migration.
- `email_preferences` — announcements on/off plus the unsubscribe token.
- `announcement_log` — one row per recipient per campaign, service-role only.

### 2.2 Verify RLS

```sql
-- As user A, this returns one row; as user B it returns nothing.
select * from public.profiles;
-- Attempting another user's row fails with no rows updated.
update public.profiles set display_name = 'x' where id <> auth.uid();
```

### 2.3 Auth SMTP through Brevo

Authentication mail (confirm signup, reset password, email change, magic links,
invites) is sent by Supabase Auth, not by the app.

1. Brevo → SMTP & API → SMTP → generate an **SMTP key**.
2. Brevo → Senders & Domains → authenticate your sending domain, then use an
   address on it (for example `hello@yourdomain.com`).
3. Supabase → Authentication → Emails → SMTP settings → enable custom SMTP:

| Field | Value |
| --- | --- |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | your Brevo SMTP login (usually the account email) |
| Password | the Brevo SMTP key |
| Sender email | the verified sender |
| Sender name | `Vic Chatbot` |

4. Authentication → URL configuration: Site URL
   `https://vic-chatbot-frontend.onrender.com`, and add
   `https://vic-chatbot-frontend.onrender.com/reset.html` to the redirect list.
   The reset flow already sends `redirectTo` to `/reset.html`.
5. Send a test: sign up with a new address and use Forgot password. Brevo →
   Transactional → Logs shows the delivery.

SMTP credentials live only in the Supabase dashboard. Nothing is in frontend code.

## 3. Render

### 3.1 Environment variables (backend service)

| Variable | Required | Notes |
| --- | --- | --- |
| `BREVO_API_KEY` | yes, for announcements | Brevo → SMTP & API → API keys. Server only. |
| `BREVO_SENDER_EMAIL` | yes | Must be a verified Brevo sender. |
| `BREVO_SENDER_NAME` | no | Defaults to `Vic Chatbot`. |
| `BREVO_DAILY_LIMIT` | no | Defaults to 300; keeps sends inside the plan. |
| `BACKEND_PUBLIC_URL` | yes, for unsubscribe | For example `https://vic-chatbot-56hw.onrender.com`. |

Existing variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`,
Cloudflare keys) stay as they are. Redeploy the backend after adding them.

### 3.2 Static site

No new build step. The frontend is served as-is; the new files are plain
ES modules. Bump the query string when you edit CSS or JS so caches refresh
(`style.css?v=29`, `script.js?v=17`, `theme.js?v=1`, `profile.js?v=1`).

## 4. Sending an announcement

Admin dashboard → Announcements:

1. **Campaign key** — unique per campaign, e.g. `november-release-notes`. The
   same key never mails the same person twice.
2. **Subject** and **Message** (HTML allowed).
3. Leave **Dry run** checked the first time to see how many recipients qualify.
4. Uncheck it and send.

Or from a terminal:

```bash
TOKEN="<a signed-in admin access token>"
curl -X POST https://vic-chatbot-56hw.onrender.com/announcements/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"november-release-notes","subject":"New in Vic","html":"<p>Hello!</p>","dry_run":true}'
```

Behaviour:

- One Brevo request per recipient, so nobody sees another address.
- Skips unconfirmed addresses, opted-out accounts and anyone already logged for
  that campaign key.
- Adds a `List-Unsubscribe` header plus a footer link to
  `/announcements/unsubscribe?token=...`, which turns announcements off without
  a login. Account mail (resets, confirmations) is unaffected.
- Logs every send and failure in `announcement_log`; failures are returned in the
  response and visible in Brevo's log.

## 5. Testing

| # | Check | How |
| --- | --- | --- |
| 1 | New registration | Sign up; a row appears in `profiles` and `email_preferences`. |
| 2 | Existing login | Sign in; the chat opens as before. |
| 3 | Name detection | Account with `full_name` in metadata shows it; without metadata the email local part is used. |
| 4 | Name formatting | `victoria.abah@…` → "Victoria Abah"; `MICHAEL` → "Michael". |
| 5 | Initials | Victoria Abah → VA, John David → JD, Michael → MI. |
| 6 | Profile update | Pencil in the sidebar, change the name, Save; greeting and avatar update everywhere and survive a reload. |
| 7 | Dark mode | Default on first visit; moon icon in the toggle. |
| 8 | Light mode | Toggle shows the sun icon, white cards, violet accents, contrast 16:1 on body text. |
| 9 | Persistence | Reload after switching; no flash of the wrong theme. |
| 10 | Password reset | Forgot password → Brevo log shows the mail → `/reset.html` completes the change. |
| 11 | Confirmation mail | Sign up a new address; the confirmation arrives from your verified sender. |
| 12 | Announcements | Dry run, then a real send; check `announcement_log` and one inbox. |
| 13 | Mobile | 390px: profile card in the drawer, welcome card in the header, both toggles reachable, no horizontal scroll. |
| 14 | Chat intact | Send a message, create an image, attach a file, use the mic; plugins page still loads. |

## 6. Notes and limits

- Announcements only go to addresses that Supabase marks as confirmed, which is
  what keeps bounce rates low.
- The Brevo plan's daily cap still applies; `BREVO_DAILY_LIMIT` is a second
  ceiling the app enforces itself.
- Profiles are display data only. Roles stay in `auth.users.app_metadata`, which
  no client can write.
- The landing page keeps its cinematic dark hero in both themes; the theme
  toggle belongs to the app and the sign-in screen.

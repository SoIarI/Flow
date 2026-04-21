# Pulra Lead Tracker — Setup Guide

## What you're building

```
tracker.html (GitHub)
      │
      ├── reads/writes ──▶ Supabase (database + auth + realtime)
      │
      └── triggers ──────▶ Edge Function ──▶ Telegram group
```

No server. No hosting fees. Free on all tiers for your team size.

---

## Step 1 — GitHub Repository

1. Go to https://github.com and create a new **private** repository
   - Name: `pulra-leads`
   - Private ✓

2. Upload these files:
   ```
   tracker.html
   version.json
   ```

3. In `version.json`, put:
   ```json
   { "version": "2.0.0", "notes": "Initial release" }
   ```

4. Open `tracker.html` and find this line near the top of the JS:
   ```js
   const VERSION_URL = 'https://raw.githubusercontent.com/YOUR_USERNAME/pulra-leads/main/version.json';
   ```
   Replace `YOUR_USERNAME` with your actual GitHub username.

5. **Sharing the file with your team:**
   - Go to the file in GitHub → click "Raw" → copy that URL
   - Or use jsDelivr: `https://cdn.jsdelivr.net/gh/YOUR_USERNAME/pulra-leads@main/tracker.html`
   - Each team member bookmarks this URL. When you push an update, they reload and get it.

> **Note for private repos:** Raw GitHub URLs for private repos require a GitHub token.
> Easiest workaround: make just the `tracker.html` accessible, or use a GitHub Pages site (free).
> Alternatively, share the file directly via WhatsApp/Telegram for now — it works offline too.

---

## Step 2 — Supabase Project

1. Go to https://supabase.com → New project
   - Name: `pulra-leads`
   - Choose a region close to you (Singapore or Mumbai for Maldives)
   - Set a strong database password (save it)

2. Once the project is ready, go to **SQL Editor** (left sidebar)

3. Copy the entire contents of `supabase/schema.sql` and paste it in → Run

4. Go to **Settings → API**:
   - Copy the **Project URL** (looks like `https://xxxx.supabase.co`)
   - Copy the **anon public** key (long JWT string)

5. These two values are what team members enter on first launch of the tracker.

---

## Step 3 — Create Team Members

1. In Supabase dashboard → **Authentication → Users → Invite user**
2. Enter each team member's email
3. They get an email with a link to set their password
4. That's their login for the tracker

> You can also go to **Authentication → Users → Add user** to create accounts manually and share credentials directly.

---

## Step 4 — Telegram Bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot`
3. Follow the prompts — give it a name like `Pulra Leads` and a username like `pulra_leads_bot`
4. BotFather gives you a **token** — copy it (looks like `123456789:ABC-DEF...`)

5. Create a Telegram group for your team (or use an existing one)
6. Add the bot to the group
7. Get the group's Chat ID:
   - Send a message in the group
   - Visit: `https://api.telegram.org/botYOUR_TOKEN/getUpdates`
   - Find `"chat":{"id":` — the number (often negative, like `-1001234567890`) is your Chat ID

---

## Step 5 — Deploy the Edge Function

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Login and link your project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
   (Project ref is in your Supabase URL: `https://YOUR_PROJECT_REF.supabase.co`)

3. Set the secrets:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=your_token_here
   supabase secrets set TELEGRAM_CHAT_ID=your_chat_id_here
   ```

4. Deploy the function:
   ```bash
   supabase functions deploy notify
   ```

5. Set up the database webhook to call the function:
   - In Supabase dashboard → **Database → Webhooks → Create webhook**
   - Name: `notify-on-change`
   - Table: `leads` → Events: Insert, Update
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify`
   - Add header: `Authorization: Bearer YOUR_ANON_KEY`
   - Repeat for `tickets` and `interactions` tables

---

## Step 6 — First Launch

1. Open the tracker URL in your browser (or open the HTML file directly)
2. On first launch you'll see the **Setup screen** — enter:
   - Supabase Project URL
   - Supabase Anon Key
3. Click **Save & Connect**
4. Sign in with your email and password
5. Done — you're live

Share the URL + Supabase credentials with your team. Each person sets it up once on their device.

---

## Pushing Updates

When you add a new feature to `tracker.html`:

1. Test it locally
2. Update `version.json`:
   ```json
   { "version": "2.1.0", "notes": "Added bulk stage update" }
   ```
3. Push both files to GitHub:
   ```bash
   git add tracker.html version.json
   git commit -m "v2.1.0 — Added bulk stage update"
   git push
   ```
4. Team members see a green banner: *"v2.1.0 available — Added bulk stage update"*
5. They click **Reload to update** — done in 2 seconds

---

## Architecture Summary

| What | Where | Cost |
|------|-------|------|
| Lead data, tickets, log | Supabase Postgres | Free (500MB) |
| Real-time sync | Supabase Realtime | Free (2 concurrent) |
| Team login | Supabase Auth | Free (50,000 MAU) |
| Telegram notifications | Supabase Edge Functions | Free (500K req/month) |
| File + version hosting | GitHub | Free |
| The app itself | Plain HTML, runs in browser | Free |

**Total monthly cost: $0**

---

## Troubleshooting

**"Connection failed" on setup screen**
- Double-check you copied the full URL including `https://`
- Make sure you used the `anon` key, not the `service_role` key

**Changes not syncing**
- Check Supabase → Realtime is enabled for your tables (Database → Replication)
- Try signing out and back in

**Telegram not sending**
- Verify the bot is in the group
- Check the Chat ID is negative (group IDs start with -100)
- Test manually: `https://api.telegram.org/botTOKEN/sendMessage?chat_id=CHATID&text=test`

**Team member can't log in**
- Check they received the invite email (check spam)
- In Supabase → Authentication → Users — confirm the email shows as confirmed

---

## Step 7 — Deploy the Bot (Guided Commands)

The bot gives your team a conversational interface to update the tracker from Telegram without opening the browser.

### Commands available

| Command | What it does |
|---------|-------------|
| `/newdeal` | Add a new lead with guided prompts |
| `/update` | Update stage, priority, notes, location, or follow-up on any deal |
| `/log` | Log a call, meeting, visit, email, or note |
| `/followup` | Set or update a follow-up date with quick-pick buttons |
| `/newticket` | Create a meeting, task, or any ticket on a deal |
| `/status` | View full status of a deal — tickets, log, stage |
| `/deals` | List all active deals |
| `/overdue` | List all overdue follow-ups |
| `/today` | See what's scheduled and due today |
| `/cancel` | Cancel the current operation |

### Add bot_sessions table

Run this in your Supabase SQL editor (you can append it after the original schema):

```sql
create table bot_sessions (
  chat_id    bigint primary key,
  state      text not null,
  data       jsonb default '{}',
  updated_at timestamptz default now()
);
alter table bot_sessions enable row level security;
create policy "open" on bot_sessions for all using (true) with check (true);
```

### Deploy the bot function

```bash
# Set required secrets (in addition to the ones already set)
supabase secrets set SUPABASE_URL=https://YOUR_REF.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Deploy
supabase functions deploy bot
```

> **Note:** The bot function uses the **service role key** (not the anon key) so it can write to the database without auth restrictions. Find it in Supabase → Settings → API → service_role. Keep this secret — never put it in the tracker.html file.

### Register the webhook with Telegram

Open this URL in your browser (replace the values):

```
https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_PROJECT_REF.supabase.co/functions/v1/bot
```

You should get: `{"ok":true,"result":true}`

That's it. The bot is live.

### Test it

1. Open your Telegram group or DM the bot
2. Send `/start`
3. The bot replies with the command list
4. Try `/newdeal` — it will guide you step by step with buttons

### How the guided flow works

Every command starts a **conversation session** stored in Supabase. The bot remembers where you are in the flow so you can just tap buttons or type short answers. Example:

```
You:  /newdeal
Bot:  What's the business name?
You:  The Sea Grill
Bot:  [Malé] [Hulhumalé] [Villimalé] [Other] [Skip]
You:  (tap Malé)
Bot:  [Restaurant] [Café] [Fast Food] ...
You:  (tap Restaurant)
Bot:  [🆕 New] [📞 Contacted] [👀 Interested] ...
You:  (tap Contacted)
Bot:  Any notes? [Skip]
You:  (tap Skip)
Bot:  ✅ Deal Created! The Sea Grill · Malé · Restaurant · Contacted
```

All changes sync instantly to the tracker on all devices.

### Session timeout

If someone starts a command and doesn't finish it, the session stays active. They can type `/cancel` at any time to clear it. Old sessions don't cause issues — they just sit in the `bot_sessions` table until the user interacts again.


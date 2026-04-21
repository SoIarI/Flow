# Pulra Lead Tracker

Internal sales lead tracker for the Pulra team.

## Files

| File | Purpose |
|------|---------|
| `tracker.html` | The app — open directly in any browser |
| `version.json` | Current version — bump this to push updates to the team |
| `supabase/schema.sql` | Run once in Supabase SQL editor to set up the database |
| `supabase/functions/notify/index.ts` | Edge Function for Telegram notifications |
| `docs/SETUP.md` | Full setup instructions |

## Quick update workflow

```bash
# Make your changes to tracker.html
# Bump version.json
git add tracker.html version.json
git commit -m "v2.x.x — what changed"
git push
# Team sees the update banner on next load
```

## Stack

- **Database + Auth + Realtime**: Supabase (free tier)
- **Notifications**: Telegram via Supabase Edge Functions
- **Hosting**: GitHub raw / jsDelivr
- **App**: Single HTML file, no framework, no build step

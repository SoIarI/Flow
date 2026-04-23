# Flow Lead Tracker — Project Context

## Overview
Single-file CRM for Flow's service-platform sales team. Tracks leads, contacts, tickets, onboarding, and interaction logs. Password-protected, multi-user (shared Supabase DB), realtime sync across browser tabs/users.

- **File**: `tracker.html` (~3100 lines, everything inline)
- **Deployed**: GitHub Pages → https://SoIarI.github.io/Flow/
- **Push to `main`** → auto-deploys in ~60 seconds

---

## Required DB Migration (run once in Supabase SQL editor)
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS onboarding_data jsonb DEFAULT '{}';
```
This stores Pulra + Flow onboarding details per lead as JSON.

---

## Stack
- Pure HTML/CSS/JS — no build step, no framework
- **Database**: Supabase (anon key, no row-level security assumed)
- **Realtime**: Supabase `postgres_changes` channel on all 4 tables
- **Auth**: simple password check (`APP_PASSWORD = 'Flow2024'`), stored in `localStorage`
- **Notifications**: direct Telegram Bot API calls from the browser (per-user bot token + chat ID)
- **SheetJS** (`xlsx@0.18.5` via CDN) — Excel import with column mapping

---

## CSS Variables

### Light theme (`:root`)
```css
--bg:#f5f4f0   --s1:#ffffff    --s2:#f0efe9   --s3:#e6e5de
--b1:rgba(0,0,0,0.07)  --b2:rgba(0,0,0,0.12)  --b3:rgba(0,0,0,0.22)
--t1:#1a1924   --t2:#6b6a7a    --t3:#a8a7b5
--accent:#5b6af0  --accent-h:#6b7af5  --accent-dim:rgba(91,106,240,0.10)
--danger:#dc4f4f  --warn:#b87716  --info:#3b7de8
--purple:#7c5ce8  --green:#18a775  --teal:#0c9688
--header-bg:rgba(245,244,240,0.92)
--r:8px  --rl:12px
```
Each color has a `-dim` counterpart (10% opacity version) for backgrounds.

### Dark theme (`[data-theme="dark"]` on `<html>`)
```css
--bg:#0f0e17   --s1:#161522   --s2:#1d1c2a   --s3:#252433
--b1:rgba(255,255,255,0.06)  --b2:rgba(255,255,255,0.10)  --b3:rgba(255,255,255,0.20)
--t1:#e8e7f2   --t2:#9796aa   --t3:#5c5b70
--header-bg:rgba(15,14,23,0.92)
```
Accent/status colors are shared between themes.

### Theme persistence
- `localStorage` key: `flow_theme` (`'light'` or `'dark'`)
- FOUC-prevention: inline `<script>` before body sets `data-theme` on `<html>` immediately
- Toggle button: `#themeToggleBtn` in header (☾ / ☀)
- Wave animation: canvas `#themeWaveCanvas` (fixed, z-index 9999, pointer-events none)

---

## Key JS Globals
```js
leads        // array — all lead objects in memory
sb           // Supabase client instance
currentUser  // { name: string } — display name only, no real auth
realtimeSub  // Supabase realtime channel ref
editId       // currently editing lead ID (null = new)
tickLeadId   // lead ID for open ticket modal
editTickId   // ticket ID being edited (null = new)
msgLeadId    // lead ID for open message modal (tg/wa/em)
ctcs         // contacts array being edited in lead modal
selectedLocs // array of location strings in lead modal
fuDate       // follow-up date string (YYYY-MM-DD) in lead modal
delMode      // delivery mode string in lead modal
drawerLeadId // currently open drawer lead ID
drawerTab    // 'tickets' or 'log'
fuPanelOpen  // boolean, follow-up panel state
currentView  // 'leads' | 'tickets' — active view mode
tvFilters    // { status, type, search } — tickets view filters
STAGES       // const array of all stage strings
_importHeaders // xlsx parsed header row
_importRawRows // xlsx parsed data rows (array of arrays)
```

---

## Lead Object (in-memory shape)
```js
{
  id,           // string (Supabase UUID)
  deal,         // business name
  loc,          // comma-separated locations e.g. "Malé, Hulhumalé"
  type,         // business type string
  branches,     // number of outlets string
  stage,        // "New"|"Contacted"|"Interested"|"Meeting Set"|"Negotiating"|"Closed"|"Lost"|"No Response"|"On Hold"
  priority,     // "Normal"|"High"|"Low"
  fuD,          // follow-up date YYYY-MM-DD
  fuR,          // follow-up required boolean
  soft,         // POS/software currently used
  del,          // current delivery app
  delMode,      // "none"|"ewity"|"self"
  notes,        // free text
  lc,           // last contact date YYYY-MM-DD
  em, wa, vb, cl, ip, // outreach booleans: email/whatsapp/viber/called/in-person
  createdAt, updatedAt, createdBy,
  contacts: [{ name, role, phone, email, tg, wa }],
  tickets: [{ id, type, status, title, date, time, assigned, priority, notes }],
  log: [{ id, type, text, date }],
  onboarding: {
    pulra: { assigned, status, notes },  // status: ''|'in_progress'|'completed'|'on_hold'
    flow:  { assigned, status, notes }
  }
}
```

---

## Supabase Tables & Column Mapping

### `leads`
| DB column | JS field |
|---|---|
| `id` | `id` |
| `deal` | `deal` |
| `loc` | `loc` |
| `type` | `type` |
| `branches` | `branches` |
| `stage` | `stage` |
| `priority` | `priority` |
| `fu_date` | `fuD` |
| `fu_required` | `fuR` |
| `soft` | `soft` |
| `del` | `del` |
| `del_mode` | `delMode` |
| `notes` | `notes` |
| `last_contact` | `lc` |
| `outreach_em` | `em` |
| `outreach_wa` | `wa` |
| `outreach_vb` | `vb` |
| `outreach_cl` | `cl` |
| `outreach_ip` | `ip` |
| `created_by` | `createdBy` |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |

### `contacts`
`lead_id, name, role, phone, email, telegram (→ tg), whatsapp (→ wa), sort_order`

### `tickets`
`lead_id, type, status, title, date, time, assigned_to (→ assigned), priority, notes, created_at`

Ticket types: `meeting | training | menu | onboarding | support | followup | demo | contract | installation | review | other`
Ticket statuses: `pending | scheduled | inprogress | completed | cancelled`

### `interactions`
`lead_id, type, text, created_at`

Log types: `note | call | meeting | email | whatsapp | visit | other`

---

## Key Functions

### Auth / Setup
- `isLoggedIn()` — checks `localStorage('flow_auth') === '1'`
- `doLogin()` / `doLogout()` — password check / clear + reload
- `checkConfig()` — shows config screen if no Supabase creds saved
- `saveConfig()` — validates + saves Supabase URL/key/name, calls `initAndLoad()`
- `initSupabase(url, key)` — creates `sb` client
- `init()` — entry point: checks login → checkConfig
- `initAndLoad()` — init Supabase → load data → setup realtime → check reminders

### Data / Sync
- `loadFromSupabase()` — fetches all 4 tables in parallel, maps to `leads[]`, calls `renderAll()`
- `mapLead(l, contacts, tickets, log)` — converts DB rows to in-memory lead object
- `saveLeadToSupabase(data, editId)` — upserts lead + deletes/re-inserts all contacts; fires stage-change notification
- `deleteLeadFromSupabase(id)` — deletes lead row
- `saveTicketToSupabase(leadId, editTickId, data)` — upserts ticket
- `deleteTicketFromSupabase(tickId)` / `updateTicketStatusSupabase(tickId, status)`
- `saveInteractionToSupabase(leadId, type, text)` — inserts log entry, updates last_contact
- `deleteInteractionFromSupabase(entryId)`
- `setupRealtime()` — subscribes to all table changes, calls `loadFromSupabase()` on any change

### Rendering
- `renderAll()` — filters leads by search/stage/fu/priority, builds card HTML, calls `renderStats()` + `checkReminders()`
- `renderStats()` — updates `#statsBar` counts
- `renderCtcList()` — re-renders contact cards inside lead modal
- `renderDrawer()` → `renderDrawerTickets()` + `renderDrawerLog()` + `updateDrawerCounts()`
- `renderFuList()` — builds follow-up panel items

### Lead Modal
- `openLeadModal(id=null)` — opens for new/edit, populates all fields, takes snapshot
- `closeLeadModal()` / `tryCloseLeadModal()` — checks dirty state, may show discard modal
- `saveLead()` — collects form, calls `saveLeadToSupabase`, sends new-lead notification
- `snapLeadForm()` / `isLeadDirty()` — dirty-check system to prevent accidental close

### Ticket Modal
- `openTicketModal(leadId, ticketId=null)` / `closeTicketModal()` / `tryCloseTicketModal()`
- `saveTicket()` — collects form, calls `saveTicketToSupabase`
- `onTicketTypeChange()` — updates date label based on ticket type

### Drawer (tickets + log)
- `openDrawer(leadId, tab='tickets')` — opens right-side drawer, locks body scroll
- `closeDrawer()` — closes, restores scroll
- `switchDrawerTab(tab)` — shows 'tickets' or 'log' pane
- `submitDrawerLog()` — posts new log entry (Ctrl+Enter shortcut)
- `deleteDrawerLog(entryId)` — removes log entry

### Follow-up Panel
- `checkReminders()` — counts overdue/today items, shows/hides `#remBar`
- `toggleFuPanel()` / `openFuPanel()` / `closeFuPanel()`
- `switchFuTab(tab)` — 'all'|'over'|'today'|'up'
- `markSeen(leadId)` / `getSeenIds()` — tracks which fu items user has acknowledged
- `scheduleDailyCheck()` / `runFollowUpCheck()` — fires once/day Telegram notification

### Outreach Modals
- `openTg(id)` / `sendTg()` / `closeTg()` — Telegram
- `openWa(id)` / `sendWa()` / `closeWa()` — WhatsApp
- `openEm(id)` / `sendEm()` / `closeEm()` — Email (mailto:)
- `buildMsg(id, type)` — builds outreach message template
- `buildCtcPicker(id, type, selFn)` — renders contact selector for message modals
- `updMsg(type)` — updates preview text
- `markContacted(leadId)` — sets last contact date to today

### Notifications (Telegram)
- `notify(triggerKey, text)` — sends if user has that trigger enabled
- `sendTelegramMsg(token, chat, text)` — raw Telegram Bot API call
- `loadNotifSettings()` / `saveNotifSettings()` — per-device settings
- Trigger keys: `new_lead | stage | fu_today | fu_over | ticket | ticket_status | meeting | log | closed`

### Google Calendar
- `addToGcal(leadId, tickId)` — builds a Google Calendar `render?action=TEMPLATE` URL from ticket data (title, date/time, notes, assigned, lead name, location) and opens in a new tab; no OAuth required. Button appears on tickets that have a date set, inside the drawer ticket card. Timed events default to 1-hour duration.
- `setDelMode(m)` / `loadDelMode(m)` — controls 3-way plan toggle: `none` / `ewity` (Starter) / `self` (Growth)

### Theme
- `initTheme()` — reads `localStorage('flow_theme')`, sets `data-theme`, updates button
- `toggleTheme()` — canvas wave animation (680ms) + theme switch at midpoint

### Utility
- `uid()` → `Date.now().toString(36) + random` (used client-side only)
- `todayS()` → `YYYY-MM-DD` string
- `diffD(d)` → days from today (negative = overdue)
- `fmtD(d)` → `"12 Jan 2025"` format
- `fmtDT(d, t)` → date + optional time string
- `esc(s)` → HTML escape
- `scls(stage)` → CSS class for stage badge
- `toast(msg, ms=2400)` → bottom toast notification
- `setSyncStatus(state, label)` — updates `#syncDot` and `#syncLbl`

### CSV / Excel Import
- `exportCSV()` — generates and downloads CSV of all leads
- `openImportModal()` / `confirmImport()` — bulk import from CSV (auto-mapped columns)
- `handleCSVFile(input)` / `handleCSVDrop(event)` — routes to CSV or XLSX processor
- `processXLSXFile(file)` — parses xlsx with SheetJS, opens mapping modal
- `openImportMap(filename, rowCount)` — shows column-mapping modal (auto-detects best matches)
- `confirmMappedImport()` — reads mapping selects, builds `_importRows`, calls `confirmImport()`
- `closeImportMap()` — returns to main import modal
- `splitCSVLine(line)` — handles quoted fields in CSV

### Stage Inline Change
- `quickChangeStage(leadId, stage)` — optimistic stage update + Supabase save + notification
- `toggleStageDropdown(event, leadId)` — show/hide stage picker on a card (closes others)
- `closeStageDropdown(leadId)` — hides the dropdown for a specific lead

### Onboarding
- `toggleObSection(platform)` — expand/collapse 'pulra' or 'flow' onboarding accordion
- `getOnboardingData()` → `{ pulra: {assigned,status,notes}, flow: {assigned,status,notes} }`
- `loadOnboardingData(ob)` — populates form fields; auto-opens sections that have data

### Tickets View (global)
- `setView(view)` — switches between 'leads' and 'tickets' views; manages toolbar visibility
- `applyTvFilters()` — reads tvStatus/tvType/tvSearch and re-renders
- `renderAllTickets()` — flat list of all tickets across all leads; sortable, filterable
- `cycleTicketStatusGlobal(leadId, tickId)` — cycles status then refreshes tickets view

---

## Constants & localStorage Keys
```js
CFG_KEY     = 'flow_cfg'      // { url, key, name }
AUTH_KEY    = 'flow_auth'     // '1' if logged in
NOTIF_KEY   = 'flow_notif_v1' // notification settings object
THEME_KEY   = 'flow_theme'    // 'light' | 'dark'
KEY         = 'flow_v4'       // legacy (unused, Supabase is source of truth)
APP_PASSWORD = 'Flow2024'
APP_VERSION  = '2.0.0'
// Also: 'flow_fu_seen', 'flow_fu_notif_YYYY-MM-DD' (daily check guard)
```

---

## DOM Structure

### Screens / Overlays (fixed, z-index layered)
| Element | ID | z-index |
|---|---|---|
| Login screen | `#loginScreen` | 600 |
| Config screen | `#configScreen` | 500 |
| Lead modal | `#leadOv` (`.overlay`) | 200 |
| Ticket modal | `#tickOv` (`.overlay`) | 200 |
| Discard modal | `#discardOv` | 200 |
| Import modal | `#importOv` | 200 |
| Telegram modal | `#tgOv` | 200 |
| WhatsApp modal | `#waOv` | 200 |
| Email modal | `#emOv` | 200 |
| Drawer overlay | `#drawerOverlay` | 120 |
| Drawer | `#drawer` | 130 |
| Follow-up panel | `#fuPanel` | 116 |
| Notif settings | `#notifPanel` | 140 |
| Theme wave canvas | `#themeWaveCanvas` | 9999 |
| Toast | `#toast` | 9999 |

### Main Layout (top to bottom)
1. `#updateBanner` — hidden by default, shown if new version available
2. `<header>` — sticky, 54px. Logo · sync status · user pill · theme toggle · settings · sign out
3. `#remBar` — follow-up reminder bar (hidden until overdue/today items exist)
4. `#fuPanel` — expandable follow-up review panel
5. `.toolbar` — sticky below header. New Lead · search · filters · export/import · clear DB
6. `#statsBar` — stat pills (Total / Active / Closed / Meetings / Overdue / No Response / Tickets)
7. `.main > #leadsGrid` — CSS grid of lead cards
8. `#emptyState` — shown when no leads match filters

### Lead Card Structure
```
.deal-group
  .card[data-id]           ← has classes: overdue / due-today / hipri / no-response
    .ctop                  ← deal name, contact sub, location tags, action buttons
      .cacts               ← .ib buttons: tg / wa / em / ed / del
    .cbody                 ← stage badge, contacts, POS, delivery, outreach pills, fu row, notes snip
  .card-footer             ← "Tickets" tab + "Log" tab
```

### Form Field IDs (Lead Modal)
`f_deal, f_loc, f_type_sel, f_type, f_branches, f_stage, f_pri, f_fuR, f_fuD, f_soft, f_del, f_delMode, f_em, f_wa, f_vb, f_cl, f_ip, f_lc, f_notes`

### Form Field IDs (Ticket Modal)
`t_type, t_status, t_title, t_date, t_time, t_assigned, t_pri, t_notes`

---

## CSS Patterns

### Button variants
- `.btn` — base
- `.btn.primary` — accent filled
- `.btn.ghost` — transparent with subtle border
- `.ib` — icon button (27×27px), used in card action row

### Status badges
- `.sbadge.s-new/s-contacted/s-interested/s-meeting/s-negotiating/s-closed/s-lost/s-noresponse/s-onhold`
- `.ts-badge.ts-pending/ts-scheduled/ts-inprogress/ts-completed/ts-cancelled` (tickets)

### Animations
- `@keyframes shake` — login error
- `@keyframes blink` — sync dot, reminder dot
- `@keyframes sr` — slide-right (notif panel open)
- `@keyframes up` — modal open (slide up)
- Canvas wave — JS-driven, `#themeWaveCanvas`

---

## Notification Defaults
```js
{
  token: '', chat: '',           // Telegram bot token + chat ID
  new_lead: true,                // New lead added
  stage: true,                   // Stage changed
  fu_today: true,                // Follow-ups due today (daily)
  fu_over: true,                 // Overdue follow-ups (daily)
  ticket: false,                 // Ticket created/updated
  ticket_status: false,          // Ticket status changed
  meeting: true,                 // Meeting ticket created
  log: false,                    // Call/visit logged
  closed: true,                  // Lead closed or lost
  include_notes: false,          // Append first 80 chars of notes
  include_who: true              // Append "👤 Name" to messages
}
```

---

## Business Context
- **Product**: Flow — service listing platform where businesses list their services, manage bookings and payments
- **Customers**: any service business (professional services, health, home services, education, events, transport, etc.)
- **Locations**: Malé, Hulhumalé, Villimalé (island-based, multi-location leads) — Maldives focused
- **Team**: small sales team, each member configures their own Telegram notifications
- **Plan tiers** (stored in `delMode` field): `none` = Not decided · `ewity` = Starter · `self` = Growth
- **Mobile**: responsive `@media (max-width: 660px)` — single-column grid, bottom-sheet modals, horizontal-scroll toolbar, `.ml-hide` / `.ml-show` utility classes collapse header labels

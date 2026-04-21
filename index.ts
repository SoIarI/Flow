// supabase/functions/bot/index.ts
// Pulra Lead Tracker — Telegram Bot with guided conversation flows
// Deploy: supabase functions deploy bot
// Register webhook: https://api.telegram.org/botTOKEN/setWebhook?url=https://YOUR_REF.supabase.co/functions/v1/bot

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── ENV ──────────────────────────────────────────────────────────────────────
const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── TELEGRAM API ─────────────────────────────────────────────────────────────
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method: string, body: object) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function send(chatId: number, text: string, extra: object = {}) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

async function edit(chatId: number, msgId: number, text: string, extra: object = {}) {
  return tg("editMessageText", { chat_id: chatId, message_id: msgId, text, parse_mode: "HTML", ...extra });
}

async function answer(callbackId: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: callbackId, text });
}

// Inline keyboard builder
function kb(rows: { text: string; data: string }[][]) {
  return {
    reply_markup: {
      inline_keyboard: rows.map(row =>
        row.map(btn => ({ text: btn.text, callback_data: btn.data }))
      ),
    },
  };
}

// ── SESSION STORE (Supabase bot_sessions table) ───────────────────────────────
async function getSession(chatId: number) {
  const { data } = await sb.from("bot_sessions").select("*").eq("chat_id", chatId).single();
  return data;
}

async function setSession(chatId: number, state: string, data: object = {}) {
  await sb.from("bot_sessions").upsert({ chat_id: chatId, state, data, updated_at: new Date().toISOString() });
}

async function clearSession(chatId: number) {
  await sb.from("bot_sessions").delete().eq("chat_id", chatId);
}

// ── DEAL LOOKUP (fuzzy) ───────────────────────────────────────────────────────
async function findDeal(query: string) {
  const { data } = await sb.from("leads")
    .select("id, deal, stage, loc, type, fu_date, fu_required, priority, notes")
    .ilike("deal", `%${query}%`)
    .order("updated_at", { ascending: false })
    .limit(5);
  return data || [];
}

async function getDeals(limit = 10, filter?: string) {
  let q = sb.from("leads").select("id, deal, stage, loc, type, priority, fu_date, fu_required, updated_at");
  if (filter === "active") q = q.not("stage", "in", '("Closed","Lost","No Response")');
  if (filter === "overdue") {
    const today = new Date().toISOString().split("T")[0];
    q = q.eq("fu_required", true).lt("fu_date", today).not("stage", "in", '("Closed","Lost")');
  }
  const { data } = await q.order("updated_at", { ascending: false }).limit(limit);
  return data || [];
}

// ── FORMATTERS ────────────────────────────────────────────────────────────────
const STAGE_EMOJI: Record<string, string> = {
  "New": "🆕", "Contacted": "📞", "Interested": "👀", "Meeting Set": "📅",
  "Negotiating": "🤝", "Closed": "✅", "Lost": "❌", "No Response": "🔇", "On Hold": "⏸",
};
const PRIORITY_EMOJI: Record<string, string> = { "High": "🔴", "Normal": "", "Low": "⚪" };

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDaysUntil(d: string) {
  if (!d) return "";
  const diff = Math.round((new Date(d).getTime() - Date.now()) / 86400000);
  if (diff < 0) return ` (⚠ ${Math.abs(diff)}d overdue)`;
  if (diff === 0) return " (due today)";
  return ` (in ${diff}d)`;
}

function fmtLead(l: any, verbose = false) {
  const e = STAGE_EMOJI[l.stage] || "◎";
  const p = PRIORITY_EMOJI[l.priority] || "";
  let s = `${p}${p ? " " : ""}<b>${l.deal}</b> ${e} ${l.stage}`;
  if (l.loc) s += `\n📍 ${l.loc}`;
  if (l.type) s += ` · ${l.type}`;
  if (verbose) {
    if (l.fu_required && l.fu_date) s += `\n⏰ Follow-up: ${fmtDate(l.fu_date)}${fmtDaysUntil(l.fu_date)}`;
    if (l.notes) s += `\n📝 "${l.notes.slice(0, 100)}${l.notes.length > 100 ? "…" : ""}"`;
  }
  return s;
}

// ── KEYBOARDS ─────────────────────────────────────────────────────────────────
const LOCATIONS_KB = kb([
  [{ text: "Malé", data: "loc:Male" }, { text: "Hulhumalé", data: "loc:Hulhumale" }, { text: "Villimalé", data: "loc:Villimale" }],
  [{ text: "Multiple", data: "loc:Multiple" }, { text: "Skip", data: "loc:skip" }, { text: "Other…", data: "loc:other" }],
]);

const TYPES_KB = kb([
  [{ text: "Restaurant", data: "type:Restaurant" }, { text: "Café", data: "type:Café" }, { text: "Fast Food", data: "type:Fast Food" }],
  [{ text: "Fine Dining", data: "type:Fine Dining" }, { text: "Supermarket", data: "type:Supermarket" }, { text: "Mini Mart", data: "type:Mini Mart" }],
  [{ text: "Hotel/Resort", data: "type:Hotel Restaurant" }, { text: "Guesthouse", data: "type:Guesthouse" }, { text: "Other…", data: "type:other" }],
  [{ text: "Skip", data: "type:skip" }],
]);

const STAGES_KB = kb([
  [{ text: "🆕 New", data: "stage:New" }, { text: "📞 Contacted", data: "stage:Contacted" }],
  [{ text: "👀 Interested", data: "stage:Interested" }, { text: "📅 Meeting Set", data: "stage:Meeting Set" }],
  [{ text: "🤝 Negotiating", data: "stage:Negotiating" }, { text: "✅ Closed", data: "stage:Closed" }],
  [{ text: "❌ Lost", data: "stage:Lost" }, { text: "🔇 No Response", data: "stage:No Response" }, { text: "⏸ On Hold", data: "stage:On Hold" }],
]);

const PRIORITY_KB = kb([
  [{ text: "🔴 High", data: "pri:High" }, { text: "Normal", data: "pri:Normal" }, { text: "⚪ Low", data: "pri:Low" }],
]);

const LOG_TYPES_KB = kb([
  [{ text: "📞 Call", data: "ltype:call" }, { text: "📅 Meeting", data: "ltype:meeting" }, { text: "🚶 Visit", data: "ltype:visit" }],
  [{ text: "✉ Email", data: "ltype:email" }, { text: "💬 WhatsApp", data: "ltype:whatsapp" }, { text: "📝 Note", data: "ltype:note" }],
]);

const TICKET_TYPES_KB = kb([
  [{ text: "📅 Meeting", data: "ttype:meeting" }, { text: "🎓 Training", data: "ttype:training" }, { text: "📋 Menu Update", data: "ttype:menu" }],
  [{ text: "🚀 Onboarding", data: "ttype:onboarding" }, { text: "🛠 Support", data: "ttype:support" }, { text: "📞 Follow-up Call", data: "ttype:followup" }],
  [{ text: "💻 Demo", data: "ttype:demo" }, { text: "📝 Contract", data: "ttype:contract" }, { text: "◎ Other", data: "ttype:other" }],
]);

const TICKET_STATUS_KB = kb([
  [{ text: "⏳ Pending", data: "tstatus:pending" }, { text: "📅 Scheduled", data: "tstatus:scheduled" }],
  [{ text: "🔄 In Progress", data: "tstatus:inprogress" }, { text: "✅ Completed", data: "tstatus:completed" }],
  [{ text: "❌ Cancelled", data: "tstatus:cancelled" }],
]);

const FOLLOWUP_KB = kb([
  [{ text: "Tomorrow", data: "fu:1" }, { text: "In 3 days", data: "fu:3" }, { text: "In 1 week", data: "fu:7" }],
  [{ text: "In 2 weeks", data: "fu:14" }, { text: "In 1 month", data: "fu:30" }, { text: "In 2 months", data: "fu:60" }],
  [{ text: "Custom date…", data: "fu:custom" }, { text: "Clear follow-up", data: "fu:clear" }],
]);

const SKIP_KB = kb([[{ text: "Skip", data: "skip:yes" }]]);
const CANCEL_KB = kb([[{ text: "❌ Cancel", data: "cancel:yes" }]]);

function dealListKb(deals: any[]) {
  const rows = deals.map(d => [{ text: `${STAGE_EMOJI[d.stage] || "◎"} ${d.deal}`, data: `pick:${d.id}` }]);
  rows.push([{ text: "❌ Cancel", data: "cancel:yes" }]);
  return kb(rows);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function parseDate(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (s === "today") return new Date().toISOString().split("T")[0];
  if (s === "tomorrow") return addDays(1);
  // Try DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD
  const patterns = [
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const [, a, b, c] = m;
      const iso = a.length === 4 ? `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}` : `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
      if (!isNaN(Date.parse(iso))) return iso;
    }
  }
  return null;
}

// ── COMMAND HANDLERS ──────────────────────────────────────────────────────────

// /start — help menu
async function cmdStart(chatId: number) {
  await clearSession(chatId);
  const text = `👋 <b>Pulra Lead Tracker Bot</b>

<b>Commands:</b>
/newdeal — Add a new lead
/update — Update a lead's stage, priority or notes
/log — Log an interaction (call, meeting, visit…)
/followup — Set or update a follow-up date
/newticket — Add a ticket/task to a deal
/status — View a deal's full status
/deals — List all active deals
/overdue — List overdue follow-ups
/today — What's due today
/cancel — Cancel current operation

Tap any command to get started.`;
  await send(chatId, text, CANCEL_KB);
}

// /newdeal
async function cmdNewDeal(chatId: number) {
  await setSession(chatId, "newdeal:name");
  await send(chatId, "🆕 <b>New Lead</b>\n\nWhat's the business name?", CANCEL_KB);
}

// /update
async function cmdUpdate(chatId: number) {
  const deals = await getDeals(10, "active");
  if (!deals.length) { await send(chatId, "No active deals found."); return; }
  await setSession(chatId, "update:pick");
  await send(chatId, "✏️ <b>Update Deal</b>\n\nWhich deal?", dealListKb(deals));
}

// /log
async function cmdLog(chatId: number) {
  const deals = await getDeals(10, "active");
  if (!deals.length) { await send(chatId, "No active deals found."); return; }
  await setSession(chatId, "log:pick");
  await send(chatId, "📝 <b>Log Interaction</b>\n\nWhich deal?", dealListKb(deals));
}

// /followup
async function cmdFollowup(chatId: number) {
  const deals = await getDeals(10, "active");
  if (!deals.length) { await send(chatId, "No active deals found."); return; }
  await setSession(chatId, "fu:pick");
  await send(chatId, "⏰ <b>Set Follow-up</b>\n\nWhich deal?", dealListKb(deals));
}

// /newticket
async function cmdNewTicket(chatId: number) {
  const deals = await getDeals(10, "active");
  if (!deals.length) { await send(chatId, "No active deals found."); return; }
  await setSession(chatId, "ticket:pick");
  await send(chatId, "🎫 <b>New Ticket</b>\n\nWhich deal?", dealListKb(deals));
}

// /status — search for a deal
async function cmdStatus(chatId: number) {
  await setSession(chatId, "status:search");
  await send(chatId, "🔍 <b>Deal Status</b>\n\nType part of the deal name:", CANCEL_KB);
}

// /deals
async function cmdDeals(chatId: number) {
  const deals = await getDeals(20, "active");
  if (!deals.length) { await send(chatId, "No active deals."); return; }
  const text = `📋 <b>Active Deals (${deals.length})</b>\n\n` +
    deals.map((d, i) => `${i + 1}. ${fmtLead(d)}`).join("\n\n");
  await send(chatId, text);
}

// /overdue
async function cmdOverdue(chatId: number) {
  const deals = await getDeals(20, "overdue");
  if (!deals.length) { await send(chatId, "✅ No overdue follow-ups!"); return; }
  const today = new Date().toISOString().split("T")[0];
  const text = `⚠️ <b>Overdue Follow-ups (${deals.length})</b>\n\n` +
    deals.map(d => `• <b>${d.deal}</b>${fmtDaysUntil(d.fu_date)}\n  ${STAGE_EMOJI[d.stage] || "◎"} ${d.stage}`).join("\n\n");
  await send(chatId, text);
}

// /today
async function cmdToday(chatId: number) {
  const today = new Date().toISOString().split("T")[0];
  const { data: dueToday } = await sb.from("leads")
    .select("id, deal, stage, loc, type, priority, fu_date")
    .eq("fu_required", true).eq("fu_date", today)
    .not("stage", "in", '("Closed","Lost")');
  const { data: meetings } = await sb.from("tickets")
    .select("id, title, type, time, assigned_to, lead_id")
    .eq("date", today).eq("status", "scheduled");

  let text = `📅 <b>Today — ${fmtDate(today)}</b>\n`;
  if (!dueToday?.length && !meetings?.length) {
    text += "\nNothing scheduled for today. 🎉";
  }
  if (dueToday?.length) {
    text += `\n<b>Follow-ups due:</b>\n` + dueToday.map(d => `• ${d.deal} · ${d.stage}`).join("\n");
  }
  if (meetings?.length) {
    text += `\n\n<b>Tickets today:</b>\n` + meetings.map(m => `• ${m.title || m.type}${m.time ? " @ " + m.time : ""}${m.assigned_to ? " — " + m.assigned_to : ""}`).join("\n");
  }
  await send(chatId, text);
}

// ── FLOW PROCESSOR (handles all states) ─────────────────────────────────────
async function processFlow(chatId: number, session: any, input: string, isCallback: boolean, callbackId?: string) {
  const state: string = session?.state || "";
  const data: any = session?.data || {};

  if (callbackId) await answer(callbackId);

  // ── CANCEL anywhere ──────────────────────────────────────────────────────
  if (input === "cancel:yes" || input === "/cancel") {
    await clearSession(chatId);
    await send(chatId, "❌ Cancelled. Use /start to see commands.");
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // NEW DEAL FLOW
  // ════════════════════════════════════════════════════════════════════════════
  if (state === "newdeal:name") {
    await setSession(chatId, "newdeal:loc", { name: input });
    await send(chatId, `📍 <b>Location?</b>`, LOCATIONS_KB);
    return;
  }

  if (state === "newdeal:loc") {
    const loc = input.replace("loc:", "") === "skip" ? "" : input.replace("loc:", "");
    if (loc === "other") {
      await setSession(chatId, "newdeal:loc_custom", data);
      await send(chatId, "Type the island name:", CANCEL_KB);
      return;
    }
    await setSession(chatId, "newdeal:type", { ...data, loc });
    await send(chatId, "🏪 <b>Business type?</b>", TYPES_KB);
    return;
  }

  if (state === "newdeal:loc_custom") {
    await setSession(chatId, "newdeal:type", { ...data, loc: input });
    await send(chatId, "🏪 <b>Business type?</b>", TYPES_KB);
    return;
  }

  if (state === "newdeal:type") {
    const type = input.replace("type:", "") === "skip" ? "" : input.replace("type:", "");
    if (type === "other") {
      await setSession(chatId, "newdeal:type_custom", data);
      await send(chatId, "Type the business type:", CANCEL_KB);
      return;
    }
    await setSession(chatId, "newdeal:stage", { ...data, type });
    await send(chatId, "📊 <b>Stage?</b>", STAGES_KB);
    return;
  }

  if (state === "newdeal:type_custom") {
    await setSession(chatId, "newdeal:stage", { ...data, type: input });
    await send(chatId, "📊 <b>Stage?</b>", STAGES_KB);
    return;
  }

  if (state === "newdeal:stage") {
    const stage = input.replace("stage:", "");
    await setSession(chatId, "newdeal:priority", { ...data, stage });
    await send(chatId, "🚦 <b>Priority?</b>", PRIORITY_KB);
    return;
  }

  if (state === "newdeal:priority") {
    const priority = input.replace("pri:", "");
    await setSession(chatId, "newdeal:notes", { ...data, priority });
    await send(chatId, "📝 <b>Any notes?</b> (optional)", kb([[{ text: "Skip", data: "skip:yes" }], [{ text: "❌ Cancel", data: "cancel:yes" }]]));
    return;
  }

  if (state === "newdeal:notes") {
    const notes = (input === "skip:yes" || input === "skip") ? "" : input;
    const d2 = { ...data, notes };

    // Save to Supabase
    const { data: lead, error } = await sb.from("leads").insert({
      deal: d2.name, loc: d2.loc || null, type: d2.type || null,
      stage: d2.stage, priority: d2.priority, notes: d2.notes || null,
      last_contact: new Date().toISOString().split("T")[0],
    }).select().single();

    await clearSession(chatId);
    if (error) { await send(chatId, `❌ Error: ${error.message}`); return; }

    await send(chatId, `✅ <b>Deal Created!</b>\n\n${fmtLead({ ...lead, ...d2 }, true)}\n\n💡 Use /followup to set a follow-up date, or /newticket to add a task.`);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UPDATE FLOW
  // ════════════════════════════════════════════════════════════════════════════
  if (state === "update:pick") {
    const leadId = input.replace("pick:", "");
    const { data: lead } = await sb.from("leads").select("*").eq("id", leadId).single();
    if (!lead) { await send(chatId, "Deal not found."); return; }
    await setSession(chatId, "update:what", { leadId, leadName: lead.deal });
    await send(chatId, `✏️ <b>${lead.deal}</b>\n\nWhat do you want to update?`,
      kb([
        [{ text: "📊 Stage", data: "what:stage" }, { text: "🚦 Priority", data: "what:priority" }],
        [{ text: "📝 Notes", data: "what:notes" }, { text: "⏰ Follow-up date", data: "what:followup" }],
        [{ text: "📍 Location", data: "what:loc" }, { text: "❌ Cancel", data: "cancel:yes" }],
      ])
    );
    return;
  }

  if (state === "update:what") {
    const what = input.replace("what:", "");
    await setSession(chatId, `update:${what}`, data);
    if (what === "stage")    { await send(chatId, "📊 New stage?", STAGES_KB); return; }
    if (what === "priority") { await send(chatId, "🚦 New priority?", PRIORITY_KB); return; }
    if (what === "followup") { await send(chatId, "⏰ New follow-up date?", FOLLOWUP_KB); return; }
    if (what === "loc")      { await send(chatId, "📍 New location?", LOCATIONS_KB); return; }
    if (what === "notes")    { await send(chatId, "📝 Enter new notes:", CANCEL_KB); return; }
    return;
  }

  if (state === "update:stage") {
    const stage = input.replace("stage:", "");
    const { data: old } = await sb.from("leads").select("stage, deal").eq("id", data.leadId).single();
    await sb.from("leads").update({ stage }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nStage: ${old?.stage} → <b>${stage}</b> ${STAGE_EMOJI[stage] || ""}`);
    return;
  }

  if (state === "update:priority") {
    const priority = input.replace("pri:", "");
    await sb.from("leads").update({ priority }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nPriority set to <b>${priority}</b>`);
    return;
  }

  if (state === "update:notes") {
    await sb.from("leads").update({ notes: input }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nNotes updated.`);
    return;
  }

  if (state === "update:loc") {
    const loc = input.replace("loc:", "") === "skip" ? null : input.replace("loc:", "");
    if (loc === "other") {
      await setSession(chatId, "update:loc_custom", data);
      await send(chatId, "Type the island name:", CANCEL_KB);
      return;
    }
    await sb.from("leads").update({ loc }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nLocation updated to <b>${loc || "—"}</b>`);
    return;
  }

  if (state === "update:loc_custom") {
    await sb.from("leads").update({ loc: input }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nLocation updated to <b>${input}</b>`);
    return;
  }

  if (state === "update:followup") {
    const val = input.replace("fu:", "");
    if (val === "clear") {
      await sb.from("leads").update({ fu_date: null, fu_required: false }).eq("id", data.leadId);
      await clearSession(chatId);
      await send(chatId, `✅ <b>${data.leadName}</b>\nFollow-up cleared.`);
      return;
    }
    if (val === "custom") {
      await setSession(chatId, "update:followup_custom", data);
      await send(chatId, "📅 Enter the date (DD/MM/YYYY or YYYY-MM-DD):", CANCEL_KB);
      return;
    }
    const days = parseInt(val);
    const date = addDays(days);
    await sb.from("leads").update({ fu_date: date, fu_required: true }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nFollow-up set: <b>${fmtDate(date)}</b>${fmtDaysUntil(date)}`);
    return;
  }

  if (state === "update:followup_custom") {
    const date = parseDate(input);
    if (!date) { await send(chatId, "⚠️ Couldn't parse that date. Try DD/MM/YYYY or YYYY-MM-DD:"); return; }
    await sb.from("leads").update({ fu_date: date, fu_required: true }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nFollow-up set: <b>${fmtDate(date)}</b>${fmtDaysUntil(date)}`);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOG INTERACTION FLOW
  // ════════════════════════════════════════════════════════════════════════════
  if (state === "log:pick") {
    const leadId = input.replace("pick:", "");
    const { data: lead } = await sb.from("leads").select("id, deal").eq("id", leadId).single();
    if (!lead) { await send(chatId, "Deal not found."); return; }
    await setSession(chatId, "log:type", { leadId, leadName: lead.deal });
    await send(chatId, `📝 <b>Log — ${lead.deal}</b>\n\nType of interaction?`, LOG_TYPES_KB);
    return;
  }

  if (state === "log:type") {
    const logType = input.replace("ltype:", "");
    await setSession(chatId, "log:text", { ...data, logType });
    const labels: Record<string, string> = { call: "Call", meeting: "Meeting", visit: "Visit", email: "Email", whatsapp: "WhatsApp", note: "Note" };
    await send(chatId, `${labels[logType] || "Interaction"} — what happened?\n\nType your note:`, CANCEL_KB);
    return;
  }

  if (state === "log:text") {
    await sb.from("interactions").insert({ lead_id: data.leadId, type: data.logType, text: input });
    await sb.from("leads").update({ last_contact: new Date().toISOString().split("T")[0] }).eq("id", data.leadId);
    await clearSession(chatId);
    const typeLabel: Record<string, string> = { call: "📞 Call", meeting: "📅 Meeting", visit: "🚶 Visit", email: "✉ Email", whatsapp: "💬 WhatsApp", note: "📝 Note" };
    await send(chatId, `✅ <b>Logged — ${data.leadName}</b>\n${typeLabel[data.logType] || "📝"}: "${input.slice(0, 150)}${input.length > 150 ? "…" : ""}"`);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FOLLOW-UP FLOW
  // ════════════════════════════════════════════════════════════════════════════
  if (state === "fu:pick") {
    const leadId = input.replace("pick:", "");
    const { data: lead } = await sb.from("leads").select("id, deal, fu_date").eq("id", leadId).single();
    if (!lead) { await send(chatId, "Deal not found."); return; }
    await setSession(chatId, "fu:date", { leadId, leadName: lead.deal });
    const current = lead.fu_date ? `\nCurrent: ${fmtDate(lead.fu_date)}` : "";
    await send(chatId, `⏰ <b>Follow-up — ${lead.deal}</b>${current}\n\nSet date to:`, FOLLOWUP_KB);
    return;
  }

  if (state === "fu:date") {
    const val = input.replace("fu:", "");
    if (val === "clear") {
      await sb.from("leads").update({ fu_date: null, fu_required: false }).eq("id", data.leadId);
      await clearSession(chatId);
      await send(chatId, `✅ <b>${data.leadName}</b>\nFollow-up cleared.`);
      return;
    }
    if (val === "custom") {
      await setSession(chatId, "fu:custom", data);
      await send(chatId, "📅 Enter date (DD/MM/YYYY):", CANCEL_KB);
      return;
    }
    const date = addDays(parseInt(val));
    await sb.from("leads").update({ fu_date: date, fu_required: true }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nFollow-up: <b>${fmtDate(date)}</b>${fmtDaysUntil(date)}`);
    return;
  }

  if (state === "fu:custom") {
    const date = parseDate(input);
    if (!date) { await send(chatId, "⚠️ Couldn't parse date. Try DD/MM/YYYY:"); return; }
    await sb.from("leads").update({ fu_date: date, fu_required: true }).eq("id", data.leadId);
    await clearSession(chatId);
    await send(chatId, `✅ <b>${data.leadName}</b>\nFollow-up: <b>${fmtDate(date)}</b>${fmtDaysUntil(date)}`);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // NEW TICKET FLOW
  // ════════════════════════════════════════════════════════════════════════════
  if (state === "ticket:pick") {
    const leadId = input.replace("pick:", "");
    const { data: lead } = await sb.from("leads").select("id, deal").eq("id", leadId).single();
    if (!lead) { await send(chatId, "Deal not found."); return; }
    await setSession(chatId, "ticket:type", { leadId, leadName: lead.deal });
    await send(chatId, `🎫 <b>New Ticket — ${lead.deal}</b>\n\nTicket type?`, TICKET_TYPES_KB);
    return;
  }

  if (state === "ticket:type") {
    const ttype = input.replace("ttype:", "");
    await setSession(chatId, "ticket:title", { ...data, ttype });
    await send(chatId, "📋 <b>Title</b> — brief description of this ticket:", CANCEL_KB);
    return;
  }

  if (state === "ticket:title") {
    await setSession(chatId, "ticket:status", { ...data, title: input });
    await send(chatId, "⚙️ <b>Status?</b>", TICKET_STATUS_KB);
    return;
  }

  if (state === "ticket:status") {
    const tstatus = input.replace("tstatus:", "");
    await setSession(chatId, "ticket:date", { ...data, tstatus });
    await send(chatId, "📅 <b>Date?</b> (or skip)", kb([
      [{ text: "Today", data: "tdate:today" }, { text: "Tomorrow", data: "tdate:tomorrow" }],
      [{ text: "In 3 days", data: "tdate:3" }, { text: "In 1 week", data: "tdate:7" }],
      [{ text: "Custom date…", data: "tdate:custom" }, { text: "Skip", data: "tdate:skip" }],
      [{ text: "❌ Cancel", data: "cancel:yes" }],
    ]));
    return;
  }

  if (state === "ticket:date") {
    const val = input.replace("tdate:", "");
    let date: string | null = null;
    if (val === "today") date = new Date().toISOString().split("T")[0];
    else if (val === "tomorrow") date = addDays(1);
    else if (!isNaN(parseInt(val))) date = addDays(parseInt(val));
    else if (val === "custom") {
      await setSession(chatId, "ticket:date_custom", data);
      await send(chatId, "📅 Enter date (DD/MM/YYYY):", CANCEL_KB);
      return;
    }
    await setSession(chatId, "ticket:time", { ...data, date });
    await send(chatId, "🕐 <b>Time?</b> (e.g. 14:30)", kb([[{ text: "Skip", data: "ttime:skip" }, { text: "❌ Cancel", data: "cancel:yes" }]]));
    return;
  }

  if (state === "ticket:date_custom") {
    const date = parseDate(input);
    if (!date) { await send(chatId, "⚠️ Couldn't parse date. Try DD/MM/YYYY:"); return; }
    await setSession(chatId, "ticket:time", { ...data, date });
    await send(chatId, "🕐 <b>Time?</b>", kb([[{ text: "Skip", data: "ttime:skip" }, { text: "❌ Cancel", data: "cancel:yes" }]]));
    return;
  }

  if (state === "ticket:time") {
    const time = (input === "ttime:skip" || input === "skip") ? null : input;
    await setSession(chatId, "ticket:assigned", { ...data, time });
    await send(chatId, "👤 <b>Assign to?</b> (name or team)", kb([[{ text: "Skip", data: "skip:yes" }, { text: "❌ Cancel", data: "cancel:yes" }]]));
    return;
  }

  if (state === "ticket:assigned") {
    const assigned = (input === "skip:yes" || input === "skip") ? null : input;
    const d2 = { ...data, assigned };

    const { error } = await sb.from("tickets").insert({
      lead_id: d2.leadId,
      type: d2.ttype,
      status: d2.tstatus,
      title: d2.title,
      date: d2.date || null,
      time: d2.time || null,
      assigned_to: d2.assigned || null,
    });

    await clearSession(chatId);
    if (error) { await send(chatId, `❌ Error: ${error.message}`); return; }

    const typeLabel: Record<string, string> = { meeting: "📅 Meeting", training: "🎓 Training", menu: "📋 Menu Update", onboarding: "🚀 Onboarding", support: "🛠 Support", followup: "📞 Follow-up", demo: "💻 Demo", contract: "📝 Contract", other: "◎ Other" };
    await send(chatId, `✅ <b>Ticket Created — ${d2.leadName}</b>\n${typeLabel[d2.ttype] || d2.ttype}: ${d2.title}${d2.date ? "\n📅 " + fmtDate(d2.date) + (d2.time ? " @ " + d2.time : "") : ""}${d2.assigned ? "\n👤 " + d2.assigned : ""}`);
    return;
  }

  if (state === "ticket:date_custom") {
    const date = parseDate(input);
    if (!date) { await send(chatId, "⚠️ Couldn't parse date:"); return; }
    await setSession(chatId, "ticket:time", { ...data, date });
    await send(chatId, "🕐 Time? (or skip)", kb([[{ text: "Skip", data: "ttime:skip" }]]));
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATUS SEARCH FLOW
  // ════════════════════════════════════════════════════════════════════════════
  if (state === "status:search") {
    const results = await findDeal(input);
    if (!results.length) {
      await send(chatId, `No deals matching "${input}". Try a shorter search:`);
      return;
    }
    if (results.length === 1) {
      await clearSession(chatId);
      const { data: tks } = await sb.from("tickets").select("*").eq("lead_id", results[0].id).order("created_at", { ascending: false }).limit(5);
      const { data: logs } = await sb.from("interactions").select("*").eq("lead_id", results[0].id).order("created_at", { ascending: false }).limit(3);
      await sendFullStatus(chatId, results[0], tks || [], logs || []);
      return;
    }
    await setSession(chatId, "status:pick");
    await send(chatId, `Found ${results.length} deals:`, dealListKb(results));
    return;
  }

  if (state === "status:pick") {
    const leadId = input.replace("pick:", "");
    const { data: lead } = await sb.from("leads").select("*").eq("id", leadId).single();
    const { data: tks } = await sb.from("tickets").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(5);
    const { data: logs } = await sb.from("interactions").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(3);
    await clearSession(chatId);
    await sendFullStatus(chatId, lead, tks || [], logs || []);
    return;
  }

  // Unrecognised input while in a session
  if (state) {
    await send(chatId, "Tap a button or type your response. Use /cancel to abort.");
    return;
  }

  // No session — unknown command
  await send(chatId, "Use /start to see available commands.");
}

async function sendFullStatus(chatId: number, lead: any, tickets: any[], logs: any[]) {
  const e = STAGE_EMOJI[lead.stage] || "◎";
  let text = `<b>${lead.deal}</b> ${e} ${lead.stage}`;
  if (lead.priority !== "Normal") text += ` · ${PRIORITY_EMOJI[lead.priority]} ${lead.priority}`;
  if (lead.loc)  text += `\n📍 ${lead.loc}`;
  if (lead.type) text += ` · ${lead.type}`;
  if (lead.soft) text += `\nPOS: ${lead.soft}`;
  if (lead.fu_required && lead.fu_date) text += `\n⏰ Follow-up: ${fmtDate(lead.fu_date)}${fmtDaysUntil(lead.fu_date)}`;
  if (lead.notes) text += `\n📝 ${lead.notes.slice(0, 120)}`;

  if (tickets.length) {
    text += `\n\n<b>Tickets (${tickets.length}):</b>`;
    tickets.slice(0, 3).forEach(t => {
      const s: Record<string, string> = { pending: "⏳", scheduled: "📅", inprogress: "🔄", completed: "✅", cancelled: "❌" };
      text += `\n${s[t.status] || "◎"} ${t.title || t.type}${t.date ? " · " + fmtDate(t.date) : ""}`;
    });
  }

  if (logs.length) {
    text += `\n\n<b>Recent interactions:</b>`;
    logs.slice(0, 3).forEach(l => {
      const d = new Date(l.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      text += `\n• ${d}: ${l.text.slice(0, 80)}${l.text.length > 80 ? "…" : ""}`;
    });
  }

  await send(chatId, text);
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
serve(async (req) => {
  try {
    const body = await req.json();

    // Callback query (button tap)
    if (body.callback_query) {
      const cq = body.callback_query;
      const chatId: number = cq.message.chat.id;
      const input: string = cq.data;
      const session = await getSession(chatId);

      // Route commands even from buttons
      if (input === "cancel:yes") {
        await answer(cq.id);
        await clearSession(chatId);
        await send(chatId, "❌ Cancelled.");
        return new Response("ok");
      }

      await processFlow(chatId, session, input, true, cq.id);
      return new Response("ok");
    }

    // Regular message
    if (body.message) {
      const msg = body.message;
      const chatId: number = msg.chat.id;
      const text: string = (msg.text || "").trim();

      if (!text) return new Response("ok");

      // Top-level commands
      const cmd = text.split(" ")[0].toLowerCase().replace("@pulra_leads_bot", "");
      if (cmd === "/start" || cmd === "/help") { await cmdStart(chatId); return new Response("ok"); }
      if (cmd === "/newdeal")  { await cmdNewDeal(chatId);   return new Response("ok"); }
      if (cmd === "/update")   { await cmdUpdate(chatId);    return new Response("ok"); }
      if (cmd === "/log")      { await cmdLog(chatId);       return new Response("ok"); }
      if (cmd === "/followup") { await cmdFollowup(chatId);  return new Response("ok"); }
      if (cmd === "/newticket"){ await cmdNewTicket(chatId); return new Response("ok"); }
      if (cmd === "/status")   { await cmdStatus(chatId);    return new Response("ok"); }
      if (cmd === "/deals")    { await cmdDeals(chatId);     return new Response("ok"); }
      if (cmd === "/overdue")  { await cmdOverdue(chatId);   return new Response("ok"); }
      if (cmd === "/today")    { await cmdToday(chatId);     return new Response("ok"); }
      if (cmd === "/cancel")   {
        await clearSession(chatId);
        await send(chatId, "Cancelled.");
        return new Response("ok");
      }

      // Pass to flow if in session
      const session = await getSession(chatId);
      if (session) {
        await processFlow(chatId, session, text, false);
      } else {
        await send(chatId, "Use /start to see available commands.");
      }
    }

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});

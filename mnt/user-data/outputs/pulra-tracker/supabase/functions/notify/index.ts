// supabase/functions/notify/index.ts
// Supabase Edge Function — sends Telegram notifications on lead/ticket changes
// Deploy: supabase functions deploy notify

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT  = Deno.env.get("TELEGRAM_CHAT_ID")!;  // group or channel ID

async function sendTelegram(text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT,
      text,
      parse_mode: "HTML",
    }),
  });
}

function stageEmoji(stage: string): string {
  const map: Record<string, string> = {
    "New": "🆕", "Contacted": "📞", "Interested": "👀",
    "Meeting Set": "📅", "Negotiating": "🤝", "Closed": "✅",
    "Lost": "❌", "No Response": "🔇", "On Hold": "⏸",
  };
  return map[stage] || "◎";
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, table, record, old_record } = payload;

    // ── NEW LEAD ──────────────────────────────────────────
    if (table === "leads" && type === "INSERT") {
      const msg = [
        `🎯 <b>New Lead Added</b>`,
        `<b>${record.deal}</b>`,
        record.type  ? `Type: ${record.type}` : null,
        record.loc   ? `Location: ${record.loc}` : null,
        `Stage: ${stageEmoji(record.stage)} ${record.stage}`,
        record.priority !== "Normal" ? `Priority: ${record.priority}` : null,
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }

    // ── STAGE CHANGE ─────────────────────────────────────
    if (table === "leads" && type === "UPDATE" && old_record?.stage !== record.stage) {
      const msg = [
        `${stageEmoji(record.stage)} <b>Stage Updated</b>`,
        `<b>${record.deal}</b>`,
        `${old_record.stage} → <b>${record.stage}</b>`,
        record.loc ? `📍 ${record.loc}` : null,
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }

    // ── FOLLOW-UP DATE SET ────────────────────────────────
    if (table === "leads" && type === "UPDATE" &&
        record.fu_required && record.fu_date &&
        old_record?.fu_date !== record.fu_date) {
      const d    = new Date(record.fu_date + "T00:00:00");
      const diff = Math.round((d.getTime() - Date.now()) / 86400000);
      const when = diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days (${d.toLocaleDateString("en-GB",{day:"numeric",month:"short"})})`;
      const msg = [
        `⏰ <b>Follow-up Scheduled</b>`,
        `<b>${record.deal}</b>`,
        `Due ${when}`,
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }

    // ── NEW TICKET ────────────────────────────────────────
    if (table === "tickets" && type === "INSERT") {
      const typeLabel: Record<string, string> = {
        meeting:"Meeting",training:"Training",menu:"Menu Update",
        onboarding:"Onboarding",support:"Support",followup:"Follow-up Call",
        demo:"Demo",contract:"Contract",installation:"Installation",
        review:"Review",other:"Other"
      };
      const msg = [
        `🎫 <b>New Ticket</b>`,
        record.title ? `${record.title}` : typeLabel[record.type] || record.type,
        `Status: ${record.status}`,
        record.date ? `Date: ${record.date}${record.time ? " " + record.time : ""}` : null,
        record.assigned_to ? `Assigned to: ${record.assigned_to}` : null,
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }

    // ── TICKET STATUS CHANGE ──────────────────────────────
    if (table === "tickets" && type === "UPDATE" &&
        old_record?.status !== record.status) {
      const statusEmoji: Record<string, string> = {
        pending:"⏳",scheduled:"📅",inprogress:"🔄",completed:"✅",cancelled:"❌"
      };
      const msg = [
        `${statusEmoji[record.status]||"◎"} <b>Ticket Updated</b>`,
        record.title || record.type,
        `${old_record.status} → <b>${record.status}</b>`,
        record.assigned_to ? `Assigned: ${record.assigned_to}` : null,
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }

    // ── NEW INTERACTION LOG ───────────────────────────────
    if (table === "interactions" && type === "INSERT") {
      const typeLabel: Record<string, string> = {
        note:"Note",call:"Call",email:"Email",whatsapp:"WhatsApp",
        meeting:"Meeting",visit:"Visit",other:"Other"
      };
      // Only notify for calls, meetings, visits — not every note
      if (["call","meeting","visit"].includes(record.type)) {
        const msg = [
          `📝 <b>Interaction Logged</b>`,
          `Type: ${typeLabel[record.type]}`,
          `"${record.text.slice(0, 200)}${record.text.length > 200 ? "…" : ""}"`,
        ].filter(Boolean).join("\n");
        await sendTelegram(msg);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});

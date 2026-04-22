// supabase/functions/notify/index.ts
// Pulra/Flow Lead Tracker — Telegram notification function

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT  = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

async function sendTelegram(text: string) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: "HTML" }),
  });
}

function stageEmoji(s: string) {
  return ({"New":"🆕","Contacted":"📞","Interested":"👀","Meeting Set":"📅","Negotiating":"🤝","Closed":"✅","Lost":"❌","No Response":"🔇","On Hold":"⏸"} as Record<string,string>)[s] || "◎";
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  try {
    const payload = await req.json();
    const { type, table, record, old_record } = payload;

    // NEW LEAD
    if (table === "leads" && type === "INSERT") {
      const lines = [`🎯 <b>New Lead Added</b>`, `<b>${record.deal}</b>`];
      if (record.type) lines.push(`Type: ${record.type}`);
      if (record.loc)  lines.push(`📍 ${record.loc}`);
      lines.push(`Stage: ${stageEmoji(record.stage)} ${record.stage}`);
      if (record.priority !== "Normal") lines.push(`Priority: ${record.priority}`);
      await sendTelegram(lines.join("\n"));
    }

    // STAGE CHANGE
    if (table === "leads" && type === "UPDATE" && old_record?.stage !== record.stage) {
      const lines = [`${stageEmoji(record.stage)} <b>Stage Updated</b>`, `<b>${record.deal}</b>`, `${old_record.stage} → <b>${record.stage}</b>`];
      if (record.loc) lines.push(`📍 ${record.loc}`);
      await sendTelegram(lines.join("\n"));
    }

    // FOLLOW-UP SET
    if (table === "leads" && type === "UPDATE" && record.fu_required && record.fu_date && old_record?.fu_date !== record.fu_date) {
      const d = new Date(record.fu_date + "T00:00:00");
      const diff = Math.round((d.getTime() - Date.now()) / 86400000);
      const when = diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff} days`;
      await sendTelegram(`⏰ <b>Follow-up Scheduled</b>\n<b>${record.deal}</b>\nDue ${when} · ${d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}`);
    }

    // NEW TICKET
    if (table === "tickets" && type === "INSERT") {
      const tl: Record<string,string> = {meeting:"Meeting",training:"Training",menu:"Menu Update",onboarding:"Onboarding",support:"Support",followup:"Follow-up Call",demo:"Demo",contract:"Contract",installation:"Installation",review:"Review",other:"Other"};
      const lines = [`🎫 <b>New Ticket</b>`, record.title || tl[record.type] || record.type, `Status: ${record.status}`];
      if (record.date) lines.push(`Date: ${record.date}${record.time ? " " + record.time : ""}`);
      if (record.assigned_to) lines.push(`Assigned: ${record.assigned_to}`);
      await sendTelegram(lines.join("\n"));
    }

    // TICKET STATUS CHANGE
    if (table === "tickets" && type === "UPDATE" && old_record?.status !== record.status) {
      const se: Record<string,string> = {pending:"⏳",scheduled:"📅",inprogress:"🔄",completed:"✅",cancelled:"❌"};
      await sendTelegram(`${se[record.status]||"◎"} <b>Ticket Updated</b>\n${record.title||record.type}\n${old_record.status} → <b>${record.status}</b>`);
    }

    // INTERACTION LOG
    if (table === "interactions" && type === "INSERT" && ["call","meeting","visit"].includes(record.type)) {
      const tl: Record<string,string> = {call:"📞 Call",meeting:"📅 Meeting",visit:"🚶 Visit"};
      await sendTelegram(`📝 <b>Interaction Logged</b>\n${tl[record.type]}\n"${record.text.slice(0,200)}${record.text.length>200?"…":""}"`);
    }

    return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});

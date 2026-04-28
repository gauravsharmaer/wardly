import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ── Gemini client ──────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_PROMPT = `
You are a clinical intake assistant for Wardly, conducting 
a pre-visit medical intake with a patient.

Your goal is to collect enough information to generate a 
structured clinical brief for the physician.

RULES:
- Ask ONE question at a time
- Be warm, professional and conversational
- Never sound like a form or checklist
- Adapt your questions based on patient answers
- If patient says "hello" or similar greeting, 
  warmly introduce yourself and ask what brings them in today

COLLECT THIS INFORMATION:
Follow OLDCARTS for the chief complaint:
- Onset: When did it start?
- Location: Where exactly?
- Duration: How long does it last?
- Character: What does it feel like? (sharp, dull, pressure?)
- Alleviating/Aggravating: What makes it better or worse?
- Radiation: Does it spread anywhere?
- Timing: Constant or comes and goes?
- Severity: Rate 1-10

Then also collect:
- Relevant past medical history
- Current medications
- Allergies
- Relevant family history
- Quick ROS for systems related to complaint

WHEN TO FINISH:
After 10-15 exchanges OR when you have collected 
sufficient OLDCARTS + history information,
set isComplete to true and generate the brief.

ALWAYS respond in this EXACT JSON format, nothing else:
{
  "message": "your message to the patient",
  "isComplete": false,
  "brief": null
}

WHEN COMPLETE respond like this:
{
  "message": "Thank you, I now have everything I need. Please wait a moment while I prepare your visit summary.",
  "isComplete": true,
  "brief": {
    "cc": "One sentence. Age if known, gender if known, chief complaint, duration. Example: 45-year-old male presenting with chest pain for 3 days.",
    "hpi": "3-5 sentences in paragraph form covering all OLDCARTS findings in clinical language. Example: Patient reports substernal chest pain that began 3 days ago, rated 7/10 in severity. Pain is described as pressure-like, radiating to the left arm. Symptoms are worse with exertion and relieved by rest. Associated with mild shortness of breath. No fever, cough, or GI symptoms reported.",
    "ros": "Bullet points by system. Only include systems relevant to the complaint. Use checkmark for positive and x for negative findings.\nExample:\nCardiovascular: chest pain ✓, palpitations ✗\nRespiratory: shortness of breath ✓, cough ✗\nGI: nausea ✗, vomiting ✗\nConstitutional: fever ✗, fatigue ✓"
  }
}

CRITICAL: 
- Return ONLY valid JSON
- No markdown, no backticks, no extra text
- Never break character
- Never ask two questions at once
`;

// ── POST /chat ─────────────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res
        .status(400)
        .json({ error: "messages array is required and must not be empty." });
    }

    const history = messages.slice(0, -1);
    const lastMessage = messages[messages.length - 1];

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const responseText = result.response.text();

    const cleaned = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return res.json({
      message: parsed.message,
      isComplete: parsed.isComplete ?? false,
      brief: parsed.brief ?? null,
    });
  } catch (err) {
    console.error("[/chat error]", err);
    if (err.status === 429) {
      return res.status(429).json({
        error:
          "The AI service is temporarily rate-limited. Please wait 30 seconds and try again.",
      });
    }
    return res
      .status(500)
      .json({ error: "Internal server error.", detail: err.message });
  }
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "Wardly Clinical Intake API" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VAPI CALLING ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// In-memory store — works fine on Railway (always-on process, no serverless)
let latestBrief = null;

// ── POST /start-call ───────────────────────────────────────────────────────────
app.post("/start-call", async (req, res) => {
  try {
    const { patientPhone } = req.body;

    if (!patientPhone) {
      return res
        .status(400)
        .json({ success: false, error: "patientPhone is required." });
    }

    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        assistantId: process.env.VAPI_ASSISTANT_ID,
        customer: {
          number: patientPhone,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[/start-call error]", data);
      return res
        .status(response.status)
        .json({ success: false, error: data?.message ?? "Vapi API error." });
    }

    return res.json({ success: true, callId: data.id });
  } catch (err) {
    console.error("[/start-call error]", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /webhook/call-ended ───────────────────────────────────────────────────
app.post("/webhook/call-ended", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.type !== "end-of-call-report") {
      return res.json({ success: true });
    }

    const transcript = message.transcript;

    if (!transcript) {
      console.warn("[/webhook/call-ended] No transcript in payload.");
      return res.json({ success: true });
    }

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `You are a clinical documentation assistant.
Based on the following patient intake conversation, generate a structured clinical brief.

Return ONLY valid JSON in this exact format:
{
  "cc": "One sentence. Chief complaint with duration.",
  "hpi": "Paragraph form. 3-5 sentences covering onset, location, duration, character, alleviating/aggravating factors, radiation, timing, severity.",
  "ros": "Bullet points by system. Only systems relevant to complaint. Use ✓ for positive findings and ✗ for negative findings."
}

Conversation transcript:
${transcript}

Return ONLY the JSON object. No markdown. No backticks.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    const cleaned = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    latestBrief = JSON.parse(cleaned);
    console.log(
      "[/webhook/call-ended] Brief generated for call:",
      message.call?.id,
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[/webhook/call-ended error]", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /latest-brief ──────────────────────────────────────────────────────────
app.get("/latest-brief", (_req, res) => {
  const brief = latestBrief;
  latestBrief = null; // clear after reading so it's consumed exactly once
  return res.json({ brief });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

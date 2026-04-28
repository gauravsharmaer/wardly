import { genAI, GEMINI_MODEL } from "../config/gemini.js";

// In-memory store — works fine on Railway (always-on process, no serverless)
let latestBrief = null;

export const startCall = async (req, res) => {
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
};

export const webhookVapi = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.type !== "end-of-call-report") {
      return res.json({ success: true });
    }

    const transcript = message.transcript;

    if (!transcript) {
      console.warn("[/webhook/vapi] No transcript in payload.");
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
      "[/webhook/vapi] Brief generated for call:",
      message.call?.id,
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[/webhook/vapi error]", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

export const getLatestBrief = (req, res) => {
  const brief = latestBrief;
  latestBrief = null; // clear after reading so it's consumed exactly once
  return res.json({ brief });
};

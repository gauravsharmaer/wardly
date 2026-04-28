import { genAI, GEMINI_MODEL } from "../config/gemini.js";
import { SYSTEM_PROMPT } from "../config/prompts.js";

export const handleChat = async (req, res) => {
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
        error: "The AI service is temporarily rate-limited. Please wait 30 seconds and try again.",
      });
    }
    return res
      .status(500)
      .json({ error: "Internal server error.", detail: err.message });
  }
};

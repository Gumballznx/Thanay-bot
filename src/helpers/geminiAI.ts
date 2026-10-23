/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { getBotConfig } from "../config.js";
import { GUMBALL2_SYSTEM_INSTRUCTION } from "../config/persona.js";
import { log } from "../logger.js";

type ChatHistoryEntry = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

const chatHistories = new Map<string, { lastUsed: number; messages: ChatHistoryEntry[] }>();
const MAX_HISTORY = 10;
const HISTORY_TTL_MS = 30 * 60 * 1000;

function cleanupHistories(): void {
  const now = Date.now();
  for (const [chatId, data] of chatHistories.entries()) {
    if (now - data.lastUsed > HISTORY_TTL_MS) {
      chatHistories.delete(chatId);
    }
  }
}

export async function askGemini(params: {
  chatId: string;
  prompt: string;
  senderName?: string;
}): Promise<string> {
  const { chatId, prompt, senderName } = params;
  const config = await getBotConfig();

  const apiKey = config.geminiApiKey?.trim();
  if (!apiKey) {
    return "A chave da API Gemini não está configurada em dados/config.json.";
  }

  const model = config.geminiModel?.trim() || "gemini-3.5-flash";

  cleanupHistories();

  let conversation = chatHistories.get(chatId);
  if (!conversation) {
    conversation = { lastUsed: Date.now(), messages: [] };
    chatHistories.set(chatId, conversation);
  }
  conversation.lastUsed = Date.now();

  const userText = senderName ? `[${senderName}]: ${prompt}` : prompt;
  conversation.messages.push({
    role: "user",
    parts: [{ text: userText }],
  });

  if (conversation.messages.length > MAX_HISTORY) {
    conversation.messages = conversation.messages.slice(-MAX_HISTORY);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: GUMBALL2_SYSTEM_INSTRUCTION }],
        },
        contents: conversation.messages,
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 600,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      log.error("GEMINI", `HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return "Tive uma leve falha no meu processador neural agora... Tenta me perguntar de novo em alguns segundos!";
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) {
      return "Fiquei sem palavras pra isso... Tenta mandar de outra forma!";
    }

    conversation.messages.push({
      role: "model",
      parts: [{ text: reply }],
    });

    return reply;
  } catch (error) {
    log.error("GEMINI", "Falha na chamada Gemini", error);
    return "Opa, deu uma oscilação na conexão com a central. Manda de novo!";
  }
}

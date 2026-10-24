/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { downloadMediaMessage, proto } from "baileys";
import { getBotConfig } from "../config.js";
import { GUMBALL2_SYSTEM_INSTRUCTION } from "../config/persona.js";
import { log } from "../logger.js";

type ChatPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type ChatHistoryEntry = {
  role: "user" | "model";
  parts: ChatPart[];
};

export type GeminiMedia = {
  mimeType: string;
  data: string;
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

export async function extractMediaForGemini(message: proto.IWebMessageInfo): Promise<GeminiMedia | null> {
  const m = message.message;
  if (!m) return null;

  const directImage = m.imageMessage;
  const directAudio = m.audioMessage;
  const directSticker = m.stickerMessage;

  const quoted = m.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedImage = quoted?.imageMessage;
  const quotedAudio = quoted?.audioMessage;
  const quotedSticker = quoted?.stickerMessage;

  const targetMedia = directImage || directAudio || directSticker;
  const targetQuoted = quotedImage || quotedAudio || quotedSticker;

  if (!targetMedia && !targetQuoted) return null;

  const isDirect = Boolean(targetMedia);
  const mediaObj = (targetMedia || targetQuoted)!;
  const isAudio = Boolean(directAudio || quotedAudio);
  const isSticker = Boolean(directSticker || quotedSticker);

  let mimeType = isAudio
    ? "audio/ogg"
    : isSticker
      ? "image/webp"
      : (mediaObj as { mimetype?: string }).mimetype?.split(";")[0] || "image/jpeg";

  if (mimeType.includes("audio")) {
    if (mimeType.includes("mp4") || mimeType.includes("m4a")) mimeType = "audio/mp4";
    else if (mimeType.includes("mpeg") || mimeType.includes("mp3")) mimeType = "audio/mp3";
    else mimeType = "audio/ogg";
  }

  try {
    const toDownload = isDirect ? message : { key: message.key, message: quoted! };
    const buffer = (await downloadMediaMessage(
      toDownload as Parameters<typeof downloadMediaMessage>[0],
      "buffer",
      {},
    )) as Buffer;

    if (!buffer || buffer.length === 0) return null;
    if (buffer.length > 15 * 1024 * 1024) return null;

    return {
      mimeType,
      data: buffer.toString("base64"),
    };
  } catch {
    return null;
  }
}

export async function askGemini(params: {
  chatId: string;
  prompt: string;
  senderName?: string;
  media?: GeminiMedia;
}): Promise<string> {
  const { chatId, prompt, senderName, media } = params;
  const config = await getBotConfig();

  const apiKey = config.geminiApiKey?.trim();
  if (!apiKey) {
    return "A chave da API Gemini não está configurada em dados/config.json.";
  }

  const model = config.geminiModel?.trim() || "gemini-3-flash-preview";

  cleanupHistories();

  let conversation = chatHistories.get(chatId);
  if (!conversation) {
    conversation = { lastUsed: Date.now(), messages: [] };
    chatHistories.set(chatId, conversation);
  }
  conversation.lastUsed = Date.now();

  const textContent = prompt.trim();
  const label = senderName ? `[${senderName}]: ${textContent}` : textContent;

  const currentParts: ChatPart[] = [];
  if (label) {
    currentParts.push({ text: label });
  } else if (media) {
    const isAudio = media.mimeType.startsWith("audio");
    currentParts.push({
      text: isAudio
        ? "Ouça esta mensagem de áudio com atenção e responda como Gumball 2."
        : "Veja esta imagem enviada e comente ou responda como Gumball 2.",
    });
  }

  if (media) {
    currentParts.push({
      inlineData: {
        mimeType: media.mimeType,
        data: media.data,
      },
    });
  }

  const historyText = media
    ? `${label || (media.mimeType.startsWith("audio") ? "[Áudio enviado]" : "[Imagem enviada]")}`
    : label;

  conversation.messages.push({
    role: "user",
    parts: [{ text: historyText }],
  });

  if (conversation.messages.length > MAX_HISTORY) {
    conversation.messages = conversation.messages.slice(-MAX_HISTORY);
  }

  const requestContents = [
    ...conversation.messages.slice(0, -1),
    {
      role: "user" as const,
      parts: currentParts,
    },
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: GUMBALL2_SYSTEM_INSTRUCTION }],
        },
        contents: requestContents,
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 250,
          thinkingConfig: {
            thinkingBudget: 0,
          },
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

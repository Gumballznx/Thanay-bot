/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { downloadMediaMessage, proto } from "baileys";
import { getBotConfig } from "../config.js";
import { GUMBALL2_SYSTEM_INSTRUCTION } from "../config/persona.js";
import {
  buildHermesContext,
  getHermesHistory,
  getHermesProfile,
  resolveSpeaker,
  saveHermesHistory,
  triggerHermesLearner,
  type HermesHistoryEntry,
  type HermesHistoryPart,
} from "./hermesMemory.js";
import { log } from "../logger.js";

export type GeminiMedia = {
  mimeType: string;
  data: string;
};

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
  senderId?: string;
  rawSender?: string;
  isGroup?: boolean;
  media?: GeminiMedia;
}): Promise<string> {
  const { chatId, prompt, senderName, senderId, rawSender, isGroup, media } = params;
  const config = await getBotConfig();

  const apiKey = config.geminiApiKey?.trim();
  if (!apiKey) {
    return "A chave da API Gemini não está configurada em dados/config.json.";
  }

  const model = config.geminiModel?.trim() || "gemini-3.5-flash-lite";

  // Identificação Hermes do Interlocutor (Dono Criador, A Dona ou Membro)
  const speaker = resolveSpeaker({
    senderId,
    rawSender,
    chatId,
    senderName,
    config,
  });

  const profile = await getHermesProfile(speaker.key, speaker.role, speaker.displayName);
  const history = await getHermesHistory(chatId);

  const textContent = prompt.trim();
  const label = speaker.displayName ? `[${speaker.displayName}]: ${textContent}` : textContent;

  const currentParts: HermesHistoryPart[] = [];
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

  history.push({
    role: "user",
    parts: [{ text: historyText }],
  });

  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  const requestContents = [
    ...history.slice(0, -1),
    {
      role: "user" as const,
      parts: currentParts,
    },
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const timezone = config.timezone || "Africa/Maputo";
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const temporalInstruction = `Contexto temporal em tempo real (Fuso horário de Moçambique / ${timezone}):
- Data atual: ${dateStr}
- Hora atual: ${timeStr}
Sempre que alguém perguntar as horas, minutos, data de hoje, dia da semana ou ano, responda com precisão absoluta usando exatamente esta informação temporal em tempo real de Moçambique.`;

  const hermesContext = buildHermesContext(profile, speaker.directive);
  const fullSystemInstruction = `${GUMBALL2_SYSTEM_INSTRUCTION}\n\n${temporalInstruction}\n\n${hermesContext}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: fullSystemInstruction }],
        },
        contents: requestContents,
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 250,
          ...(!model.includes("flash-lite") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorText = await response.text();
      log.error("GEMINI", `HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return "Minha conexão deu uma travada aqui agora... Tenta me mandar de novo em alguns segundos!";
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

    history.push({
      role: "model",
      parts: [{ text: reply }],
    });

    // Salva histórico persistente em disco (perda 0 de memória)
    await saveHermesHistory(chatId, history);

    // Módulo Hermes de aprendizado em segundo plano (adapta personalidade e aprende novas skills)
    triggerHermesLearner({
      profile,
      userText: prompt,
      botReply: reply,
      apiKey,
      model,
    });

    return reply;
  } catch (error) {
    log.error("GEMINI", "Falha na chamada Gemini", error);
    return "Opa, deu uma oscilação na conexão com a central. Manda de novo!";
  }
}

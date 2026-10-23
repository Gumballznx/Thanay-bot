/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { WAMessage } from "baileys";
import { Command } from "../../../types/Command.js";
import { askGemini } from "../../../helpers/geminiAI.js";

const iaCommand: Command = {
  name: "ia",
  aliases: ["ai", "gumball", "gumball2", "thanay", "gemini", "chat"],
  description: "Conversa com Gumball 2 (Inteligência Artificial)",
  category: "geral",
  async execute({ thanay, message, from, rawArgs, prefix }) {
    const prompt = rawArgs.trim();

    if (!prompt) {
      await thanay.sendMessage(
        from,
        {
          text: [
            "╭─[ 🤖 *Gumball 2* ]",
            "│",
            "│ › Manda aí a sua pergunta ou ideia!",
            `│ › Exemplo: *${prefix}ia qual é a boa de hoje?*`,
            "│",
            "╰──────────────────────",
          ].join("\n"),
        },
        { quoted: message as WAMessage },
      );
      return;
    }

    await thanay.sendPresenceUpdate("composing", from).catch(() => {});

    const senderName = message.pushName || "Amigo";
    const reply = await askGemini({
      chatId: from,
      prompt,
      senderName,
    });

    await thanay.sendMessage(from, { text: reply }, { quoted: message as WAMessage });
  },
};

export default iaCommand;

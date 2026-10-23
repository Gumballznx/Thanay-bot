/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { WAMessage } from "baileys";
import { Command } from "../../../types/Command.js";
import { getBotConfig } from "../../../config.js";
import { sendMenu } from "../../../helpers/sendMenu.js";

const menuIaCommand: Command = {
  name: "menuia",
  aliases: ["aimenu", "menuai", "menugpt"],
  description: "Mostra os comandos de Inteligência Artificial",
  category: "geral",
  async execute({ thanay, message, from, prefix, t }) {
    const config = await getBotConfig();

    await sendMenu(
      thanay,
      from,
      [
        t("commands.menu.mainTitle", { botName: config.botName }),
        "│",
        `├ 〔 ${t("commands.menu.categories.ia")} 〕`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.ia")} <pergunta>`,
        `│  ♡ ${prefix}gumball <pergunta>`,
        `│  ♡ ${prefix}thanay <pergunta>`,
        "│",
        "│  › No PV: Donos conversam direto sem prefixo!",
        "│",
        "‧₊˚ ────────────────˚₊‧",
      ].join("\n"),
      message as WAMessage,
    );
  },
};

export default menuIaCommand;

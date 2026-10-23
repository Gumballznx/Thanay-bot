/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { WAMessage } from "baileys";
import { Command } from "../../../types/Command.js";
import { getBotConfig } from "../../../config.js";
import { sendMenu } from "../../../helpers/sendMenu.js";

const menuCommand: Command = {
  name: "menu",
  aliases: ["help", "ajuda", "comandos"],
  description: "Shows the main menu",
  category: "geral",
  async execute({ thanay, message, from, prefix, t }) {
    const config = await getBotConfig();

    await sendMenu(
      thanay,
      from,
      [
        t("commands.menu.mainTitle", { botName: config.botName }),
        "│",
        `│  ♡ ${prefix}${t("commands.menu.cmds.menugeral")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menuia")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menufig")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menudl")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menubrincadeira")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menugrupo")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menuadm")}`,
        `│  ♡ ${prefix}${t("commands.menu.cmds.menudono")}`,
        "│",
        "‧₊˚ ────────────────˚₊‧",
      ].join("\n"),
      message as WAMessage,
    );
  },
};

export default menuCommand;

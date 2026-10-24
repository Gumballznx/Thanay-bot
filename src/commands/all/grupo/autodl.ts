/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { WAMessage } from "baileys";
import { getGroup, saveGroup } from "../../../database/groupDB.js";
import { Command } from "../../../types/Command.js";

const autodlCommand: Command = {
  name: "autodl",
  aliases: ["autodownload", "autodownloader", "autobaixar"],
  i18nAliases: {
    en: ["autodl", "autodownload"],
    es: ["autodl", "autodescarga"],
    id: ["autodl", "autounduh"],
  },
  description: "Enables or disables automatic media download in the group",
  category: "grupo",
  groupOnly: true,
  adminOnly: true,
  async execute({ thanay, message, from, t }) {
    const config = await getGroup(from);
    const next = !config.autodl;
    await saveGroup(from, { autodl: next });

    await thanay.sendMessage(
      from,
      { text: next ? t("commands.autodl.enabled") : t("commands.autodl.disabled") },
      { quoted: message as WAMessage },
    );
  },
};

export default autodlCommand;

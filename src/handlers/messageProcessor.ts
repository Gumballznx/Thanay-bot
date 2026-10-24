/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { proto, WAMessage, WASocket } from "baileys";
import { groupCache } from "../cache/groupCache.js";
import { getBotConfig } from "../config.js";
import { getGroup } from "../database/groupDB.js";
import { logCommandActivity, logMessageActivity } from "../helpers/activityLog.js";
import { applyAntiLink } from "../helpers/antiLink.js";
import { applyAntiStealth, countNormalGroupMessage } from "../helpers/antiStealth.js";
import { tryHandleApkReply } from "../helpers/apkReply.js";
import { tryHandleAutoDl } from "../helpers/autoDl.js";
import { askGemini, extractMediaForGemini } from "../helpers/geminiAI.js";
import { recordGroupActivity } from "../helpers/groupActivity.js";
import { isAdmin, isBotAdmin } from "../helpers/isAdmin.js";
import { isOwnerFromConfig } from "../helpers/isOwner.js";
import { applyMediaRestriction } from "../helpers/messageRestrictions.js";
import { isBlockedCommandInEntries, isBlockedUserInEntries } from "../helpers/ownerRestrictions.js";
import { resolveCommandPrefix } from "../helpers/resolveCommandPrefix.js";
import { toLID } from "../helpers/toLID.js";
import { findSimilarCommand, sendUnknownCommandMessage } from "../helpers/unknownCommand.js";
import { createTranslator } from "../i18n/index.js";
import { log } from "../logger.js";
import { getOwnerConfig } from "../ownerConfig.js";
import { Command } from "../types/Command.js";
import { CommandHandler } from "./commandHandler.js";
import { metrics } from "../metrics.js";

export type ParsedCommandInput = {
  commandName: string;
  rawArgs: string;
  args: string[];
};

export function parseCommandInput(body: string, prefix: string): ParsedCommandInput {
  const afterPrefix = body.slice(prefix.length).trimStart();
  const commandMatch = /^(\S+)([\s\S]*)$/.exec(afterPrefix);
  const rawArgs = (commandMatch?.[2] ?? "").replace(/^\s+/, "");
  return {
    commandName: (commandMatch?.[1] ?? "").toLowerCase(),
    rawArgs,
    args: rawArgs.length > 0 ? rawArgs.split(/\s+/).filter(Boolean) : [],
  };
}

type AuthorizationInput = {
  command: Command;
  thanay: WASocket;
  from: string;
  isGroup: boolean;
  userIsOwner: boolean;
  groupAdminOnly: boolean;
  userIsAdmin: () => Promise<boolean>;
  botIsAdmin: () => Promise<boolean>;
  isCommandBlocked: () => Promise<boolean>;
  t: (key: string) => string;
};

export async function authorizeCommand(input: AuthorizationInput): Promise<boolean> {
  const { command, thanay, from, isGroup, userIsOwner, groupAdminOnly, t } = input;
  if (command.ownerOnly && !userIsOwner) {
    await thanay.sendMessage(from, { text: t("errors.ownerOnly") });
    return false;
  }
  if (command.groupOnly && !isGroup) {
    await thanay.sendMessage(from, { text: t("errors.groupOnly") });
    return false;
  }
  if (command.privateOnly && isGroup) {
    await thanay.sendMessage(from, { text: t("errors.privateOnly") });
    return false;
  }

  const [userAdmin, botAdmin, blocked] = await Promise.all([
    input.userIsAdmin(),
    input.botIsAdmin(),
    input.isCommandBlocked(),
  ]);

  if (command.adminOnly && isGroup && !userAdmin && !userIsOwner) {
    await thanay.sendMessage(from, { text: t("errors.adminOnly") });
    return false;
  }
  if (isGroup && groupAdminOnly && !userIsOwner && !userAdmin) {
    await thanay.sendMessage(from, { text: t("errors.groupCommandsAdminOnly") });
    return false;
  }
  if (command.botAdminRequired && isGroup && !botAdmin) {
    await thanay.sendMessage(from, { text: t("errors.botAdminRequired") });
    return false;
  }
  if (!userIsOwner && blocked) {
    await thanay.sendMessage(from, { text: t("errors.commandBlocked") });
    return false;
  }
  return true;
}

export async function processMessage(
  thanay: WASocket,
  commandHandler: CommandHandler,
  message: proto.IWebMessageInfo,
): Promise<void> {
  const key = message.key;
  if (!key || key.fromMe) return;

  const from = key.remoteJid;
  if (!from) return;
  const isGroup = from.endsWith("@g.us");
  const [runtimeConfig, groupConfig, ownerConfig] = await Promise.all([
    getBotConfig(),
    isGroup ? getGroup(from) : Promise.resolve(null),
    getOwnerConfig(),
  ]);
  const fallbackPrefix = groupConfig?.prefix || runtimeConfig.prefix;
  const sessionLocale = groupConfig?.language ?? runtimeConfig.language;

  const rawSender = (isGroup ? key.participant : key.remoteJid) || "";
  const senderLID = rawSender ? await toLID(rawSender, thanay) : null;

  if (!senderLID) {
    const tGlobal = createTranslator(runtimeConfig.language || "pt");
    log.warn("COMMAND", tGlobal("logs.commandIgnoredNoLid", { sender: rawSender || tGlobal("logs.emptySender") }));
    return;
  }

  if (isGroup && key.participant) key.participant = senderLID;
  if (message.participant) message.participant = senderLID;

  const sender = senderLID;
  const userIsOwner = isOwnerFromConfig(sender, runtimeConfig);
  let userAdmin: Promise<boolean> | undefined;
  let botAdmin: Promise<boolean> | undefined;
  const getUserAdmin = () => userAdmin ??= isAdmin(from, sender, thanay);
  const getBotAdmin = () => botAdmin ??= isBotAdmin(from, thanay);

  const markOwnerReadIfPrivate = async () => {
    if (!isGroup && userIsOwner && key) {
      await thanay.readMessages([key]).catch(() => {});
    }
  };

  if (!message.message) {
    if (isGroup && !userIsOwner) {
      if (!(await getUserAdmin()) && await getBotAdmin()) {
        await applyAntiStealth(thanay, message, from, sender, sessionLocale);
      }
    }
    return;
  }

  if (isGroup) countNormalGroupMessage(from, sender);

  if (!userIsOwner && isBlockedUserInEntries(ownerConfig.blockedUsers, sender)) return;

  if (!isGroup && !userIsOwner) {
    if (ownerConfig.antiPrivate) return;
  }

  if (isGroup && !userIsOwner && groupConfig?.botBan.ativo) return;

  const body =
    message.message.conversation ||
    message.message.extendedTextMessage?.text ||
    message.message.imageMessage?.caption ||
    message.message.videoMessage?.caption ||
    "";

  const resolved = resolveCommandPrefix(body, runtimeConfig.prefixByLocale, fallbackPrefix);
  const prefix = resolved.prefix;
  const isCommandMessage = resolved.matched;
  if (isGroup) {
    const isStickerMessage = Boolean(message.message.stickerMessage);
    recordGroupActivity(from, sender, isCommandMessage ? "command" : isStickerMessage ? "sticker" : "message");
  }

  if (isGroup) {
    const [currentUserAdmin, currentBotAdmin] = userIsOwner
      ? [true, await getBotAdmin()]
      : await Promise.all([getUserAdmin(), getBotAdmin()]);

    if (!userIsOwner && !currentUserAdmin && currentBotAdmin) {
      const blockedMedia = await applyMediaRestriction(thanay, message, from, sender, sessionLocale);
      if (blockedMedia) return;
    }

    if (!isCommandMessage && !userIsOwner && !currentUserAdmin && currentBotAdmin) {
      const handled = await applyAntiLink(thanay, message, from, sender, sessionLocale);
      if (handled) return;
    }
  }

  if (!isCommandMessage) {
    const sessionT = createTranslator(sessionLocale);
    const activityT = createTranslator(runtimeConfig.language || "pt");
    logMessageActivity({ message, from, sender, isGroup, body, t: activityT });
    const apkHandled = await tryHandleApkReply({ thanay, from, sender, body, message, t: sessionT });
    if (apkHandled) {
      await markOwnerReadIfPrivate();
      return;
    }

    if (isGroup && groupConfig?.autodl) {
      const autoDlHandled = await tryHandleAutoDl({
        thanay,
        from,
        sender,
        body,
        message,
        t: sessionT,
      });
      if (autoDlHandled) {
        return;
      }
    }

    if (!isGroup && userIsOwner) {
      const media = await extractMediaForGemini(message);
      const text = body.trim();
      if (text || media) {
        await thanay.sendPresenceUpdate("composing", from).catch(() => {});
        const reply = await askGemini({
          chatId: from,
          prompt: text,
          senderName: message.pushName || "Dono",
          media: media ?? undefined,
        });
        await thanay.sendMessage(from, { text: reply }, { quoted: message as WAMessage });
        await markOwnerReadIfPrivate();
      }
    }
    return;
  }

  const { commandName, rawArgs, args } = parseCommandInput(body, prefix);
  if (!commandName) return;

  const command = commandHandler.get(commandName);
  const locale = resolved.locale ?? sessionLocale;
  const cmdTranslator = createTranslator(locale);

  if (!command) {
    const similar = findSimilarCommand(commandName, commandHandler.listNames());
    await sendUnknownCommandMessage(thanay, from, sender, prefix, commandName, similar, message, locale);
    await markOwnerReadIfPrivate();
    return;
  }

  metrics.startCommand();
  const authorized = await authorizeCommand({
    command,
    thanay,
    from,
    isGroup,
    userIsOwner,
    groupAdminOnly: Boolean(groupConfig?.soadmin),
    userIsAdmin: getUserAdmin,
    botIsAdmin: getBotAdmin,
    isCommandBlocked: async () => isBlockedCommandInEntries(ownerConfig.blockedCommands, command.name),
    t: cmdTranslator,
  });
  if (!authorized) {
    metrics.denyCommand();
    await markOwnerReadIfPrivate();
    return;
  }

  const commandStartedAt = Date.now();
  try {
    const activityT = createTranslator(runtimeConfig.language || "pt");
    logCommandActivity({ message, from, sender, isGroup, prefix, commandName, args, t: activityT });
    await command.execute({

      thanay,
      message,
      args,
      rawArgs,
      prefix,
      commandName,
      sender,
      from,
      groupCache,
      isOwner: async () => userIsOwner,
      isGroup,
      isAdmin: getUserAdmin,
      isBotAdmin: getBotAdmin,
      commandDirectory: commandHandler,
      locale,
      t: cmdTranslator,
    });
    metrics.recordCommand(command.name, "success", Date.now() - commandStartedAt);
    await markOwnerReadIfPrivate();
  } catch (error) {
    metrics.recordCommand(command.name, "failure", Date.now() - commandStartedAt);
    log.error("COMMAND", cmdTranslator("logs.commandError", { commandName }), error);
    await thanay.sendMessage(from, { text: cmdTranslator("errors.commandExecution") });
    await markOwnerReadIfPrivate();
  }
}

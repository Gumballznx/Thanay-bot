/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 * @description Gemini Function Calling Tools — Dá 'mãos' reais ao Gumball 2 para controlar o bot.
 */
import os from "node:os";
import { proto, WASocket } from "baileys";
import { getBotConfig } from "../config.js";
import { groupCache, GroupCache } from "../cache/groupCache.js";
import { CommandDirectory } from "../types/Command.js";
import { Locale, createTranslator } from "../i18n/index.js";
import { log } from "../logger.js";
import { extractIdentityDigits } from "./isOwner.js";
import { isAdmin as checkUserAdmin, isBotAdmin as checkBotAdmin } from "./isAdmin.js";
import { metrics } from "../metrics.js";
import { mediaQueue } from "../media/mediaQueue.js";

export interface GeminiToolContext {
  thanay: WASocket;
  commandHandler: CommandDirectory;
  message: proto.IWebMessageInfo;
  sender: string;
  from: string;
  isGroup: boolean;
  userIsOwner: boolean;
  groupCache?: GroupCache;
  locale?: Locale;
  isAdmin?: () => Promise<boolean>;
  isBotAdmin?: () => Promise<boolean>;
}

export const GEMINI_TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: "executar_comando",
        description:
          "Executa qualquer comando dos menus do bot (ex: 'tiktok', 'ytmp4', 'ytmp3', 'pinterest', 'instagram', 'ping', 'gp', 'kick', 'statusbot', 'menubn', 'beijar', 'hidetag', 'autodl', etc.). Use sempre que o usuário pedir para buscar ou baixar vídeos/músicas, gerenciar grupo, jogar ou rodar qualquer comando existente no bot.",
        parameters: {
          type: "OBJECT",
          properties: {
            comando: {
              type: "STRING",
              description:
                "Nome do comando a ser executado sem o prefixo (ex: 'tiktok', 'ytmp4', 'ping', 'gp', 'kick', 'menubn', 'beijar').",
            },
            argumentos: {
              type: "STRING",
              description:
                "Argumentos passados para o comando (ex: 'gatos fofos' para tiktok, 'fechar' ou 'abrir' para gp, link do youtube, menção do usuário, etc.).",
            },
          },
          required: ["comando"],
        },
      },
      {
        name: "enviar_recado",
        description:
          "Envia uma mensagem privada via WhatsApp para o Dono Criador (Gumball), para a Dona (Chefinha) ou para outro usuário específico.",
        parameters: {
          type: "OBJECT",
          properties: {
            destinatario: {
              type: "STRING",
              description:
                "Para quem enviar o recado: 'dono', 'gumball', 'dona', 'chefinha', 'patroa', ou um número de telefone com DDI (ex: 258835152398).",
            },
            mensagem: {
              type: "STRING",
              description: "O texto ou mensagem que deve ser entregue no privado do WhatsApp.",
            },
          },
          required: ["destinatario", "mensagem"],
        },
      },
      {
        name: "consultar_status_sistema",
        description:
          "Consulta o consumo real de memória RAM (Heap e RSS), uso médio de CPU, tempo online (uptime) e saúde do servidor do bot sem alucinar.",
        parameters: {
          type: "OBJECT",
          properties: {},
        },
      },
    ],
  },
];

export async function executeGeminiToolCall(
  call: { name: string; args?: Record<string, unknown> },
  context: GeminiToolContext,
): Promise<{ status: "sucesso" | "erro"; [key: string]: unknown }> {
  const { name, args = {} } = call;

  try {
    if (name === "executar_comando") {
      const comandoRaw = String(args.comando || "").trim().toLowerCase();
      const argumentos = typeof args.argumentos === "string" ? args.argumentos.trim() : "";

      if (!comandoRaw) {
        return {
          status: "erro",
          detalhe: "O nome do comando não foi informado.",
        };
      }

      const cmd = context.commandHandler.get(comandoRaw);
      if (!cmd) {
        return {
          status: "erro",
          detalhe: `O comando '${comandoRaw}' não existe no bot. Verifique o nome correto nos menus.`,
        };
      }

      // Validação de permissões
      if (cmd.ownerOnly && !context.userIsOwner) {
        return {
          status: "erro",
          detalhe: `O comando '${cmd.name}' é exclusivo para os donos do bot.`,
        };
      }

      if (cmd.groupOnly && !context.isGroup) {
        return {
          status: "erro",
          detalhe: `O comando '${cmd.name}' só pode ser utilizado dentro de grupos, não no chat privado.`,
        };
      }

      if (cmd.privateOnly && context.isGroup) {
        return {
          status: "erro",
          detalhe: `O comando '${cmd.name}' só pode ser utilizado em conversa privada, não em grupos.`,
        };
      }

      const checkAdmin = context.isAdmin ?? (() => checkUserAdmin(context.from, context.sender, context.thanay));
      const checkBotAdm = context.isBotAdmin ?? (() => checkBotAdmin(context.from, context.thanay));

      if (cmd.adminOnly && context.isGroup) {
        const isAdm = await checkAdmin();
        if (!isAdm && !context.userIsOwner) {
          return {
            status: "erro",
            detalhe: `O comando '${cmd.name}' exige permissão de administrador do grupo.`,
          };
        }
      }

      if (cmd.botAdminRequired && context.isGroup) {
        const isBotAdm = await checkBotAdm();
        if (!isBotAdm) {
          return {
            status: "erro",
            detalhe: `O bot precisa ser administrador deste grupo para executar o comando '${cmd.name}'.`,
          };
        }
      }

      const botConfig = await getBotConfig();
      const locale = context.locale || "pt";
      const t = createTranslator(locale);
      const cache = context.groupCache || groupCache;
      const cmdArgs = argumentos ? argumentos.split(/\s+/) : [];

      log.info("GEMINI_AGENT", `Executando comando bot: ${cmd.name} ${argumentos}`);

      await cmd.execute({
        thanay: context.thanay,
        message: context.message,
        args: cmdArgs,
        rawArgs: argumentos,
        prefix: botConfig.prefix || "!",
        commandName: cmd.name,
        sender: context.sender,
        from: context.from,
        groupCache: cache,
        isOwner: async () => context.userIsOwner,
        isGroup: context.isGroup,
        isAdmin: checkAdmin,
        isBotAdmin: checkBotAdm,
        commandDirectory: context.commandHandler,
        locale,
        t,
      });

      return {
        status: "sucesso",
        detalhe: `Comando '${cmd.name}' executado com sucesso e o resultado/mídia foi enviado no chat.`,
      };
    }

    if (name === "enviar_recado") {
      const destRaw = String(args.destinatario || "").trim().toLowerCase();
      const mensagem = String(args.mensagem || "").trim();

      if (!mensagem) {
        return {
          status: "erro",
          detalhe: "Nenhuma mensagem foi informada para o recado.",
        };
      }

      const config = await getBotConfig();
      let targetJid: string | null = null;
      let labelDestinatario = "";

      if (
        destRaw.includes("dona") ||
        destRaw.includes("chefa") ||
        destRaw.includes("chefinha") ||
        destRaw.includes("patroa")
      ) {
        const donaNum = config.extraOwners?.[0] || "258835152398";
        targetJid = `${donaNum.replace(/\D/g, "")}@s.whatsapp.net`;
        labelDestinatario = "A Dona (Chefinha)";
      } else if (
        destRaw.includes("dono") ||
        destRaw.includes("chefe") ||
        destRaw.includes("gumball") ||
        destRaw.includes("criador")
      ) {
        const donoNum = config.ownerNumber || "258879116693";
        targetJid = `${donoNum.replace(/\D/g, "")}@s.whatsapp.net`;
        labelDestinatario = "O Dono (Gumball)";
      } else {
        const digits = destRaw.replace(/\D/g, "");
        if (digits.length >= 8) {
          if (!context.userIsOwner) {
            return {
              status: "erro",
              detalhe: "Apenas os donos do bot têm permissão para enviar recados para números de terceiros.",
            };
          }
          targetJid = `${digits}@s.whatsapp.net`;
          labelDestinatario = `+${digits}`;
        }
      }

      if (!targetJid) {
        return {
          status: "erro",
          detalhe: `Destinatário '${args.destinatario}' não foi reconhecido. Especifique 'dono', 'dona' ou um número válido com DDI.`,
        };
      }

      const senderDigits = extractIdentityDigits(context.sender);
      const isGumball = senderDigits === extractIdentityDigits(config.ownerNumber || "");
      const isDona =
        (config.extraOwners || []).some((o) => extractIdentityDigits(o) === senderDigits) ||
        senderDigits === "258835152398";

      const remetenteNome = isGumball
        ? "Gumball (Dono)"
        : isDona
          ? "A Chefinha (Dona)"
          : (context.message.pushName || "Alguém");

      const textoFinal = `💬 *Recado de ${remetenteNome}:*\n\n${mensagem}`;

      await context.thanay.sendMessage(targetJid, { text: textoFinal });

      return {
        status: "sucesso",
        detalhe: `Recado entregue com sucesso para ${labelDestinatario} no privado do WhatsApp.`,
      };
    }

    if (name === "consultar_status_sistema") {
      const mem = process.memoryUsage();
      const uptimeSec = process.uptime();
      const days = Math.floor(uptimeSec / 86400);
      const hours = Math.floor((uptimeSec % 86400) / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const seconds = Math.floor(uptimeSec % 60);
      const uptimeStr = [days ? `${days}d` : null, hours ? `${hours}h` : null, `${minutes}m`, `${seconds}s`]
        .filter(Boolean)
        .join(" ");

      const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
      const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
      const loadAvg = os.loadavg();
      const queue = mediaQueue.snapshot();
      const metricsSnapshot = metrics.snapshot();

      return {
        status: "sucesso",
        metricasReais: {
          ramHeapUsada: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
          ramRssUsada: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
          memoriaLivreServidor: `${freeMemMb} MB de ${totalMemMb} MB`,
          tempoAtividadeBot: uptimeStr,
          cpuMediaCarga: loadAvg[0].toFixed(2),
          tarefasMidiaAtivas: queue.active,
          tarefasMidiaFila: queue.pending,
          totalMensagensProcessadas: metricsSnapshot.messages.processed,
          totalComandosExecutados: metricsSnapshot.commands.started,
          plataforma: `${process.platform} (${os.arch()})`,
        },
      };
    }

    return {
      status: "erro",
      detalhe: `Ferramenta desconhecida: '${name}'.`,
    };
  } catch (error: any) {
    log.error("GEMINI_AGENT", `Erro durante execução da ferramenta '${name}'`, error);
    return {
      status: "erro",
      detalhe: `Falha na execução: ${error?.message || "erro interno"}`,
    };
  }
}

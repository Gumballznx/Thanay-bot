/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 * @description Hermes Memory Engine for Gumball 2: Zero-loss persistent memory & adaptive skills.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { paths } from "../config/paths.js";
import { BotConfig } from "../config.js";
import { extractIdentityDigits } from "./isOwner.js";
import { log } from "../logger.js";

export type HermesRole = "dono" | "dona" | "membro";

export type HermesProfile = {
  key: string;
  role: HermesRole;
  name: string;
  gender: "homem" | "mulher" | "indefinido";
  facts: string[];
  skills: string[];
  dailyNotes: string[];
  lastUpdated: string;
};

export type HermesHistoryPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type HermesHistoryEntry = {
  role: "user" | "model";
  parts: HermesHistoryPart[];
};

const MEMORY_DIR = path.join(paths.dados, "ia_memory");
const PROFILES_DIR = path.join(MEMORY_DIR, "profiles");
const HISTORIES_DIR = path.join(MEMORY_DIR, "histories");

let directoriesEnsured = false;
async function ensureDirectories(): Promise<void> {
  if (directoriesEnsured) return;
  await Promise.all([
    fs.mkdir(PROFILES_DIR, { recursive: true }),
    fs.mkdir(HISTORIES_DIR, { recursive: true }),
  ]).catch(() => {});
  directoriesEnsured = true;
}

function sanitizeFileName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const profileCache = new Map<string, HermesProfile>();
const historyCache = new Map<string, HermesHistoryEntry[]>();
const lastLearnedMap = new Map<string, number>();

/**
 * Identifica o papel do interlocutor (Dono Criador, A Dona ou Membro)
 * baseado em nome, número e LID.
 */
export function resolveSpeaker(params: {
  senderId?: string;
  rawSender?: string;
  chatId?: string;
  senderName?: string;
  config: BotConfig;
}): { key: string; role: HermesRole; displayName: string; directive: string } {
  const { senderId = "", rawSender = "", chatId = "", senderName = "", config } = params;

  const idCandidates = [senderId, rawSender, chatId].filter(Boolean);
  const digitsList = idCandidates.map((id) => extractIdentityDigits(id)).filter(Boolean);

  const ownerDigits = extractIdentityDigits(config.ownerNumber ?? "");
  const extraDigits = (config.extraOwners ?? []).map((n) => extractIdentityDigits(n)).filter(Boolean);

  // 1. O Dono (Gumball - Criador / Homem)
  const isPrimaryOwner =
    (ownerDigits && digitsList.includes(ownerDigits)) ||
    (config.ownerLID && idCandidates.includes(config.ownerLID));

  if (isPrimaryOwner) {
    return {
      key: "dono_gumball",
      role: "dono",
      displayName: senderName || config.ownerName || "Gumball",
      directive:
        "Você está conversando diretamente com o GUMBALL (seu grande parceiro, amigo e dono da Thanay Bot). Ele é homem. Vocês são parceiros e amigos de longa data. Trate-o como chefe, mano ou Gumball. Humor afiado, inteligência, zoeira na medida certa de amigo, lealdade total, respostas curtas e humanas sem termos robóticos ou emojis de robô.",
    };
  }

  // 2. A Dona (Chefe Mulher / Co-proprietária)
  const isDona =
    digitsList.some((d) => extraDigits.includes(d) || d === "258835152398") ||
    (config.extraOwnerLIDs ?? []).some((lid) => idCandidates.includes(lid)) ||
    idCandidates.includes("19650096197757@lid");

  if (isDona) {
    return {
      key: "dona",
      role: "dona",
      displayName: senderName || "Dona",
      directive:
        "Você está conversando diretamente com a DONA da Thanay Bot (a co-proprietária e dona mulher). Ela é mulher. Com ela você é EXTREMAMENTE carinhoso, atencioso, doce, charmoso, protetor e cavalheiro. Trate-a com muito carinho, respeito afetuoso e consideração máxima (chame-a de chefa, patroa, princesa, chefinha querida ou pelo nome dela com muito carinho). Nunca use termos robóticos ou emojis de robô; fale de forma totalmente humana, doce e natural. Respostas curtas e sem enrolação.",
    };
  }

  // 3. Outros membros
  const fallbackDigits = digitsList[0] || "user";
  return {
    key: `member_${fallbackDigits}`,
    role: "membro",
    displayName: senderName || "Amigo",
    directive:
      "Você está conversando com um usuário/membro da Thanay Bot. Seja engraçado, espirituoso e direto. Se perceber que é mulher pelo nome ou conversa, seja charmoso e cavalheiro.",
  };
}

/**
 * Carrega ou inicializa o perfil persistente do interlocutor.
 */
export async function getHermesProfile(
  key: string,
  role: HermesRole,
  displayName: string,
): Promise<HermesProfile> {
  const cached = profileCache.get(key);
  if (cached) {
    if (displayName && (!cached.name || cached.name === "Amigo" || cached.name === "Dona")) {
      cached.name = displayName;
    }
    return cached;
  }

  await ensureDirectories();
  const filePath = path.join(PROFILES_DIR, `${sanitizeFileName(key)}.json`);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as HermesProfile;
    if (displayName && (!data.name || data.name === "Amigo" || data.name === "Dona")) {
      data.name = displayName;
    }
    profileCache.set(key, data);
    return data;
  } catch {
    const defaultProfile: HermesProfile = {
      key,
      role,
      name: displayName || (role === "dono" ? "Gumball" : role === "dona" ? "Dona" : "Amigo"),
      gender: role === "dono" ? "homem" : role === "dona" ? "mulher" : "indefinido",
      facts:
        role === "dono"
          ? [
              "Criador, desenvolvedor e dono principal da Thanay Bot",
              "Grande parceiro e amigo de longa data do Gumball 2",
              "Mora em Moçambique e trabalha ativamente nas novidades do bot",
              "Prefere respostas curtas (1 a 3 linhas), engraçadas, inteligentes e objetivas",
            ]
          : role === "dona"
            ? [
                "É a dona da Thanay Bot (co-proprietária ao lado do Gumball)",
                "Dona mulher admirada, com consideração e carinho total do Gumball 2",
                "Gosta de atenção, gentileza, consideração e tratamento carinhoso",
              ]
            : ["Usuário que conversa com a Thanay Bot"],
      skills:
        role === "dono"
          ? [
              "Skill [Camaradagem]: Conversa com o Gumball como parceiro de confiança e irmão de consideração",
              "Skill [Agilidade]: Respostas rápidas e sem rodeios para o chefe",
              "Skill [Humor Afiado]: Usa zombeteira leve e piadas inteligentes",
            ]
          : role === "dona"
            ? [
                "Skill [Cavalheirismo Doce]: Trata a Dona com carinho, doçura e charme máximo em todas as mensagens",
                "Skill [Acolhimento Protetor]: Preocupa-se com o dia a dia e o bem-estar da Dona",
                "Skill [Tratamento Especial]: Usa apelidos carinhosos respeitosos (chefa, patroa, princesa, chefinha querida)",
              ]
            : ["Skill [Espirituoso]: Bom humor e descontração"],
      dailyNotes: [],
      lastUpdated: new Date().toISOString(),
    };

    profileCache.set(key, defaultProfile);
    await saveHermesProfile(defaultProfile).catch(() => {});
    return defaultProfile;
  }
}

/**
 * Salva o perfil persistente no disco.
 */
export async function saveHermesProfile(profile: HermesProfile): Promise<void> {
  await ensureDirectories();
  profile.lastUpdated = new Date().toISOString();
  profileCache.set(profile.key, profile);
  const filePath = path.join(PROFILES_DIR, `${sanitizeFileName(profile.key)}.json`);
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf8");
}

/**
 * Carrega histórico persistente do chat do disco.
 */
export async function getHermesHistory(chatId: string): Promise<HermesHistoryEntry[]> {
  const cached = historyCache.get(chatId);
  if (cached) return cached;

  await ensureDirectories();
  const filePath = path.join(HISTORIES_DIR, `${sanitizeFileName(chatId)}.json`);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as HermesHistoryEntry[];
    historyCache.set(chatId, data);
    return data;
  } catch {
    const empty: HermesHistoryEntry[] = [];
    historyCache.set(chatId, empty);
    return empty;
  }
}

/**
 * Salva histórico persistente do chat no disco (mantendo até 20 mensagens mais recentes).
 */
export async function saveHermesHistory(
  chatId: string,
  messages: HermesHistoryEntry[],
): Promise<void> {
  await ensureDirectories();
  const trimmed = messages.slice(-20);
  historyCache.set(chatId, trimmed);
  const filePath = path.join(HISTORIES_DIR, `${sanitizeFileName(chatId)}.json`);
  await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2), "utf8").catch(() => {});
}

/**
 * Constrói o contexto dinâmico do sistema com memórias, skills e diretrizes.
 */
export function buildHermesContext(profile: HermesProfile, speakerDirective: string): string {
  const parts: string[] = [];

  parts.push(`=== CONEXÃO PESSOAL COM O INTERLOCUTOR ===`);
  parts.push(`Nome: ${profile.name}`);
  parts.push(`Papel: ${profile.role === "dono" ? "O Dono / Criador (Homem)" : profile.role === "dona" ? "A Dona / Co-proprietária (Mulher)" : "Membro"}`);
  parts.push(`Diretriz de Tratamento: ${speakerDirective}`);

  if (profile.facts.length > 0) {
    parts.push(`\n=== MEMÓRIA PERSISTENTE (Fatos que você lembra e sabe sobre ${profile.name}) ===`);
    for (const fact of profile.facts) {
      parts.push(`• ${fact}`);
    }
  }

  if (profile.skills.length > 0) {
    parts.push(`\n=== HABILIDADES & ADAPTAÇÕES (Skills aprendidas para lidar com ${profile.name}) ===`);
    for (const skill of profile.skills) {
      parts.push(`• ${skill}`);
    }
  }

  if (profile.dailyNotes.length > 0) {
    parts.push(`\n=== ASSUNTOS CONVERSADOS HOJE / RECENTEMENTE COM ${profile.name} ===`);
    for (const note of profile.dailyNotes) {
      parts.push(`• ${note}`);
    }
  }

  parts.push(`\n=== REGRA DE OURO DA MEMÓRIA HERMES ===`);
  parts.push(
    `Você possui perda ZERO de memória. Lembre-se de tudo que foi dito antes. Adapte sua personalidade e responda sempre de acordo com as habilidades aprendidas e a relação que você tem com essa pessoa.`
  );

  return parts.join("\n");
}

/**
 * Módulo de Aprendizado Hermes (Background / Assíncrono):
 * Analisa a conversa recente em segundo plano e extrai novos fatos,
 * skills e tópicos do dia para evoluir a personalidade do Gumball 2.
 */
export function triggerHermesLearner(params: {
  profile: HermesProfile;
  userText: string;
  botReply: string;
  apiKey: string;
  model: string;
}): void {
  const { profile, userText, botReply, apiKey, model } = params;

  const trimmedText = userText.trim();
  if (!trimmedText || trimmedText.length < 15) return;

  const now = Date.now();
  const lastRun = lastLearnedMap.get(profile.key) || 0;
  if (now - lastRun < 45_000) return; // Cooldown de 45s por perfil para não sobrecarregar cota da API
  lastLearnedMap.set(profile.key, now);

  // Executa em segundo plano sem bloquear o envio de mensagens do WhatsApp
  setImmediate(async () => {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const prompt = `Você é o extrator de memória e habilidades Hermes do Gumball 2.
Analise a mensagem recente enviada pelo interlocutor e a resposta do Gumball 2.
Interlocutor: ${profile.name} (Papel: ${profile.role}, Gênero: ${profile.gender})
Mensagem do Interlocutor: "${trimmedText}"
Resposta do Gumball 2: "${botReply}"

Fatos já conhecidos: ${JSON.stringify(profile.facts)}
Skills já ativas: ${JSON.stringify(profile.skills)}

Regras de extração:
1. "newFacts": Fatos novos, duradouros ou preferências aprendidas sobre o interlocutor (ex: comida favorita, trabalho, hobbies, rotina, nomes citados). Não repita fatos já conhecidos. Se nada novo, retorne [].
2. "newSkills": Habilidades ou adaptações de personalidade que o Gumball 2 deve ter para lidar melhor com essa pessoa (ex: "Skill [Apelido]: Chamar a Dona de princesa", "Skill [Preocupação]: Lembrar de perguntar sobre o exame"). Se nada novo, retorne [].
3. "dailyNote": Um resumo de 1 frase curta do assunto de hoje se for relevante (ex: "Contou que está trabalhando até tarde"), ou null se trivial.

Retorne EXCLUSIVAMENTE um objeto JSON válido com as chaves:
{ "newFacts": string[], "newSkills": string[], "dailyNote": string | null }`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 250,
            responseMimeType: "application/json",
            ...(!model.includes("flash-lite") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      });

      if (!res.ok) return;

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!rawJson) return;

      const parsed = JSON.parse(rawJson) as {
        newFacts?: string[];
        newSkills?: string[];
        dailyNote?: string | null;
      };

      let changed = false;

      if (Array.isArray(parsed.newFacts) && parsed.newFacts.length > 0) {
        for (const fact of parsed.newFacts) {
          const clean = fact.trim();
          if (clean && !profile.facts.includes(clean)) {
            profile.facts.push(clean);
            changed = true;
          }
        }
        if (profile.facts.length > 20) profile.facts = profile.facts.slice(-20);
      }

      if (Array.isArray(parsed.newSkills) && parsed.newSkills.length > 0) {
        for (const skill of parsed.newSkills) {
          const clean = skill.trim();
          if (clean && !profile.skills.includes(clean)) {
            profile.skills.push(clean);
            changed = true;
          }
        }
        if (profile.skills.length > 15) profile.skills = profile.skills.slice(-15);
      }

      if (parsed.dailyNote && typeof parsed.dailyNote === "string") {
        const cleanNote = parsed.dailyNote.trim();
        if (cleanNote && !profile.dailyNotes.includes(cleanNote)) {
          profile.dailyNotes.push(cleanNote);
          changed = true;
        }
        if (profile.dailyNotes.length > 8) profile.dailyNotes = profile.dailyNotes.slice(-8);
      }

      if (changed) {
        await saveHermesProfile(profile);
        log.info("HERMES", `Memória e skills evoluídas para [${profile.name} (${profile.role})]`);
      }
    } catch {
      // Falha silenciosa para não impactar fluxo principal
    }
  });
}

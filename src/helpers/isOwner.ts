/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { getBotConfig, type BotConfig } from "../config.js";
import { lidCache } from "../cache/lidCache.js";

/** Extrai apenas dígitos do user part de um JID/número. */
export function extractIdentityDigits(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const at = trimmed.indexOf("@");
  const userPart = at === -1 ? trimmed : trimmed.slice(0, at);
  return userPart.replace(/\D/g, "");
}

/**
 * Compara identidade do usuário com dono configurado (LID, número ou cache).
 * Função pura testável — não lê disco.
 */
export function matchesOwnerIdentity(
  userId: string,
  owner: {
    ownerLID?: string;
    ownerNumber?: string;
    cachedOwnerLid?: string | null;
    extraOwners?: string[];
    extraOwnerLIDs?: string[];
    cachedExtraOwnerLids?: string[];
  },
): boolean {
  const trimmedUser = userId.trim();
  if (!trimmedUser) return false;

  if (owner.ownerLID && trimmedUser === owner.ownerLID) {
    return true;
  }

  if (owner.extraOwnerLIDs && owner.extraOwnerLIDs.includes(trimmedUser)) {
    return true;
  }

  if (owner.cachedOwnerLid && trimmedUser === owner.cachedOwnerLid) {
    return true;
  }

  if (owner.cachedExtraOwnerLids && owner.cachedExtraOwnerLids.includes(trimmedUser)) {
    return true;
  }

  const userDigits = extractIdentityDigits(trimmedUser);
  if (!userDigits) return false;

  const ownerDigits = extractIdentityDigits(owner.ownerNumber ?? "");
  if (ownerDigits && userDigits === ownerDigits) {
    return true;
  }

  if (owner.extraOwners && Array.isArray(owner.extraOwners)) {
    for (const extra of owner.extraOwners) {
      const extraDigits = extractIdentityDigits(extra);
      if (extraDigits && userDigits === extraDigits) {
        return true;
      }
    }
  }

  return false;
}

export async function isOwner(userLID: string): Promise<boolean> {
  const config = await getBotConfig();

  let cachedOwnerLid: string | null = null;
  const cachedExtraOwnerLids: string[] = [];

  const ownerDigits = extractIdentityDigits(config.ownerNumber ?? "");
  if (ownerDigits || (config.extraOwners && config.extraOwners.length > 0)) {
    await lidCache.load();
    if (!config.ownerLID && ownerDigits) {
      cachedOwnerLid = lidCache.get(`${ownerDigits}@s.whatsapp.net`);
    }
    if (config.extraOwners) {
      for (const extra of config.extraOwners) {
        const d = extractIdentityDigits(extra);
        if (d) {
          const lid = lidCache.get(`${d}@s.whatsapp.net`);
          if (lid) cachedExtraOwnerLids.push(lid);
        }
      }
    }
  }

  return matchesOwnerIdentity(userLID, {
    ownerLID: config.ownerLID,
    ownerNumber: config.ownerNumber,
    cachedOwnerLid,
    extraOwners: config.extraOwners,
    extraOwnerLIDs: config.extraOwnerLIDs,
    cachedExtraOwnerLids,
  });
}

export function isOwnerFromConfig(
  userLID: string,
  config: Pick<BotConfig, "ownerLID" | "ownerNumber"> & { extraOwners?: string[]; extraOwnerLIDs?: string[] },
): boolean {
  const ownerDigits = extractIdentityDigits(config.ownerNumber ?? "");
  const cachedOwnerLid = !config.ownerLID && ownerDigits
    ? lidCache.get(`${ownerDigits}@s.whatsapp.net`)
    : null;

  const cachedExtraOwnerLids: string[] = [];
  if (config.extraOwners) {
    for (const extra of config.extraOwners) {
      const d = extractIdentityDigits(extra);
      if (d) {
        const lid = lidCache.get(`${d}@s.whatsapp.net`);
        if (lid) cachedExtraOwnerLids.push(lid);
      }
    }
  }

  return matchesOwnerIdentity(userLID, {
    ownerLID: config.ownerLID,
    ownerNumber: config.ownerNumber,
    cachedOwnerLid,
    extraOwners: config.extraOwners,
    extraOwnerLIDs: config.extraOwnerLIDs,
    cachedExtraOwnerLids,
  });
}

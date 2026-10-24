import { describe, it } from "node:test";
import assert from "node:assert";
import type { WASocket } from "baileys";
import { authorizeCommand, parseCommandInput, processMessage } from "../src/handlers/messageProcessor.js";
import { CommandHandler } from "../src/handlers/commandHandler.js";
import type { Command } from "../src/types/Command.js";

const command: Command = {
  name: "ping",
  description: "Ping",
  category: "all",
  async execute() {},
};

function authorization(overrides: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const thanay = {
    sendMessage: async (_from: string, content: { text?: string }) => { sent.push(content.text ?? ""); },
  } as unknown as WASocket;
  return {
    sent,
    input: {
      command,
      thanay,
      from: "chat",
      isGroup: true,
      userIsOwner: false,
      groupAdminOnly: false,
      userIsAdmin: async () => false,
      botIsAdmin: async () => true,
      isCommandBlocked: async () => false,
      t: (key: string) => key,
      ...overrides,
    },
  };
}

describe("messageProcessor command stages", () => {
  it("parses command name, args and multiline raw args", () => {
    assert.deepEqual(parseCommandInput("!Eval first\nsecond value", "!"), {
      commandName: "eval",
      rawArgs: "first\nsecond value",
      args: ["first", "second", "value"],
    });
  });

  it("denies owner-only commands before other checks", async () => {
    let blockedChecked = false;
    const state = authorization({
      command: { ...command, ownerOnly: true },
      isCommandBlocked: async () => { blockedChecked = true; return false; },
    });
    assert.equal(await authorizeCommand(state.input), false);
    assert.deepEqual(state.sent, ["errors.ownerOnly"]);
    assert.equal(blockedChecked, false);
  });

  it("enforces group admin-only mode", async () => {
    const state = authorization({ groupAdminOnly: true });
    assert.equal(await authorizeCommand(state.input), false);
    assert.deepEqual(state.sent, ["errors.groupCommandsAdminOnly"]);
  });

  it("allows an authorized command without sending an error", async () => {
    const state = authorization({ userIsAdmin: async () => true });
    assert.equal(await authorizeCommand(state.input), true);
    assert.deepEqual(state.sent, []);
  });
});

describe("messageProcessor read receipts", () => {
  it("marks message as read only for owner in PV after command execution", async () => {
    let commandExecuted = false;
    const pingCommand: Command = {
      name: "ping",
      description: "Ping",
      category: "all",
      async execute() {
        commandExecuted = true;
      },
    };
    const handler = {
      get: (name: string) => (name === "ping" ? pingCommand : undefined),
      listNames: () => ["ping"],
      listUnique: () => [pingCommand],
    } as unknown as CommandHandler;

    const readKeys: unknown[] = [];
    const thanay = {
      readMessages: async (keys: unknown[]) => {
        readKeys.push(...keys);
      },
      sendMessage: async () => {},
      sendPresenceUpdate: async () => {},
    } as unknown as WASocket;

    const ownerMsg = {
      key: { id: "msg-owner-1", remoteJid: "159034049044504@lid", fromMe: false },
      message: { conversation: "!ping" },
    };

    await processMessage(thanay, handler, ownerMsg);
    assert.equal(commandExecuted, true);
    assert.equal(readKeys.length, 1);
    assert.deepEqual(readKeys[0], ownerMsg.key);
  });

  it("does not mark message as read for non-owner in PV", async () => {
    const pingCommand: Command = {
      name: "ping",
      description: "Ping",
      category: "all",
      async execute() {},
    };
    const handler = {
      get: (name: string) => (name === "ping" ? pingCommand : undefined),
      listNames: () => ["ping"],
      listUnique: () => [pingCommand],
    } as unknown as CommandHandler;

    const readKeys: unknown[] = [];
    const thanay = {
      readMessages: async (keys: unknown[]) => {
        readKeys.push(...keys);
      },
      sendMessage: async () => {},
      sendPresenceUpdate: async () => {},
    } as unknown as WASocket;

    const nonOwnerMsg = {
      key: { id: "msg-user-1", remoteJid: "9999999999@lid", fromMe: false },
      message: { conversation: "!ping" },
    };

    await processMessage(thanay, handler, nonOwnerMsg);
    assert.equal(readKeys.length, 0);
  });

  it("does not mark message as read for owner in group", async () => {
    const pingCommand: Command = {
      name: "ping",
      description: "Ping",
      category: "all",
      async execute() {},
    };
    const handler = {
      get: (name: string) => (name === "ping" ? pingCommand : undefined),
      listNames: () => ["ping"],
      listUnique: () => [pingCommand],
    } as unknown as CommandHandler;

    const readKeys: unknown[] = [];
    const thanay = {
      readMessages: async (keys: unknown[]) => {
        readKeys.push(...keys);
      },
      sendMessage: async () => {},
      sendPresenceUpdate: async () => {},
    } as unknown as WASocket;

    const groupOwnerMsg = {
      key: { id: "msg-group-1", remoteJid: "123456789@g.us", participant: "159034049044504@lid", fromMe: false },
      message: { conversation: "!ping" },
    };

    await processMessage(thanay, handler, groupOwnerMsg);
    assert.equal(readKeys.length, 0);
  });
});

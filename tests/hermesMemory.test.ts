import { describe, it } from "node:test";
import assert from "node:assert";
import {
  resolveSpeaker,
  buildHermesContext,
  getHermesProfile,
  getHermesHistory,
  saveHermesHistory,
  HermesProfile,
} from "../src/helpers/hermesMemory.js";
import { defaultConfig } from "../src/config.js";

describe("hermesMemory speaker resolution", () => {
  const mockConfig = {
    ...defaultConfig,
    ownerNumber: "258879116693",
    ownerLID: "159034049044504@lid",
    ownerName: "Gumball",
    extraOwners: ["258835152398"],
    extraOwnerLIDs: ["19650096197757@lid"],
  };

  it("identifies Gumball (the creator/dono) by phone number", () => {
    const speaker = resolveSpeaker({
      senderId: "258879116693@s.whatsapp.net",
      senderName: "Gumball",
      config: mockConfig,
    });
    assert.equal(speaker.role, "dono");
    assert.equal(speaker.key, "dono_gumball");
    assert.ok(speaker.directive.includes("GUMBALL"));
    assert.ok(speaker.directive.includes("clone"));
  });

  it("identifies Gumball by LID", () => {
    const speaker = resolveSpeaker({
      senderId: "159034049044504@lid",
      config: mockConfig,
    });
    assert.equal(speaker.role, "dono");
    assert.equal(speaker.key, "dono_gumball");
  });

  it("identifies A Dona (the female owner) by phone number", () => {
    const speaker = resolveSpeaker({
      senderId: "258835152398@s.whatsapp.net",
      senderName: "Minha Chefa",
      config: mockConfig,
    });
    assert.equal(speaker.role, "dona");
    assert.equal(speaker.key, "dona");
    assert.ok(speaker.directive.includes("DONA"));
    assert.ok(speaker.directive.includes("carinhoso"));
    assert.ok(speaker.directive.includes("cavalheiro"));
  });

  it("identifies A Dona by LID", () => {
    const speaker = resolveSpeaker({
      senderId: "19650096197757@lid",
      config: mockConfig,
    });
    assert.equal(speaker.role, "dona");
    assert.equal(speaker.key, "dona");
    assert.ok(speaker.directive.includes("chefa"));
  });

  it("identifies regular members", () => {
    const speaker = resolveSpeaker({
      senderId: "551199999999@s.whatsapp.net",
      senderName: "Lucas",
      config: mockConfig,
    });
    assert.equal(speaker.role, "membro");
    assert.ok(speaker.key.startsWith("member_"));
  });
});

describe("hermesMemory context and profile", () => {
  it("builds rich context with facts and skills", () => {
    const profile: HermesProfile = {
      key: "dona",
      role: "dona",
      name: "Princesa",
      gender: "mulher",
      facts: ["Gosta de chocolate", "Dona da Thanay Bot"],
      skills: ["Skill [Carinho]: Falar com doçura", "Skill [Atenção]: Perguntar se comeu"],
      dailyNotes: ["Disse que hoje o dia foi produtivo"],
      lastUpdated: new Date().toISOString(),
    };

    const context = buildHermesContext(profile, "Seja carinhoso e doce");
    assert.ok(context.includes("Princesa"));
    assert.ok(context.includes("Gosta de chocolate"));
    assert.ok(context.includes("Skill [Carinho]"));
    assert.ok(context.includes("Disse que hoje o dia foi produtivo"));
  });

  it("persists history and retrieves without loss", async () => {
    const testChat = "test_chat_hermes_001";
    await saveHermesHistory(testChat, [
      { role: "user", parts: [{ text: "oi gumball" }] },
      { role: "model", parts: [{ text: "fala meu chefe!" }] },
    ]);

    const reloaded = await getHermesHistory(testChat);
    assert.equal(reloaded.length, 2);
    assert.equal(reloaded[0].parts[0].text, "oi gumball");
    assert.equal(reloaded[1].parts[0].text, "fala meu chefe!");
  });
});

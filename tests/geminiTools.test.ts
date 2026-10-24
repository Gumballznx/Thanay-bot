import { describe, it } from "node:test";
import assert from "node:assert";
import { executeGeminiToolCall, GeminiToolContext } from "../src/helpers/geminiTools.js";
import { Command } from "../src/types/Command.js";

describe("geminiTools helper", () => {
  it("consultar_status_sistema returns real metrics", async () => {
    const mockContext = {
      thanay: {} as any,
      commandHandler: { get: () => undefined, listUnique: () => [], listNames: () => [] },
      message: {} as any,
      sender: "258879116693@s.whatsapp.net",
      from: "258879116693@s.whatsapp.net",
      isGroup: false,
      userIsOwner: true,
    } as unknown as GeminiToolContext;

    const result = await executeGeminiToolCall(
      { name: "consultar_status_sistema" },
      mockContext,
    );

    assert.strictEqual(result.status, "sucesso");
    assert.ok(result.metricasReais);
    const metricas = result.metricasReais as Record<string, string>;
    assert.ok(metricas.ramHeapUsada.includes("MB"));
    assert.ok(metricas.ramRssUsada.includes("MB"));
    assert.ok(typeof metricas.tempoAtividadeBot === "string");
  });

  it("enviar_recado sends to Dona when target is dona", async () => {
    let sentJid = "";
    let sentContent = "";

    const mockSocket = {
      sendMessage: async (jid: string, content: { text: string }) => {
        sentJid = jid;
        sentContent = content.text;
      },
    };

    const mockContext = {
      thanay: mockSocket as any,
      commandHandler: { get: () => undefined, listUnique: () => [], listNames: () => [] },
      message: { pushName: "Gumball" } as any,
      sender: "258879116693@s.whatsapp.net",
      from: "258879116693@s.whatsapp.net",
      isGroup: false,
      userIsOwner: true,
    } as unknown as GeminiToolContext;

    const result = await executeGeminiToolCall(
      {
        name: "enviar_recado",
        args: {
          destinatario: "dona",
          mensagem: "te adoro demais chefinha!",
        },
      },
      mockContext,
    );

    assert.strictEqual(result.status, "sucesso");
    assert.ok(sentJid.includes("258835152398@s.whatsapp.net"));
    assert.ok(sentContent.includes("te adoro demais"));
  });

  it("enviar_recado rejects non-owner sending to third party numbers", async () => {
    const mockContext = {
      thanay: { sendMessage: async () => {} } as any,
      commandHandler: { get: () => undefined, listUnique: () => [], listNames: () => [] },
      message: { pushName: "Membro" } as any,
      sender: "258849999999@s.whatsapp.net",
      from: "120363@g.us",
      isGroup: true,
      userIsOwner: false,
    } as unknown as GeminiToolContext;

    const result = await executeGeminiToolCall(
      {
        name: "enviar_recado",
        args: {
          destinatario: "258841234567",
          mensagem: "spam teste",
        },
      },
      mockContext,
    );

    assert.strictEqual(result.status, "erro");
    assert.ok(String(result.detalhe).includes("Apenas os donos"));
  });

  it("executar_comando rejects unknown command", async () => {
    const mockContext = {
      thanay: {} as any,
      commandHandler: { get: () => undefined, listUnique: () => [], listNames: () => [] },
      message: {} as any,
      sender: "258879116693@s.whatsapp.net",
      from: "258879116693@s.whatsapp.net",
      isGroup: false,
      userIsOwner: true,
    } as unknown as GeminiToolContext;

    const result = await executeGeminiToolCall(
      {
        name: "executar_comando",
        args: { comando: "comando_inexistente_xyz" },
      },
      mockContext,
    );

    assert.strictEqual(result.status, "erro");
    assert.ok(String(result.detalhe).includes("não existe"));
  });

  it("executar_comando enforces ownerOnly and adminOnly permissions", async () => {
    const dummyOwnerCmd: Command = {
      name: "reiniciar",
      description: "Restart bot",
      category: "geral",
      ownerOnly: true,
      execute: async () => {},
    };

    const dummyAdminCmd: Command = {
      name: "fechar_gp",
      description: "Close group",
      category: "grupo",
      adminOnly: true,
      groupOnly: true,
      execute: async () => {},
    };

    const mockRegistry = new Map<string, Command>([
      ["reiniciar", dummyOwnerCmd],
      ["fechar_gp", dummyAdminCmd],
    ]);

    const mockHandler = {
      get: (name: string) => mockRegistry.get(name),
      listUnique: () => Array.from(mockRegistry.values()),
      listNames: () => Array.from(mockRegistry.keys()),
    };

    // Usuário comum em grupo tentando comando de dono
    const userContext = {
      thanay: {} as any,
      commandHandler: mockHandler,
      message: {} as any,
      sender: "258849999999@s.whatsapp.net",
      from: "120363@g.us",
      isGroup: true,
      userIsOwner: false,
      isAdmin: async () => false,
      isBotAdmin: async () => true,
    } as unknown as GeminiToolContext;

    const resOwner = await executeGeminiToolCall(
      { name: "executar_comando", args: { comando: "reiniciar" } },
      userContext,
    );
    assert.strictEqual(resOwner.status, "erro");
    assert.ok(String(resOwner.detalhe).includes("exclusivo para os donos"));

    // Usuário comum em grupo tentando comando de admin
    const resAdmin = await executeGeminiToolCall(
      { name: "executar_comando", args: { comando: "fechar_gp" } },
      userContext,
    );
    assert.strictEqual(resAdmin.status, "erro");
    assert.ok(String(resAdmin.detalhe).includes("administrador"));

    // Dono executando comando com sucesso
    let executed = false;
    dummyOwnerCmd.execute = async () => {
      executed = true;
    };

    const ownerContext = {
      ...userContext,
      userIsOwner: true,
    };

    const resSuccess = await executeGeminiToolCall(
      { name: "executar_comando", args: { comando: "reiniciar" } },
      ownerContext,
    );
    assert.strictEqual(resSuccess.status, "sucesso");
    assert.strictEqual(executed, true);
  });
});

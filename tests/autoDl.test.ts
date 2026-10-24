import { describe, it } from "node:test";
import assert from "node:assert";
import { detectAutoDlTarget, extractUrls } from "../src/helpers/autoDl.js";
import { normalizeGroupData, DEFAULT_GROUP } from "../src/database/groupDB.js";
import autodlCommand from "../src/commands/all/grupo/autodl.js";

describe("autoDl helper", () => {
  it("extracts URLs correctly including punctuation trimming", () => {
    const urls = extractUrls("Olha esse link: https://vm.tiktok.com/ZMh123/! E esse: https://youtu.be/dQw4w9WgXcQ.");
    assert.deepEqual(urls, [
      "https://vm.tiktok.com/ZMh123/",
      "https://youtu.be/dQw4w9WgXcQ",
    ]);
  });

  it("detects TikTok URLs", () => {
    const target1 = detectAutoDlTarget("https://www.tiktok.com/@user/video/1234567890");
    assert.deepEqual(target1, {
      type: "tiktok",
      url: "https://www.tiktok.com/@user/video/1234567890",
    });

    const target2 = detectAutoDlTarget("Mano olha isso https://vm.tiktok.com/ZMh987654/");
    assert.deepEqual(target2, {
      type: "tiktok",
      url: "https://vm.tiktok.com/ZMh987654/",
    });
  });

  it("detects Instagram URLs", () => {
    const target1 = detectAutoDlTarget("https://www.instagram.com/reel/DC12345abc/?igsh=xyz");
    assert.deepEqual(target1, {
      type: "instagram",
      url: "https://www.instagram.com/reel/DC12345abc/?igsh=xyz",
    });

    const target2 = detectAutoDlTarget("Foto linda https://www.instagram.com/p/ABC123xyz/");
    assert.deepEqual(target2, {
      type: "instagram",
      url: "https://www.instagram.com/p/ABC123xyz/",
    });
  });

  it("detects YouTube URLs", () => {
    const target1 = detectAutoDlTarget("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.deepEqual(target1, {
      type: "youtube",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    const target2 = detectAutoDlTarget("Escuta ai https://youtu.be/dQw4w9WgXcQ");
    assert.deepEqual(target2, {
      type: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
  });

  it("detects Pinterest URLs", () => {
    const target1 = detectAutoDlTarget("https://pin.it/7xK9abc");
    assert.deepEqual(target1, {
      type: "pinterest",
      url: "https://pin.it/7xK9abc",
    });

    const target2 = detectAutoDlTarget("Ideia https://www.pinterest.com/pin/123456789/");
    assert.deepEqual(target2, {
      type: "pinterest",
      url: "https://www.pinterest.com/pin/123456789/",
    });
  });

  it("returns null for non-supported or non-media URLs", () => {
    assert.equal(detectAutoDlTarget("https://google.com"), null);
    assert.equal(detectAutoDlTarget("https://github.com/Gumballxnz"), null);
    assert.equal(detectAutoDlTarget("Acesse nosso grupo: https://chat.whatsapp.com/ABC123DEF456"), null);
    assert.equal(detectAutoDlTarget("texto simples sem nenhum link"), null);
  });
});

describe("autoDl persistence and command", () => {
  it("normalizes autodl field with fallback to false", () => {
    const defaultData = normalizeGroupData({});
    assert.equal(defaultData.autodl, false);

    const activeData = normalizeGroupData({ autodl: true });
    assert.equal(activeData.autodl, true);

    const malformedData = normalizeGroupData({ autodl: "yes" });
    assert.equal(malformedData.autodl, false);
  });

  it("has correct command properties", () => {
    assert.equal(autodlCommand.name, "autodl");
    assert.equal(autodlCommand.groupOnly, true);
    assert.equal(autodlCommand.adminOnly, true);
    assert.equal(autodlCommand.category, "grupo");
    assert.ok(autodlCommand.aliases?.includes("autodownload"));
  });
});

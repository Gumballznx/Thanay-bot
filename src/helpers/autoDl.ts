/**
 * @author Gumball · github.com/Gumballxnz
 * @project Thanay Bot
 */
import { proto, WAMessage, WASocket } from "baileys";
import { downloadInstagram, isValidInstagramURL } from "./instagramDownload.js";
import { downloadPinterest, isValidPinURL } from "./pinterestDownload.js";
import { downloadTiktok, isValidTiktokURL, TiktokDownloadResult } from "./tiktokDownload.js";
import {
  downloadYouTube,
  getYouTubeVideoID,
  isYouTubeURL,
  sanitizeYtFileName,
} from "./youtubeDownload.js";
import { localizeError } from "./localizeError.js";
import { downloadToTemp } from "../media/downloadToTemp.js";
import { runMediaJob } from "../media/runMediaJob.js";
import { log } from "../logger.js";

const URL_REGEX = /https?:\/\/[^\s]+/gi;

export type AutoDlMediaType = "tiktok" | "instagram" | "youtube" | "pinterest";

export type AutoDlTarget = {
  type: AutoDlMediaType;
  url: string;
};

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return matches.map((u) => u.replace(/[.,!?;:)>\]]+$/, ""));
}

export function detectAutoDlTarget(text: string): AutoDlTarget | null {
  const urls = extractUrls(text);
  for (const url of urls) {
    if (isValidTiktokURL(url)) {
      return { type: "tiktok", url };
    }
    if (isValidInstagramURL(url)) {
      return { type: "instagram", url };
    }
    if (isYouTubeURL(url) && Boolean(getYouTubeVideoID(url))) {
      return { type: "youtube", url };
    }
    if (isValidPinURL(url)) {
      return { type: "pinterest", url };
    }
  }
  return null;
}

async function sendTiktokResult(
  thanay: WASocket,
  from: string,
  message: WAMessage,
  data: TiktokDownloadResult,
  caption: string,
  signal: AbortSignal,
): Promise<void> {
  if (data.type === "image") {
    for (let i = 0; i < data.urls.length; i++) {
      const media = await downloadToTemp({ url: data.urls[i], kind: "image", signal });
      try {
        await thanay.sendMessage(from, {
          image: { url: media.path },
          caption: i === 0 ? caption : undefined,
        }, { quoted: message });
      } finally {
        await media.cleanup();
      }
    }
  } else if (data.urls[0]) {
    const media = await downloadToTemp({ url: data.urls[0], kind: "video", signal });
    try {
      await thanay.sendMessage(from, {
        video: { url: media.path },
        caption,
      }, { quoted: message });
    } finally {
      await media.cleanup();
    }
  }

  if (data.audio) {
    const media = await downloadToTemp({ url: data.audio, kind: "audio", signal });
    try {
      await thanay.sendMessage(from, {
        audio: { url: media.path },
        mimetype: "audio/mpeg",
      }, { quoted: message });
    } finally {
      await media.cleanup();
    }
  }
}

export async function tryHandleAutoDl(params: {
  thanay: WASocket;
  from: string;
  sender: string;
  body: string;
  message: proto.IWebMessageInfo;
  t: (key: string, vars?: Record<string, string>) => string;
}): Promise<boolean> {
  const { thanay, from, sender, body, message, t } = params;
  const target = detectAutoDlTarget(body);
  if (!target) return false;

  log.info("AUTODL", `AutoDL disparado para [${target.type}] por ${sender} no grupo ${from}`);

  if (target.type === "tiktok") {
    await runMediaJob({ thanay, from, sender, kind: "tiktok", t }, async (signal) => {
      await thanay.sendMessage(from, { text: t("commands.tiktok.downloading") }, { quoted: message as WAMessage });
      try {
        const data = await downloadTiktok(target.url, { signal });
        const caption = `🎵 *${data.title}*\n\n${t("commands.tiktok.downloadDone")}`;
        await sendTiktokResult(thanay, from, message as WAMessage, data, caption, signal);
      } catch (error) {
        await thanay.sendMessage(from, {
          text: t("commands.tiktok.error", { message: localizeError(error, t, "commands.tiktok.unknown") }),
        }, { quoted: message as WAMessage });
      }
    });
    return true;
  }

  if (target.type === "instagram") {
    await runMediaJob({ thanay, from, sender, kind: "instagram", t }, async (signal) => {
      await thanay.sendMessage(from, { text: t("commands.instagram.downloading") }, { quoted: message as WAMessage });
      try {
        const data = await downloadInstagram(target.url, { signal });

        if (data.count === 0) {
          await thanay.sendMessage(from, { text: t("commands.instagram.downloadFailed") }, { quoted: message as WAMessage });
          return;
        }

        await thanay.sendMessage(from, {
          text: t("commands.instagram.sending", {
            count: String(data.count),
            fileWord: data.count === 1 ? t("common.file") : t("common.files"),
          }),
        }, { quoted: message as WAMessage });

        for (let i = 0; i < data.medias.length; i++) {
          const item = data.medias[i];
          const local = await downloadToTemp({ url: item.url, kind: item.type, signal });
          const caption = i === 0 ? t("commands.instagram.done") : undefined;
          try {
            const isImage = local.contentType.startsWith("image/");
            await thanay.sendMessage(from, isImage
              ? { image: { url: local.path }, caption }
              : { video: { url: local.path }, caption }, { quoted: message as WAMessage });
          } finally {
            await local.cleanup();
          }
        }
      } catch (error) {
        await thanay.sendMessage(from, {
          text: t("commands.instagram.error", { message: localizeError(error, t, "commands.instagram.unknown") }),
        }, { quoted: message as WAMessage });
      }
    });
    return true;
  }

  if (target.type === "youtube") {
    const videoId = getYouTubeVideoID(target.url);
    const videoURL = `https://youtube.com/watch?v=${videoId}`;
    await runMediaJob({ thanay, from, sender, kind: "youtube-video", t }, async (signal) => {
      await thanay.sendMessage(from, { text: t("commands.ytmp4.downloading") }, { quoted: message as WAMessage });
      let media: Awaited<ReturnType<typeof downloadYouTube>>["media"];
      try {
        const video = await downloadYouTube(videoURL, "mp4", { signal });
        if (!video.success || !video.media) throw new Error(video.error || t("commands.ytmp4.unknown"));
        media = video.media;
        const title = video.title || t("common.file");
        const author = video.author || t("common.unknown");
        const common = {
          mimetype: "video/mp4",
          fileName: `${sanitizeYtFileName(title, "video")}.mp4`,
          caption: `🎬 *${title}*\n👤 ${author}`,
        };
        await thanay.sendMessage(from, media.size > 50 * 1024 * 1024
          ? { document: { url: media.path }, ...common }
          : { video: { url: media.path }, ...common }, { quoted: message as WAMessage });
      } catch (error) {
        await thanay.sendMessage(from, {
          text: t("commands.ytmp4.error", { message: localizeError(error, t, "commands.ytmp4.unknown") }),
        }, { quoted: message as WAMessage });
      } finally {
        await media?.cleanup();
      }
    });
    return true;
  }

  if (target.type === "pinterest") {
    await runMediaJob({ thanay, from, sender, kind: "pinterest", t }, async (signal) => {
      await thanay.sendMessage(from, { text: t("commands.pinterest.downloading") }, { quoted: message as WAMessage });
      try {
        const data = await downloadPinterest(target.url, { signal });
        const media = await downloadToTemp({ url: data.url, kind: data.type, signal });
        try {
          await thanay.sendMessage(from, data.type === "video"
            ? {
              video: { url: media.path },
              caption: t("commands.pinterest.done"),
            }
            : {
              image: { url: media.path },
              caption: t("commands.pinterest.done"),
            }, { quoted: message as WAMessage });
        } finally {
          await media.cleanup();
        }
      } catch (error) {
        await thanay.sendMessage(from, {
          text: t("commands.pinterest.error", { message: localizeError(error, t, "commands.pinterest.unknown") }),
        }, { quoted: message as WAMessage });
      }
    });
    return true;
  }

  return false;
}

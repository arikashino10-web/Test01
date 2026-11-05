const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const https = require("https");
const http = require("http");
const yts = require("yt-search");

const API_BASE_URL = "https://hinata-shazam-api-production.up.railway.app";

const TMP_DIR        = path.join(__dirname, "cache");
const MAX_BYTES      = 100 * 1024 * 1024;

const REACT_WORKING = "🐤";
const REACT_DONE    = "🪶";
const REACT_ERROR   = "❌";

const sentSongIds    = new Set();
const pendingSongIds = new Set();
const failedSongIds  = new Set();

const CLEANUP_DELAY_MS = 10 * 60 * 1000;

function isLocked(msgID) {
  return sentSongIds.has(msgID) || pendingSongIds.has(msgID) || failedSongIds.has(msgID);
}
function markSending(msgID)  { pendingSongIds.add(msgID); }
function markSent(msgID)     { pendingSongIds.delete(msgID); sentSongIds.add(msgID); }
function markFailed(msgID)   { pendingSongIds.delete(msgID); failedSongIds.add(msgID); }

function scheduleCleanup(msgID) {
  setTimeout(() => {
    sentSongIds.delete(msgID);
    pendingSongIds.delete(msgID);
    failedSongIds.delete(msgID);
  }, CLEANUP_DELAY_MS);
}

function react(api, event, emoji) {
  try { api.setMessageReaction(emoji, event.messageID, () => {}, true); } catch (_) {}
}

function registerCard(msgID, data) {
  const payload = { commandName: "find", messageID: msgID, ...data };
  global.GoatBot.onReply.set(msgID, payload);
  global.GoatBot.onReaction.set(msgID, payload);
}

async function checkVIP(senderID, usersData, message) {
  const ADMINS = global.GoatBot?.config?.adminBot || [];
  const isBotAdmin = ADMINS.includes(senderID);

  if (isBotAdmin) return true;

  const userData = await usersData.get(senderID);
  const vip = userData?.data?.vip;

  if (!vip || !vip.expires || vip.expires < Date.now()) {
    await message.reply(
      "❌ 𝐕𝐈𝐏 𝐎𝐍𝐋𝐘 𝐂𝐎𝐌𝐌𝐀𝐍𝐃\n" +
      "• 𝐎𝐧𝐥𝐲 𝐕𝐈𝐏 𝐮𝐬𝐞𝐫𝐬 𝐜𝐚𝐧 𝐮𝐬𝐞 𝐟𝐢𝐧𝐝\n" +
      "• 𝐓𝐲𝐩𝐞: vip buy"
    );
    return false;
  }

  return true;
}

async function baseApiUrl() {
  const base = await axios.get("https://raw.githubusercontent.com/mahmudx7/HINATA/main/baseApiUrl.json");
  return base.data.mahmud;
}

async function downloadViaNewApi({ videoID, title, type }) {
  const ext = type === "audio" ? "mp3" : "mp4";
  const filePath = path.join(TMP_DIR, `${Date.now()}_ytb.${ext}`);

  const apiUrl = await baseApiUrl();
  const { data } = await axios.get(`${apiUrl}/api/ytb/get?id=${videoID}&type=${type}`, { timeout: 60000 });

  const info = data?.data;
  if (!info || !info.downloadLink) throw new Error("API did not return a download URL.");

  const response = await axios({ url: info.downloadLink, method: "GET", responseType: "stream", timeout: 180000 });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });

  const { size } = await fs.stat(filePath);
  if (size < 1024) throw new Error(`Download too small (${size}B)`);

  return {
    filePath,
    caption: type === "audio"
      ? `✅ | 𝐇𝐞𝐫𝐞'𝐬 𝐲𝐨𝐮𝐫 𝐫𝐞𝐪𝐮𝐞𝐬𝐭𝐞𝐝 𝐬𝐨𝐧𝐠\n➡️ ${info.title || title}`
      : `• ✨𝐓𝐢𝐭𝐥𝐞: ${info.title || title}`
  };
}

function cleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
}

module.exports = {
  config: {
    name: "find",
    aliases: ["finds", "shazam", "detect"],
    version: "3.8.0",
    author: "Arafat",
    countDown: 15,
    role: 0,
    shortDescription: "Detect song from video/audio and download the full track",
    longDescription:
      "Reply to any video or audio with 'find' → detects the background song + sends info card.\n" +
      "Reply to the card OR react to it → downloads and sends the full song (sent only once).\n" +
      "If download fails, the card is permanently locked — no spam retries.",
    category: "music",
    guide: {
      en: "Step 1 — Reply to a video or audio: {pn}\nStep 2 — Reply to the card OR react with any emoji → full song sent (once only)"
    }
  },

  onStart: async function ({ message, event, api, usersData }) {
    const allowed = await checkVIP(event.senderID, usersData, message);
    if (!allowed) return;

    const afterCmd = (event.body || '').trim().replace(/^[^\s]+\s*/i, '').trim().toLowerCase();

    let mode = null;
    if (['-a', 'audio', '-audio', 'find audio', 'find -a'].includes(afterCmd)) {
      mode = 'audio';
    } else if (['-v', 'video', '-video', 'find video', 'find -v'].includes(afterCmd)) {
      mode = 'video';
    }

    return handleFindSong({ message, event, api, mode });
  },

  onReply: async function ({ message, event, api, Reply, usersData }) {
    const allowed = await checkVIP(event.senderID, usersData, message);
    if (!allowed) return;

    const body = (event.body || "").trim().toLowerCase();
    if (body === "send video") {
      return sendVideo({ message, event, api, songData: Reply });
    }
    return sendAudio({ message, event, api, songData: Reply });
  },

  onReaction: async function ({ message, event, api, Reaction, usersData }) {
    const allowed = await checkVIP(event.senderID, usersData, message);
    if (!allowed) return;

    return sendAudio({ message, event, api, songData: Reaction });
  }
};

async function handleFindSong({ message, event, api, mode }) {
  const reply = event.messageReply;
  if (!reply) {
    return message.reply("❌ | Please reply to a video or audio message and type: !find");
  }

  const mediaUrl = extractMediaUrl(reply);
  if (!mediaUrl) {
    return message.reply("❌ | No video or audio found in the replied message.");
  }

  react(api, event, REACT_WORKING);

  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/find`, {
      params: { url: mediaUrl },
      timeout: 60000
    });

    if (!data.success) {
      react(api, event, REACT_ERROR);
      return message.reply("❌ | No song detected in this video/audio.");
    }

    const song = data.data;

    const result = {
      title:        song.title       || "Unknown",
      artist:       song.artist      || "Unknown",
      release_date: song.detectedAt  ? new Date(song.detectedAt).toLocaleDateString() : null,
      song_link:    song.shazamLink  || null,
      thumbnail:    song.thumbnail   || null,
      audioUrl:     song.audioUrl    || null,
      _shazamMeta:  [],
    };

    const info = buildSongInfo(result);

    // Silent direct-download modes (no card)
    if (mode === 'audio') {
      react(api, event, REACT_DONE);
      return sendAudio({
        message, event, api,
        songData: {
          title:     info.title,
          artist:    info.artist,
          audioUrl:  result.audioUrl,
          messageID: event.messageID
        }
      });
    }

    if (mode === 'video') {
      react(api, event, REACT_DONE);
      return sendVideo({
        message, event, api,
        songData: {
          title:     info.title,
          artist:    info.artist,
          audioUrl:  result.audioUrl,
          messageID: event.messageID
        }
      });
    }

    // Default: card flow
    const coverUrl  = result.thumbnail;
    const coverPath = await downloadCover(coverUrl, result.song_link || Date.now());

    const ts = Date.now();
    const canvasPath = await buildSongCanvas(info, coverPath, ts);

    let sentMsg;
    if (canvasPath && fs.existsSync(canvasPath)) {
      sentMsg = await message.reply({ body: buildCaption(info), attachment: fs.createReadStream(canvasPath) });
      cleanFile(canvasPath);
    } else if (coverPath && fs.existsSync(coverPath)) {
      sentMsg = await message.reply({ body: buildCaption(info), attachment: fs.createReadStream(coverPath) });
    } else {
      sentMsg = await message.reply(`❍ ${info.title} — ${info.artist}`);
    }
    if (coverPath) cleanFile(coverPath);

    react(api, event, REACT_DONE);
    registerCard(sentMsg.messageID, {
      title:    info.title,
      artist:   info.artist,
      audioUrl: result.audioUrl,
      songLink: result.song_link
    });

  } catch (err) {
    react(api, event, REACT_ERROR);
    await message.reply(`❌ | Error detecting song.`);
  }
}

async function sendVideo({ message, event, api, songData }) {
  const { title, artist, audioUrl, messageID: cardMsgID } = songData;

  if (!title || !artist) {
    return message.reply("❌ | Song data missing. Please use !find again.");
  }

  if (isLocked(cardMsgID)) return;

  markSending(cardMsgID);
  scheduleCleanup(cardMsgID);

  react(api, event, REACT_WORKING);
  await fs.ensureDir(TMP_DIR);

  const searchQuery = `${title} ${artist}`;
  let filePath = null;
  let caption = null;

  // Step 1: search YouTube then fetch via new API
  let ytSelected = null;
  try {
    const ytResults = await yts(searchQuery);
    if (ytResults && ytResults.videos.length) ytSelected = ytResults.videos[0];
  } catch (_) {}

  if (ytSelected) {
    try {
      const result = await downloadViaNewApi({ videoID: ytSelected.videoId, title: ytSelected.title, type: "video" });
      filePath = result.filePath;
      caption  = result.caption;
    } catch (apiErr) {
      console.warn(`[find] sendVideo new API failed: ${apiErr.message}`);
      filePath = null;
    }
  }

  // All failed — now send error
  if (!filePath) {
    markFailed(cardMsgID);
    react(api, event, REACT_ERROR);
    return message.reply(`❌ | Could not download video. Please try again.`);
  }

  try {
    const { size: sendSize } = await fs.stat(filePath);
    if (sendSize < 1024) throw new Error(`File too small before send (${sendSize}B)`);

    const sentMsg = await message.reply({ body: caption, attachment: fs.createReadStream(filePath) });
    if (!sentMsg || !sentMsg.messageID) throw new Error("Send returned no messageID — upload likely failed.");

    markSent(cardMsgID);
    react(api, event, REACT_DONE);
  } catch (sendErr) {
    console.error(`[find] sendVideo send failed: ${sendErr.message}`);
    markFailed(cardMsgID);
    react(api, event, REACT_ERROR);
    await message.reply(`❌ | Could not send video. Please try again.`);
  } finally {
    cleanFile(filePath);
  }
}

async function sendAudio({ message, event, api, songData }) {
  const { title, artist, messageID: cardMsgID, audioUrl } = songData;

  if (!title || !artist) {
    return message.reply("❌ | Song data missing. Please use !find again.");
  }

  if (isLocked(cardMsgID)) return;

  markSending(cardMsgID);
  scheduleCleanup(cardMsgID);

  react(api, event, REACT_WORKING);
  await fs.ensureDir(TMP_DIR);

  const searchQuery = `${title} ${artist}`;
  let filePath = null;
  let caption = null;

  // Step 1: Railway audioUrl
  if (audioUrl) {
    const railwayPath = path.join(TMP_DIR, `find_railway_${Date.now()}.mp3`);
    try {
      const response = await axios({
        url: audioUrl,
        method: "GET",
        responseType: "stream",
        timeout: 120000,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const writer = fs.createWriteStream(railwayPath);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
      });
      const { size } = await fs.stat(railwayPath);
      if (size < 1024) throw new Error("File too small.");
      filePath = railwayPath;
      caption  = `✅ | 𝐇𝐞𝐫𝐞'𝐬 𝐲𝐨𝐮𝐫 𝐫𝐞𝐪𝐮𝐞𝐬𝐭𝐞𝐝 𝐬𝐨𝐧𝐠\n➡️ ${title}`;
    } catch (railErr) {
      console.warn(`[find] Railway audioUrl failed: ${railErr.message}`);
      cleanFile(railwayPath);
      filePath = null;
    }
  }

  // Step 2: search YouTube then fetch via new API
  if (!filePath) {
    let ytSelected = null;
    try {
      const ytResults = await yts(searchQuery);
      if (ytResults && ytResults.videos.length) ytSelected = ytResults.videos[0];
    } catch (_) {}

    if (ytSelected) {
      try {
        const result = await downloadViaNewApi({ videoID: ytSelected.videoId, title: ytSelected.title, type: "audio" });
        filePath = result.filePath;
        caption  = result.caption;
      } catch (apiErr) {
        console.warn(`[find] sendAudio new API failed: ${apiErr.message}`);
        filePath = null;
      }
    }
  }

  // All failed — now send error
  if (!filePath) {
    markFailed(cardMsgID);
    react(api, event, REACT_ERROR);
    return message.reply(`❌ | Could not download song from any source.`);
  }

  try {
    const { size: sendSize } = await fs.stat(filePath);
    if (sendSize < 1024) throw new Error(`File too small before send (${sendSize}B)`);

    const sentMsg = await message.reply({ body: caption, attachment: fs.createReadStream(filePath) });
    if (!sentMsg || !sentMsg.messageID) throw new Error("Send returned no messageID — upload likely failed.");

    markSent(cardMsgID);
    react(api, event, REACT_DONE);
  } catch (sendErr) {
    console.error(`[find] sendAudio send failed: ${sendErr.message}`);
    markFailed(cardMsgID);
    react(api, event, REACT_ERROR);
    await message.reply(`❌ | Could not send song. Please try again.`);
  } finally {
    cleanFile(filePath);
  }
}

function buildSongInfo(result) {
  const meta = (title) =>
    (result._shazamMeta || []).find(m => m.title === title)?.text || "Unknown";

  return {
    title:         result.title                    || "Unknown",
    artist:        result.artist                   || "Unknown",
    album:         meta("Album"),
    released:      result.release_date || meta("Released"),
    genre:         meta("Genre"),
    lyrics:        result.lyrics?.snippet          || null,
    songLink:      result.song_link                || null,
    spotifyUrl:    null,
    appleMusicUrl: null,
  };
}

function buildCaption(info) {
  const lines = [
    "ღ 𝖮𝖬𝖭𝖨-𝖷 𝖠𝖭𝖠𝖫𝖸𝖳𝖨𝖢𝖲",
    "ღ 𝖲𝖸𝖲𝖳𝖤𝖬 𝖡𝖸 𝖠𝖱𝖠𝖥𝖠𝖳",
    "",
    `❍ 𝖳𝗂𝗍𝗅𝖾: ${info.title}`,
    `❍ 𝖠𝗋𝗍𝗂𝗌𝗍: ${info.artist}`,
  ];
  if (info.lyrics) {
    lines.push("", "❍ 𝖫𝗒𝗋𝗂𝖼𝗌:");
    info.lyrics.split("\n").forEach(l => lines.push(l));
  }
  lines.push("", "");
  return lines.join("\n");
}

function extractMediaUrl(reply) {
  if (!reply) return null;
  for (const att of (reply.attachments || [])) {
    const t = (att.type || "").toLowerCase();
    if (["video", "audio"].includes(t) && att.url) return att.url;
    if (att.payload?.url && ["video", "audio"].includes(t)) return att.payload.url;
    if (t === "share" && att.url) return att.url;
  }
  return null;
}

async function downloadCover(url, songKey) {
  if (!url) return null;
  try {
    await fs.ensureDir(TMP_DIR);
    const p = path.join(TMP_DIR, `cover_${songKey}.jpg`);
    await streamDownload(url, p, 5 * 1024 * 1024);
    return p;
  } catch (_) {
    return null;
  }
}

function streamDownload(url, destPath, maxBytes = 0) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const doRequest = (currentUrl, hops = 0) => {
      if (hops >= 5) return reject(new Error("Too many redirects"));
      const mod = currentUrl.startsWith("https") ? https : http;
      mod.get(currentUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
      }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location)
          return doRequest(res.headers.location, hops + 1);
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode}`));
        const out = fs.createWriteStream(destPath);
        res.on("data", chunk => {
          received += chunk.length;
          if (maxBytes > 0 && received > maxBytes) {
            res.destroy();
            out.close();
            reject(new Error(`File exceeds ${maxBytes / 1024 / 1024} MB limit`));
          }
        });
        res.pipe(out);
        out.on("finish", resolve);
        out.on("error",  reject);
        res.on("error",  reject);
      }).on("error", reject)
        .setTimeout(120000, () => reject(new Error("Stream timeout")));
    };
    doRequest(url);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncate(str, max) {
  const s = str || "Unknown";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function buildSongCanvas(info, coverPath, ts) {
  try {
    const { createCanvas, loadImage } = require("canvas");

    const W = 900, H = 420;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0,   "#0f0c29");
    bg.addColorStop(0.5, "#302b63");
    bg.addColorStop(1,   "#24243e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth   = 1;
    for (let i = 0; i < H; i += 6) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
    }

    const COVER_W = 280, COVER_H = H;
    if (coverPath && fs.existsSync(coverPath)) {
      try {
        const cover = await loadImage(coverPath);
        ctx.save();
        ctx.drawImage(cover, 0, 0, COVER_W, COVER_H);
        const fadeGrad = ctx.createLinearGradient(COVER_W - 80, 0, COVER_W, 0);
        fadeGrad.addColorStop(0, "rgba(15,12,41,0)");
        fadeGrad.addColorStop(1, "rgba(15,12,41,1)");
        ctx.fillStyle = fadeGrad;
        ctx.fillRect(COVER_W - 80, 0, 80, COVER_H);
        ctx.restore();
      } catch (_) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(0, 0, COVER_W, COVER_H);
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.font      = "120px Sans";
        ctx.textAlign = "center";
        ctx.fillText("♫", COVER_W / 2, COVER_H / 2 + 45);
        ctx.textAlign = "left";
      }
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, COVER_W, COVER_H);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.font      = "120px Sans";
      ctx.textAlign = "center";
      ctx.fillText("♫", COVER_W / 2, COVER_H / 2 + 45);
      ctx.textAlign = "left";
    }

    const PAD  = 28;
    const TX   = COVER_W + PAD;
    const TW   = W - TX - PAD;

    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.font      = "bold 11px Sans";
    ctx.fillText("ღ OMNI-X ANALYTICS  ·  SYSTEM BY ARAFAT", TX, 30);

    const divGrad = ctx.createLinearGradient(TX, 0, TX + TW, 0);
    divGrad.addColorStop(0, "rgba(167,139,250,0.80)");
    divGrad.addColorStop(1, "rgba(167,139,250,0)");
    ctx.strokeStyle = divGrad;
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(TX, 40); ctx.lineTo(TX + TW, 40); ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font      = "bold 30px Sans";
    ctx.fillText(truncate(info.title || "Unknown Title", 26), TX, 78);

    ctx.fillStyle = "#a78bfa";
    ctx.font      = "bold 16px Sans";
    ctx.fillText("✦  " + truncate(info.artist || "Unknown Artist", 38), TX, 104);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(TX, 118); ctx.lineTo(TX + TW, 118); ctx.stroke();

    const LABEL_W = 74, LABEL_H = 20, VAL_OFF = LABEL_W + 10;
    const ROW_H   = 32, COL_GAP = 10;
    const COL2_X  = TX + (TW / 2) + COL_GAP;

    const allRows = [
      ["ALBUM",    info.album    || "—"],
      ["ARTIST",   info.artist   || "—"],
      ["GENRE",    info.genre    || "—"],
      ["RELEASE",  info.released || "—"],
      ["LABEL",    info.label    || "—"],
      ["DURATION", info.duration || "—"],
    ];

    let ry = 134;
    for (let i = 0; i < allRows.length; i += 2) {
      const leftItem  = allRows[i];
      const rightItem = allRows[i + 1];

      if (leftItem) {
        ctx.save();
        ctx.fillStyle = "rgba(167,139,250,0.20)";
        roundRect(ctx, TX, ry, LABEL_W, LABEL_H, 4);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(167,139,250,0.95)";
        ctx.font      = "bold 10px Sans";
        ctx.fillText(leftItem[0], TX + 6, ry + 14);
        ctx.fillStyle = "#e2e8f0";
        ctx.font      = "13px Sans";
        ctx.fillText(truncate(leftItem[1], 18), TX + VAL_OFF, ry + 14);
      }

      if (rightItem) {
        ctx.save();
        ctx.fillStyle = "rgba(167,139,250,0.20)";
        roundRect(ctx, COL2_X, ry, LABEL_W, LABEL_H, 4);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(167,139,250,0.95)";
        ctx.font      = "bold 10px Sans";
        ctx.fillText(rightItem[0], COL2_X + 6, ry + 14);
        ctx.fillStyle = "#e2e8f0";
        ctx.font      = "13px Sans";
        ctx.fillText(truncate(rightItem[1], 18), COL2_X + VAL_OFF, ry + 14);
      }

      ry += ROW_H;
    }

    const links = [];
    if (info.spotifyUrl)    links.push(["SPOTIFY",   info.spotifyUrl]);
    if (info.appleMusicUrl) links.push(["APPLE",     info.appleMusicUrl]);
    if (info.songLink)      links.push(["SONG LINK", info.songLink]);

    if (links.length > 0) {
      ry += 4;
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(TX, ry); ctx.lineTo(TX + TW, ry); ctx.stroke();
      ry += 10;

      let lx = TX;
      for (const [label] of links) {
        const bw = 76;
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        roundRect(ctx, lx, ry, bw, 18, 4);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(167,139,250,0.85)";
        ctx.font      = "bold 10px Sans";
        ctx.textAlign = "center";
        ctx.fillText("▶ " + label, lx + bw / 2, ry + 13);
        ctx.textAlign = "left";
        lx += bw + 8;
      }
      ry += 26;
    }

    if (info.lyrics) {
      const snip = (info.lyrics.split("\n").find(l => l.trim()) || "").trim();
      if (snip) {
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.font      = "italic 12px Sans";
        const lyricY  = Math.min(Math.max(ry + 6, H - 48), H - 36);
        ctx.fillText(`❝ ${truncate(snip, 58)} ❞`, TX, lyricY);
      }
    }

    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font      = "11px Sans";
    ctx.fillText("↩ Reply or react to this card to download the full song", TX, H - 14);

    const accentGrad = ctx.createLinearGradient(0, H - 4, W, H - 4);
    accentGrad.addColorStop(0,   "#a78bfa");
    accentGrad.addColorStop(0.5, "#7c3aed");
    accentGrad.addColorStop(1,   "#a78bfa");
    ctx.strokeStyle = accentGrad;
    ctx.lineWidth   = 3;
    ctx.beginPath(); ctx.moveTo(0, H - 3); ctx.lineTo(W, H - 3); ctx.stroke();

    const outPath = path.join(TMP_DIR, `card_${ts}.jpg`);
    const buf     = canvas.toBuffer("image/jpeg", { quality: 0.93 });
    fs.writeFileSync(outPath, buf);
    return outPath;

  } catch (_) {
    return null;
  }
}


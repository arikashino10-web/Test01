const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

// ====== আপনার GIF-এর লিংক (ibb পেজের লিংক চলবে, কোড নিজে সরাসরি ছবির লিংক বের করে নেবে) ======
// সরাসরি লিংক (i.ibb.co/...gif) থাকলে সেটা বসালে আরও নির্ভরযোগ্য হবে।
// নতুন লিংক যোগ করলে প্রতিটার শেষে কমা (,) দেবেন, শুধু সবার শেষটায় লাগবে না।
const GIF_LINKS = [
	"https://ibb.co.com/hJ7fjFG4",
	"https://ibb.co.com/KpGVks5K",
	"https://ibb.co.com/Fkr4ffx4",
	"https://ibb.co.com/qYz3DHrx",
	"https://ibb.co.com/MWJQXQ7",
	"https://ibb.co.com/sd5cS8w2",
	"https://ibb.co.com/0VQKKf41",
	"https://ibb.co.com/Jj9R4bvY"
];

// ====== মেইন এডমিন (এই ফাইলে বসানো UID) ======
// এছাড়া config.json এর adminBot ও devUsers এর সবাইও মেইন এডমিন।
// মেইন এডমিনরা effect চালাতে পারবে এবং `admin add/remove` দিয়ে এক্সট্রা ইউজার যোগ/বাদ করতে পারবে।
const MAIN_ADMIN_UIDS = [
	"61591169410501"
];

const SHOW_MS = 3000; // GIF কত মিলিসেকেন্ড দেখা যাবে
const DATA_FILE = path.join(__dirname, "cache", "effectavatar.json");
const urlCache = {};
const lastReplay = {};

// ====== বাবল + GIF এক ছবিতে (ভিডিওর মতো) ======
const BUBBLE_MODE = true;        // false দিলে আগের মতো আলাদা GIF-পপআপ হবে
const MAX_W = 640;               // ছবির সর্বোচ্চ প্রস্থ
const GIF_H = 260;               // উপরের ক্যারেক্টারের উচ্চতা
const OVERLAP = 18;              // ক্যারেক্টারের পা বাবলের মাথায় কতটা ঢুকবে (পিক্সেল)
const CHAR_LEFT = 0.35;          // ক্যারেক্টার কোথায় বসবে: 0 = বাঁয়ে, 0.5 = মাঝে, 1 = ডানে
const MAX_FRAMES = 60;           // GIF-এর ফ্রেম বেশি হলে এর বেশি নেবে না (বট ধীর হয় না)
const CRACK_CHANCE = 0.4;        // বাবলে ফাটলের নকশা আসার সম্ভাবনা (0 = কখনো না, 1 = সবসময়)
const PALETTE = [
	["#ff6fa5", "#ff3d77"], // গোলাপি
	["#4aa3ff", "#2f7bff"], // নীল
	["#ffd24a", "#ff9a2e"], // সোনালি
	["#ff5a5a", "#d92b2b"], // লাল
	["#b36bff", "#7b3dff"], // বেগুনি
	["#3ddc97", "#1fb57a"], // সবুজ
	["#ff8a3d", "#ff5e1a"], // কমলা
	["#5ad7ff", "#2fb3e8"]  // আকাশি
];

let _canvas = null;
function getCanvas() {
	if (_canvas) return _canvas;
	_canvas = require("canvas");
	try {
		const fp = path.join(process.cwd(), "scripts", "cmds", "assets", "font", "NotoSans-Bold.ttf");
		if (fs.existsSync(fp)) _canvas.registerFont(fp, { family: "NotoBold" });
	} catch (e) { }
	return _canvas;
}

// একটা লেখাকে অক্ষর-অক্ষর ভাগ করে (ইমোজি/যুক্তাক্ষর না ভেঙে)
function splitChars(str) {
	try {
		if (typeof Intl !== "undefined" && Intl.Segmenter) {
			return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(str), s => s.segment);
		}
	} catch (e) { }
	return Array.from(str);
}

// ফাটলের মতো আঁকাবাঁকা সরু রেখা
function drawCracks(ctx, w, h) {
	ctx.strokeStyle = "rgba(0,0,0,0.22)";
	ctx.lineWidth = 1.6;
	ctx.lineCap = "round";
	const n = 3 + Math.floor(Math.random() * 3);
	for (let i = 0; i < n; i++) {
		let x = Math.random() * w, y = Math.random() * h;
		let ang = Math.random() * Math.PI * 2;
		const segs = 5 + Math.floor(Math.random() * 5);
		ctx.beginPath();
		ctx.moveTo(x, y);
		for (let k = 0; k < segs; k++) {
			ang += (Math.random() - 0.5) * 1.2;
			const len = 14 + Math.random() * 22;
			x += Math.cos(ang) * len; y += Math.sin(ang) * len;
			ctx.lineTo(x, y);
			if (Math.random() < 0.25) { // ছোট শাখা
				const bx = x + Math.cos(ang + 0.9) * 14, by = y + Math.sin(ang + 0.9) * 14;
				ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.moveTo(x, y);
			}
		}
		ctx.stroke();
	}
}

// লেখা থেকে ঢেউ-কিনারার রঙিন বাবল PNG বানায়
function renderBubble(text) {
	const { createCanvas } = getCanvas();
	const pad = 30, fontSize = 30, lineH = 42, wave = 9;
	const font = `bold ${fontSize}px NotoBold, "Noto Sans", sans-serif`;
	const probe = createCanvas(10, 10).getContext("2d");
	probe.font = font;
	const maxTextW = MAX_W - pad * 2;

	const lines = [];
	for (const raw of String(text).split("\n")) {
		if (raw === "") { lines.push(""); continue; }
		let cur = "";
		for (const ch of splitChars(raw)) {
			if (probe.measureText(cur + ch).width > maxTextW) { lines.push(cur); cur = ch; }
			else cur += ch;
		}
		lines.push(cur);
	}
	if (lines.length > 26) throw new Error("text too long");

	let textW = 0;
	for (const l of lines) textW = Math.max(textW, probe.measureText(l).width);
	const w = Math.min(MAX_W, Math.ceil(textW) + pad * 2);
	const h = lines.length * lineH + pad * 2 + wave;

	const canvas = createCanvas(w, h);
	const ctx = canvas.getContext("2d");
	const [c1, c2] = PALETTE[Math.floor(Math.random() * PALETTE.length)];
	const grad = ctx.createLinearGradient(0, 0, 0, h);
	grad.addColorStop(0, c1); grad.addColorStop(1, c2);

	const r = 34, bottom = h - wave;
	ctx.beginPath();
	ctx.moveTo(r, 0);
	ctx.lineTo(w - r, 0); ctx.quadraticCurveTo(w, 0, w, r);
	ctx.lineTo(w, bottom - r); ctx.quadraticCurveTo(w, bottom, w - r, bottom);
	// নিচের ঢেউ
	const steps = Math.max(4, Math.round((w - 2 * r) / 36));
	const sw = (w - 2 * r) / steps;
	for (let i = 0; i < steps; i++) {
		const x0 = w - r - i * sw, x1 = x0 - sw;
		ctx.quadraticCurveTo(x0 - sw / 2, bottom + (i % 2 === 0 ? wave : -wave * 0.2), x1, bottom);
	}
	ctx.quadraticCurveTo(0, bottom, 0, bottom - r);
	ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
	ctx.closePath();
	ctx.fillStyle = grad; ctx.fill();

	// চকচকে ভাব + (মাঝে মাঝে) ফাটলের নকশা, শুধু বাবলের ভেতরে
	ctx.save();
	ctx.clip();
	const gloss = ctx.createLinearGradient(0, 0, 0, h * 0.55);
	gloss.addColorStop(0, "rgba(255,255,255,0.40)");
	gloss.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = gloss; ctx.fillRect(0, 0, w, h * 0.55);
	if (Math.random() < CRACK_CHANCE) drawCracks(ctx, w, h);
	ctx.restore();

	ctx.fillStyle = "#111111"; ctx.font = font; ctx.textBaseline = "top";
	lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lineH));
	return { png: canvas.toBuffer("image/png"), width: w, height: h };
}

// ক্যারেক্টার বাবলের ওপর দাঁড়িয়ে আছে, পা সামান্য বাবলে ঢোকা (ভিডিওর মতো)।
// ক্যারেক্টার বাবলের সামনে থাকে, প্রতিটা ফ্রেম আলাদা করে জোড়া লাগানো হয়।
async function composeGifOverlap(gifBuf, bubble) {
	const sharp = require("sharp");
	const meta = await sharp(gifBuf, { animated: true }).metadata();
	const pages = meta.pages || 1;
	const frameH = meta.pageHeight || meta.height;
	const W = Math.max(bubble.width, 360);
	const H = GIF_H + bubble.height - OVERLAP;
	const clear = { r: 0, g: 0, b: 0, alpha: 0 };
	const cw = Math.min(W, Math.max(1, Math.round(GIF_H * meta.width / frameH)));
	const rh = Math.max(1, Math.min(GIF_H, Math.round(cw * frameH / meta.width)));
	const charLeft = Math.round((W - cw) * CHAR_LEFT);
	const bubbleLeft = Math.round((W - bubble.width) / 2);

	const base = await sharp({ create: { width: W, height: H, channels: 4, background: clear } })
		.composite([{ input: bubble.png, top: GIF_H - OVERLAP, left: bubbleLeft }])
		.png().toBuffer();

	const step = Math.max(1, Math.ceil(pages / MAX_FRAMES));
	const srcDelay = Array.isArray(meta.delay) && meta.delay.length ? meta.delay : [];
	const raws = [], delay = [];
	for (let i = 0; i < pages; i += step) {
		const frame = await sharp(gifBuf, { page: i })
			.resize({ width: cw, height: rh, fit: "fill" })
			.ensureAlpha().png().toBuffer();
		raws.push(await sharp(base)
			.composite([{ input: frame, top: GIF_H - rh, left: charLeft }])
			.png().toBuffer());
		let d = 0;
		for (let k = i; k < Math.min(pages, i + step); k++) d += (srcDelay[k] || 80);
		delay.push(d);
	}
	if (raws.length === 1) return await sharp(raws[0]).gif().toBuffer();
	return await sharp(raws, { join: { animated: true } })
		.gif({ delay, loop: meta.loop === undefined ? 0 : meta.loop })
		.toBuffer();
}

// আগের সরল পদ্ধতি (ওপরে ক্যারেক্টার, নিচে বাবল): নতুন পদ্ধতি না চললে এটা কাজে লাগে
async function composeGifStacked(gifBuf, bubble) {
	const sharp = require("sharp");
	const meta = await sharp(gifBuf, { animated: true }).metadata();
	const pages = meta.pages || 1;
	const W = Math.max(bubble.width, 360);
	const left = Math.round((W - bubble.width) / 2);
	const pageH = GIF_H + bubble.height;
	const clear = { r: 0, g: 0, b: 0, alpha: 0 };
	const overlays = [];
	for (let i = 0; i < pages; i++) overlays.push({ input: bubble.png, top: i * pageH + GIF_H, left });
	return await sharp(gifBuf, { animated: true })
		.resize({ width: W, height: GIF_H, fit: "contain", background: clear })
		.extend({ bottom: bubble.height, background: clear })
		.composite(overlays)
		.gif()
		.toBuffer();
}

async function composeGif(gifBuf, bubble) {
	try { return await composeGifOverlap(gifBuf, bubble); }
	catch (e) { return await composeGifStacked(gifBuf, bubble); }
}

// ====== GIF ডাউনলোড: মেমরি + ডিস্কে জমিয়ে রাখে, একটা ব্যর্থ হলে আরেকটা চেষ্টা করে ======
const GIF_DIR = path.join(__dirname, "cache", "effectavatar_gifs");
const gifBufCache = {};

function linkKey(link) { return Buffer.from(link).toString("hex").slice(-24); }

async function fetchGifBuffer(link) {
	if (gifBufCache[link]) return gifBufCache[link];
	const file = path.join(GIF_DIR, linkKey(link) + ".gif");
	try {
		if (fs.existsSync(file)) {
			const b = fs.readFileSync(file);
			if (b && b.length > 100) { gifBufCache[link] = b; return b; }
		}
	} catch (e) { }
	let lastErr;
	for (let t = 0; t < 2; t++) { // প্রতি লিংকে ২ বার চেষ্টা
		try {
			delete urlCache[link];
			const url = await resolveUrl(link);
			const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20000, headers: { "User-Agent": "Mozilla/5.0" } });
			const b = Buffer.from(res.data);
			if (b.length < 100) throw new Error("empty image");
			gifBufCache[link] = b;
			try { fs.ensureDirSync(GIF_DIR); fs.writeFileSync(file, b); } catch (e) { }
			return b;
		}
		catch (e) { lastErr = e; }
	}
	throw lastErr;
}

// লিংকগুলো এলোমেলো ক্রমে সাজায়, যেগুলো আগে থেকেই জমানো আছে সেগুলো আগে
function orderedLinks() {
	const arr = GIF_LINKS.slice().sort(() => Math.random() - 0.5);
	return arr.sort((a, b) => (gifBufCache[b] ? 1 : 0) - (gifBufCache[a] ? 1 : 0) + (Math.random() - 0.5) * 0.01);
}

// পিছনে চুপচাপ সব GIF নামিয়ে রাখে, যাতে পরে আর দেরি/ব্যর্থতা না হয়
async function warmGifs() {
	for (const link of GIF_LINKS) {
		try { await fetchGifBuffer(link); }
		catch (e) { console.error("[effectavatar] GIF preload failed:", link, e && e.message); }
	}
}

function bufferStream(buf, name) {
	const { Readable } = require("stream");
	const s = Readable.from(buf);
	s.path = name;
	return s;
}

// উত্তর দিলে রেজাল্ট, কোনো কারণে না পারলে null (তখন সাধারণ লেখা যাবে)
async function sendBubble(origReply, form, cb) {
	const body = typeof form === "string" ? form : (form && form.body);
	if (!body || typeof body !== "string" || body.length > 1500) return null;
	if (typeof form === "object" && (form.attachment || form.mentions || form.sticker || form.url || form.location)) return null;

	let bubble;
	try { bubble = renderBubble(body); }
	catch (e) { console.error("[effectavatar] bubble render failed:", e && e.message); return null; }

	// একটা GIF ব্যর্থ হলে পরেরটা, সর্বোচ্চ ৪টা পর্যন্ত চেষ্টা
	const links = orderedLinks().slice(0, 4);
	let out = null;
	for (const link of links) {
		try {
			const gifBuf = await fetchGifBuffer(link);
			out = await composeGif(gifBuf, bubble);
			if (out) break;
		}
		catch (e) { console.error("[effectavatar] GIF failed, trying next:", link, e && e.message); }
	}
	if (!out) return null;

	try { return await origReply({ attachment: bufferStream(out, "effect.gif") }, cb); }
	catch (e) { console.error("[effectavatar] send failed:", e && e.message); return null; }
}

// ====== ডেটা ফাইল: effect-ওয়ালা কমান্ড + এক্সট্রা ইউজার (UID) ======
function loadData() {
	try {
		const d = fs.readJsonSync(DATA_FILE);
		return {
			commands: Array.isArray(d.commands) ? d.commands : [],
			admins: Array.isArray(d.admins) ? d.admins.map(String) : []
		};
	}
	catch (e) { return { commands: [], admins: [] }; }
}
function saveData(data) {
	fs.ensureDirSync(path.dirname(DATA_FILE));
	fs.writeJsonSync(DATA_FILE, { commands: data.commands, admins: data.admins });
}
function loadList() { return loadData().commands; }
function saveList(list) {
	const d = loadData();
	d.commands = list;
	saveData(d);
}

async function resolveUrl(link) {
	if (urlCache[link]) return urlCache[link];
	let url = link;
	if (!/\.(gif|png|jpe?g|webp)(\?.*)?$/i.test(link)) {
		const { data } = await axios.get(link, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
		const html = String(data);
		const m = html.match(/property="og:image"\s+content="([^"]+)"/i)
			|| html.match(/content="([^"]+)"\s+property="og:image"/i);
		if (!m) throw new Error("direct image link not found");
		url = m[1].replace(/&amp;/g, "&");
	}
	urlCache[link] = url;
	return url;
}

// GIF পাঠায়, SHOW_MS পর মুছে দেয়
async function showGif(api, threadID) {
	try {
		const link = GIF_LINKS[Math.floor(Math.random() * GIF_LINKS.length)];
		const url = await resolveUrl(link);
		const stream = await global.utils.getStreamFromURL(url, "effect.gif");
		const info = await new Promise((resolve, reject) => {
			api.sendMessage({ attachment: stream }, threadID, (err, i) => err ? reject(err) : resolve(i));
		});
		const id = info && info.messageID;
		if (id) setTimeout(() => { try { api.unsendMessage(id, () => { }); } catch (e) { } }, SHOW_MS);
	}
	catch (e) { /* GIF না গেলে কমান্ড স্বাভাবিকভাবেই চলবে */ }
}

function findCommand(name) {
	const { commands, aliases } = global.GoatBot;
	return commands.get(name) || commands.get(aliases.get(name));
}

function hook(name) {
	const cmd = findCommand(name);
	if (!cmd) return false;
	if (cmd.onStart && cmd.onStart.__eff) return true;
	const orig = cmd.onStart;
	const wrapped = async function (params) {
		try {
			const { message, event, api } = params;
			const origReply = message.reply;
			let used = false;
			message.reply = async (form, cb) => {
				let res = null;
				if (!used) {
					used = true;
					if (BUBBLE_MODE) res = await sendBubble(origReply, form, cb);
					else await showGif(api, event.threadID); // GIF আগে, লেখা পরে
				}
				if (!res) res = await origReply(form, cb);   // বাবল না বানাতে পারলে সাধারণ লেখা
				try {
					if (!BUBBLE_MODE && res && res.messageID && global.GoatBot.onReaction) {
						global.GoatBot.onReaction.set(res.messageID, {
							commandName: "effectavatar",
							messageID: res.messageID,
							author: event.senderID
						});
					}
				} catch (e) { }
				return res;
			};
		} catch (e) { }
		return orig.call(this, params);
	};
	wrapped.__eff = true;
	wrapped.__orig = orig;
	cmd.onStart = wrapped;
	return true;
}

function unhook(name) {
	const cmd = findCommand(name);
	if (cmd && cmd.onStart && cmd.onStart.__eff) cmd.onStart = cmd.onStart.__orig;
}

function installAll() {
	for (const name of loadList()) hook(name);
}

// ====== অনুমতি ======
// মেইন এডমিন: এই ফাইলের MAIN_ADMIN_UIDS + config.json এর adminBot ও devUsers
function isMainAdmin(senderID) {
	const id = String(senderID);
	if (MAIN_ADMIN_UIDS.map(String).includes(id)) return true;
	try {
		const c = global.GoatBot.config || {};
		const all = [...(c.adminBot || []), ...(c.devUsers || [])].map(String);
		return all.includes(id);
	}
	catch (e) { return false; }
}
// effect কমান্ড চালাতে পারবে: মেইন এডমিন অথবা `admin add` দিয়ে যোগ করা এক্সট্রা ইউজার
function canUse(senderID) {
	return isMainAdmin(senderID) || loadData().admins.includes(String(senderID));
}

module.exports = {
	config: {
		name: "effectavatar",
		aliases: ["effavatar"],
		version: "1.4",
		author: "JABED",
		countDown: 3,
		// অনুমতি-চেক নিচে কোডের ভেতরেই হয় (মেইন এডমিন + এক্সট্রা ইউজার), তাই এখানে onStart: 0
		// onChat/onReaction সবার জন্য খোলা, কারণ ওগুলো ভেতরের কাজ।
		role: { onStart: 0, onChat: 0, onReaction: 0 },
		description: { en: "Add a GIF popup effect (shown 3s) to chosen commands (main admins + added users only)" },
		category: "owner",
		guide: {
			en: "   {pn} add <command>: effect চালু"
				+ "\n   {pn} remove <command>: effect বন্ধ"
				+ "\n   {pn} list: চালু থাকা কমান্ড"
				+ "\n   {pn} admin add <uid / মেনশন / রিপ্লাই>: এক্সট্রা ইউজার যোগ (শুধু মেইন এডমিন)"
				+ "\n   {pn} admin remove <uid / মেনশন / রিপ্লাই>: এক্সট্রা ইউজার বাদ (শুধু মেইন এডমিন)"
				+ "\n   {pn} admin list: এক্সট্রা ইউজারদের তালিকা"
		}
	},

	onLoad: function () {
		// অন্য কমান্ড লোড হওয়ার পর হুক বসাতে একটু দেরি
		setTimeout(installAll, 10000);
		setTimeout(() => { warmGifs().catch(() => { }); }, 15000);
	},

	onChat: function () {
		installAll();
	},

	onStart: async function ({ args, message, event }) {
		// নিরাপত্তা: মেইন এডমিন বা যোগ করা এক্সট্রা ইউজার ছাড়া কেউ চালাতে পারবে না
		if (!canUse(event && event.senderID))
			return message.reply("⛔ এই কমান্ড শুধু বটের এডমিন ও অনুমতি পাওয়া ইউজাররা ব্যবহার করতে পারবেন।");

		const sub = (args[0] || "").toLowerCase();

		// ---- এক্সট্রা ইউজার ম্যানেজ ----
		if (sub === "admin") {
			const act = (args[1] || "").toLowerCase();
			const data = loadData();

			if (act === "list") {
				return message.reply(data.admins.length
					? "👤 এক্সট্রা ইউজার:\n" + data.admins.map((u, i) => `${i + 1}. ${u}`).join("\n")
					: "কোনো এক্সট্রা ইউজার নেই।");
			}

			// যোগ/বাদ শুধু মেইন এডমিন
			if (!isMainAdmin(event.senderID))
				return message.reply("⛔ এক্সট্রা ইউজার যোগ/বাদ শুধু বটের মেইন এডমিন করতে পারবেন।");

			if (!["add", "remove"].includes(act))
				return message.reply("ব্যবহার:\neffectavatar admin add <uid / মেনশন / রিপ্লাই>\neffectavatar admin remove <uid / মেনশন / রিপ্লাই>\neffectavatar admin list");

			let uids = Object.keys(event.mentions || {});
			if (!uids.length && event.messageReply && event.messageReply.senderID) uids = [event.messageReply.senderID];
			if (!uids.length) uids = args.slice(2).filter(x => /^\d+$/.test(x));
			uids = [...new Set(uids.map(String))];
			if (!uids.length)
				return message.reply("❌ UID দিন, কাউকে মেনশন করুন, অথবা তার মেসেজে রিপ্লাই দিন।");

			if (act === "add") {
				const added = uids.filter(u => !data.admins.includes(u) && !isMainAdmin(u));
				if (!added.length) return message.reply("ℹ️ এরা আগেই যোগ করা আছে অথবা মেইন এডমিন।");
				data.admins.push(...added);
				saveData(data);
				return message.reply("✅ যোগ হলো:\n" + added.join("\n"));
			}

			const removed = uids.filter(u => data.admins.includes(u));
			if (!removed.length) return message.reply("ℹ️ এই UID তালিকায় ছিল না।");
			data.admins = data.admins.filter(u => !removed.includes(u));
			saveData(data);
			return message.reply("✅ বাদ দেওয়া হলো:\n" + removed.join("\n"));
		}

		// ---- effect ম্যানেজ ----
		const list = loadList();

		if (sub === "list") {
			return message.reply(list.length
				? "✨ Effect চালু আছে:\n" + list.map((n, i) => `${i + 1}. ${n}`).join("\n")
				: "কোনো কমান্ডে effect চালু নেই।");
		}

		const name = (args[1] || "").toLowerCase();
		if (!["add", "remove"].includes(sub) || !name)
			return message.reply("ব্যবহার:\neffectavatar add <command>\neffectavatar remove <command>\neffectavatar list\neffectavatar admin add/remove/list");

		const cmd = findCommand(name);
		if (!cmd) return message.reply(`❌ "${name}" নামে কোনো কমান্ড পাইনি।`);
		const real = cmd.config.name;
		if (["effectavatar", "onlyeffect"].includes(real))
			return message.reply("❌ এই কমান্ডে effect বসানো যাবে না।");

		if (sub === "add") {
			if (list.includes(real)) return message.reply(`ℹ️ ${real} এ আগেই চালু আছে।`);
			list.push(real);
			saveList(list);
			hook(real);
			return message.reply(`✅ ${real} কমান্ডে GIF effect চালু হলো।`);
		}

		if (!list.includes(real)) return message.reply(`ℹ️ ${real} এ effect চালু ছিল না।`);
		saveList(list.filter(n => n !== real));
		unhook(real);
		return message.reply(`✅ ${real} কমান্ডে effect বন্ধ হলো।`);
	},

	// effect-ওয়ালা মেসেজে কেউ রিঅ্যাক্ট করলে GIF আবার দেখাবে
	onReaction: async function ({ event, api }) {
		const key = event.messageID;
		const now = Date.now();
		if (lastReplay[key] && now - lastReplay[key] < SHOW_MS + 2000) return;
		lastReplay[key] = now;
		await showGif(api, event.threadID);
	}
};
		

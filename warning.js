const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

// ================= সেটিংস =================
const GROUP_ID = "9558705787479785";        // রিপোর্ট যাবে এই গ্রুপে
const OWNER_UID = "61591169410501";         // আপনার আইডি (ট্যাগ করার জন্য)
const TAG_NAME = "@Boss";                   // ট্যাগে যে নাম দেখাবে
const VIDEO_FIRST = "https://files.catbox.moe/zl71oz.mp4";    // প্রথম অ্যালার্টের ভিডিও
const VIDEO_REMIND = "https://files.catbox.moe/yskhac.mp4";   // রিমাইন্ডারের ভিডিও

const CHECK_EVERY = 10 * 60 * 1000;         // প্রতি ১০ মিনিটে চেক
const REMIND_EVERY = 30 * 60 * 1000;        // প্রতি আধাঘন্টায় রিমাইন্ডার
const ALERT_MIN_LEVEL = 2;                  // এই লেভেল বা তার ওপরে হলে অ্যালার্ট
const SLOW_MS = 8000;
const COOKIE_WARN_HOURS = 72;
const SILENT_HOURS = 12;
const SEND_WINDOW = 30 * 60 * 1000;         // মেসেজ পাঠানোর এরর গোনার সময়সীমা
const OK_EVERY = 3 * 60 * 60 * 1000;        // সব ঠিক থাকলে প্রতি ৩ ঘন্টায় "আইডি ঠিক আছে" মেসেজ
const RATE_10MIN = 40;                      // ১০ মিনিটে এর বেশি মেসেজ পাঠালে সতর্ক (আমার আন্দাজ, দরকারে বদলান)
const RATE_HOUR = 150;                      // ১ ঘন্টায় এর বেশি মেসেজ পাঠালে উচ্চ ঝুঁকি (আমার আন্দাজ)
const AUTO_SAFE_MODE = true;                // ঝুঁকি 🔴/🚨 হলে বট নিজে থেকে অন্য মেসেজ পাঠানো বন্ধ রাখবে

const LEVELS = {
	0: { icon: "✅", name: "স্বাভাবিক" },
	1: { icon: "🟡", name: "নজরে রাখা হচ্ছে" },
	2: { icon: "🟠", name: "মাঝারি ঝুঁকি" },
	3: { icon: "🔴", name: "উচ্চ ঝুঁকি" },
	4: { icon: "🚨", name: "জরুরি (যেকোনো সময় লগআউট/সাসপেন্ড)" }
};

const DANGER_REGEX = /checkpoint|not logged in|login|log in|suspend|disabled|blocked|restricted|locked|956|282|1357|1348|1390/i;
const SPAM_REGEX = /spam|limit|too many|temporar|rate|1545|1404|1390008|1357031|try again later/i;
const PAGE_BAD_URL = /checkpoint|disabled|suspended|account_locked|confirmemail|recover/i;
const PAGE_BAD_BODY = /your account has been (disabled|locked|suspended)|account is temporarily locked|we suspended your account/i;

const stateFile = path.join(__dirname, "tmp", "warning_state.json");

let state = {
	enabled: true,
	groupID: GROUP_ID,
	level: 0,
	riskSince: null,
	lastReport: 0,
	fails: 0,
	slow: 0,
	log: [],
	sessionStart: null,   // এই appstate কখন থেকে চলছে
	xsHash: null,
	lastSeen: null,       // শেষবার কখন আইডি ঠিক ছিল
	lifetimes: [],        // আগের সেশনগুলো কত ঘন্টা চলেছে
	leadTimes: [],        // ঝুঁকি শুরুর কত ঘন্টা পরে সেশন শেষ হয়েছে
	safeMode: false,
	safeManual: false,
	lastOk: 0
};
let lastEventAt = Date.now();
let running = false;
let sendErrors = []; // { t, msg }
let sendLog = [];    // বট কখন কখন মেসেজ পাঠিয়েছে (গতি মাপার জন্য)

function loadState() {
	try {
		if (fs.existsSync(stateFile)) state = { ...state, ...fs.readJsonSync(stateFile) };
	} catch (e) { }
}
function saveState() {
	try {
		fs.ensureDirSync(path.dirname(stateFile));
		fs.writeJsonSync(stateFile, state);
	} catch (e) { }
}
function addLog(level, text) {
	state.log.push({ t: Date.now(), level, text: String(text).slice(0, 200) });
	if (state.log.length > 20) state.log.shift();
}

function errText(err) {
	try { return String(err.error || err.message || JSON.stringify(err)); } catch (e) { return String(err); }
}

// ---------- ভিডিও ও মেসেজ পাঠানো ----------
async function getVideo(url) {
	try {
		if (global.utils && typeof global.utils.getStreamFromURL === "function")
			return await global.utils.getStreamFromURL(url);
		const axios = require("axios");
		const r = await axios.get(url, { responseType: "stream", timeout: 60000 });
		return r.data;
	} catch (e) { return null; }
}

// ---------- Facebook-এর বাইরের চ্যানেল (আইডি সাসপেন্ড হলেও কাজ করে) ----------
// Railway Variables-এ WARNING_TG_TOKEN ও WARNING_TG_CHAT দিলে Telegram-এ অ্যালার্ট যাবে
async function tgSend(text) {
	try {
		const token = process.env.WARNING_TG_TOKEN, chat = process.env.WARNING_TG_CHAT;
		if (!token || !chat) return;
		const axios = require("axios");
		await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text }, { timeout: 15000 });
	} catch (e) { }
}
// WARNING_HEARTBEAT_URL (যেমন healthchecks.io) দিলে বট ঠিক থাকলে প্রতি ১০ মিনিটে পিং করবে;
// আইডি/বট মরে গেলে পিং বন্ধ হবে আর ওই সার্ভিস আপনাকে জানাবে
async function heartbeat() {
	try {
		const u = process.env.WARNING_HEARTBEAT_URL;
		if (!u) return;
		const axios = require("axios");
		await axios.get(u, { timeout: 15000 });
	} catch (e) { }
}

function sendOnce(api, payload, threadID) {
	return new Promise(resolve => {
		try {
			global.__warningSending = true;
			try { api.sendMessage(payload, threadID, (err) => resolve(err || null)); }
			finally { global.__warningSending = false; }
		} catch (e) { resolve(e); }
	});
}

// গ্রুপে আপনাকে ট্যাগ করে পাঠায়; ভিডিও ফেল করলে শুধু টেক্সট; গ্রুপ ফেল করলে ইনবক্সে
async function notify(api, text, videoUrl, tag = true) {
	tgSend(text);
	const body = tag ? `${TAG_NAME}\n${text}` : text;
	const mentions = tag ? [{ tag: TAG_NAME, id: OWNER_UID, fromIndex: 0 }] : [];
	let err = null;

	if (videoUrl) {
		const stream = await getVideo(videoUrl);
		if (stream) {
			err = await sendOnce(api, { body, mentions, attachment: stream }, state.groupID);
			if (!err) return true;
		}
	}
	err = await sendOnce(api, { body, mentions }, state.groupID);
	if (!err) return true;

	// গ্রুপে যায়নি, তাই সরাসরি ইনবক্সে
	await sendOnce(api, `⚠️ (গ্রুপে পাঠানো যায়নি)\n${text}`, OWNER_UID);
	return false;
}

// ---------- কুকি / পেজ / সেশন ----------
function toMs(v) {
	if (!v || v === "Infinity") return null;
	if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
	const t = Date.parse(v);
	return isNaN(t) ? null : t;
}

function getCookies(api) {
	try { return api.getAppState() || []; } catch (e) { return null; }
}

function cookieExpiryHours(cookies) {
	if (!cookies) return null;
	let min = null;
	for (const c of cookies) {
		if (c.key !== "xs" && c.key !== "c_user") continue;
		const e = toMs(c.expires || c.expirationDate);
		if (e && (min === null || e < min)) min = e;
	}
	return min === null ? null : Math.floor((min - Date.now()) / 3600000);
}

function probe(api) {
	return new Promise(resolve => {
		const start = Date.now();
		let done = false;
		const timer = setTimeout(() => {
			if (!done) { done = true; resolve({ ok: false, err: "timeout (৩০ সেকেন্ডে সাড়া নেই)", ms: 30000 }); }
		}, 30000);
		try {
			api.getThreadList(1, null, ["INBOX"], (err) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				const ms = Date.now() - start;
				resolve(err ? { ok: false, err: errText(err), ms } : { ok: true, ms });
			});
		} catch (e) {
			if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, err: errText(e), ms: Date.now() - start }); }
		}
	});
}

// আপনার কুকি দিয়ে Facebook-এর পেজ খুলে দেখে checkpoint/লগইন পেজে পাঠাচ্ছে কিনা
async function pageCheck(cookies) {
	try {
		if (!cookies || !cookies.length) return null;
		const axios = require("axios");
		const cookie = cookies.map(c => `${c.key}=${c.value}`).join("; ");
		const r = await axios.get("https://mbasic.facebook.com/", {
			headers: {
				cookie,
				"user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
			},
			maxRedirects: 5,
			timeout: 20000,
			validateStatus: () => true
		});
		if (r.status >= 500) return null;
		const finalUrl = (r.request && r.request.res && r.request.res.responseUrl) || "";
		const body = typeof r.data === "string" ? r.data.slice(0, 20000) : "";
		return { finalUrl, body, status: r.status };
	} catch (e) { return null; }
}

// মেসেজ পাঠানোর এরর ট্র্যাক করতে api.sendMessage-এ হালকা হুক
function hookSendMessage(api) {
	try {
		if (!api || api.sendMessage.__warnHooked) return;
		const orig = api.sendMessage;
		const wrapped = function (...args) {
			const own = global.__warningSending === true; // Warning-এর নিজের মেসেজ
			const idx = args.findIndex((a, i) => i > 0 && typeof a === "function");

			if (!own) {
				sendLog.push(Date.now());
				if (sendLog.length > 1000) sendLog.shift();

				// সেফ মোড: ঝুঁকির সময় বটের অন্য সব মেসেজ আটকে দেয়
				if (state.safeMode) {
					if (idx > 0) { try { args[idx](null, { messageID: "safe-mode" }); } catch (e) { } }
					return Promise.resolve({ messageID: "safe-mode" });
				}
			}

			if (idx > 0) {
				const cb = args[idx];
				args[idx] = function (err, ...rest) {
					if (err && !own) sendErrors.push({ t: Date.now(), msg: errText(err) });
					return cb.call(this, err, ...rest);
				};
			}
			return orig.apply(this, args);
		};
		wrapped.__warnHooked = true;
		api.sendMessage = wrapped;
	} catch (e) { }
}

// ---------- মূল বিশ্লেষণ ----------
async function evaluate(api) {
	const signals = [];
	const add = (level, text) => signals.push({ level, text });

	// ১) সেশন প্রোব
	const res = await probe(api);
	if (res.ok) {
		state.fails = 0;
		if (res.ms > SLOW_MS) state.slow++; else state.slow = 0;
		if (state.slow >= 4) add(2, `Facebook অনেক ধীর সাড়া দিচ্ছে (${Math.round(res.ms / 1000)}s), পরপর ${state.slow} বার`);
		else if (state.slow >= 2) add(1, `Facebook ধীর সাড়া দিচ্ছে (${Math.round(res.ms / 1000)}s)`);
	} else {
		state.fails++;
		if (DANGER_REGEX.test(res.err)) add(4, `Facebook ব্লক/চেকপয়েন্ট সিগন্যাল: ${res.err.slice(0, 100)}`);
		else if (state.fails >= 2) add(3, `পরপর ${state.fails} বার সেশন চেক ফেল: ${res.err.slice(0, 100)}`);
		else add(2, `সেশন চেক ফেল করেছে: ${res.err.slice(0, 100)}`);
	}

	// ২) কুকি যাচাই
	const cookies = getCookies(api);
	let hoursLeft = null;
	if (cookies) {
		const cu = cookies.find(c => c.key === "c_user");
		const xs = cookies.find(c => c.key === "xs");
		if (!cu || !xs) {
			add(4, "লগইন কুকি (c_user/xs) পাওয়া যাচ্ছে না");
		} else {
			try {
				const uid = api.getCurrentUserID && api.getCurrentUserID();
				if (uid && String(cu.value) !== String(uid)) add(3, "কুকির আইডি আর বটের আইডি মিলছে না");
			} catch (e) { }
		}
		hoursLeft = cookieExpiryHours(cookies);
		if (hoursLeft !== null) {
			if (hoursLeft <= 6) add(4, `কুকির মেয়াদ প্রায় শেষ (~${Math.max(hoursLeft, 0)} ঘন্টা)`);
			else if (hoursLeft <= 24) add(3, `কুকির মেয়াদ ২৪ ঘন্টার মধ্যে শেষ (~${hoursLeft} ঘন্টা)`);
			else if (hoursLeft <= COOKIE_WARN_HOURS) add(2, `কুকির মেয়াদ শেষ হয়ে আসছে (~${hoursLeft} ঘন্টা)`);
		}
	}

	// ৩) Facebook পেজ চেক (checkpoint / লগআউট রিডাইরেক্ট)
	const page = await pageCheck(cookies);
	if (page) {
		if (PAGE_BAD_URL.test(page.finalUrl)) add(4, "Facebook আপনাকে checkpoint/লক পেজে পাঠাচ্ছে");
		else if (/\/login/i.test(page.finalUrl)) add(4, "Facebook লগইন পেজে পাঠাচ্ছে, মানে সেশন শেষ/লগআউট হয়েছে");
		else if (PAGE_BAD_BODY.test(page.body)) add(4, "Facebook পেজে অ্যাকাউন্ট লক/সাসপেন্ডের বার্তা দেখাচ্ছে");
	}

	// ৪) মেসেজ পাঠানোর এরর (স্প্যাম/রেট লিমিট আগাম লক্ষণ)
	const cutoff = Date.now() - SEND_WINDOW;
	sendErrors = sendErrors.filter(e => e.t >= cutoff);
	const spamErrs = sendErrors.filter(e => SPAM_REGEX.test(e.msg));
	if (spamErrs.length >= 3) add(4, `মেসেজ পাঠাতে স্প্যাম/লিমিট এরর ${spamErrs.length} বার (গত ৩০ মিনিটে)`);
	else if (spamErrs.length >= 1) add(3, `মেসেজ পাঠাতে স্প্যাম/লিমিট এরর এসেছে: ${spamErrs[spamErrs.length - 1].msg.slice(0, 80)}`);
	else if (sendErrors.length >= 5) add(2, `গত ৩০ মিনিটে ${sendErrors.length} টা মেসেজ পাঠানো ব্যর্থ হয়েছে`);

	// ৪.৫) বট কত দ্রুত মেসেজ পাঠাচ্ছে (বেশি গতি = সাসপেন্ডের বড় কারণ)
	const nowT = Date.now();
	sendLog = sendLog.filter(t => t >= nowT - 3600000);
	const c10 = sendLog.filter(t => t >= nowT - 600000).length;
	const c60 = sendLog.length;
	if (c60 >= RATE_HOUR) add(3, `বট গত ১ ঘন্টায় ${c60}টা মেসেজ পাঠিয়েছে, গতি অনেক বেশি`);
	else if (c10 >= RATE_10MIN) add(2, `বট গত ১০ মিনিটে ${c10}টা মেসেজ পাঠিয়েছে, গতি বেশি`);

	// ৫) লিসেনার নীরব কিনা
	const silentH = (Date.now() - lastEventAt) / 3600000;
	if (silentH >= SILENT_HOURS) add(1, `বট ${Math.floor(silentH)} ঘন্টা কোনো মেসেজ পায়নি (লিসেনার বন্ধ হতে পারে)`);

	const level = signals.reduce((m, s) => Math.max(m, s.level), 0);
	return { level, signals, hoursLeft, ms: res.ms, alive: res.ok };
}

// ---------- সেশনের ইতিহাস থেকে শেখা ----------
// একই xs কুকি কতক্ষণ টিকেছে সেটা মনে রাখে। appstate বদলালে আগের সেশনের আয়ু রেকর্ড হয়।
function sessionTrack(api) {
	try {
		const cookies = getCookies(api);
		const xs = cookies && cookies.find(c => c.key === "xs");
		if (!xs) return;
		const h = crypto.createHash("md5").update(String(xs.value)).digest("hex").slice(0, 12);
		if (state.xsHash && state.xsHash !== h && state.sessionStart && state.lastSeen) {
			const life = (state.lastSeen - state.sessionStart) / 3600000;
			if (life > 0.2) {
				state.lifetimes.push(Math.round(life * 10) / 10);
				if (state.lifetimes.length > 10) state.lifetimes.shift();
			}
			if (state.riskSince) {
				const lead = (state.lastSeen - state.riskSince) / 3600000;
				if (lead > 0) {
					state.leadTimes.push(Math.round(lead * 10) / 10);
					if (state.leadTimes.length > 10) state.leadTimes.shift();
				}
			}
			state.riskSince = null;
			state.level = 0;
			state.lastReport = 0;
		}
		if (state.xsHash !== h) {
			state.xsHash = h;
			state.sessionStart = Date.now();
		}
		state.lastSeen = Date.now();
		saveState();
	} catch (e) { }
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function fmtH(h) {
	if (h < 1) return `${Math.max(1, Math.round(h * 60))} মিনিট`;
	return `${Math.round(h * 10) / 10} ঘন্টা`;
}

// ঝুঁকির শতাংশ (এটা সম্ভাবনার গ্যারান্টি নয়, লক্ষণ দেখে হিসাব করা সূচক)
function riskPercent(ev) {
	const base = { 0: 3, 1: 15, 2: 40, 3: 65, 4: 90 };
	const extra = Math.max(0, ev.signals.length - 1) * 4;
	return Math.min(99, base[ev.level] + extra);
}

function riskBar(pct) {
	const f = Math.round(pct / 20);
	return "🟥".repeat(f) + "⬜".repeat(5 - f);
}

// আনুমানিক সময়: কুকি + আগের সেশনের ইতিহাস + বর্তমান লক্ষণ
function estimateTime(ev) {
	const lines = [];
	let conf = "কম";

	if (ev.hoursLeft !== null) lines.push(`কুকির মেয়াদ অনুযায়ী সর্বোচ্চ ~${fmtH(Math.max(ev.hoursLeft, 0))}`);

	const lt = state.lifetimes || [];
	if (lt.length >= 2 && state.sessionStart) {
		const a = avg(lt);
		const age = (Date.now() - state.sessionStart) / 3600000;
		const rem = a - age;
		if (rem > 0) lines.push(`আগের ${lt.length}টা সেশন গড়ে ~${fmtH(a)} চলেছে, এটা ${fmtH(age)} চলছে → আনুমানিক ~${fmtH(rem)} বাকি`);
		else lines.push(`এই সেশন আগের গড়ের (~${fmtH(a)}) চেয়ে বেশি চলছে, যেকোনো সময় শেষ হতে পারে`);
		if (lt.length >= 4) conf = "মাঝারি";
	}

	const lead = state.leadTimes || [];
	if (lead.length >= 2 && state.riskSince) {
		const a = avg(lead);
		const el = (Date.now() - state.riskSince) / 3600000;
		const rem = a - el;
		if (rem > 0) lines.push(`আগে ঝুঁকি শুরুর গড়ে ~${fmtH(a)} পরে আইডি গেছে → আনুমানিক ~${fmtH(rem)} বাকি`);
		else lines.push(`ঝুঁকি আগের গড় সময় (~${fmtH(a)}) পার করেছে, যেকোনো মুহূর্তে হতে পারে`);
		if (lead.length >= 3) conf = "মাঝারি";
	}

	const heur = { 4: "কয়েক মিনিট থেকে ~২ ঘন্টা", 3: "~২ থেকে ১২ ঘন্টা", 2: "~১২ থেকে ৪৮ ঘন্টা" }[ev.level];
	if (heur) lines.push(`বর্তমান লক্ষণ অনুযায়ী সাধারণ ধারণা: ${heur}`);

	return { lines, conf };
}

function advice(level) {
	if (level >= 4) return "👉 এখনই: নতুন appstate/fbstate সেভ করুন, Facebook-এ ঢুকে চেক করুন, আর বটের স্প্যাম/ব্রডকাস্ট কমান্ড বন্ধ রাখুন।";
	if (level === 3) return "👉 নতুন appstate রেডি রাখুন আর Facebook-এ ঢুকে নিরাপত্তা নোটিফিকেশন আছে কিনা দেখুন।";
	return "👉 appstate ব্যাকআপ নিয়ে রাখুন, বটের অতিরিক্ত অ্যাক্টিভিটি কমান।";
}

function elapsed(ts) {
	const m = Math.floor((Date.now() - ts) / 60000);
	return m >= 60 ? `${Math.floor(m / 60)} ঘন্টা ${m % 60} মিনিট` : `${m} মিনিট`;
}

function buildReport(kind, ev) {
	const L = LEVELS[ev.level];
	let t = kind === "instant" ? `${L.icon} [Warning] ঝুঁকি ধরা পড়েছে!\n` : `⏰ [Warning] রিমাইন্ডার\n`;
	t += `লেভেল: ${L.icon} ${L.name}\n`;
	if (state.riskSince) t += `ঝুঁকি শুরু: ${elapsed(state.riskSince)} আগে\n`;
	t += `\nকারণ:\n` + ev.signals.filter(s => s.level >= 1).map(s => `• ${s.text}`).join("\n");
	const pct = riskPercent(ev);
	const est = estimateTime(ev);
	t += `\n\n📊 ঝুঁকি: ${riskBar(pct)} ${pct}%`;
	t += `\n\n⏳ আনুমানিক সময় (অনুমান, নিশ্চিত নয়):\n` + est.lines.map(l => `• ${l}`).join("\n");
	t += `\n🎯 অনুমানের নির্ভরযোগ্যতা: ${est.conf}`;
	t += `\n\n${advice(ev.level)}`;
	return t;
}

async function runCheck(api, manual = false) {
	if (running) return null;
	if (!state.enabled && !manual) return null;
	running = true;
	try {
		const ev = await evaluate(api);
		const now = Date.now();
		if (ev.alive) { state.lastSeen = now; heartbeat(); }
		console.log(`[warning] check: level=${ev.level} alive=${ev.alive} signals=${ev.signals.length} ${ev.signals.map(x => x.text).join(' | ')}`);
		const eff = ev.level >= ALERT_MIN_LEVEL ? ev.level : 0;

		if (eff === 0) {
			if (state.level > 0) {
				await notify(api, "✅ [Warning] ঝুঁকি কেটে গেছে, আইডি এখন স্বাভাবিক আছে।", null, true);
				addLog(0, "ঝুঁকি কেটে গেছে");
			}
			if (state.safeMode && !state.safeManual) {
				state.safeMode = false;
				await notify(api, "🛡️ [Warning] সেফ মোড বন্ধ হয়েছে, বট আবার স্বাভাবিকভাবে মেসেজ পাঠাবে।", null, false);
			}
			state.level = 0;
			state.riskSince = null;
			state.lastReport = 0;
			// সব ঠিক থাকলে নিয়মিত "আইডি ঠিক আছে" মেসেজ; এটা বন্ধ হয়ে গেলে বুঝবেন সমস্যা
			if (now - (state.lastOk || 0) >= OK_EVERY) {
				state.lastOk = now;
				const pct0 = riskPercent(ev);
				await notify(api, `🟢 [Warning] আইডি ঠিক আছে\n📊 ঝুঁকি: ${riskBar(pct0)} ${pct0}%\n(এই মেসেজ প্রতি ৩ ঘন্টায় আসবে। না এলে বুঝবেন বট বা আইডিতে সমস্যা হয়েছে।)`, null, false);
			}
			saveState();
			return ev;
		}

		const first = state.level === 0;
		if (first) state.riskSince = now;
		const worse = eff > state.level;
		const due = now - state.lastReport >= REMIND_EVERY;

		if (first || worse) {
			await notify(api, buildReport("instant", ev), VIDEO_FIRST, true);
			addLog(eff, ev.signals.map(s => s.text).join(" | "));
			state.lastReport = now;
		} else if (due) {
			await notify(api, buildReport("reminder", ev), VIDEO_REMIND, true);
			addLog(eff, "রিমাইন্ডার: " + ev.signals.map(s => s.text).join(" | "));
			state.lastReport = now;
		}
		if (AUTO_SAFE_MODE && eff >= 3 && !state.safeMode) {
			state.safeMode = true;
			await notify(api, "🛡️ [Warning] সেফ মোড চালু: ঝুঁকি বেশি, তাই বট এখন অন্য কোনো মেসেজ পাঠাবে না (শুধু Warning-এর অ্যালার্ট যাবে)। ঝুঁকি কাটলে নিজে থেকে বন্ধ হবে।", null, false);
		}
		state.level = eff;
		saveState();
		return ev;
	} finally {
		running = false;
	}
}

module.exports = {
	config: {
		name: "warning",
		version: "5.0",
		author: "JABED",
		countDown: 5,
		role: 2,
		description: {
			en: "Auto detect Facebook account risk (logout/suspend) and report to group with tag + video"
		},
		category: "system",
		guide: {
			en: "{pn} help | status | log | on | off | test | safe | setgroup <threadID>"
		}
	},

	// বট চালু হলে নিজে থেকেই শুরু হবে
	onLoad: function ({ api }) {
		loadState();
		lastEventAt = Date.now();
		hookSendMessage(api);
		sessionTrack(api);
		if (global.warningTimer) clearInterval(global.warningTimer);
		global.warningTimer = setInterval(() => { runCheck(api).catch(() => { }); }, CHECK_EVERY);
		console.log('[warning] monitoring started');
		setTimeout(() => {
			notify(api, "🟢 [Warning] মনিটরিং চালু হয়েছে। প্রতি ১০ মিনিটে চেক চলবে।", null, true).catch(() => { });
			runCheck(api).catch(() => { });
		}, 20000);
	},

	// লিসেনার জীবিত আছে কিনা বোঝার জন্য
	onChat: async function () {
		lastEventAt = Date.now();
	},

	onStart: async function ({ api, message, args, event }) {
		// সেফ মোডেও কমান্ডের উত্তর যেন আসে, তাই সরাসরি পাঠানো হচ্ছে
		const reply = (t) => sendOnce(api, t, event.threadID);
		// role: 2 থাকায় শুধু config.json-এর adminBot-এ থাকা আইডিগুলো ব্যবহার করতে পারবে
		loadState();
		const sub = (args[0] || "status").toLowerCase();

		if (sub === "help" || !["status", "log", "on", "off", "test", "setgroup", "safe"].includes(sub)) {
			return reply(
				"🛡️ Warning কমান্ড লিস্ট\n\n" +
				"1️⃣ warning status\n→ আইডির অবস্থা, ঝুঁকির শতাংশ, আনুমানিক সময়, সাড়ার সময় আর ঝুঁকির কারণ দেখায়।\n\n" +
				"2️⃣ warning log\n→ সর্বশেষ ১০টা ঝুঁকির ঘটনা সময়সহ দেখায়।\n\n" +
				"3️⃣ warning test\n→ গ্রুপে ট্যাগ ও ভিডিওসহ টেস্ট মেসেজ পাঠায়।\n\n" +
				"4️⃣ warning on\n→ অটো মনিটরিং চালু করে।\n\n" +
				"5️⃣ warning off\n→ অটো মনিটরিং বন্ধ করে।\n\n" +
				"6️⃣ warning setgroup <গ্রুপ আইডি>\n→ রিপোর্ট যে গ্রুপে যাবে সেটা বদলায়।\n\n" +
				"7️⃣ warning safe on/off\n→ সেফ মোড: বট অন্য মেসেজ পাঠানো বন্ধ রাখে। ঝুঁকি বাড়লে নিজে থেকেও চালু হয়।\n\n" +
				"8️⃣ warning help\n→ এই লিস্ট দেখায়।\n\n" +
				"⚙️ অটো কাজ: প্রতি ১০ মিনিটে চেক, ঝুঁকি ধরলে সাথে সাথে ট্যাগসহ অ্যালার্ট, তারপর প্রতি ৩০ মিনিটে রিমাইন্ডার।\n" +
				"🔒 শুধু config.json-এর adminBot-এ থাকা আইডিগুলো ব্যবহার করতে পারবে।\n🟢 সব ঠিক থাকলে প্রতি ৩ ঘন্টায় \"আইডি ঠিক আছে\" মেসেজ আসবে।"
			);
		}

		if (sub === "on") { state.enabled = true; saveState(); return reply("✅ Warning মনিটরিং চালু।"); }
		if (sub === "off") { state.enabled = false; saveState(); return reply("⛔ Warning মনিটরিং বন্ধ।"); }

		if (sub === "safe") {
			const v = (args[1] || "").toLowerCase();
			if (v === "on") { state.safeMode = true; state.safeManual = true; saveState(); return reply("🛡️ সেফ মোড চালু। বট এখন Warning ছাড়া অন্য মেসেজ পাঠাবে না।"); }
			if (v === "off") { state.safeMode = false; state.safeManual = false; saveState(); return reply("✅ সেফ মোড বন্ধ।"); }
			return reply(`সেফ মোড এখন: ${state.safeMode ? "চালু 🛡️" : "বন্ধ"}\nব্যবহার: warning safe on | warning safe off`);
		}

		if (sub === "setgroup") {
			if (!/^\d{8,}$/.test(args[1] || "")) return reply("সঠিক গ্রুপ আইডি দিন। উদাহরণ: warning setgroup 9558705787479785");
			state.groupID = args[1]; saveState();
			return reply(`✅ রিপোর্ট গ্রুপ সেট হয়েছে: ${args[1]}`);
		}

		if (sub === "test") {
			await notify(api, "🧪 [Warning] টেস্ট: ট্যাগ, ভিডিও ও রিপোর্টিং ঠিকঠাক কাজ করছে কিনা দেখুন।", VIDEO_FIRST, true);
			return reply("টেস্ট মেসেজ গ্রুপে পাঠানো হয়েছে।");
		}

		if (sub === "log") {
			if (!state.log.length) return reply("এখনো কোনো ঘটনা রেকর্ড হয়নি।");
			const lines = state.log.slice(-10).reverse().map(l =>
				`${LEVELS[l.level].icon} ${new Date(l.t).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}\n${l.text}`);
			return reply("📜 সাম্প্রতিক ঘটনা:\n\n" + lines.join("\n\n"));
		}

		const ev = await runCheck(api, true);
		let txt = `🛡️ Warning স্ট্যাটাস\nমনিটরিং: ${state.enabled ? "চালু" : "বন্ধ"}\nচেক: প্রতি ১০ মিনিট | রিমাইন্ডার: প্রতি ৩০ মিনিট\nরিপোর্ট গ্রুপ: ${state.groupID}\nসেফ মোড: ${state.safeMode ? "চালু 🛡️" : "বন্ধ"}`;
		if (ev) {
			const L = LEVELS[ev.level];
			txt += `\nআইডি অবস্থা: ${L.icon} ${L.name}\nসাড়া দেওয়ার সময়: ${Math.round(ev.ms / 100) / 10}s`;
			const pct = riskPercent(ev);
			txt += `\n📊 ঝুঁকি: ${riskBar(pct)} ${pct}%`;
			if (ev.level >= 2 || ev.hoursLeft !== null) {
				const est = estimateTime(ev);
				txt += `\n\n⏳ আনুমানিক সময় (অনুমান):\n` + est.lines.map(l => `• ${l}`).join("\n") + `\n🎯 নির্ভরযোগ্যতা: ${est.conf}`;
			}
			if (ev.signals.length) txt += `\n\nকারণ:\n` + ev.signals.map(s => `• ${s.text}`).join("\n");
		} else txt += `\n(চেক চলছে, একটু পরে আবার দিন)`;
		return reply(txt);
	}
};

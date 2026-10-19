const axios = require("axios");
const { getPrefix } = global.utils;
const { commands, aliases } = global.GoatBot;

// ভিডিও লিংক দুইটা এখানে বসাও
const VIDEO_LINKS = [
	"https://files.catbox.moe/zl71oz.mp4",
	"https://files.catbox.moe/yskhac.mp4"
];

// অতিরিক্ত কমান্ডের তালিকা (479 টা). বর্তমান কমান্ডের সাথে নাম মিলে গেলে একটা বাদ যাবে
const EXTRA_COMMANDS = [
	"anihot", "horny", "kanda", "redroom", "segs2", "sex", "sexvid", "uff",
	"xncdi", "xrandom", "clearcache", "mgi", "out", "pending", "setallnick", "setbal",
	"settings", "udi", "hot", "aliya2", "aniart", "flux2max", "gen", "genx",
	"webss", "zombie", "ai", "animate", "art", "dalle", "edit", "flux",
	"gemini", "gpt", "midjourney", "nanobanana", "poli", "prompt", "text2image", "supanime",
	"ai-song", "device", "alya", "animeinfo", "animequote", "anipic", "bankai", "character",
	"goku", "hinata", "manga", "narutovideo", "shikimori", "anisearch", "applemusic", "autodl",
	"bluearchive", "cat", "hentai", "lyricsvideo", "memevid", "shazam", "sing", "song",
	"spotify", "tiktok", "v2a", "waifu", "waifuadult", "tcp", "groupimage", "groupname",
	"activemember", "adduser", "admin", "adminboxonly", "all", "antichangeinfobox", "antiout", "ban",
	"boxinfo", "busy", "callad", "count", "emoji", "filteruser", "gcadmin", "gcinfo",
	"god", "kick", "kickall", "refresh", "rules", "setalias", "setleave", "setname",
	"shortcut", "tag", "theme", "usage", "warn", "hello", "baby", "prefix",
	"terminal", "balancec", "bank", "give", "math", "premium", "set", "task",
	"top", "shiko", "ads", "ball", "berojgar", "bondhu", "bonk", "bou",
	"bro", "bro2", "butslap", "buttslap", "buzz", "chagol", "chipay", "cockroach",
	"condom", "dim", "elephant", "fakechat", "farhan_tx", "fighter", "goru", "goru2",
	"gossip", "gu", "handsome", "hijla", "hitler", "horny2", "jail2", "joke",
	"jolpori", "karaba", "kola", "ledysr", "life", "love", "mia", "mistake",
	"mnm", "murgi2", "murgi3", "mygirl", "nc", "needgf", "nekha", "nigga",
	"notstonk", "patkhet", "pikachu", "pregnant", "premik", "pussy", "rajakar", "relation",
	"sala", "snews", "son", "stonk", "takla", "tokai", "trigger", "tuntun",
	"tv", "usta", "videocall", "voice", "wanted2", "xdi", "xnxx", "xray",
	"alien", "caption", "clown", "cow", "dog2", "donkey", "emojigif", "emojimean",
	"emojimix", "findgay", "fuck", "fuck2", "gay", "gif", "gorib", "hack",
	"hug", "jail", "kicked", "kidnap", "kill", "kiss", "marry", "meme",
	"murgi", "nokia", "pair", "pair2", "pair3", "pickupline", "poke", "propose",
	"punch", "rip", "sanda", "slap", "squeeze", "toilet", "trash", "wanted",
	"actor", "animalgame", "animequiz", "aniqz2", "cartoongame", "casinoslot", "cricketgame", "daily",
	"duck", "fflike", "ffqz2", "football2", "footballgame", "freefire", "megaspin", "narutoquiz",
	"slot", "ttt2", "vslot", "wbquiz", "wordgame", "bet", "casino", "chess",
	"dice", "flaggame", "guess", "guessnumber", "hunt", "islamicquiz", "mathgame", "maze",
	"quiz", "spin", "trade", "truthordare", "ttt", "wheel", "cmdstore", "supportgc",
	"autoreact", "cr", "friendadd", "groupcustomize", "listbox", "pakhi", "4kpro", "arrest",
	"chad", "copuledp2", "dog", "edit2", "fbcover", "fox", "imagefilter", "pinterest",
	"pp", "up5", "xlnub", "countryinfo", "cpanel", "cpanel2", "cpanel3", "numinfo",
	"owner", "setrole", "spy2", "system", "tid", "time", "uptime4", "shishir",
	"islamicvideo", "namaz", "ramadan", "bed", "cdp", "crush", "kiss3", "love2",
	"marry4", "my", "myking", "myqueen", "pair5", "pair6", "pr", "sister",
	"goatstore", "album", "album2", "anicdp", "anime", "anisr", "anisr2", "as",
	"aura", "bike", "boom", "captain", "car", "catvideo", "cdpvip", "convertmp3",
	"cutee", "ffvideo", "flower", "fun", "fun2", "funny", "gan", "girl",
	"girl2", "host", "loco", "lofi", "mbox", "meme2", "music", "natural",
	"neymar", "onlyanimevideo", "onlyanimevideo2", "pair4", "pfp", "pinterestdl", "random", "root",
	"sad", "sing2", "sniper", "solowed", "tik", "tikedit", "tiksr", "tiktokdl",
	"unsplash", "video", "ytb", "momoi", "play", "song2", "autosticker", "fuck you",
	"blowjob", "boobs", "chudi", "comatozze", "fingering", "kissvideo", "segs", "segs3",
	"tormarechudi", "vuda", "rainbow", "backupdata", "botnick", "cmd", "creator", "developer",
	"eval", "event", "givefile", "ignoreonlyad", "ignoreonlyadbox", "install", "jsontomongodb", "loadconfig",
	"mention", "noprefix", "notification", "offbot", "owner2", "raw", "resetuser", "restart",
	"setavt", "setlang", "setrankup", "setwelcome", "shell", "stats", "typingindicator", "update",
	"user", "whitelistthread", "wl", "spiderman", "spycard", "anti18", "customrankcard", "rank",
	"topexp", "haha", "account", "chakrun", "de", "emoji_voice", "fork", "perf",
	"ping", "spam", "system2", "text_voice", "thread", "uptime", "uptime2", "uptime3",
	"fokir", "gopgop", "monkey", "ephoto", "circuit", "4k", "cloudinary", "fakechat2",
	"font", "freeimage", "googleimagesearch", "imgbb", "imgur", "lens", "lyrics", "monitor",
	"rbg", "smsbomber", "ss", "tempmail", "tikinfo", "tinyurl", "unblur", "poop",
	"shahabagi", "murf-tts", "accept", "acpme", "age", "calendar", "catbox", "check",
	"cpanel4", "getlink", "github", "google", "googleimg", "npm", "postreact", "say",
	"spy", "spy3", "sr", "translate", "uid", "unsent", "weather",
// ---- বাড়তি নাম (শুধু তালিকায় দেখানোর জন্য, আসল কমান্ড ফাইল নেই) ----
	"tiger", "lion", "panda", "zebra", "giraffe", "rabbit", "monkey2", "wolf",
	"fox2", "bear", "eagle", "parrot", "dolphin", "shark", "whale", "turtle",
	"snake", "frog", "horse", "camel", "deer", "goat", "sheep", "pig",
	"hen", "rooster", "crow", "owl", "bat", "bee", "ant", "spider",
	"pizza", "burger", "biryani", "kebab", "noodles", "pasta", "cake", "icecream",
	"chocolate", "coffee", "tea", "juice", "mango", "apple", "banana", "grapes",
	"lemon", "rice", "football2026", "cricket", "chessbot", "ludo", "carrom", "snake2",
	"tictac", "puzzle", "riddle", "trivia", "bingo", "darts", "racing", "archery",
	"boxing", "sunny", "rainy", "cloud", "storm", "snow", "star", "sun",
	"planet", "galaxy", "comet", "rocket", "earth", "ocean", "river", "mountain",
	"forest", "desert", "island", "love3", "heart", "rose", "smile", "laugh",
	"cry", "angry", "shy", "wink", "cool", "nerd", "ghost", "devil",
	"angel", "king", "queen", "prince", "princess", "ninja", "pirate", "robot",
	"alienx", "ping2", "pong", "clock", "timer", "alarm", "stopwatch", "reminder",
	"note", "todo", "poll", "vote", "flip", "coin2", "roll", "lucky",
	"fortune", "horoscope", "zodiac", "qrcode", "barcode", "ip", "whois", "dns",
	"speedtest", "shorten", "expand", "base64", "binary", "hex", "morse", "reverse",
	"upper", "lower", "title", "count2", "vowels", "palindrome", "quote2", "fact",
	"proverb", "poem", "shayari", "story", "dialogue", "wish", "greet", "goodnight",
	"goodmorning"
];

let xfont = null;
let yfont = null;
let categoryEmoji = null;

async function loadResources() {
	try {
		const [catRes, cmdRes, emojiRes] = await Promise.all([
			axios.get("https://raw.githubusercontent.com/Saim-x69x/sakura/main/xfont.json", { timeout: 6000 }),
			axios.get("https://raw.githubusercontent.com/Saim-x69x/sakura/main/yfont.json", { timeout: 6000 }),
			axios.get("https://raw.githubusercontent.com/Saim-x69x/sakura/main/category.json", { timeout: 6000 })
		]);
		xfont = catRes.data;
		yfont = cmdRes.data;
		categoryEmoji = emojiRes.data;
	} catch (err) {}
}

function fontConvert(text, type = "command") {
	const fontMap = type === "category" ? xfont : yfont;
	if (!fontMap) return text;
	return text.split("").map(ch => fontMap[ch] || ch).join("");
}

function getCategoryEmoji(cat) {
	return categoryEmoji?.[cat.toLowerCase()] || "🗂️";
}

function levenshteinDistance(a, b) {
	const matrix = Array(b.length + 1).fill(0).map(() => Array(a.length + 1).fill(0));
	for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
	for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
	for (let j = 1; j <= b.length; j++) {
		for (let i = 1; i <= a.length; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[j][i] = Math.min(
				matrix[j][i - 1] + 1,
				matrix[j - 1][i] + 1,
				matrix[j - 1][i - 1] + cost
			);
		}
	}
	return matrix[b.length][a.length];
}

function getClosestCommand(name) {
	const lower = name.toLowerCase();
	let best = null, dist = Infinity;
	for (const cmd of commands.keys()) {
		const d = levenshteinDistance(lower, cmd.toLowerCase());
		if (d < dist) {
			dist = d;
			best = cmd;
		}
	}
	return dist <= 3 ? best : null;
}

function roleTextToString(role) {
	switch (role) {
		case 0: return "All Users";
		case 1: return "Group Admins";
		case 2: return "VIP Users";
		case 3: return "Bot Admin";
		case 4: return "Bot Creator";
		default: return "Unknown";
	}
}

let videoIndex = 0; // কোন ভিডিওর পালা (বট রিস্টার্ট হলে প্রথমটা থেকে শুরু)

// প্রতিবার একটা করে ভিডিও, পরের বার অন্যটা (পর্যায়ক্রমে)
async function getVideos() {
	const links = VIDEO_LINKS.filter(u => /^https?:\/\//.test(u));
	if (!links.length) return undefined;

	for (let i = 0; i < links.length; i++) {
		const url = links[(videoIndex + i) % links.length];
		try {
			const stream = await global.utils.getStreamFromURL(url);
			videoIndex = (videoIndex + i + 1) % links.length;
			return [stream];
		} catch (e) {
			console.error("help0 video error:", e.message);
		}
	}
	return undefined;
}

module.exports = {
	config: {
		name: "help0",
		version: "1.0",
		author: "JABED",
		countDown: 5,
		role: 0,
		shortDescription: { en: "Shows all commands or details." },
		longDescription: { en: "Display categories, command lists or specific command info." },
		category: "info",
		guide: { en: "{pn}, {pn} [command], {pn} -c [category]" }
	},

	onStart: async function ({ message, args, event, role }) {
		const prefix = getPrefix(event.threadID);

		if (!xfont || !yfont || !categoryEmoji) await loadResources();

		const categories = {};
		for (const [name, cmd] of commands) {
			if (!cmd?.config || typeof cmd.onStart !== "function") continue;
			if (cmd.config.role > role) continue;
			const cat = (cmd.config.category || "UNCATEGORIZED").toUpperCase();
			if (!categories[cat]) categories[cat] = [];
			categories[cat].push(name);
		}

		// বর্তমান সব কমান্ড + aliases (role ছাড়া) এর সাথে মিলিয়ে ডুপ্লিকেট বাদ
		const liveAll = new Set([...commands.keys(), ...aliases.keys()].map(n => n.toLowerCase()));
		const seenExtra = new Set();
		const extra = EXTRA_COMMANDS.filter(n => {
			const k = n.toLowerCase();
			if (liveAll.has(k) || seenExtra.has(k)) return false;
			seenExtra.add(k);
			return true;
		});
		if (extra.length) categories["MORE"] = extra;

		const input = args.join(" ").trim();

		// ক্যাটাগরি অনুযায়ী লিস্ট: help0 -c <category>
		if (args[0] === "-c" && args[1]) {
			const categoryName = args[1].toUpperCase();
			if (!categories[categoryName]) {
				return message.reply(`❌ Category "${categoryName}" not found.`);
			}

			const emoji = getCategoryEmoji(categoryName);
			const list = categories[categoryName];

			let msg = "";
			msg += "━━━━━━━━━━━━━━\n";
			msg += `𝐂𝐀𝐓𝐄𝐆𝐎𝐑𝐘: ${emoji} | ${fontConvert(categoryName, "category")}\n`;
			msg += "╭──────୨ৎ──────╮\n";
			for (const cmd of list.sort()) {
				msg += `╎ ᯓ✧. ${fontConvert(cmd, "command")}\n`;
			}
			msg += "┕━─────୨ৎ─────━ᥫ᭡\n";
			msg += `• 𝙽𝚎𝚎𝚍 𝚑𝚎𝚕𝚙 𝚠𝚒𝚝𝚑 𝚊 𝚌𝚘𝚖𝚖𝚊𝚗𝚍? 𝚄𝚜𝚎 ${prefix}𝚑𝚎𝚕𝚙𝟶 <𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚗𝚊𝚖𝚎>.\n`;
			msg += "╭──────୨ৎ──────╮\n";
			msg += `╎ 🔢 𝐓𝐨𝐭𝐚𝐥 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬: ${list.length}\n`;
			msg += `╎ ⚡️ 𝐏𝐫𝐞𝐟𝐢𝐱: ${prefix}\n`;
			msg += "╎ 👤 𝐂𝐫𝐞𝐚𝐭𝐨𝐫: JABED\n";
			msg += "╰──────୨ৎ──────╯";

			return message.reply({ body: msg, attachment: await getVideos() });
		}

		// তালিকা ৩ পেজে: help0 (পেজ ১), help0 2, help0 3
		const pageMatch = /^(?:page|p)?\s*(\d+)$/i.exec(input);
		if (!input || pageMatch) {
			const PAGES = 3;
			const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
			if (page < 1 || page > PAGES) {
				return message.reply(`❌ পেজ ১ থেকে ${PAGES} এর মধ্যে দিন। যেমন: ${prefix}help0 2`);
			}

			const all = [].concat(...Object.values(categories))
				.sort((a, b) => a.localeCompare(b));
			const total = all.length;
			const size = Math.ceil(total / PAGES);
			const slice = all.slice((page - 1) * size, page * size);

			let body =
				"━━━━━━━━━━━━━━\n" +
				`𝙰𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝙲𝚘𝚖𝚖𝚊𝚗𝚍𝚜 (𝙿𝚊𝚐𝚎 ${page}/${PAGES})\n` +
				"━━━━━━━━━━━━━━\n" +
				"╭──────୨ৎ──────╮\n";
			for (const cmd of slice) {
				body += `╎ᯓ✧. ${fontConvert(cmd, "command")}\n`;
			}
			body += "┕━─────୨ৎ─────━ᥫ᭡\n";
			body += page < PAGES
				? `➡️ 𝙽𝚎𝚡𝚝: ${prefix}𝚑𝚎𝚕𝚙𝟶 ${page + 1}\n`
				: `⬅️ 𝙱𝚊𝚌𝚔: ${prefix}𝚑𝚎𝚕𝚙𝟶 ${page - 1}\n`;
			body += `• 𝙽𝚎𝚎𝚍 𝚑𝚎𝚕𝚙 𝚠𝚒𝚝𝚑 𝚊 𝚌𝚘𝚖𝚖𝚊𝚗𝚍? 𝚄𝚜𝚎 ${prefix}𝚑𝚎𝚕𝚙𝟶 <𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚗𝚊𝚖𝚎>.\n`;
			body += "╭──────୨ৎ──────╮\n";
			body += `╎ 🔢 𝐓𝐨𝐭𝐚𝐥 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬: ${total}\n`;
			body += `╎ 📄 𝐏𝐚𝐠𝐞: ${page}/${PAGES}\n`;
			body += `╎ ⚡️ 𝐏𝐫𝐞𝐟𝐢𝐱: ${prefix}\n`;
			body += "╎ 👤 𝐂𝐫𝐞𝐚𝐭𝐨𝐫: JABED\n";
			body += "╰──────୨ৎ──────╯";

			// ভিডিও (১ মিনিটে না এলে ভিডিও ছাড়াই যাবে)
			const attachment = await Promise.race([
				getVideos(),
				new Promise(resolve => setTimeout(() => resolve(undefined), 60000))
			]);

			try {
				return await message.reply({ body, attachment });
			} catch (e) {
				console.error("help0 page+video failed:", e && e.message);
				return message.reply(body);
			}
		}

		// নির্দিষ্ট কমান্ডের তথ্য: help0 <command>
		const cmdName = input.toLowerCase();
		const cmd = commands.get(cmdName) || commands.get(aliases.get(cmdName));

		if ((!cmd || !cmd.config) && seenExtra.has(cmdName)) {
			return message.reply(`ℹ️ "${cmdName}" শুধু তালিকায় আছে, বটে লোড করা নেই।`);
		}

		if (!cmd || !cmd.config) {
			const suggestion = getClosestCommand(cmdName);
			return message.reply(
				suggestion
					? `❌ Command "${cmdName}" not found.\n👉 Maybe you meant: ${suggestion}`
					: `❌ Command "${cmdName}" not found.`
			);
		}

		const c = cmd.config;
		const guideText = c.guide?.en || (typeof c.guide === "string" ? c.guide : null);
		const usage = guideText ? guideText.replace(/{pn}/g, `${prefix}${c.name}`) : "No usage.";
		const aliasList = Array.isArray(c.aliases) ? c.aliases.join(", ") : (c.aliases || "None");
		const desc = c.longDescription?.en || c.shortDescription?.en
			|| (typeof c.description === "string" ? c.description : "No description.");

		const msg = `
╭═══ [ 𝘊𝘖𝘔𝘔𝘈𝘕𝘋 𝘐𝘕𝘍𝘖 ] ═══╮
╎🧩 Name : ${c.name}
╎📦 Category : ${(c.category || "UNCATEGORIZED").toUpperCase()}
╎📜 Description: ${desc}
╎🔁 Aliases : ${aliasList}
╎⚙️ Version : ${c.version || "1.0"}
╎🔐 Permission : ${c.role} (${roleTextToString(c.role)})
╎⏱️ Cooldown : ${c.countDown || 5}s
╎👑 Author : ${c.author || "Unknown"}
╎📖 Usage : ${usage}
╰═════════୨ৎ═════════╯`;

		return message.reply(msg);
	}
};

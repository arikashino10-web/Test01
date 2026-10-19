// প্রতি২ গ্রুপে চলমান সিকোয়েন্স (threadID -> { timers, targetID })
const running = new Map();
// বট রিস্টার্টের আগ পর্যন্ত মেমোরিতে on/off অবস্থা (threadsData না থাকলে এটাই ব্যবহার হবে)
const memState = new Map();

// [দেরি (ms), মেসেজ]  — নামটা প্রতিটার শেষে ট্যাগ হয়ে যাবে
const MESSAGES = [
	[3000, "তোমাকে দেখলে আমার এত ভালো লাগে কেন জান আমি কিছুই তো বুঝতে পারি না? । ?।"],
	[5000, "টমেটো লাল কাঁচা মরিচ ঝাল তোমার বুকের মাঝে চুমু দেবো আমি চিরকাল জান???   ?.."],
	[7000, "༉༎༉?!!লাইন টা তুমার জন্য  ডুবেছি আমি তুমার প্রেমের অনন্ত মায়ায় ? ༅༎•❤️??"],
	[9000, "দিন শেষে আমার তোমাকেই লাগবে?!"],
	[12000, "~?এক আকাশ সমান স্বপ্ন নিয়েতোমাকে ভালোবাসি প্রিয়???"],
	[15000, "ছেড়ে যাওয়ার যুগে সবার একটা থেকে যাওয়ার মানুষ হোক!?আপনি আমার সে মানুষ?? "],
	[17000, "- সত্যি কারের ভালোবাসা গুলো এমনই হয় ??- কেউ কাউকে ছেড়ে যায় না শেষ পর্যন্ত থাকে ?❤️i Love You Jan?"],
	[20000, "ডুবেছি আমি তোমার চোখের অন্তত মায়ায় ?❤️‍? ?"],
	[23000, " যেদিন তুমি সবকিছু বুঝতে পারবে - সেদিন আমি সিমান্ত থাকবো না! ?? MAHFUJ PROJECT বট?"],
	[26000, "- খুব জানতে ইচ্ছে করে.?? - কি লেখা আছে আমার এই জীবনের শেষের পাতায়.!??"],
	[29000, "︵?シ-???'? ??? ??? ???????..!??-  ???? ????? ???? ?✨ দিন শেষে আমি আমার  তোমাকেই লাগবে??︵?❤️‍?"],
	[29000, "সময় থাকতে ভালোবাসার মানুষকে আপন করে নিতে হয়,দেরি হলেই সব শেষ!??"],
	[32000, "-︵??___ღ༎হারিয়ে গেলে কেউ খুজবে না︵ღ۵__? অথচ সবাই বলে তুমি হারিয়ে গেলে খুব Miss করবো___ღ༎???"],
	[35000, "∞──?✨?──∞ ?{·(??????? ????????? ????)·}?___বিশ্বাস ছাড়া ভালোবাসা অর্থহীন আর ? অধিকার ছাড়া সম্পর্ক মূল্যহীন-!? ?"],
	[38000, "নীল আকাশে তারার মেলা,,,,, মধ্য রাতে চাদের খেলা। মিষ্টি সকাল শিশির ভেজা,,,,,,,, শুধু দেখো আমার প্রেমে কতোই না মজা।।"],
	[41000, "-মানসিক শান্তি'ই বড় শান্তি..❤️-আর সেই শান্তি শুধুমাত্র তোমার কাছেই  পাওয়া যায়..?"],
	[44000, "সমবয়সী রিলেশন গুলো সবসময় সুন্দর ও সুখের হয় যেমন জান তোমার আর আমার ?❤️?"],
	[47000, "- সৌন্দর্যের আলাদা কোন রং নেই - আল্লাহর সৃষ্টি সব কিছুই সুন্দর যেমন তুমি..! ?"],
	[50000, "খুব জানতে ইচ্ছে করে.?? - কি লেখা আছে তোমার আর আমার এই জীবনের শেষের পাতায়.!??"],
	[53000, "∞──?✨?──∞ ?{·(??????? ????????? ????)·}?___বিশ্বাস ছাড়া ভালোবাসা অর্থহীন আর ? অধিকার ছাড়া সম্পর্ক মূল্যহীন-!? ?"],
	[56000, "✨?-!<???? ????? ?????'-?- ??__তুমি তার রুপের কথা বলছো  আমি তোমার হাসিতে মুগ্ধ! ?????"],
	[59000, "অনিয়মে কাছে আসা নিয়ম করে দুরত্ব,এটা  যদি নিয়ম হয় ভালোবাসার ঘৃনা জন্মাক ভালোবাসার উপর ??"],
	[62000, "যার জন্য সব কিছু  চেরে  আমি শূন্য ???আজ সে অন্য কাউকে  নিয়ে পরিপূর্ণ  ???"],
	[65000, "✨?-!<???? ????? ?????'-?- ??আকাশ সুন্দর চন্দ্র তারায়, বাগান সুন্দর ফুলে। আমি সুন্দর তোমার প্রেমে,,, যদি না যাও ভুলে।?????"],
	[68000, "︵༎ຶ??❥︎✔︎•____???? ?? ?????????? ???? ??? ??? ?????? ??????:)??___জীবন সুন্দর!! যদি তুমি আমি সিমান্তের   সাথে থাকো -?✨???"],
	[71000, "I love u Jan?? দুজনে মিলে বেচবো ডিম?‍♂️?‍♂️"],
	[74000, "একদিন সব ইচ্ছা পূর্ণতা পাবে ! ? ?? ??? ?????____Jan ☺️?"],
	[77000, "অন্যের জন্যে নিজেকে বাঁচিয়ে রেখে নিজেকে নিজে তিলে তিলে শেষ করার নামই হলো ভালোবাসা ।"],
	[80000, "ভালোবাসা হলো দুটি হৃদয়ের সমন্বয়, যেখানে একটি ছাড়া অন্যটি অচল।"],
	[83000, "ভালোবাসা যা দেয়, তার চেয়ে বেশি কেড়ে নেয় ।"],
	[86000, "ভালোবাসা বাতাসের মতো,আপনি এটি দেখতে না পারলেও অনুভব করতে পারবেন"],
	[89000, "ভালোবাসা পাওয়ার চাইতে ভালোবাসা দেওয়াতেই বেশী আনন্দ।"],
	[92000, "পৃথিবীতে অনেক ধরনের অত্যাচার আছে । ভালোবাসার অত্যাচার হচ্ছে সবচেয়ে ভয়ানক অত্যাচার। এ অত্যাচারের বিরুদ্ধে কখনো কিছু বলা যায় না, শুধু সহ্য করে নিতে হয়।"],
	[95000, "বাস্তবতা এতই কঠিন যে কখনও কখনও বুকের ভেতর গড়ে তোলা বিন্দু বিন্দু ভালোবাসাও অসহায় হয়ে পড়ে।"],
	[98000, "জীবনে শুধু এবং শুধুমাত্র একটিই সুখ রয়েছে আর তা হলো ভালোবাসা এবং বিনিময়ে তা পাওয়া।"],
	[101000, "ভালোবাসার মধ্যে অবশ্যই কিছু পাগলামি থাকে তবে সেই পাগলামির পিছনেও কিছু কারণ থাকে।"],
	[104000, "যদি তুমি তোমাকে ভালোবাসা না দাও তবে কেউ দিতে আসবে না।"],
	[107000, "ভালোবাসা কখনো এমনি এমনি মারা যায় না ভালোবাসা তখনই মারা যায় যখন আমরা এর খেয়াল নিতে ভুলে যাই।"],
	[110000, "ভালোবাসা অল্প কয়েক দিনের জন্য হলেও ভুলে যাওয়া সময় সাপেক্ষ।"],
	[113000, "যদি তুমি আমাকে মনে রাখো তবে অন্য কেউ ভুলে গেলেও আমার কিছু যায় আসে না।"],
	[116000, "বসন্তের মনোহর গোধূলি বেলাতে,গাছে গাছে কি যে শোভা ফুলের মেলাতে,বয়ে যায় এ লগন এসো মোর প্রিয়া, তোমায় কাছে পেয়ে জুড়াক আমার জান ।"],
	[120000, "কাছে যদি না আসো, গোপন কথা বলি কেমন করে,আমার যত প্রেম পিরিত, রেখেছি তা তোমার তরে ।"],
	[123000, "সবই কিছু বুঝো তুমি, তবু অবুজ হয়ে থাকো,তোমার ছেড়ে আর যে আমি থাকতে পারি নাগো ।"],
	[126000, "হে প্রেয়সী মিষ্টি হাসি, জাগায় প্রানে সাড়া আবার কবে দেখবো তোমায় তাইতো এত তাড়া ।"],
	[129000, "তোমার আমার প্রেম এক জনমের শুধু নয়,এই প্রেম যেন ওগো চিরদিন অন্তরে রয় ।"],
	[132000, "ঝড় উঠেছে এই বুকে, দেখে তোমায় প্রথম বার,না পেলে আপন করে, এ ঝড় থামবে না আর ।"],
	[135000, "কত রাত জেগেছি তোমার কথা ভেবে ভেবে কবে বলো তুমি আমার আপন করে নেবে ।"]
];

async function isEnabled(threadsData, threadID) {
	try {
		if (threadsData) {
			const v = await threadsData.get(threadID, "data.stalkEnabled");
			if (v === false) return false;
			if (v === true) return true;
		}
	} catch (e) {}
	return memState.has(threadID) ? memState.get(threadID) : true; // ডিফল্ট: চালু
}

async function setEnabled(threadsData, threadID, value) {
	memState.set(threadID, value);
	try {
		if (threadsData) await threadsData.set(threadID, value, "data.stalkEnabled");
	} catch (e) {}
}

function stopRunning(threadID) {
	const r = running.get(threadID);
	if (!r) return false;
	for (const t of r.timers) clearTimeout(t);
	running.delete(threadID);
	return true;
}

async function getName(usersData, uid) {
	try {
		if (usersData && usersData.getName) {
			const n = await usersData.getName(uid);
			if (n) return n;
		}
	} catch (e) {}
	return "বন্ধু";
}

module.exports = {
	config: {
		name: "stalk",
		version: "2.0.0",
		role: 2,
		author: "JABED D KURÕ",
		description: "একজনকে বারবার ট্যাগ করে প্রেমের মেসেজ পাঠায়। @mention, UID বা রিপ্লাই দিয়ে টার্গেট বাছা যায়।",
		category: "nsfw",
		countDown: 10,
		guide: {
			en: "{pn} @mention\n{pn} <uid>\n(কারো মেসেজে রিপ্লাই দিয়ে) {pn}\n{pn} on  → এই গ্রুপে চালু\n{pn} off → বন্ধ + চলমানটা থামাবে"
		}
	},

	onStart: async function ({ message, event, args, api, usersData, threadsData }) {
		const threadID = event.threadID;
		const sub = (args[0] || "").toLowerCase();

		// stalk on / stalk off
		if (sub === "on") {
			await setEnabled(threadsData, threadID, true);
			return message.reply("✅ stalk এই গ্রুপে চালু করা হলো।");
		}
		if (sub === "off") {
			await setEnabled(threadsData, threadID, false);
			const stopped = stopRunning(threadID);
			return message.reply(stopped
				? "🛑 stalk বন্ধ করা হলো, চলমান মেসেজ পাঠানোও থামিয়ে দিয়েছি।"
				: "🛑 stalk এই গ্রুপে বন্ধ করা হলো।");
		}

		if (!(await isEnabled(threadsData, threadID))) {
			return message.reply("⚠️ stalk এই গ্রুপে বন্ধ আছে। চালু করতে: stalk on");
		}
		if (event.isGroup === false) {
			return message.reply("⚠️ এই কমান্ড শুধু গ্রুপ চ্যাটে কাজ করবে।");
		}
		if (running.has(threadID)) {
			return message.reply("⏳ এই গ্রুপে আগের stalk এখনো চলছে। থামাতে: stalk off");
		}

		// টার্গেট বাছা: mention > reply > uid
		let targetID = null;
		let name = null;

		const mentionID = Object.keys(event.mentions || {})[0];
		if (mentionID) {
			targetID = mentionID;
			name = event.mentions[mentionID];
		} else if (event.messageReply && event.messageReply.senderID) {
			targetID = String(event.messageReply.senderID);
		} else {
			const uidArg = args.find(a => /^\d{6,}$/.test(a));
			if (uidArg) targetID = uidArg;
		}

		if (!targetID) {
			return message.reply("কাকে ট্যাগ করবো? @mention দিন, UID দিন, অথবা তার মেসেজে রিপ্লাই দিয়ে stalk লিখুন।");
		}

		let botID = null;
		try { botID = String(api.getCurrentUserID()); } catch (e) {}
		if (botID && String(targetID) === botID) {
			return message.reply("নিজেকে ট্যাগ করা যাবে না 😄");
		}

		// টার্গেট গ্রুপের সদস্য কি না দেখে নেওয়া (৫ সেকেন্ডে উত্তর না এলে এই চেক বাদ)
		try {
			const info = await Promise.race([
				Promise.resolve(api.getThreadInfo(threadID)),
				new Promise(resolve => setTimeout(() => resolve(null), 5000))
			]);
			if (info && Array.isArray(info.participantIDs) && info.participantIDs.length
				&& !info.participantIDs.map(String).includes(String(targetID))) {
				return message.reply("❌ এই UID এই গ্রুপের সদস্য নন।");
			}
		} catch (e) {}

		if (!name) name = await getName(usersData, targetID);
		// fight1-এর মতো: ট্যাগ "@নাম" আকারে, মেসেজের একদম শুরুতে, fromIndex: 0
		const cleanName = String(name).replace(/^@/, "");
		const tag = "@" + cleanName;
		const mentions = [{ tag, id: targetID, fromIndex: 0 }];

		// আগের কাজ করা কোডের মতোই message.reply দিয়ে পাঠানো; ব্যর্থ হলে api.sendMessage
		const send = async (form) => {
			try {
				await message.reply(form);
			} catch (e) {
				console.error("stalk message.reply error:", e && e.message);
				try {
					await api.sendMessage(form, threadID);
				} catch (e2) {
					console.error("stalk api.sendMessage error:", e2 && e2.message);
				}
			}
		};

		const timers = [];
		running.set(threadID, { timers, targetID });

		console.log(`[stalk] thread=${threadID} target=${targetID} name=${cleanName}`);
		await message.reply(`✅ stalk শুরু হলো: ${cleanName}\n(থামাতে লিখুন: stalk off)`);
		send("~বস JABED এর ভালোবাসা নাও প্রিয়~");

		let last = 0;
		for (const [delay, text] of MESSAGES) {
			last = Math.max(last, delay);
			timers.push(setTimeout(() => {
				send({ body: tag + " " + text, mentions });
			}, delay));
		}
		// শেষ হলে চলমান তালিকা থেকে সরানো
		timers.push(setTimeout(() => running.delete(threadID), last + 1000));
	}
};
			

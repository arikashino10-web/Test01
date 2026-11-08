const fs = require("fs");
const path = require("path");

// ═══════════════════════════ SETTINGS (change here) ═══════════════════════════
const CFG = {
  OWNER_IDS: ["61591169410501"],   // only these accounts can trigger the react-to-add
  TRIGGER_EMOJI: "🤓",             // react with this on a member's message -> member is added
  MAX_GROUP_SIZE: 250,             // Messenger group limit
  MAX_TARGET_COUNT: 250,           // most members one target group can be asked to move
  BATCH_SIZE: 10,                  // add 10 members ...
  BATCH_PAUSE_MS: 20 * 1000,       // ... then wait 20 seconds
  ADD_GAP_MIN_MS: 3 * 1000,        // small random wait between two adds (safety)
  ADD_GAP_MAX_MS: 6 * 1000,
  REACT_GAP_MIN_MS: 4 * 1000,      // minimum wait between two react-adds
  REACT_GAP_MAX_MS: 8 * 1000,
  STOP_AFTER_BAD_IN_ROW: 4,        // Facebook is probably blocking: stop the transfer
  ATTEMPT_FACTOR: 2,               // tries at most 2x the wanted count (privacy failures do not loop forever)
  MAX_REACT_ADDS_PER_HOUR: 40,     // safety against accidental reaction sprees
  DEDUPE_MS: 30 * 1000,            // the same reaction delivered twice is handled once
  INFO_GAP_MS: 1000,               // wait between messages to several info groups
  CALL_TIMEOUT_MS: 30 * 1000,      // one Facebook call may not hang longer than this
  CACHE_MAX: 5000,                 // remembered messages (to know who wrote the reacted message)
  DEFAULT_INFO_GROUPS: [],         // optional: put thread IDs here so they survive a fresh deploy
  DEFAULT_PUSH_GROUPS: []
};

// Runtime state lives in a global so a command reload does not lose it
const M = global.__move || (global.__move = {
  job: null, lastJob: null, lastReaction: null, cache: new Map(), names: new Map(),
  seen: new Map(), reactTimes: [], lastAddAt: 0, hookedKeys: new Set(), chain: Promise.resolve()
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const norm = e => String(e || "").replace(/\uFE0F/g, "").trim();
const errText = e => {
  if (!e) return "unknown error";
  if (typeof e === "string") return e;
  return String(e.errorDescription || e.message || e.error || JSON.stringify(e));
};

// ═══════════════════════════ SAVED SETTINGS ═══════════════════════════
const DATA_FILE = () => path.join(process.cwd(), "move_data.json");

function normalizeData(raw) {
  const list = (value, defaults) => {
    const source = Array.isArray(value) ? value : defaults.map(id => ({ id: String(id), name: "" }));
    return source.filter(x => x && /^\d{5,}$/.test(String(x.id))).map(x => ({ ...x, id: String(x.id), name: x.name || "" }));
  };
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    infoGroups: list(d.infoGroups, CFG.DEFAULT_INFO_GROUPS),
    pushGroups: list(d.pushGroups, CFG.DEFAULT_PUSH_GROUPS),
    targets: list(d.targets, []).map(t => ({ ...t, count: Math.min(CFG.MAX_TARGET_COUNT, Math.max(1, parseInt(t.count) || 1)) })),
    reactEnabled: d.reactEnabled !== false
  };
}

function loadData() {
  try { return normalizeData(JSON.parse(fs.readFileSync(DATA_FILE(), "utf8"))); }
  catch { return normalizeData(null); }
}

let data = loadData();

function saveData() {
  try { fs.writeFileSync(DATA_FILE(), JSON.stringify(data, null, 2)); }
  catch (e) { console.error("[move] could not save settings:", e.message); }
}

// ═══════════════════════════ FACEBOOK HELPERS ═══════════════════════════
// Works with fca functions that use a callback AND with the ones that return a promise.
function call(invoke) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => done(new Error("timeout: Facebook did not answer")), CFG.CALL_TIMEOUT_MS);
    function done(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(result);
    }
    try {
      const ret = invoke(done);
      if (ret && typeof ret.then === "function")
        ret.then(r => done(null, r), e => done(e || new Error("unknown error")));
    }
    catch (e) { done(e); }
  });
}

const botIDOf = api => String(api.getCurrentUserID());

async function threadInfo(api, tid) {
  try { return await call(cb => api.getThreadInfo(tid, cb)); }
  catch { return null; }
}

async function groupName(api, tid) {
  const key = "g" + tid;
  const hit = M.names.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.name;
  const info = await threadInfo(api, tid);
  const name = (info && info.threadName) || "নামহীন গ্রুপ";
  M.names.set(key, { name, at: Date.now() });
  return name;
}

async function userNames(api, ids) {
  const out = {};
  const need = [];
  for (const id of ids) {
    const hit = M.names.get("u" + id);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) out[id] = hit.name; else need.push(id);
  }
  if (need.length) {
    try {
      const res = await call(cb => api.getUserInfo(need, cb));
      for (const id of need) {
        const name = (res && res[id] && res[id].name) || "Facebook User";
        out[id] = name;
        M.names.set("u" + id, { name, at: Date.now() });
      }
    }
    catch { for (const id of need) out[id] = "Facebook User"; }
  }
  return out;
}

// Messages for the owner: only to the info groups, never to a group listed in `exclude`
async function sendInfo(api, text, exclude = []) {
  const skip = new Set(exclude.map(String));
  let first = true;
  for (const g of data.infoGroups) {
    if (skip.has(String(g.id))) continue;
    if (!first && CFG.INFO_GAP_MS) await sleep(CFG.INFO_GAP_MS);
    first = false;
    try { await call(cb => api.sendMessage(text, g.id, cb)); }
    catch (e) { console.error("[move] info message failed:", g.id, errText(e)); }
  }
}

// ═══════════════════════════ WHY DID IT FAIL ═══════════════════════════
const BAD_CODES = new Set(["blocked", "timeout", "unknown"]); // these may mean Facebook is blocking us

function classify(err) {
  const t = errText(err);
  if (/already (in|a member)|is already/i.test(t)) return "already";
  if (/\bfull\b|maximum|too many (members|participants|people)|limit.*(members|participants)/i.test(t)) return "full";
  if (/timeout|timed out|ETIMEDOUT|ECONN|socket hang/i.test(t)) return "timeout";
  if (/privacy|can.?t be added|cannot be added|not allowed|permission|not friends|blocked you|you can.?t add|unavailable|not available/i.test(t)) return "privacy";
  if (/rate|too many|too fast|spam|temporar|try again later|checkpoint|restrict|block/i.test(t)) return "blocked";
  return "unknown";
}

function reasonText(code, res = {}) {
  const push = res.push ? (res.push.name || res.push.id) : "";
  switch (code) {
    case "already": return `মেম্বার আগে থেকেই গ্রুপে আছে${push ? ` (${push})` : ""}`;
    case "full": return `সব push গ্রুপ পূর্ণ (${CFG.MAX_GROUP_SIZE} জন)`;
    case "privacy": return "মেম্বারের প্রাইভেসি সেটিং বা Facebook তাকে গ্রুপে যুক্ত করতে দিচ্ছে না";
    case "blocked": return "Facebook সাময়িকভাবে add আটকে দিয়েছে (রেট লিমিট/ব্লক)";
    case "timeout": return "Facebook সময়মতো জবাব দেয়নি";
    case "notmember": return `বট push গ্রুপে নেই বা গ্রুপের তথ্য পাওয়া যায়নি${res.raw ? ` (${res.raw})` : ""}`;
    default: return `অজানা কারণ${res.raw ? `: ${res.raw}` : ""}`;
  }
}

// ═══════════════════════════ THE ADD ENGINE ═══════════════════════════
// Only one add runs at a time (react-adds and the bulk transfer take turns).
function exclusive(fn) {
  const run = M.chain.then(() => fn());
  M.chain = run.catch(() => {});
  return run;
}

async function pace(range) {
  const gap = rand(range[0], range[1]);
  const wait = M.lastAddAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
}

async function loadPushStates(api, cache) {
  const botID = botIDOf(api);
  const states = [];
  for (const push of data.pushGroups) {
    let members = cache && cache.get(push.id);
    if (!members) {
      const info = await threadInfo(api, push.id);
      const list = info && Array.isArray(info.participantIDs) ? info.participantIDs.map(String) : null;
      if (!list || !list.includes(botID)) {
        states.push({ push, members: null, raw: info ? "bot not in group" : "group info unavailable" });
        continue;
      }
      members = new Set(list);
      if (cache) cache.set(push.id, members);
    }
    states.push({ push, members });
  }
  return states;
}

// Adds ONE member to the first push group that has room. Returns {ok, code, push, raw}.
async function addOne(api, uid, opts = {}) {
  const states = await loadPushStates(api, opts.cache);
  const usable = states.filter(s => s.members);
  if (!usable.length) return { ok: false, code: "notmember", raw: (states.find(s => s.raw) || {}).raw };

  const holder = usable.find(s => s.members.has(uid));
  if (holder) return { ok: false, code: "already", push: holder.push };

  const open = usable.find(s => s.members.size < CFG.MAX_GROUP_SIZE);
  if (!open) return { ok: false, code: "full" };

  await pace(opts.gap || [CFG.ADD_GAP_MIN_MS, CFG.ADD_GAP_MAX_MS]);
  try {
    await call(cb => api.addUserToGroup(uid, open.push.id, cb));
    open.members.add(uid);
    return { ok: true, push: open.push };
  }
  catch (e) {
    return { ok: false, code: classify(e), push: open.push, raw: errText(e).slice(0, 120) };
  }
  finally {
    M.lastAddAt = Date.now();
  }
}

// ═══════════════════════════ REACT-TO-ADD ═══════════════════════════
async function handleReaction(api, event) {
  const note = { at: Date.now(), emoji: event.reaction, userID: event.userID, senderID: event.senderID, threadID: event.threadID, result: "" };
  M.lastReaction = note;

  if (norm(event.reaction) !== norm(CFG.TRIGGER_EMOJI)) { note.result = "ignored: not the trigger emoji"; return; }
  if (!CFG.OWNER_IDS.map(String).includes(String(event.userID))) { note.result = "ignored: reactor is not an owner"; return; }
  if (!data.reactEnabled) { note.result = "ignored: react mode is off"; return; }
  if (!data.pushGroups.length) { note.result = "ignored: no push group set"; return; }

  const cached = M.cache.get(String(event.messageID));
  const author = String((cached && cached.senderID) || event.senderID || "");
  if (!author) { note.result = "ignored: author unknown"; return; }
  if (author === botIDOf(api) || CFG.OWNER_IDS.map(String).includes(author)) { note.result = "ignored: author is the bot or an owner"; return; }

  const dupKey = `${event.messageID}:${event.userID}`;
  const last = M.seen.get(dupKey);
  if (last && Date.now() - last < CFG.DEDUPE_MS) { note.result = "ignored: duplicate event"; return; }
  M.seen.set(dupKey, Date.now());
  if (M.seen.size > 200) M.seen.delete(M.seen.keys().next().value);

  const hourAgo = Date.now() - 60 * 60 * 1000;
  M.reactTimes = M.reactTimes.filter(t => t > hourAgo);
  const exclude = [event.threadID]; // the group the member comes from stays silent
  if (M.reactTimes.length >= CFG.MAX_REACT_ADDS_PER_HOUR) {
    note.result = "ignored: hourly limit";
    await sendInfo(api, `⚠️ ঘণ্টায় সর্বোচ্চ ${CFG.MAX_REACT_ADDS_PER_HOUR} জন যুক্ত করার সীমা শেষ। অ্যাকাউন্ট বাঁচাতে এই রিয়েক্টটা বাদ দেওয়া হলো।`, exclude);
    return;
  }
  M.reactTimes.push(Date.now());
  note.result = "accepted";

  const names = await userNames(api, [author]);
  const name = names[author];
  const sourceName = await groupName(api, event.threadID);

  await sendInfo(api,
    `🚀 কাজ শুরু হয়েছে\n━━━━━━━━━━━━━━━\n👤 মেম্বার: ${name}\n🆔 UID: ${author}\n📤 কোন গ্রুপ থেকে: ${sourceName}\n⏳ যুক্ত করা হচ্ছে...`,
    exclude);

  const res = await exclusive(() => addOne(api, author, { gap: [CFG.REACT_GAP_MIN_MS, CFG.REACT_GAP_MAX_MS] }));
  if (!res.ok) M.seen.delete(dupKey); // the owner may try again

  if (res.ok) {
    await sendInfo(api,
      `✅ কাজ শেষ হয়েছে\n━━━━━━━━━━━━━━━\n👤 মেম্বার: ${name}\n🆔 UID: ${author}\n📥 যুক্ত হয়েছে: ${res.push.name || res.push.id}\n📤 কোন গ্রুপ থেকে: ${sourceName}`,
      exclude);
  } else {
    await sendInfo(api,
      `❌ যুক্ত করা সম্ভব হয়নি\n━━━━━━━━━━━━━━━\n👤 মেম্বার: ${name}\n🆔 UID: ${author}\n📤 কোন গ্রুপ থেকে: ${sourceName}\n📌 কারণ: ${reasonText(res.code, res)}`,
      exclude);
  }
}

// ═══════════════════════════ BULK TRANSFER ═══════════════════════════
async function sleepUnlessCancelled(job, ms) {
  let left = ms;
  while (left > 0 && !job.cancel) {
    const step = Math.min(500, left);
    await sleep(step);
    left -= step;
  }
}

async function runBulk(api, job) {
  const botID = botIDOf(api);
  const owners = new Set(CFG.OWNER_IDS.map(String));
  const targetIDs = data.targets.map(t => t.id);
  const info = text => sendInfo(api, text, targetIDs); // the groups members come FROM stay silent

  try {
    await info(`🚀 ট্রান্সফার শুরু হয়েছে\n━━━━━━━━━━━━━━━\n📤 টার্গেট গ্রুপ: ${data.targets.length}টি\n📥 push গ্রুপ: ${data.pushGroups.map(p => p.name || p.id).join(", ")}\n⏱️ নিয়ম: প্রতি ${CFG.BATCH_SIZE} জন যুক্ত করার পর ${Math.round(CFG.BATCH_PAUSE_MS / 1000)} সেকেন্ড বিরতি`);

    for (const t of data.targets.slice()) {
      if (job.cancel) break;

      const tInfo = await threadInfo(api, t.id);
      const members = tInfo && Array.isArray(tInfo.participantIDs) ? tInfo.participantIDs.map(String) : null;
      const tName = (tInfo && tInfo.threadName) || t.name || t.id;
      if (!members || !members.includes(botID)) {
        await info(`⚠️ টার্গেট গ্রুপে বট নেই বা তথ্য পাওয়া যায়নি, বাদ দেওয়া হলো: ${tName}`);
        continue;
      }

      const cache = new Map();
      const states = await loadPushStates(api, cache);
      if (!states.some(s => s.members)) {
        await info(`❌ কোনো push গ্রুপের তথ্য পাওয়া যায়নি (বট কি গ্রুপে আছে?). ট্রান্সফার বন্ধ।`);
        job.fatal = true;
        break;
      }
      const inPush = new Set();
      states.forEach(s => s.members && s.members.forEach(m => inPush.add(m)));

      const candidates = members.filter(uid => uid !== botID && !owners.has(uid) && !inPush.has(uid));
      const goal = Math.min(t.count, candidates.length);
      if (goal === 0) {
        await info(`ℹ️ ${tName}: যুক্ত করার মতো নতুন মেম্বার নেই (সবাই আগে থেকেই push গ্রুপে)।`);
        continue;
      }
      const maxAttempts = Math.min(candidates.length, goal * CFG.ATTEMPT_FACTOR);

      await info(`📤 টার্গেট: ${tName}\n🎯 লক্ষ্য: ${goal} জন (গ্রুপে মোট ${members.length} জন)\n⏳ কাজ শুরু হচ্ছে...`);

      let added = 0, failed = 0, attempts = 0, badRow = 0, batchNo = 0, stoppedWhy = "";
      let batch = [];

      const flush = async (pauseAfter) => {
        if (!batch.length) return;
        batchNo++;
        const names = await userNames(api, batch.map(b => b.uid));
        const lines = batch.map(b => b.res.ok
          ? `✅ ${names[b.uid]} (${b.uid})`
          : `❌ ${names[b.uid]} (${b.uid}) — ${reasonText(b.res.code, b.res)}`);
        batch = [];
        await info(`📦 ব্যাচ ${batchNo} — ${tName}\n━━━━━━━━━━━━━━━\n${lines.join("\n")}\n━━━━━━━━━━━━━━━\n📊 এখন পর্যন্ত: ✅ ${added}/${goal}  ❌ ${failed}` + (pauseAfter ? `\n⏳ ${Math.round(CFG.BATCH_PAUSE_MS / 1000)} সেকেন্ড বিরতি...` : ""));
      };

      for (let i = 0; i < candidates.length; i++) {
        if (job.cancel) { stoppedWhy = "cancel"; break; }
        if (added >= goal || attempts >= maxAttempts) break;

        const uid = candidates[i];
        const res = await exclusive(() => addOne(api, uid, { cache, gap: [CFG.ADD_GAP_MIN_MS, CFG.ADD_GAP_MAX_MS] }));
        attempts++;
        batch.push({ uid, res });

        if (res.ok) { added++; job.added++; badRow = 0; }
        else {
          failed++; job.failed++;
          badRow = BAD_CODES.has(res.code) ? badRow + 1 : 0;
          if (res.code === "full" || res.code === "notmember") stoppedWhy = res.code;
        }
        if (badRow >= CFG.STOP_AFTER_BAD_IN_ROW) stoppedWhy = "blocked";

        const finished = !!stoppedWhy || added >= goal || attempts >= maxAttempts || i === candidates.length - 1;
        if (batch.length >= CFG.BATCH_SIZE || finished) {
          await flush(!finished);
          if (!finished) await sleepUnlessCancelled(job, CFG.BATCH_PAUSE_MS);
        }
        if (finished) break;
      }
      if (job.cancel && !stoppedWhy) stoppedWhy = "cancel";
      await flush(false);

      let status = "✅ টার্গেট শেষ";
      if (stoppedWhy === "cancel") status = "⏹️ হাতে বন্ধ করা হয়েছে";
      else if (stoppedWhy === "blocked") status = `🛑 টানা ${CFG.STOP_AFTER_BAD_IN_ROW} বার সমস্যা, Facebook সম্ভবত আটকাচ্ছে। অ্যাকাউন্ট বাঁচাতে থামানো হয়েছে`;
      else if (stoppedWhy === "full") status = "🛑 push গ্রুপ পূর্ণ, থামানো হয়েছে";
      else if (stoppedWhy === "notmember") status = "🛑 push গ্রুপে সমস্যা, থামানো হয়েছে";
      await info(`${status}\n📤 ${tName}\n✅ যুক্ত: ${added}  ❌ ব্যর্থ: ${failed}  🎯 লক্ষ্য: ${goal}`);

      if (stoppedWhy) { job.fatal = stoppedWhy !== "cancel"; break; }
    }
  }
  catch (e) {
    console.error("[move] bulk error:", e);
    await info(`❌ ট্রান্সফারে ত্রুটি: ${errText(e)}`);
  }
  finally {
    job.running = false;
    job.endedAt = Date.now();
    M.lastJob = job;
    M.job = null;
    await info(`🏁 ট্রান্সফার শেষ\n✅ মোট যুক্ত: ${job.added}\n❌ মোট ব্যর্থ: ${job.failed}\n⏱️ সময়: ${Math.max(1, Math.round((job.endedAt - job.startedAt) / 60000))} মিনিট`);
  }
}

// ═══════════════════════════ LISTENER HOOK ═══════════════════════════
// Sits in FRONT of the bot's main listener (same idea as antidelete.js) so reactions and messages
// from every group are seen, even where the whitelist stops normal commands.
async function tap(api, event) {
  if (!api || !event) return;
  if (event.type === "message" || event.type === "message_reply") {
    if (!event.messageID) return;
    M.cache.set(String(event.messageID), { senderID: String(event.senderID), threadID: String(event.threadID) });
    if (M.cache.size > CFG.CACHE_MAX) M.cache.delete(M.cache.keys().next().value);
    return;
  }
  if (event.type === "message_reaction") await handleReaction(api, event);
}
global.moveTap = tap; // the newest version of tap always wins (survives command reinstall)

function installHook() {
  try {
    const cbt = global.GoatBot && global.GoatBot.callbackListenTime;
    if (!cbt) return;
    const key = Object.keys(cbt).pop();
    if (!key || typeof cbt[key] !== "function") return;
    if (M.hookedKeys.has(key)) return; // hooked already, even if another command wrapped on top of ours

    const original = cbt[key];
    const wrapper = function (error, event) {
      try {
        if (!error && event && typeof global.moveTap === "function")
          Promise.resolve().then(() => global.moveTap(global.GoatBot.fcaApi, event)).catch(e => console.error("[move] tap error:", e && e.message));
      }
      catch (e) { /* never break the main listener */ }
      return original.apply(this, arguments);
    };
    // keep the markers other commands (e.g. antidelete) use to recognise their own wrapper
    Object.keys(original).forEach(k => { if (k.startsWith("__")) wrapper[k] = original[k]; });
    wrapper.__moveHook = true;
    cbt[key] = wrapper;
    M.hookedKeys.add(key);
  }
  catch (e) { /* try again on the next tick */ }
}

if (global.moveHookTimer) clearInterval(global.moveHookTimer);
installHook();
global.moveHookTimer = setInterval(installHook, 3000);

// ═══════════════════════════ COMMAND ═══════════════════════════
const HELP =
  `🛠️ 𝐌𝐎𝐕𝐄 — মেম্বার ট্রান্সফার ম্যানুয়াল\n` +
  `━━━━━━━━━━━━━━━━━━━━\n\n` +
  `⚡ রিয়েক্ট দিয়ে যুক্ত করা\n` +
  `যেকোনো গ্রুপে কোনো মেম্বারের মেসেজে ${CFG.TRIGGER_EMOJI} রিয়েক্ট দিন (শুধু মালিক), সাথে সাথে সেই মেম্বার push গ্রুপে যুক্ত হবে। যে গ্রুপ থেকে নেওয়া হচ্ছে সেখানে বট কিছুই লিখবে না, রিয়েক্টও দেবে না।\n\n` +
  `📣 INFO গ্রুপ (সব আপডেট এখানে আসে)\n` +
  `• move info group add [TID] — TID না দিলে এই গ্রুপ\n` +
  `• move info group remove [TID | নম্বর]\n` +
  `• move info group list\n\n` +
  `📥 PUSH গ্রুপ (যেখানে মেম্বার যুক্ত হবে)\n` +
  `• move push group add [TID] — TID না দিলে এই গ্রুপ\n` +
  `• move push group remove [TID | নম্বর]\n` +
  `• move push group list\n` +
  `একাধিক push গ্রুপ থাকলে প্রথমটা ভরলে (${CFG.MAX_GROUP_SIZE} জন) পরেরটায় যুক্ত হয়।\n\n` +
  `📤 TARGET গ্রুপ (যে গ্রুপ থেকে মেম্বার নেওয়া হবে)\n` +
  `• move target group add <TID> <সংখ্যা> — সংখ্যা ১ থেকে ${CFG.MAX_TARGET_COUNT}\n` +
  `• move target group remove <TID | নম্বর>\n` +
  `• move target group list\n` +
  `• move target group on — ট্রান্সফার শুরু\n` +
  `• move target group off — চলমান ট্রান্সফার বন্ধ\n` +
  `নিয়ম: প্রতি ${CFG.BATCH_SIZE} জন যুক্ত করার পর ${Math.round(CFG.BATCH_PAUSE_MS / 1000)} সেকেন্ড বিরতি। প্রতিটা ব্যাচের ফলাফল INFO গ্রুপে যায়।\n\n` +
  `🔧 অন্যান্য\n` +
  `• move react on / off — ${CFG.TRIGGER_EMOJI} রিয়েক্ট চালু/বন্ধ\n` +
  `• move status — বর্তমান অবস্থা\n` +
  `• move help — এই ম্যানুয়াল\n\n` +
  `⚠️ সতর্কতা: একসাথে অনেক মেম্বার যুক্ত করা Facebook-এর কাছে স্প্যাম মনে হয়, অ্যাকাউন্ট সাসপেন্ড হতে পারে। টানা ${CFG.STOP_AFTER_BAD_IN_ROW} বার সমস্যা হলে বট নিজেই থেমে যায়।`;

const isTid = s => /^\d{8,}$/.test(String(s || ""));

function removeFrom(list, token) {
  const t = String(token || "");
  let idx = -1;
  if (isTid(t)) idx = list.findIndex(x => x.id === t);
  else if (/^\d{1,4}$/.test(t)) idx = parseInt(t) - 1;
  if (idx < 0 || idx >= list.length) return null;
  return list.splice(idx, 1)[0];
}

async function showList(api, title, list, extra = () => "") {
  if (!list.length) return `${title}\n━━━━━━━━━━━━━━━\n(খালি)`;
  const lines = [];
  for (let i = 0; i < list.length; i++) {
    const live = await groupName(api, list[i].id);
    const name = live !== "নামহীন গ্রুপ" ? live : (list[i].name || live);
    lines.push(`${i + 1}. ${name}\n   🧵 ${list[i].id}${extra(list[i])}`);
  }
  return `${title}\n━━━━━━━━━━━━━━━\n${lines.join("\n")}`;
}

module.exports = {
  config: {
    name: "move",
    aliases: ["transfer"],
    version: "2.0.0",
    author: "JABED VAO",
    countDown: 3,
    role: 2,
    category: "group",
    description: {
      en: "React 🤓 to a member to add them to your push group, plus bulk transfer from target groups",
      bn: "মেম্বারের মেসেজে 🤓 রিয়েক্ট দিলেই push গ্রুপে যুক্ত, সাথে টার্গেট গ্রুপ থেকে ব্যাচে ট্রান্সফার"
    },
    guide: { en: "{pn} help" }
  },

  async onStart({ api, event, args, message }) {
    const tid = String(event.threadID);
    const tokens = (args || []).map(a => String(a).trim()).filter(Boolean);
    const lower = tokens.map(t => t.toLowerCase());
    const section = lower[0] || "help";
    // the word "group" is optional everywhere
    const rest = tokens.slice(1).filter(t => !/^(group|groups|gc)$/i.test(t));
    const sub = (rest[0] || "").toLowerCase();
    const arg1 = rest[1];

    const reply = text => message.reply(text);

    // ── help / status ──
    if (section === "help" || section === "h") return reply(HELP);

    if (section === "status") {
      const cbt = (global.GoatBot && global.GoatBot.callbackListenTime) || {};
      const key = Object.keys(cbt).pop();
      const hooked = !!(key && M.hookedKeys.has(key));
      const hourAgo = Date.now() - 60 * 60 * 1000;
      const last = M.lastReaction;
      const lastText = last
        ? `${last.emoji || "?"} reactor=${last.userID} author=${last.senderID} → ${last.result}`
        : "এখনো কোনো রিয়েক্ট দেখা যায়নি";
      const job = M.job;
      return reply(
        `📊 MOVE স্ট্যাটাস\n━━━━━━━━━━━━━━━\n` +
        `🔗 লিসেনার হুক: ${hooked ? "সংযুক্ত" : "সংযুক্ত নয়"}\n` +
        `⚡ ${CFG.TRIGGER_EMOJI} রিয়েক্ট মোড: ${data.reactEnabled ? "চালু" : "বন্ধ"}\n` +
        `📣 info গ্রুপ: ${data.infoGroups.length}টি\n📥 push গ্রুপ: ${data.pushGroups.length}টি\n📤 টার্গেট গ্রুপ: ${data.targets.length}টি\n` +
        `🚚 ট্রান্সফার: ${job ? `চলছে (✅ ${job.added} ❌ ${job.failed})` : "বন্ধ"}\n` +
        `🕒 গত ১ ঘণ্টায় রিয়েক্টে যুক্ত: ${M.reactTimes.filter(t => t > hourAgo).length}/${CFG.MAX_REACT_ADDS_PER_HOUR}\n` +
        `💾 মনে রাখা মেসেজ: ${M.cache.size}\n` +
        `🔎 শেষ রিয়েক্ট: ${lastText}`
      );
    }

    // ── react on/off ──
    if (section === "react") {
      if (sub !== "on" && sub !== "off") return reply(`ব্যবহার: move react on | off`);
      data.reactEnabled = sub === "on";
      saveData();
      return reply(`${data.reactEnabled ? "✅" : "⏸️"} ${CFG.TRIGGER_EMOJI} রিয়েক্ট মোড ${data.reactEnabled ? "চালু" : "বন্ধ"} করা হয়েছে।`);
    }

    // ── info / push groups ──
    if (section === "info" || section === "push") {
      const isPush = section === "push";
      const list = isPush ? data.pushGroups : data.infoGroups;
      const label = isPush ? "push" : "info";

      if (sub === "list" || sub === "") {
        return reply(await showList(api, isPush ? "📥 PUSH গ্রুপ তালিকা" : "📣 INFO গ্রুপ তালিকা", list));
      }

      if (sub === "add") {
        const id = arg1 ? String(arg1) : tid;
        if (!isTid(id)) return reply(`❌ সঠিক TID দিন। ব্যবহার: move ${label} group add [TID]`);
        if (list.some(g => g.id === id)) return reply(`ℹ️ এই গ্রুপ আগে থেকেই ${label} তালিকায় আছে।`);
        if (data.targets.some(t => t.id === id))
          return reply(`❌ এটা টার্গেট গ্রুপ। টার্গেট গ্রুপে বট কোনো তথ্য পাঠায় না, তাই ${label} গ্রুপ হতে পারবে না।`);

        const info = await threadInfo(api, id);
        if (!info || !Array.isArray(info.participantIDs) || !info.participantIDs.map(String).includes(botIDOf(api)))
          return reply(`❌ বট ওই গ্রুপে নেই (বা তথ্য পাওয়া যায়নি)। আগে বটকে গ্রুপে যুক্ত করুন।`);
        if (isPush && info.isGroup === false) return reply(`❌ push গ্রুপ একটা গ্রুপ চ্যাট হতে হবে।`);

        list.push({ id, name: info.threadName || "" });
        saveData();
        return reply(`✅ ${label} গ্রুপে যোগ হয়েছে\n📛 ${info.threadName || "নামহীন গ্রুপ"}\n🧵 ${id}\n📋 মোট: ${list.length}টি`);
      }

      if (sub === "remove") {
        const removed = removeFrom(list, arg1 || tid);
        if (!removed) return reply(`❌ তালিকায় পাওয়া যায়নি। TID বা তালিকার নম্বর দিন: move ${label} group remove <TID | নম্বর>`);
        saveData();
        return reply(`🗑️ ${label} তালিকা থেকে সরানো হয়েছে\n📛 ${removed.name || "নামহীন গ্রুপ"}\n🧵 ${removed.id}\n📋 বাকি: ${list.length}টি`);
      }

      return reply(`ব্যবহার:\n• move ${label} group add [TID]\n• move ${label} group remove [TID | নম্বর]\n• move ${label} group list`);
    }

    // ── target groups ──
    if (section === "target") {
      if (sub === "list" || sub === "") {
        return reply(await showList(api, "📤 TARGET গ্রুপ তালিকা", data.targets, t => `\n   🎯 লক্ষ্য: ${t.count} জন`));
      }

      if (sub === "add") {
        const id = String(arg1 || "");
        const count = Number(rest[2]);
        if (!isTid(id)) return reply(`❌ টার্গেট গ্রুপের TID দিন।\nব্যবহার: move target group add <TID> <সংখ্যা ১-${CFG.MAX_TARGET_COUNT}>`);
        if (!Number.isInteger(count) || count < 1 || count > CFG.MAX_TARGET_COUNT)
          return reply(`❌ সংখ্যা ১ থেকে ${CFG.MAX_TARGET_COUNT}-এর মধ্যে হতে হবে।\nব্যবহার: move target group add <TID> <সংখ্যা>`);
        if (data.infoGroups.some(g => g.id === id) || data.pushGroups.some(g => g.id === id))
          return reply(`❌ এটা info/push তালিকায় আছে। একই গ্রুপ টার্গেট হতে পারবে না।`);

        const info = await threadInfo(api, id);
        if (!info || !Array.isArray(info.participantIDs) || !info.participantIDs.map(String).includes(botIDOf(api)))
          return reply(`❌ বট ওই গ্রুপে নেই (বা তথ্য পাওয়া যায়নি)। আগে বটকে গ্রুপে যুক্ত করুন।`);

        const existing = data.targets.find(t => t.id === id);
        if (existing) { existing.count = count; existing.name = info.threadName || existing.name; }
        else data.targets.push({ id, name: info.threadName || "", count });
        saveData();
        return reply(`${existing ? "🔄 আপডেট হয়েছে" : "✅ টার্গেট যোগ হয়েছে"}\n📛 ${info.threadName || "নামহীন গ্রুপ"}\n🧵 ${id}\n🎯 লক্ষ্য: ${count} জন\n👥 গ্রুপে মোট: ${info.participantIDs.length} জন`);
      }

      if (sub === "remove") {
        const removed = removeFrom(data.targets, arg1);
        if (!removed) return reply(`❌ তালিকায় পাওয়া যায়নি। ব্যবহার: move target group remove <TID | নম্বর>`);
        saveData();
        return reply(`🗑️ টার্গেট তালিকা থেকে সরানো হয়েছে\n📛 ${removed.name || "নামহীন গ্রুপ"}\n🧵 ${removed.id}\n📋 বাকি: ${data.targets.length}টি`);
      }

      if (sub === "on" || sub === "off") {
        // answers go to the info groups when this is typed inside a source group, so that group sees nothing
        const inSource = data.targets.some(t => t.id === tid);
        const quiet = async text => {
          if (inSource && data.infoGroups.length) return sendInfo(api, text, data.targets.map(t => t.id));
          return reply(text);
        };

        if (sub === "off") {
          if (!M.job) return quiet(`ℹ️ এখন কোনো ট্রান্সফার চলছে না।`);
          M.job.cancel = true;
          return quiet(`⏹️ ট্রান্সফার বন্ধ করা হচ্ছে... (চলমান ধাপ শেষ হলেই থামবে)`);
        }

        if (M.job) return quiet(`⏳ ট্রান্সফার আগে থেকেই চলছে।`);
        if (!data.targets.length) return quiet(`❌ আগে টার্গেট গ্রুপ যোগ করুন: move target group add <TID> <সংখ্যা>`);
        if (!data.pushGroups.length) return quiet(`❌ আগে push গ্রুপ যোগ করুন: move push group add [TID]`);
        if (!data.infoGroups.length) return quiet(`❌ আগে info গ্রুপ যোগ করুন, সব আপডেট সেখানে যাবে: move info group add [TID]`);

        const job = M.job = { running: true, cancel: false, added: 0, failed: 0, startedAt: Date.now(), fatal: false };
        runBulk(api, job).catch(e => console.error("[move] bulk crashed:", e)); // runs in the background
        return quiet(`🚀 ট্রান্সফার শুরু হয়েছে। প্রতিটা ধাপের খবর info গ্রুপে যাবে।`);
      }

      return reply(`ব্যবহার:\n• move target group add <TID> <সংখ্যা>\n• move target group remove <TID | নম্বর>\n• move target group list\n• move target group on | off`);
    }

    return reply(`❓ বুঝতে পারিনি। সব নিয়ম দেখতে লিখুন: move help`);
  },

  // exposed only so the logic can be tested
  __test: { CFG, M, tap, handleReaction, runBulk, installHook, classify, addOne, getData: () => data, setData: d => { data = normalizeData(d); return data; }, saveData }
};

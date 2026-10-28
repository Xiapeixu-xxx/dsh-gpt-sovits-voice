// @xiapeixu/dsh-gpt-sovits-voice — host side (0.4)
//
// 把文字交给本机 GPT-SoVITS 合成，然后在本机播出来。
//
// Tools:
//   sovits_speak   speak text (voice / speed optional)
//   sovits_voices  list configured voices
//   sovits_status  service status and config location
//   sovits_stop    stop the sentence being spoken
//
// Config: ~/.dsh/gpt-sovits-voice.json (generated on first run; legacy flat config is migrated)
// Log:    ~/.dsh/gpt-sovits-voice.log
//

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const name = "gpt-sovits-voice";
export const inject = ["agents", "webServer"];

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const playScript = join(packageRoot, "lib", "play.ps1");
const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
const configPath = join(dshHome, "gpt-sovits-voice.json");
const logPath = join(dshHome, "gpt-sovits-voice.log");
const pluginVersion = (() => {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version || "?";
  } catch {
    return "?";
  }
})();

const defaultVoice = {
  id: "default",
  name: "默认音色",
  refAudio: "",
  promptText: "",
  promptLang: "zh",
  speed: 1,
  topK: 15,
};

const defaultConfig = {
  endpoint: "http://127.0.0.1:9880/tts",
  textLang: "zh",
  timeoutMs: 120000,
  maxCharsPerRequest: 200,
  modelsDir: "",
  currentModel: "",
  testText: "这里是测试语音，喂喂喂听得到吗？",
  playLocally: true,
  defaultVoice: "",
  voices: [],
  autoStart: {
    enabled: false,
    command: "",
    workdir: "",
    waitSeconds: 120,
  },
};

try {
  appendFileSync(logPath, `[${new Date().toISOString()}] module loaded (0.4)\n`);
} catch {
  /* ignore */
}

function log(message) {
  try {
    appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* ignore */
  }
}

/** Migrate a legacy flat config into the voices list. */
function migrateConfig(raw) {
  if (Array.isArray(raw.voices) && raw.voices.length > 0) return raw;
  const legacyVoice = {
    id: "dania",
    name: "达妮娅",
    refAudio: raw.refAudio || defaultVoice.refAudio,
    promptText: raw.promptText || defaultVoice.promptText,
    promptLang: raw.promptLang || "zh",
    speed: Number(raw.speed) || 1,
    topK: Number(raw.topK) || 15,
  };
  return { ...defaultConfig, ...raw, defaultVoice: legacyVoice.id, voices: [legacyVoice] };
}

function ensureConfig() {
  if (existsSync(configPath)) return;
  try {
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf8");
  } catch (error) {
    log(`failed to write default config: ${error && error.message}`);
  }
}

/** 早期版本把值写在顶层（refAudio / promptText / speed ...），和 voices 里的是两套。
 *  这里把顶层值并回默认音色，再从文件里删掉顶层重复字段，留一套为准。 */
function normalizeConfigFile() {
  if (!existsSync(configPath)) return
  let raw
  try { raw = JSON.parse(readFileSync(configPath, "utf8")) } catch { return }
  if (!Array.isArray(raw.voices) || raw.voices.length === 0) return
  const targetId = raw.defaultVoice || raw.voices[0].id
  let index = raw.voices.findIndex((voice) => voice.id === targetId)
  if (index < 0) index = 0
  const voice = raw.voices[index]
  const legacyKeys = ["refAudio", "promptText", "promptLang", "speed", "topK"]
  let changed = false
  for (const key of legacyKeys) {
    if (raw[key] !== undefined) {
      if (raw[key] !== voice[key]) { voice[key] = raw[key]; changed = true }
      delete raw[key]
      changed = true
    }
  }
  if (!changed) return
  try {
    writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf8")
    log("normalized legacy flat fields into voices")
  } catch (error) {
    log(`normalize failed: ${error && error.message}`)
  }
}

function readConfig() {
  ensureConfig();
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    const config = { ...defaultConfig, ...migrateConfig(raw) };
    config.voices = config.voices.map((voice) => ({ ...defaultVoice, ...voice }));
    return config;
  } catch (error) {
    throw new Error(`gpt-sovits-voice.json 读不了：${error && error.message}`);
  }
}

function writeConfig(config) {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch (error) {
    throw new Error(`写配置失败：${error && error.message}`);
  }
}

function findVoice(config, voiceId) {
  const id = voiceId || config.defaultVoice || (config.voices[0] && config.voices[0].id);
  const voice = config.voices.find((item) => item.id === id);
  if (!voice) throw new Error(config.voices.length === 0 ? "还没配置音色：把模型放进 modelsDir（内含 .ckpt/.pth/参考 wav 和 prompt.txt），再在设置页选一个" : `没有这个音色：${id}（用 sovits_voices 看有哪些）`);
  return voice;
}

/** Flat view for the settings page (it edits the default voice). */
function flattenConfig(config) {
  const voice = config.voices.length > 0 ? findVoice(config, config.defaultVoice) : defaultVoice;
  return {
    endpoint: config.endpoint,
    timeoutMs: config.timeoutMs,
    textLang: config.textLang,
    refAudio: voice.refAudio,
    promptText: voice.promptText,
    promptLang: voice.promptLang,
    speed: voice.speed,
    topK: voice.topK,
    testText: config.testText,
    modelsDir: config.modelsDir,
    playLocally: config.playLocally !== false,
    defaultVoice: config.defaultVoice,
  };
}

/** Apply the settings page payload onto the default voice only. */
function applyFlatConfig(input) {
  const config = readConfig();
  if (typeof input.endpoint === "string" && input.endpoint.trim() !== "") config.endpoint = input.endpoint.trim();
  if (input.timeoutMs !== undefined) config.timeoutMs = Number(input.timeoutMs) || config.timeoutMs
  if (typeof input.testText === 'string' && input.testText.trim() !== '') config.testText = input.testText.trim();
  if (typeof input.modelsDir === "string") config.modelsDir = input.modelsDir.trim();
  if (typeof input.playLocally === "boolean") config.playLocally = input.playLocally;
  config.textLang = "zh";
  const id = config.defaultVoice;
  config.voices = config.voices.map((voice) => {
    if (voice.id !== id) return voice;
    const next = { ...voice };
    if (typeof input.refAudio === "string") next.refAudio = input.refAudio;
    if (typeof input.promptText === "string") next.promptText = input.promptText;
    if (input.speed !== undefined) next.speed = Number(input.speed) || voice.speed;
    if (input.topK !== undefined) next.topK = Math.round(Number(input.topK)) || voice.topK;
    next.promptLang = "zh";
    return next;
  });
  writeConfig(config);
  return config;
}

/** Split long text on punctuation so one request never gets too long. */
function splitText(text, maxChars) {
  const limit = Math.max(40, Number(maxChars) || 200);
  if (text.length <= limit) return [text];
  const sentences = text.split(/(?<=[。！？!?；;…\n])/).filter((part) => part.trim() !== "");
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > limit && current !== "") {
      chunks.push(current);
      current = "";
    }
    if (sentence.length > limit) {
      for (let i = 0; i < sentence.length; i += limit) chunks.push(sentence.slice(i, i + limit));
    } else {
      current += sentence;
    }
  }
  if (current.trim() !== "") chunks.push(current);
  return chunks.filter((part) => part.trim() !== "");
}

function parseEndpoint(endpoint) {
  try {
    return new URL(endpoint);
  } catch {
    throw new Error(`endpoint 不是合法地址：${endpoint}`);
  }
}

/** Probe whether the TTS port is open. */
function portOpen(address, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const port = Number(address.port || (address.protocol === "https:" ? 443 : 80));
    const socket = connect({ host: address.hostname, port });
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

/** Launch the configured start command and wait until the port opens. */
async function startService(config, address) {
  const auto = config.autoStart || {};
  if (auto.enabled === false || !auto.command) {
    throw new Error(`连不上 GPT-SoVITS（${config.endpoint}）。服务没起，autoStart 也没配——先手动启动它，或在配置里填 autoStart.command`);
  }
  if (!existsSync(auto.command)) {
    throw new Error(`autoStart 命令不存在：${auto.command}`);
  }
  log(`service not running, launching: ${auto.command}`);
  try {
    const child = spawn("cmd.exe", ["/c", auto.command], {
      cwd: auto.workdir && existsSync(auto.workdir) ? auto.workdir : undefined,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    throw new Error(`拉起服务失败：${error && error.message}`);
  }
  const deadline = Date.now() + Math.max(10, Number(auto.waitSeconds) || 120) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (await portOpen(address, 800)) {
      log("service is up");
      return;
    }
  }
  throw new Error(`等了 ${auto.waitSeconds} 秒服务还没起来，去看 D:\\AI\\api.log`);
}

/** Ask GPT-SoVITS for one piece of audio. */
async function synthesize(config, voice, text, speed) {
  const address = parseEndpoint(config.endpoint);
  address.searchParams.set("text", text);
  address.searchParams.set("text_lang", config.textLang || "zh");
  address.searchParams.set("ref_audio_path", voice.refAudio || "");
  address.searchParams.set("prompt_text", voice.promptText || "");
  address.searchParams.set("prompt_lang", voice.promptLang || "zh");
  address.searchParams.set("media_type", "wav");
  const speedValue = Number(speed || voice.speed || 1);
  if (Number.isFinite(speedValue) && speedValue > 0) address.searchParams.set("speed_factor", String(speedValue));
  if (voice.topK) address.searchParams.set("top_k", String(voice.topK));

  let response;
  try {
    response = await fetch(address, { signal: AbortSignal.timeout(config.timeoutMs || 120000) });
  } catch (error) {
    throw new Error(`连不上 GPT-SoVITS（${config.endpoint}）：${error && error.message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 400 && body.includes("tts failed")) {
      throw new Error(`合成失败：${body.slice(0, 300)}`);
    }
    throw new Error(`GPT-SoVITS 返回 ${response.status}：${body.slice(0, 300)}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 1000) throw new Error("拿回来的音频不对劲（太小），模型可能还没加载好");
  return audio;
}

let currentPlayback = null;
let playChain = Promise.resolve();

/** Play one audio file through PowerShell + MCI and wait for it to finish. */
function play(file) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", playScript, "-Path", file], { windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    currentPlayback = child;
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already dead */
      }
      reject(new Error("播放超时"));
    }, 60000);
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      currentPlayback = null;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      currentPlayback = null;
      if (code === 0) resolve();
      else
        reject(
          new Error(
            String(stderr || `play.ps1 exit code ${code}`)
              .trim()
              .slice(0, 300),
          ),
        );
    });
  });
}

/** Serialize playback so two speak calls never overlap. */
function enqueue(task) {
  const result = playChain.then(task, task);
  playChain = result.catch(() => {});
  return result;
}

/** Speak text: split, synthesize and play each chunk in order. */
function speakText(config, text, voiceId, speed, playIt = true) {
  const voice = findVoice(config, voiceId);
  const address = parseEndpoint(config.endpoint);
  return enqueue(async () => {
    if (!(await portOpen(address))) await startService(config, address);
    const chunks = splitText(text, config.maxCharsPerRequest);
    const startedAt = Date.now();
    let bytes = 0;
    const files = [];
    for (const [index, chunk] of chunks.entries()) {
      const audio = await synthesize(config, voice, chunk, speed);
      bytes += audio.length;
      if (playIt) {
        const tempFile = join(tmpdir(), `sovits-${randomUUID().slice(0, 8)}.wav`);
        try {
          writeFileSync(tempFile, audio);
          await play(tempFile);
        } finally {
          try {
            unlinkSync(tempFile);
          } catch {
            /* ignore */
          }
        }
      } else {
        // 只合成不播放：落成文件，交给调用方（比如发 QQ）
        const outDir = join(dshHome, "voice-out");
        mkdirSync(outDir, { recursive: true });
        const outFile = join(outDir, `voice-${Date.now()}-${index + 1}.wav`);
        writeFileSync(outFile, audio);
        files.push(outFile);
      }
      log(`chunk ${index + 1}/${chunks.length} ${playIt ? "spoken" : "saved"} (${chunk.length} chars, ${Math.round(audio.length / 1024)} KB)`);
    }
    return {
      segments: chunks.length,
      bytes,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      files,
    };
  });
}

/** Overlay form values for a test run without persisting them. */
function overlayConfig(config, overlay) {
  const next = { ...config, voices: config.voices.map((voice) => ({ ...voice })) };
  if (typeof overlay.endpoint === "string" && overlay.endpoint.trim() !== "") next.endpoint = overlay.endpoint.trim();
  if (overlay.timeoutMs !== undefined) next.timeoutMs = Number(overlay.timeoutMs) || next.timeoutMs;
  const voice = next.voices.find((item) => item.id === next.defaultVoice);
  if (voice) {
    if (typeof overlay.refAudio === "string") voice.refAudio = overlay.refAudio;
    if (typeof overlay.promptText === "string") voice.promptText = overlay.promptText;
    if (overlay.speed !== undefined) voice.speed = Number(overlay.speed) || voice.speed;
    if (overlay.topK !== undefined) voice.topK = Math.round(Number(overlay.topK)) || voice.topK;
  }
  return next;
}

/** 扫 modelsDir：每个子目录里找一个 .ckpt（GPT）和一个 .pth（SoVITS）就算一个模型 */
function scanModels(config) {
  const dir = String(config.modelsDir || "");
  const models = [];
  if (!dir || !existsSync(dir)) return models;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return models;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    let files = [];
    try {
      files = readdirSync(full);
    } catch {
      continue;
    }
    const gpt = files.find((f) => f.toLowerCase().endsWith(".ckpt"));
    const sovits = files.find((f) => f.toLowerCase().endsWith(".pth"));
    if (!gpt || !sovits) continue;
    const refAudio = files.find((f) => /\.(wav|mp3|flac)$/i.test(f)) || "";
    const textFile = files.find((f) => /\.(txt|lab)$/i.test(f)) || "";
    let refText = "";
    if (textFile) {
      try {
        refText = readFileSync(join(full, textFile), "utf8").trim().slice(0, 200);
      } catch {
        refText = "";
      }
    }
    models.push({ id: entry.name, name: entry.name, dir: full, gpt: join(full, gpt), sovits: join(full, sovits), refAudio: refAudio ? join(full, refAudio) : "", refText });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/** 让 GPT-SoVITS 切到某个模型（调它的 /set_gpt_weights 和 /set_sovits_weights） */
async function applyModel(config, model) {
  const base = new URL(config.endpoint);
  base.pathname = base.pathname.replace(/\/tts\/?$/, "");
  const call = async (route, file) => {
    const url = new URL(base.toString().replace(/\/$/, "") + route);
    url.searchParams.set("weights_path", file);
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`${route} 失败：${response.status} ${text.slice(0, 200)}`);
    return text;
  };
  await call("/set_gpt_weights", model.gpt);
  await call("/set_sovits_weights", model.sovits);
  log(`model switched: ${model.name}`);
}
const outputBase = {
  schema: { type: "object", properties: {}, additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
};

const speakTool = {
  name: "sovits_speak",
  description: "用本机 GPT-SoVITS 模型把文字念出来（出声）。长文会自动分段；服务没起时会尝试自动拉起。",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "要念出来的文字，最多 3000 字" },
      voice: { type: "string", description: "音色 id，不填用默认（可用 sovits_voices 查）" },
      speed: { type: "number", description: "语速倍数，1 是原速；不填用音色配置里的值" },
      play: { type: "boolean", description: "是否在本机播放。false = 只合成不播，返回音频文件路径（比如要发到 QQ）" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  output: outputBase,
  async execute(args) {
    const text = String((args && args.text) || "").trim();
    if (text === "") throw new Error("text 不能为空");
    if (text.length > 3000) throw new Error("一次最多念 3000 个字，再长分几次");

    const config = readConfig();
    const voice = findVoice(config, args && args.voice);
    const playIt = args && args.play !== undefined ? Boolean(args.play) : config.playLocally !== false;
    const result = await speakText(config, text, args && args.voice, args && args.speed, playIt);
    return { ok: true, voice: voice.id, chars: text.length, played: playIt, ...result };
  },
};

const voicesTool = {
  name: "sovits_voices",
  description: "列出 GPT-SoVITS 插件配好的音色（id、名字、参考音频），以及默认用哪个。",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  output: outputBase,
  async execute() {
    const config = readConfig();
    return {
      default: config.defaultVoice,
      endpoint: config.endpoint,
      voices: config.voices.map((voice) => ({ id: voice.id, name: voice.name, refAudio: voice.refAudio, speed: voice.speed })),
    };
  },
};

const statusTool = {
  name: "sovits_status",
  description: "看 GPT-SoVITS 服务在不在、配置指向哪、有几个音色、自动拉起开没开。",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  output: outputBase,
  async execute() {
    const config = readConfig();
    const address = parseEndpoint(config.endpoint);
    const running = await portOpen(address);
    return {
      running,
      endpoint: config.endpoint,
      defaultVoice: config.defaultVoice,
      voices: config.voices.length,
      autoStart: Boolean(config.autoStart && config.autoStart.enabled !== false),
      maxCharsPerRequest: config.maxCharsPerRequest,
      version: pluginVersion,
      configPath,
    };
  },
};

const stopTool = {
  name: "sovits_stop",
  description: "立刻停掉正在念的那句话。",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  output: outputBase,
  async execute() {
    if (currentPlayback === null) return { ok: true, stopped: false, note: "当前没在念" };
    try {
      currentPlayback.kill();
    } catch {
      /* already dead */
    }
    currentPlayback = null;
    log("stop requested");
    return { ok: true, stopped: true };
  },
};

const allTools = [speakTool, voicesTool, statusTool, stopTool];

/**
 * Register the tools on every live agent (DSH tools are agent-scoped), re-checking every 5s.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  ensureConfig()
  normalizeConfigFile();

  // ---- HTTP routes for the web half (settings page) ----
  const send = (res, status, payload) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(payload));
  };
  const readBody = async (req) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  };
  const route = (path, handler) => {
    if (typeof ctx.effect !== "function" || !ctx.webServer || typeof ctx.webServer.register !== "function") return;
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: "exact",
          path,
          handler: async (req, res) => {
            try {
              await handler(req, res);
            } catch (error) {
              send(res, 500, { ok: false, error: String((error && error.message) || error) });
            }
          },
        }),
      `gpt-sovits-voice: route ${path}`,
    );
  };

  route("/api/gpt-sovits-voice/config", async (req, res) => {
    if (req.method === "POST") {
      const input = await readBody(req);
      const config = applyFlatConfig(input);
      log("settings page saved config");
      send(res, 200, { ok: true, config: flattenConfig(config) });
      return;
    }
    send(res, 200, { ok: true, config: flattenConfig(readConfig()) });
  });

  route("/api/gpt-sovits-voice/status", async (_req, res) => {
    const config = readConfig();
    const address = parseEndpoint(config.endpoint);
    const running = await portOpen(address);
    send(res, 200, {
      ok: true,
      running,
      endpoint: config.endpoint,
      defaultVoice: config.defaultVoice,
      voices: config.voices.length,
      version: pluginVersion,
      configPath,
    });
  });

  route('/api/gpt-sovits-voice/models', async (_req, res) => {
    const config = readConfig();
    const models = scanModels(config);
    send(res, 200, {
      ok: true,
      modelsDir: config.modelsDir,
    playLocally: config.playLocally !== false,
      current: config.currentModel || "",
      models: models.map((m) => ({ id: m.id, name: m.name, hasRef: Boolean(m.refAudio), refText: m.refText })),
    });
  });

  route('/api/gpt-sovits-voice/model', async (req, res) => {
    if (req.method !== 'POST') { send(res, 405, { ok: false, error: '用 POST' }); return }
    const input = await readBody(req);
    const config = readConfig();
    const models = scanModels(config);
    const model = models.find((m) => m.id === input.id);
    if (!model) { send(res, 404, { ok: false, error: `没有这个模型：${input.id}` }); return }
    await applyModel(config, model);
    config.currentModel = model.id;
    // 模型自带参考音频/台词时，默认音色跟着换，不然音色和参考对不上
    let voiceUpdated = false;
    if (model.refAudio || model.refText) {
      config.voices = config.voices.map((voice) => {
        if (voice.id !== config.defaultVoice) return voice;
        const next = { ...voice };
        if (model.refAudio) { next.refAudio = model.refAudio; voiceUpdated = true }
        if (model.refText) { next.promptText = model.refText; voiceUpdated = true }
        return next;
      });
    }
    writeConfig(config);
    send(res, 200, { ok: true, current: model.id, name: model.name, voiceUpdated });
  });
  route('/api/gpt-sovits-voice/start', async (req, res) => {
    if (req.method !== 'POST') { send(res, 405, { ok: false, error: '用 POST' }); return }
    const config = readConfig()
    const address = parseEndpoint(config.endpoint)
    if (await portOpen(address)) {
      send(res, 200, { ok: true, running: true, alreadyRunning: true, endpoint: config.endpoint })
      return
    }
    await startService(config, address)
    const running = await portOpen(address)
    log(`settings page started service (running=${running})`)
    send(res, 200, { ok: true, running, alreadyRunning: false, endpoint: config.endpoint })
  })
  route("/api/gpt-sovits-voice/test", async (req, res) => {
    if (req.method !== "POST") {
      send(res, 405, { ok: false, error: "用 POST" });
      return;
    }
    const input = await readBody(req);
    let config = readConfig();
    if (input.config && typeof input.config === "object") config = overlayConfig(config, input.config);
    const text = String(input.text || "").trim() || config.testText || "这里是测试语音，喂喂喂听得到吗？";
    const result = await speakText(config, text, config.defaultVoice, input.config && input.config.speed);
    log(`settings page test speak: ${text.length} chars`);
    send(res, 200, { ok: true, voice: config.defaultVoice, chars: text.length, ...result });
  });

  const attached = new Set();
  const attachOnce = () => {
    let agents = [];
    try {
      agents = ctx.agents.list();
    } catch {
      return;
    }
    for (const agent of agents) {
      if (!agent) continue;
      const id = agent.id || (agent.session && agent.session.id);
      if (!id || attached.has(id)) continue;
      const tools = agent.ctx && agent.ctx.tools;
      if (!tools || typeof tools.register !== "function") continue;
      try {
        for (const tool of allTools) tools.register(tool);
        attached.add(id);
        log(`tools attached: ${id}`);
      } catch (error) {
        attached.add(id);
        log(`attach ${id} failed: ${error && error.message}`);
      }
    }
  };
  attachOnce();
  const timer = setInterval(attachOnce, 5000);
  if (typeof timer.unref === "function") timer.unref();
  if (typeof ctx.effect === "function") ctx.effect(() => () => clearInterval(timer), "gpt-sovits-voice: attach timer");
}

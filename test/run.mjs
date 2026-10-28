// Self-test: fake GPT-SoVITS server + all four tools.
// Run: node test/run.mjs

import { createServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RATE = 22050;

function makeSineWav(seconds, frequency) {
  const sampleCount = Math.floor(SAMPLE_RATE * seconds);
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    data.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const audio = makeSineWav(0.4, 440);
const requests = [];

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/tts") {
    res.writeHead(404).end("not found");
    return;
  }
  requests.push(url.searchParams);
  res.writeHead(200, { "content-type": "audio/wav" });
  res.end(audio);
});

await new Promise((ok) => server.listen(19880, "127.0.0.1", ok));
console.log("fake service: http://127.0.0.1:19880/tts");

const home = mkdtempSync(join(tmpdir(), "sovits-test-"));
process.env.DSH_HOME = home;
writeFileSync(
  join(home, "gpt-sovits-voice.json"),
  JSON.stringify(
    {
      endpoint: "http://127.0.0.1:19880/tts",
      textLang: "zh",
      timeoutMs: 30000,
      maxCharsPerRequest: 40,
      defaultVoice: "dania",
      voices: [
        {
          id: "dania",
          name: "达妮娅",
          refAudio: "output/slicer_opt/ref.wav",
          promptText: "测试参考音频",
          promptLang: "zh",
          speed: 1,
          topK: 15,
        },
      ],
      autoStart: { enabled: false },
    },
    null,
    2,
  ),
);

const { apply } = await import("../lib/host.js");
const registered = [];
apply({
  agents: {
    list: () => [
      {
        id: "mock-agent",
        ctx: {
          tools: {
            register: (tool) => {
              registered.push(tool);
              return () => {};
            },
          },
        },
      },
    ],
  },
  effect: () => {},
});
console.log("tools:", registered.map((tool) => tool.name).join(", "));

const pick = (name) => registered.find((tool) => tool.name === name);

console.log("sovits_status ->", JSON.stringify(await pick("sovits_status").execute({})));
console.log("sovits_voices ->", JSON.stringify(await pick("sovits_voices").execute({})));

const longText = "第一句话说得长一点，凑够字数。第二句话也长一点，继续凑字。第三句话再长一点，快够了。第四句话还是长一点，这下应该够了。";
const firstIndex = requests.length;
const result = await pick("sovits_speak").execute({ text: longText });
console.log("sovits_speak  ->", JSON.stringify(result));
console.log("sovits_stop   ->", JSON.stringify(await pick("sovits_stop").execute({})));
const noPlay = await pick("sovits_speak").execute({ text: "这句只合成，不在本机播放。", play: false });
console.log("sovits_speak(play:false) ->", JSON.stringify(noPlay));
if (noPlay.played !== false || !Array.isArray(noPlay.files) || noPlay.files.length === 0 || !existsSync(noPlay.files[0])) {
  console.error("FAILED: play:false should save a file without playing");
  process.exit(1);
}

const first = requests[firstIndex];
console.log("first request: media=" + first.get("media_type") + ", ref=" + first.get("ref_audio_path"));
console.log("segments:", requests.length - firstIndex);
console.log("joined text:", requests.slice(firstIndex, firstIndex + result.segments).map((params) => params.get("text")).join(""));

server.close();
if (result.segments < 2) {
  console.error("FAILED: long text was not split");
  process.exit(1);
}
if (requests.slice(firstIndex, firstIndex + result.segments).map((params) => params.get("text")).join("") !== longText) {
  console.error("FAILED: split text does not match the original");
  process.exit(1);
}
console.log("self-test passed");

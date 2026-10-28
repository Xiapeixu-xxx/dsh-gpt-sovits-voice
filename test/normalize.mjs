// Self-test: legacy flat fields (top-level promptText/refAudio/...) are merged into the default voice
// and then dropped, so config has a single source of truth.
// Run: node test/normalize.mjs

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'sovits-normalize-'))
process.env.DSH_HOME = home
const configPath = join(home, 'gpt-sovits-voice.json')

writeFileSync(configPath, JSON.stringify({
  endpoint: 'http://127.0.0.1:9880/tts',
  textLang: 'zh',
  timeoutMs: 120000,
  maxCharsPerRequest: 200,
  defaultVoice: 'dania',
  // 旧版设置页写出来的顶层重复字段
  refAudio: 'flat-ref.wav',
  promptText: '顶层的新台词',
  promptLang: 'zh',
  speed: 1.3,
  topK: 33,
  voices: [
    { id: 'dania', name: '达妮娅', refAudio: 'old-ref.wav', promptText: '音色里的旧台词', promptLang: 'zh', speed: 1, topK: 15 },
  ],
  autoStart: { enabled: false },
}, null, 2))

const routes = new Map()
const { apply } = await import('../lib/host.js')
apply({
  agents: { list: () => [] },
  effect: (fn) => { fn() },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
})

function fakeResponse() {
  const state = { status: 0, body: null }
  return { state, writeHead(status) { state.status = status }, end(text) { state.body = JSON.parse(text) } }
}
const response = fakeResponse()
await routes.get('/api/gpt-sovits-voice/config')({ method: 'GET' }, response)

console.log('接口看到的配置 ->', JSON.stringify(response.state.body.config))

const saved = JSON.parse(readFileSync(configPath, 'utf8'))
console.log('落盘的顶层字段:', Object.keys(saved).join(', '))
console.log('落盘的默认音色:', JSON.stringify(saved.voices[0]))

const nested = response.state.body.config
if (nested.promptText !== '顶层的新台词' || nested.refAudio !== 'flat-ref.wav' || nested.speed !== 1.3) {
  console.error('FAILED: flat fields were not merged into the default voice')
  process.exit(1)
}
if (saved.promptText !== undefined || saved.refAudio !== undefined || saved.speed !== undefined) {
  console.error('FAILED: legacy flat fields were not removed from the file')
  process.exit(1)
}
if (saved.voices[0].promptText !== '顶层的新台词') {
  console.error('FAILED: voices[0] was not updated in the file')
  process.exit(1)
}
if (saved.voices.length !== 1) {
  console.error('FAILED: voices list changed unexpectedly')
  process.exit(1)
}
console.log('normalize self-test passed')

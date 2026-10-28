// Self-test: the three settings-page routes (get config / save config / status).
// Run: node test/routes.mjs

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'sovits-routes-'))
process.env.DSH_HOME = home
const configPath = join(home, 'gpt-sovits-voice.json')
writeFileSync(configPath, JSON.stringify({
  endpoint: 'http://127.0.0.1:19881/tts',
  textLang: 'zh',
  timeoutMs: 60000,
  maxCharsPerRequest: 200,
  defaultVoice: 'dania',
  voices: [
    { id: 'dania', name: '达妮娅', refAudio: 'old.wav', promptText: '旧台词', promptLang: 'zh', speed: 1, topK: 15 },
    { id: 'other', name: '备用', refAudio: 'other.wav', promptText: '别的', promptLang: 'zh', speed: 1, topK: 15 },
  ],
  autoStart: { enabled: false },
}, null, 2))

const routes = new Map()
const ctx = {
  agents: { list: () => [] },
  effect: (fn) => { fn() },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
}

const { apply } = await import('../lib/host.js')
apply(ctx)
console.log('routes:', [...routes.keys()].join(', '))

function fakeRequest(method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}
function fakeResponse() {
  const state = { status: 0, body: null }
  return {
    state,
    writeHead(status) { state.status = status },
    end(text) { state.body = JSON.parse(text) },
  }
}

const getConfig = routes.get('/api/gpt-sovits-voice/config')
const getStatus = routes.get('/api/gpt-sovits-voice/status')

let response = fakeResponse()
await getConfig(fakeRequest('GET'), response)
console.log('GET /config ->', JSON.stringify(response.state.body))

response = fakeResponse()
await getConfig(fakeRequest('POST', { endpoint: 'http://127.0.0.1:19881/tts', refAudio: 'new.wav', promptText: '新台词', speed: 1.2, topK: 20, timeoutMs: 90000, testText: '改过的测试文本', modelsDir: 'D:\\models' }), response)
console.log('POST /config ->', JSON.stringify(response.state.body))

response = fakeResponse()
await getStatus(fakeRequest('GET'), response)
console.log('GET /status ->', JSON.stringify(response.state.body))
if (!/^\d+\.\d+\.\d+/.test(String(response.state.body.version))) {
  console.error('FAILED: status should expose the plugin version')
  process.exit(1)
}

const saved = JSON.parse(readFileSync(configPath, 'utf8'))
console.log('saved voices:', JSON.stringify(saved.voices))
console.log('saved timeoutMs:', saved.timeoutMs)

if (saved.voices.length !== 2) { console.error('FAILED: voices list was clobbered'); process.exit(1) }
if (saved.voices[0].refAudio !== 'new.wav' || saved.voices[0].speed !== 1.2) { console.error('FAILED: default voice was not saved'); process.exit(1) }
if (saved.voices[1].refAudio !== 'other.wav') { console.error('FAILED: other voice was modified'); process.exit(1) }
if (saved.modelsDir !== 'D:\\models') { console.error('FAILED: modelsDir was not saved'); process.exit(1) }
if (saved.testText !== '改过的测试文本') { console.error('FAILED: testText was not saved'); process.exit(1) }
if (saved.timeoutMs !== 90000) { console.error('FAILED: timeoutMs was not saved'); process.exit(1) }
console.log('routes self-test passed')

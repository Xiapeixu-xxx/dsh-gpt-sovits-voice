// Self-test: the settings page "test voice" route (/api/gpt-sovits-voice/test).
// Run: node test/test-route.mjs

import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAMPLE_RATE = 22050
function makeSineWav(seconds, frequency) {
  const sampleCount = Math.floor(SAMPLE_RATE * seconds)
  const data = Buffer.alloc(sampleCount * 2)
  for (let i = 0; i < sampleCount; i++) {
    data.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE)), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const audio = makeSineWav(0.2, 523)
const requests = []
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname !== '/tts') return res.writeHead(404).end('no')
  requests.push(url.searchParams)
  res.writeHead(200, { 'content-type': 'audio/wav' })
  res.end(audio)
})
await new Promise((ok) => server.listen(19882, '127.0.0.1', ok))

const home = mkdtempSync(join(tmpdir(), 'sovits-test-route-'))
process.env.DSH_HOME = home
writeFileSync(join(home, 'gpt-sovits-voice.json'), JSON.stringify({
  endpoint: 'http://127.0.0.1:19882/tts',
  textLang: 'zh',
  timeoutMs: 30000,
  maxCharsPerRequest: 200,
  testText: '这是配置里的测试文本。',
  defaultVoice: 'dania',
  voices: [{ id: 'dania', name: '达妮娅', refAudio: 'saved.wav', promptText: '保存的台词', promptLang: 'zh', speed: 1, topK: 15 }],
  autoStart: { enabled: false },
}, null, 2))

const routes = new Map()
const { apply } = await import('../lib/host.js')
apply({
  agents: { list: () => [] },
  effect: (fn) => { fn() },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
})

const testRoute = routes.get('/api/gpt-sovits-voice/test')
if (!testRoute) { console.error('FAILED: /test route missing'); process.exit(1) }

function fakeRequest(body) {
  return { method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body), 'utf8') } }
}
function fakeResponse() {
  const state = { status: 0, body: null }
  return { state, writeHead(status) { state.status = status }, end(text) { state.body = JSON.parse(text) } }
}

const response = fakeResponse()
await testRoute(fakeRequest({
  config: { endpoint: 'http://127.0.0.1:19882/tts', refAudio: 'form.wav', promptText: '表单里的台词', speed: 1.15, topK: 22, timeoutMs: 30000 },
}), response)

console.log('route result ->', JSON.stringify(response.state.body))
const params = requests[0]
console.log('request params: ref=' + params.get('ref_audio_path') + ', prompt=' + params.get('prompt_text') + ', speed=' + params.get('speed_factor') + ', top_k=' + params.get('top_k'))

const saved = JSON.parse(readFileSync(join(home, 'gpt-sovits-voice.json'), 'utf8'))
console.log('saved config: ref=' + saved.voices[0].refAudio + ', speed=' + saved.voices[0].speed)

server.close()
if (response.state.body.ok !== true) { console.error('FAILED: route did not return ok'); process.exit(1) }
if (params.get('text') !== '这是配置里的测试文本。') { console.error('FAILED: testText from config was not used'); process.exit(1) }
if (params.get('ref_audio_path') !== 'form.wav' || params.get('prompt_text') !== '表单里的台词') { console.error('FAILED: form values not applied'); process.exit(1) }
if (params.get('speed_factor') !== '1.15') { console.error('FAILED: speed not applied'); process.exit(1) }
if (saved.voices[0].refAudio !== 'saved.wav' || saved.voices[0].speed !== 1) { console.error('FAILED: test run polluted the saved config'); process.exit(1) }
console.log('test-route self-test passed')

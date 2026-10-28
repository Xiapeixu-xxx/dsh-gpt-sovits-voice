// Self-test: POST /api/gpt-sovits-voice/start
// 跑法：node test/start-route.mjs
//
// 分两种：端口关着（autoStart 关）应该报错；端口开着应该直接回 alreadyRunning。

import { createServer } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'sovits-start-'))
process.env.DSH_HOME = home
writeFileSync(join(home, 'gpt-sovits-voice.json'), JSON.stringify({
  endpoint: 'http://127.0.0.1:19884/tts',
  textLang: 'zh',
  timeoutMs: 20000,
  maxCharsPerRequest: 200,
  testText: '测试',
  defaultVoice: 'dania',
  voices: [{ id: 'dania', name: '达妮娅', refAudio: 'r.wav', promptText: 'p', promptLang: 'zh', speed: 1, topK: 15 }],
  autoStart: { enabled: false },
}, null, 2))

const routes = new Map()
const { apply } = await import('../lib/host.js')
apply({
  agents: { list: () => [] },
  effect: (fn) => { fn() },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
})

const start = routes.get('/api/gpt-sovits-voice/start')
if (!start) { console.error('FAILED: /start route missing'); process.exit(1) }

function fakeRequest() {
  return { method: 'POST', async *[Symbol.asyncIterator]() {} }
}
function fakeResponse() {
  const state = { status: 0, body: null }
  return { state, writeHead(status) { state.status = status }, end(text) { state.body = JSON.parse(text) } }
}

// 1) 端口关着 + autoStart 关 → 应该失败并提示
let response = fakeResponse()
await start(fakeRequest(), response)
console.log('closed ->', response.state.status, JSON.stringify(response.state.body))
if (response.state.status !== 500 || response.state.body.ok !== false) {
  console.error('FAILED: expected a failure when the service is down and autoStart is off')
  process.exit(1)
}
if (!String(response.state.body.error).includes('连不上')) {
  console.error('FAILED: error message should explain the service is unreachable')
  process.exit(1)
}

// 2) 端口开着 → 应该回 alreadyRunning
const server = createServer((socket) => socket.end())
await new Promise((ok) => server.listen(19884, '127.0.0.1', ok))
response = fakeResponse()
await start(fakeRequest(), response)
console.log('open   ->', response.state.status, JSON.stringify(response.state.body))
server.close()

if (response.state.body.ok !== true || response.state.body.alreadyRunning !== true) {
  console.error('FAILED: expected alreadyRunning when the port is open')
  process.exit(1)
}
console.log('start-route self-test passed')

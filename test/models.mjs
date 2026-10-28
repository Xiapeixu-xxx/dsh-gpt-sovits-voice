// Self-test: 模型列表与切换（GET /models、POST /model）
// 跑法：node test/models.mjs

import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// --- 假模型目录：alpha 带参考音频和台词，beta 只有权重 ---
const home = mkdtempSync(join(tmpdir(), 'sovits-models-'))
process.env.DSH_HOME = home
const modelsDir = join(home, 'models')
mkdirSync(join(modelsDir, 'alpha'), { recursive: true })
mkdirSync(join(modelsDir, 'beta'), { recursive: true })
writeFileSync(join(modelsDir, 'alpha', 'alpha.ckpt'), 'x')
writeFileSync(join(modelsDir, 'alpha', 'alpha.pth'), 'x')
writeFileSync(join(modelsDir, 'alpha', 'ref.wav'), 'x')
writeFileSync(join(modelsDir, 'alpha', 'prompt.txt'), '这是 alpha 的参考台词。')
writeFileSync(join(modelsDir, 'beta', 'beta.ckpt'), 'x')
writeFileSync(join(modelsDir, 'beta', 'beta.pth'), 'x')

// --- 假 GPT-SoVITS：接 set_gpt_weights / set_sovits_weights ---
const calls = []
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  calls.push(url.pathname + '?' + url.searchParams.toString())
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ message: 'success' }))
})
await new Promise((ok) => server.listen(19885, '127.0.0.1', ok))

writeFileSync(join(home, 'gpt-sovits-voice.json'), JSON.stringify({
  endpoint: 'http://127.0.0.1:19885/tts',
  textLang: 'zh',
  timeoutMs: 20000,
  maxCharsPerRequest: 200,
  testText: '测试',
  modelsDir,
  currentModel: '',
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

function fakeRequest(method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return { method, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c } }
}
function fakeResponse() {
  const state = { status: 0, body: null }
  return { state, writeHead(s) { state.status = s }, end(t) { state.body = JSON.parse(t) } }
}

// 1) 列表
let response = fakeResponse()
await routes.get('/api/gpt-sovits-voice/models')(fakeRequest('GET'), response)
console.log('GET /models ->', JSON.stringify(response.state.body))
const list = response.state.body.models
if (!Array.isArray(list) || list.length !== 2) { console.error('FAILED: 应该扫到 2 个模型'); process.exit(1) }
const alpha = list.find((m) => m.id === 'alpha')
if (!alpha || alpha.hasRef !== true || alpha.refText !== '这是 alpha 的参考台词。') {
  console.error('FAILED: alpha 的参考音频/台词没识别出来')
  process.exit(1)
}

// 2) 切换
response = fakeResponse()
await routes.get('/api/gpt-sovits-voice/model')(fakeRequest('POST', { id: 'alpha' }), response)
console.log('POST /model ->', JSON.stringify(response.state.body))
console.log('GPT-SoVITS 收到的调用：', calls.join(' | '))
server.close()

if (response.state.body.ok !== true || response.state.body.current !== 'alpha') {
  console.error('FAILED: 切换没成功')
  process.exit(1)
}
if (!calls.some((c) => c.startsWith('/set_gpt_weights') && c.includes('alpha.ckpt'))) {
  console.error('FAILED: 没有调 set_gpt_weights（或路径不对）')
  process.exit(1)
}
if (!calls.some((c) => c.startsWith('/set_sovits_weights') && c.includes('alpha.pth'))) {
  console.error('FAILED: 没有调 set_sovits_weights（或路径不对）')
  process.exit(1)
}
const saved = JSON.parse(readFileSync(join(home, 'gpt-sovits-voice.json'), 'utf8'))
if (saved.currentModel !== 'alpha') { console.error('FAILED: currentModel 没落盘'); process.exit(1) }
if (!String(saved.voices[0].refAudio).endsWith('ref.wav')) { console.error('FAILED: 参考音频没跟着模型换'); process.exit(1) }
if (saved.voices[0].promptText !== '这是 alpha 的参考台词。') { console.error('FAILED: 参考台词没跟着模型换'); process.exit(1) }
console.log('models self-test passed')

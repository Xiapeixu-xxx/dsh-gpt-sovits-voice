# dsh-gpt-sovits-voice

把本机 **GPT-SoVITS** 的声音接进 DSH：宿主半边提供四个工具，网页半边在「设置」里加一页「dsh声音」。

## 工具

| 工具 | 干什么 |
|---|---|
| `sovits_speak` | 念话。`voice` 选音色、`speed` 调语速；超过 `maxCharsPerRequest` 按标点分段，逐段合成播放 |
| `sovits_voices` | 列出音色：id、名字、参考音频、语速 |
| `sovits_status` | 服务通不通、默认音色、音色数量、自动拉起开没开、配置路径 |
| `sovits_stop` | 立刻停掉正在念的那句 |

两次念话会排队，不会叠音；要打断就 `sovits_stop`。

## 设置页

「设置 → dsh声音」，顶部是状态行（服务在不在 + 地址），下面是可改的项：

| 项 | 说明 |
|---|---|
| 模型 | 从 `modelsDir` 扫出来的权重包，选好点「应用模型」 |
| 服务地址 | 默认 `http://127.0.0.1:9880/tts` |
| 语速 | 1 是原速，0.5～2 |
| 采样 top_k | 越小越稳，越大越发散 |
| **测试文本** | 点「测试语音」念的那句，随便改 |
| 超时（毫秒） | 单次合成最长等待 |

按钮：

- **保存**：写进 `~/.dsh/gpt-sovits-voice.json`，下一句说话生效（只改默认音色那条）
- **测试语音**：用当前表单里的值念一句测试话，**不用先保存、也不写盘**
- **刷新状态**：重新读服务状态和配置
- **启动服务**：连不上时状态行右边才出现，按 `autoStart.command` 拉起 GPT-SoVITS，起来后自动刷新

参考音频和参考台词**不在页面上**——它们是内部字段，要改直接编辑 json。

## 接口

宿主给设置页开的六条路径、七个方法（同源，无需鉴权）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/gpt-sovits-voice/config` | 读配置（默认音色平铺成 refAudio / promptText / speed / topK / testText） |
| POST | `/api/gpt-sovits-voice/config` | 存配置（只改默认音色 + 全局字段） |
| GET | `/api/gpt-sovits-voice/status` | 服务在不在、音色数、配置文件路径 |
| POST | `/api/gpt-sovits-voice/test` | 试音：接受 `{ text, config }`，临时覆盖、不落盘；不带 text 就用 `testText` |
| GET | `/api/gpt-sovits-voice/models` | 扫 `modelsDir`，返回可用模型（有参考音频/台词的会标出来） |
| POST | `/api/gpt-sovits-voice/model` | 切模型：调 `set_gpt_weights` / `set_sovits_weights`，模型自带参考音频时一并换掉默认音色的 refAudio/promptText |
| POST | `/api/gpt-sovits-voice/start` | 拉起服务并等端口；已在跑则回 `alreadyRunning` |

## 配置

`~/.dsh/gpt-sovits-voice.json`（第一次跑自动生成）

```json
{
  "endpoint": "http://127.0.0.1:9880/tts",
  "textLang": "zh",
  "timeoutMs": 120000,
  "maxCharsPerRequest": 200,
  "modelsDir": "D:\\AI\\GPT-SoVITS\\models",
  "currentModel": "",
  "testText": "这里是测试语音，喂喂喂听得到吗？",
  "defaultVoice": "dania",
  "voices": [
    {
      "id": "dania",
      "name": "卡提希娅",
      "refAudio": "output/refs/katexia_zh_ref.wav",
      "promptText": "不过，我建议你现在最好去找坎特蕾拉聊聊，她应该已经安全离开索诺拉了，我能感觉到。",
      "promptLang": "zh",
      "speed": 1,
      "topK": 15
    }
  ],
  "autoStart": {
    "enabled": true,
    "command": "D:\\AI\\启动GPT-SoVITS.cmd",
    "workdir": "D:\\AI\\GPT-SoVITS",
    "waitSeconds": 120
  }
}
```

- **只有一套字段**：音色的地址、台词、语速、top_k 都在 `voices[]` 里。老版本写在顶层的 `refAudio / promptText / speed / topK` 会在启动时并进默认音色并从文件里删掉。
- **多音色**：`voices` 里加一条就是一个新声音，`defaultVoice` 决定默认。
- **`testText`**：设置页「测试语音」念的句子，随便改。
- **`voices[].refAudio` / `voices[].promptText`**：内部字段。前者是参考音频、后者是它的**逐字转录**，两者必须一致；改的时候要一起换，否则音色会跑偏。
- **参考音频路径**相对 GPT-SoVITS 仓库根目录（服务那边的 CWD），不是相对 DSH。
- **autoStart**：念话前发现端口不通就按 `command` 拉起，最多等 `waitSeconds` 秒；`"enabled": false` 关掉自动拉起（「启动服务」按钮也会失效）。
- `maxCharsPerRequest` 小于 40 按 40 算。
- **`modelsDir`**：模型目录，一个子目录一个模型。子目录里要有 **一个 `.ckpt`（GPT）+ 一个 `.pth`（SoVITS）**；如果有 `.wav` 和同名 `.txt`/`.lab`，会当成参考音频和参考台词。
- **版本要一致**：模型必须是当前 `tts_infer.yaml` 里 `custom.version` 对应的版本（现在跑的是 **v4**）。v2ProPlus 的权重塞进 v4 配置里会加载失败——换版本要改 yaml 再重启服务。
- **`currentModel`**：最近一次「应用模型」切到的那个，只作记录；实际权重已经在 GPT-SoVITS 进程里。

## 文件结构

```
dsh-gpt-sovits-voice/
├─ package.json
├─ README.md
├─ client.js              设置页（浏览器半边）
├─ cordis.patch.yml       bundle 安装用的补丁（按包名插入）
├─ cordis.dev.patch.yml   本地测试用的补丁（绝对路径指向 lib/host.js）
├─ dev.cmd                双击起测试实例
├─ lib/
│  ├─ host.js             四个工具 + 五条接口 + 合成播放
│  └─ play.ps1            MCI 播放（UTF-8 BOM，中文不乱码）
└─ test/
   ├─ run.mjs             四个工具 + 长文分段
   ├─ routes.mjs          读/存配置、状态
   ├─ test-route.mjs      「测试语音」接口（表单值生效且不写盘）
   ├─ normalize.mjs       顶层旧字段并进 voices 并删除
   ├─ start-route.mjs     启动服务接口（关着报错 / 开着回 alreadyRunning）
   └─ models.mjs          模型列表与切换（扫目录 + 调 set_*_weights）
```

## 自测（不用 DSH）

```
node test/run.mjs
node test/routes.mjs
node test/test-route.mjs
node test/normalize.mjs
node test/start-route.mjs
node test/models.mjs
```

都是起假服务（440Hz 正弦波代替语音），跑完打印 `self-test passed`；改完代码先跑这五个再重启。

## 本地测试（不动桌面版）

参照 dsh-demo 的约定，两份补丁分工不同：

| 文件 | 指向 | 用来测什么 |
|---|---|---|
| `cordis.dev.patch.yml` | 绝对路径 `lib\host.js` | 宿主半边：工具、接口（改完重启这个实例就行） |
| `cordis.patch.yml` | 包名 `dsh-gpt-sovits-voice` | bundle 安装用；能带出设置页 |

最省事：

```
cd /d D:\code\dsh-gpt-sovits-voice
npm test
```

等价于 `dsh web --patch .\cordis.dev.patch.yml`，也可以直接双击 `dev.cmd`。起来后终端会打印 `http://127.0.0.1:xxxx`。

要点：

- **dev patch 只加载宿主**，设置页不会出来；要看设置页就重启桌面版（profile 里已注册）
- 测试实例和桌面版**共用** `~\.dsh\gpt-sovits-voice.json`，别两边同时保存
- 报 `EADDRINUSE 127.0.0.1:3080` 说明有旧实例占着端口，先收掉
- `--patch` 后面**必须写绝对路径**（Loader 以 profile 目录为基准解析相对路径）

## 装进 DSH / 卸掉

装：

1. 链到 profile：`mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-gpt-sovits-voice" "D:\code\dsh-gpt-sovits-voice"`
2. `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾加：

```yaml
- insert:
    - id: gpt-sovits-voice
      name: dsh-gpt-sovits-voice
```

3. 重启 DSH

卸：删掉补丁里那三行、`rmdir` 掉链接、重启。

## 排查

| 现象 | 原因 / 处理 |
|---|---|
| 只听到「哼」一声、句子断掉 | GPT-SoVITS 的 `GPT_SoVITS/configs/tts_infer.yaml` 里 `is_half: true` 在 RTX 50 系上会算崩，改成 `false`（fp32） |
| 点「测试语音」念的是参考台词 | 旧版本 bug；现在走 `testText`，确认已升级 |
| 声音闷、飘、没感情 | 参考音频的问题：换 5～10 秒、干净、**带情绪**的单人片段，`refAudio` 和 `promptText` 一起换 |
| 连不上 `127.0.0.1:9880` | 先点「启动服务」；还不行看 `D:\AI\api.log` |
| 口气声/底噪大 | 参考音频本身带的呼吸或噪声，换一段干净的参考最有效；`top_k` 降到 5～8 能收一点 |

日志：

- 插件：`~/.dsh/gpt-sovits-voice.log`
- 服务：`D:\AI\api.log`

## 命名约定

- 标识符一律英文（lowerCamelCase），配置字段也是英文。
- 注释和用户可见文案保持中文。

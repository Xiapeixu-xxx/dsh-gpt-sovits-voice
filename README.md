# @xiapeixu/dsh-gpt-sovits-voice

把本机 **GPT-SoVITS** 的声音接进 DSH：宿主半边提供四个工具，网页半边在「设置」里加一页「dsh声音」。

> **平台**：Windows 10 / 11（播放走 PowerShell + winmm，暂不支持 macOS / Linux）
> **DSH**：0.2.1 及以上
> **本仓库不含任何语音模型**：模型和参考音频要自己准备，版权归各自权利人

## 前置要求

插件本身只是一层「调用方」，真正发声的是本机的 GPT-SoVITS 服务。装之前请确认：

| 需要准备 | 说明 |
|---|---|
| GPT-SoVITS 本体 | 能起 `api_v2.py`，默认监听 `127.0.0.1:9880` |
| 基础权重 | 跟模型版本匹配：v4 要 `s2Gv4.pth` + `vocoder.pth`；v2ProPlus 要 `s2G/s2D` |
| 角色模型 | 一个 `.ckpt`（GPT）+ 一个 `.pth`（SoVITS），版本要和 `tts_infer.yaml` 的 `version` 一致 |
| 参考音频 + 台词 | 一段 5～10 秒的干净人声，以及它的**逐字转录**，两者必须对得上 |
| 解码环境 | 50 系显卡建议 `is_half: false`（fp16 会把句子算断） |

## 安装

**方式一：插件市场**（上架后）

DSH → 设置 → 插件市场 → 搜索 `@xiapeixu/dsh-gpt-sovits-voice` → 安装 → 重启。

**方式二：命令行**

```bash
dsh plugin --profile desktop add @xiapeixu/dsh-gpt-sovits-voice
```

**方式三：手动（开发用）**

```bat
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\@xiapeixu\dsh-gpt-sovits-voice" <本包目录>
```

再在 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 末尾加：

```yaml
- insert:
    - id: gpt-sovits-voice
      name: '@xiapeixu/dsh-gpt-sovits-voice'
```

然后**重启 DSH**。

**装完的第一次配置**

1. 把模型按下面的「模型目录」摆好
2. 设置 → dsh声音 → 填「模型目录」（比如 `D:\AI\GPT-SoVITS\models`）→ 刷新状态
3. 下拉里选中模型 → 应用模型
4. 点「测试语音」验证

## 工具

| 工具 | 干什么 |
|---|---|
| `sovits_speak` | 念话。`voice` 选音色、`speed` 调语速、`play: false` 只合成不播放（返回文件路径）；超长按标点分段 |
| `sovits_voices` | 列出音色：id、名字、参考音频、语速 |
| `sovits_status` | 服务通不通、默认音色、音色数量、自动拉起开没开、配置路径 |
| `sovits_stop` | 停掉正在念的那句 |

两次念话会排队，不会叠音；要打断就 `sovits_stop`。

## 模型目录约定

`modelsDir` 下**一个子目录一个模型**：

```
models/
└─ 你的角色名/
   ├─ xxx.ckpt        GPT 权重
   ├─ xxx.pth         SoVITS 权重
   ├─ ref.wav         参考音频（可选，但强烈建议）
   └─ prompt.txt      参考音频的逐字转录（可选，但有 wav 就该配）
```

扫描规则：目录里必须有 `.ckpt` + `.pth`；有 `.wav` 就当参考音频，有 `.txt`/`.lab` 就当参考台词。应用模型时会调 GPT-SoVITS 的 `set_gpt_weights` / `set_sovits_weights`，并把参考音频/台词同步到默认音色。

⚠️ **模型版本必须和当前 `tts_infer.yaml` 的 `custom.version` 一致**。v2ProPlus 的权重塞进 v4 配置里会加载失败——换大版本要改 yaml 再重启服务。

## 设置页

「设置 → dsh声音」，顶部是状态行（服务在不在 + 地址），可改：

| 项 | 说明 |
|---|---|
| 模型目录 | 模型所在的根目录，比如 `D:\AI\GPT-SoVITS\models` |
| 模型 | 从模型目录扫出来的权重包，选好点「应用模型」 |
| 服务地址 | 默认 `http://127.0.0.1:9880/tts` |
| 语速 | 1 是原速，0.5～2 |
| 采样 top_k | 越小越稳，越大越发散 |
| 测试文本 | 点「测试语音」念的那句 |
| 超时（毫秒） | 单次合成最长等待 |
| 本机播放 | 关掉后只合成不播放，适合把音频发到别处（QQ 等） |

按钮：保存 / 测试语音 / 刷新状态 / 启动服务（连不上时才出现）。

参考音频、参考台词是**内部字段**，不在页面上——通过模型目录带出来，或直接编辑 json。

## 接口

宿主给设置页开的接口（同源，无需鉴权）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/gpt-sovits-voice/config` | 读配置（默认音色平铺） |
| POST | `/api/gpt-sovits-voice/config` | 存配置（只改默认音色 + 全局字段） |
| GET | `/api/gpt-sovits-voice/status` | 服务在不在、音色数、配置路径 |
| GET | `/api/gpt-sovits-voice/models` | 扫 `modelsDir` 列出模型 |
| POST | `/api/gpt-sovits-voice/model` | 切模型（调 `set_*_weights`） |
| POST | `/api/gpt-sovits-voice/test` | 试音（`{ text, config }`，不落盘） |
| POST | `/api/gpt-sovits-voice/start` | 拉起服务并等端口 |

## 配置

`~/.dsh/gpt-sovits-voice.json`（第一次跑自动生成，**默认是空的**）

```json
{
  "endpoint": "http://127.0.0.1:9880/tts",
  "textLang": "zh",
  "timeoutMs": 120000,
  "maxCharsPerRequest": 200,
  "modelsDir": "",
  "currentModel": "",
  "testText": "这里是测试语音，喂喂喂听得到吗？",
  "playLocally": true,
  "defaultVoice": "",
  "voices": [],
  "autoStart": {
    "enabled": false,
    "command": "",
    "workdir": "",
    "waitSeconds": 120
  }
}
```

- `modelsDir` 填了才有模型可切；`autoStart` 配了 `command` 才能自动拉起服务
- `playLocally`：默认 `true`（念了就在本机响）；设成 `false` 就只合成、把音频留在 `~/.dsh/voice-out/`，适合发 QQ
- `voices[]` 由「应用模型」自动填；也可以手写多条（多音色）
- 参考音频路径**相对 GPT-SoVITS 仓库根目录**（服务那边的 CWD），不是相对 DSH
- `maxCharsPerRequest` 小于 40 按 40 算

## 多工作区 / 多会话

- 插件**按 profile 安装一次**，所有工作区、所有会话共用同一份代码
- 配置只有一份：`~/.dsh/gpt-sovits-voice.json`。改语速、音色、模型目录都是**全局生效**，不存在「某个工作区单独设置」
- 本机开发时把安装位做成指向源码的 junction（`mklink /J`），改完源码重启 DSH，所有工作区一起变
- 如果发现某个窗口行为不一致，先看设置页状态行的版本号——多半是那个实例还挂着旧宿主，重启即可

## 自测

```bash
npm test
```

六个脚本，都是起假服务（440Hz 正弦波代替语音），跑完打印 `self-test passed`：

| 脚本 | 测什么 |
|---|---|
| `test/run.mjs` | 四个工具 + 长文分段 |
| `test/routes.mjs` | 读/存配置、状态 |
| `test/test-route.mjs` | 试音接口（表单值生效且不写盘） |
| `test/normalize.mjs` | 顶层旧字段并进 voices 并删除 |
| `test/start-route.mjs` | 启动服务接口 |
| `test/models.mjs` | 模型列表与切换 |

## 本地开发

```bash
npm run dev
```

等价 `dsh web --patch .\cordis.dev.patch.yml`，也可以双击 `dev.cmd`。dev patch 只加载宿主半边，设置页不会出来。

- `--patch` 后面**必须写绝对路径**（Loader 以 profile 目录为基准解析）
- 报 `EADDRINUSE 127.0.0.1:3080` 说明有旧实例占着端口

## 卸载

删掉 profile 补丁里那三行、`rmdir` 掉链接（或 `dsh plugin remove`），重启。

## 排查

| 现象 | 原因 / 处理 |
|---|---|
| 只听到「哼」一声、句子断掉 | `is_half: true` 在 50 系上会算崩，改成 `false` |
| 念的是参考台词而不是测试文本 | 旧版本 bug；现在走 `testText` |
| 声音闷、飘、没感情 | 参考音频问题：换 5～10 秒、干净、**带情绪**的单人片段，`refAudio` 和 `promptText` 一起换 |
| 连不上 `127.0.0.1:9880` | 点「启动服务」（需配 `autoStart`）；或手动起服务看 `api.log` |
| 报 `Resource 'cmudict' not found` | v4 处理英文/数字需要 NLTK 数据，补 `cmudict` 和 `averaged_perceptron_tagger_eng` |
| 切模型后加载失败 | 模型版本和 `tts_infer.yaml` 的 `version` 不一致 |
| 改了语速 / top_k 但说话没变 | 多半是装了个旧版宿主（把参数存进顶层字段、合成时没读）。设置页状态行右边会显示版本号 `v0.5.0`；不是这个版本就重启 DSH 让新宿主加载 |

日志：插件 `~/.dsh/gpt-sovits-voice.log`；服务端看 GPT-SoVITS 的 `api.log`。

## 许可

MIT（见 `LICENSE`）。**模型、参考音频、角色声音不在此许可范围内**，请自行确认授权。

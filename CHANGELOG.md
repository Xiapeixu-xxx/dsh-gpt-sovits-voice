# Changelog

## 0.5.1

修 0.5.0 的致命打包问题：

- `client.js` 的 bundle id 从 `dsh-gpt-sovits-voice` 改成 `@xiapeixu/dsh-gpt-sovits-voice`，和包名一致
  - 0.5.0 装上后 web boot 会报 `duplicate factory registration for "dsh-gpt-sovits-voice"`，入口激活失败，整个 DSH 起不来
- 保存设置后不再误报 `保存失败：modelsResponse is not defined`（保存后一并刷新 `/status` 和 `/models`）

## 0.5.0

发布前收拾：

- 包名改为 `@xiapeixu/dsh-gpt-sovits-voice`（带 scope，避免撞名），补 author / repository / homepage
- 去掉所有本机硬编码：默认不再带 `modelsDir`、`autoStart.command`、示例音色
- 首次安装是「空配置」：设置页能打开，但不配模型就念不出声（会给出明确提示）
- 重新组织 README：前置要求、安装、模型目录约定、常见问题
- 补 `LICENSE`（MIT）、`os: win32`、`engines.node >= 22.6`
- `files` 里去掉 `cordis.dev.patch.yml`（开发用，不随包发布）
- 状态接口和设置页状态行显示插件版本，方便排查「装的是旧宿主」
- 新增「只合成不播放」：工具参数 `play: false` + 配置 `playLocally`，音频落在 `~/.dsh/voice-out/`
- `npm test` 改成跑全部六个自测

## 0.4.0

- 标识符全部英文，注释和文案保持中文
- 设置页加「模型」下拉 + 「应用模型」，切模型会调 `set_gpt_weights` / `set_sovits_weights`
- 设置页加「测试文本」输入框和「启动服务」按钮

## 0.3.0

- 新增 `sovits_voices`、`sovits_stop`
- 长文按标点分段；两次念话排队，不再叠音
- 服务没起时按 `autoStart.command` 自动拉起
- 设置页（`client.js`）+ 三条 HTTP 接口
- 配置里支持多音色 `voices[]`

## 0.2.0

- 从「念出来」升级成插件：四个工具、合成 + MCI 播放
- 配置迁移：顶层 `refAudio` / `promptText` 等旧字段并进 `voices[]` 后删除

## 0.1.0

- 第一版：`sovits_speak` / `sovits_status`，HTTP 调本机 GPT-SoVITS

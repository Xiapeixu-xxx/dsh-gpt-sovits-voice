/**
 * @xiapeixu/dsh-gpt-sovits-voice —— 浏览器半端：在「设置」里加一页「语音」。
 * ============================================================================
 * 和 dsh-demo 同一套约定：
 *   1. 不是 ESM，是自注册脚本：window.__ModuleLoader__.load({ id, factory })。
 *   2. id 必须等于 package.json 的 name，否则 web boot 会报
 *      "loaded without registering <包名>"。
 *   3. 设置页读写的是宿主那半边暴露的 /api/gpt-sovits-voice/*，
 *      和 sovits_speak / sovits_status 读的是同一个 json，保存后立刻生效。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: "@xiapeixu/dsh-gpt-sovits-voice",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;

    const API = "/api/gpt-sovits-voice";

    /** 统一走宿主接口：非 2xx 或 { ok: false } 都当失败抛出来。 */
    async function requestApi(path, options) {
      const response = await fetch(API + path, { credentials: "same-origin", ...options });
      let body = null;
      try {
        body = await response.json();
      } catch {
        /* 不是 JSON 就按状态码报 */
      }
      if (!response.ok || (body && body.ok === false)) {
        throw new Error((body && body.error) || `HTTP ${response.status}`);
      }
      return body;
    }

    // 只留中文：这个插件的参考音频和台词都是中文，别的语言不再给选项。
    const LANGUAGES = [["zh", "中文"]];

    const styles = {
      page: { display: "flex", flexDirection: "column", gap: "14px", maxWidth: "620px", padding: "12px 4px" },
      title: { fontSize: "15px", fontWeight: 700 },
      statusRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", opacity: 0.8 },
      dot: { width: "7px", height: "7px", borderRadius: "50%", display: "inline-block", flex: "none" },
      section: { display: "flex", flexDirection: "column", gap: "10px" },
      row: { display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "13px" },
      label: { width: "90px", flex: "none", opacity: 0.8, paddingTop: "6px" },
      input: {
        flex: "1",
        minWidth: 0,
        padding: "6px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
      },
      textarea: {
        flex: "1",
        minWidth: 0,
        padding: "6px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        resize: "vertical",
      },
      button: {
        padding: "6px 14px",
        borderRadius: "6px",
        border: 0,
        cursor: "pointer",
        background: "rgba(127,127,127,.18)",
        color: "inherit",
        font: "inherit",
      },
      secondaryButton: {
        padding: "6px 12px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,.35)",
        cursor: "pointer",
        background: "transparent",
        color: "inherit",
        font: "inherit",
      },
      hint: { fontSize: "12px", opacity: 0.65 },
      small: { fontSize: "11px", opacity: 0.5, wordBreak: "break-all" },
    };

    return {
      inject: ["slots"],
      apply(ctx) {
        const slots = ctx.get("slots") || ctx.slots;
        if (!slots) return;

        function VoicePanel() {
          const [config, setConfig] = React.useState(null);
          const [status, setStatus] = React.useState(null);
          const [loading, setLoading] = React.useState(true);
          const [error, setError] = React.useState("");
          const [message, setMessage] = React.useState("");
          const [saving, setSaving] = React.useState(false);
          const [testing, setTesting] = React.useState(false);
          const [testMessage, setTestMessage] = React.useState("");
          const [starting, setStarting] = React.useState(false);
          const [models, setModels] = React.useState([]);
          const [modelsDir, setModelsDir] = React.useState("");
          const [modelId, setModelId] = React.useState("");
          const [applying, setApplying] = React.useState(false);

          const refresh = React.useCallback(async () => {
            setError("");
            try {
              const [configResponse, statusResponse, modelsResponse] = await Promise.all([
                requestApi("/config"),
                requestApi("/status"),
                requestApi("/models"),
              ]);
              setConfig(configResponse.config);
              setStatus(statusResponse);
              setModels(modelsResponse.models || []);
              setModelsDir(modelsResponse.modelsDir || "");
              setModelId((previous) => previous || modelsResponse.current || "");
            } catch (e) {
              setError(e && e.message ? e.message : String(e));
            } finally {
              setLoading(false);
            }
          }, []);

          React.useEffect(() => {
            refresh();
          }, [refresh]);

          const updateField = (key) => (event) => {
            const value = event.target.value;
            setConfig((previous) => ({ ...previous, [key]: value }));
            setMessage("");
          };

          const save = async () => {
            setSaving(true);
            setMessage("");
            try {
              const response = await requestApi("/config", {
                method: "POST",
                headers: { "content-type": "application/json" },
                // 只支持中文：保存时把两个语言字段归一到 zh
                body: JSON.stringify({ ...config, textLang: "zh", promptLang: "zh" }),
              });
              setConfig(response.config);
              const [statusResponse, modelsResponse] = await Promise.all([requestApi("/status"), requestApi("/models")]);
              setStatus(statusResponse);
              setModels(modelsResponse.models || []);
              setModelsDir(modelsResponse.modelsDir || "");
              setModelId((previous) => previous || modelsResponse.current || "");
              setMessage("已保存，下次说话就生效");
            } catch (e) {
              setMessage("保存失败：" + (e && e.message ? e.message : String(e)));
            } finally {
              setSaving(false);
            }
          };

          // 试音：拿当前表单里的值（还没保存也没关系）让宿主念一句
          const testVoice = async () => {
            setTesting(true);
            setTestMessage("");
            try {
              const result = await requestApi("/test", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  text: config.testText || "这里是测试语音，喂喂喂听得到吗？",
                  config,
                }),
              });
              setTestMessage(`念完了：${result.chars} 字，${result.seconds} 秒`);
            } catch (e) {
              setTestMessage("测试失败：" + (e && e.message ? e.message : String(e)));
            } finally {
              setTesting(false);
            }
          };

          // 切换模型：让宿主调 GPT-SoVITS 的 set_*_weights
          const applyModel = async () => {
            if (!modelId) return;
            setApplying(true);
            setMessage("");
            try {
              const result = await requestApi("/model", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ id: modelId }),
              });
              setMessage("已切换到：" + (result.name || modelId));
            } catch (e) {
              setMessage("切换失败：" + (e && e.message ? e.message : String(e)));
            } finally {
              setApplying(false);
            }
          };
          // 启动服务：调宿主拉 GPT-SoVITS，等服务起来再刷新状态
          const startService = async () => {
            setStarting(true);
            setMessage("");
            try {
              const result = await requestApi("/start", { method: "POST" });
              setMessage(result.alreadyRunning ? "服务本来就在跑" : "服务已启动");
              await refresh();
            } catch (e) {
              setMessage("启动失败：" + (e && e.message ? e.message : String(e)));
            } finally {
              setStarting(false);
            }
          };
          if (loading) return h("div", { style: styles.hint }, "读取中…");

          if (error && !config) {
            return h(
              "div",
              { style: { ...styles.page } },
              h("div", { style: styles.hint }, "读取失败：" + error),
              h(
                "button",
                {
                  style: styles.button,
                  onClick: () => {
                    setLoading(true);
                    refresh();
                  },
                },
                "重试",
              ),
            );
          }

          if (!config) return null;

          const textField = (key, label, extra = {}) =>
            h(
              "label",
              { style: styles.row },
              h("span", { style: styles.label }, label),
              h("input", { style: styles.input, value: config[key] ?? "", onChange: updateField(key), ...extra }),
            );

          const selectField = (key, label) => {
            const current = LANGUAGES.some(([value]) => value === config[key]) ? config[key] : LANGUAGES[0][0];
            return h(
              "label",
              { style: styles.row },
              h("span", { style: styles.label }, label),
              h(
                "select",
                { style: styles.input, value: current, onChange: updateField(key) },
                ...LANGUAGES.map(([value, name]) => h("option", { key: value, value }, name)),
              ),
            );
          };

          return h(
            "div",
            { style: styles.page },
            h("div", { style: styles.title }, "GPT-SoVITS 语音"),

            h(
              "div",
              { style: styles.statusRow },
              h("span", { style: { ...styles.dot, background: status && status.running ? "#3fb950" : "#d29922" } }),
              h("span", null, status && status.running ? "GPT-SoVITS 在跑" : "连不上 GPT-SoVITS"),
              h(
                "span",
                { style: styles.hint },
                (status && status.endpoint ? status.endpoint : "") + (status && status.version ? " · v" + status.version : ""),
              ),
              !(status && status.running) &&
                h("button", { style: styles.secondaryButton, onClick: startService, disabled: starting }, starting ? "启动中…" : "启动服务"),
            ),

            h(
              "div",
              { style: styles.section },
              h(
                "label",
                { style: styles.row },
                h("span", { style: styles.label }, "模型"),
                h(
                  "select",
                  { style: styles.input, value: modelId, onChange: (event) => setModelId(event.target.value) },
                  ...(models.length
                    ? models.map((model) => h("option", { key: model.id, value: model.id }, model.name))
                    : [h("option", { key: "none", value: "" }, "（模型目录里没找到模型）")]),
                ),
              ),
              h(
                "div",
                { style: { display: "flex", gap: "8px", alignItems: "center" } },
                h(
                  "button",
                  { style: styles.secondaryButton, onClick: applyModel, disabled: applying || !modelId },
                  applying ? "切换中…" : "应用模型",
                ),
                h("span", { style: styles.hint }, modelsDir ? "模型目录：" + modelsDir : ""),
              ),
              textField("modelsDir", "模型目录", { placeholder: "例如 D:\\AI\\GPT-SoVITS\\models" }),
              textField("endpoint", "服务地址", { placeholder: "http://127.0.0.1:9880/tts" }),

              selectField("textLang", "合成语言"),
              selectField("promptLang", "参考语言"),

              h(
                "label",
                { style: styles.row },
                h("span", { style: styles.label }, "语速"),
                h("input", {
                  style: styles.input,
                  type: "number",
                  step: "0.05",
                  min: "0.5",
                  max: "2",
                  value: config.speed ?? "",
                  onChange: updateField("speed"),
                }),
              ),

              h(
                "label",
                { style: styles.row },
                h("span", { style: styles.label }, "采样 top_k"),
                h("input", {
                  style: styles.input,
                  type: "number",
                  step: "1",
                  min: "1",
                  max: "100",
                  value: config.topK ?? "",
                  onChange: updateField("topK"),
                }),
              ),

              h(
                "label",
                { style: styles.row },
                h("span", { style: styles.label }, "测试文本"),
                h("textarea", {
                  style: styles.textarea,
                  rows: 2,
                  value: config.testText ?? "",
                  onChange: updateField("testText"),
                  placeholder: "点『测试语音』时念这句",
                }),
              ),
              h(
                "label",
                { style: { ...styles.row, alignItems: "center" } },
                h("span", { style: styles.label }, "本机播放"),
                h("input", {
                  type: "checkbox",
                  checked: config.playLocally !== false,
                  onChange: (event) => setConfig({ ...config, playLocally: event.target.checked }),
                }),
                h("span", { style: styles.hint }, "关掉后只合成不播放，适合发到别处"),
              ),
              h(
                "label",
                { style: styles.row },
                h("span", { style: styles.label }, "超时（毫秒）"),
                h("input", {
                  style: styles.input,
                  type: "number",
                  step: "1000",
                  min: "5000",
                  max: "600000",
                  value: config.timeoutMs ?? "",
                  onChange: updateField("timeoutMs"),
                }),
              ),
            ),

            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "10px" } },
              h("button", { style: styles.secondaryButton, onClick: save, disabled: saving }, saving ? "保存中…" : "保存"),
              h("button", { style: styles.secondaryButton, onClick: testVoice, disabled: testing }, testing ? "正在念…" : "测试语音"),
              h("button", { style: styles.secondaryButton, onClick: refresh }, "刷新状态"),
              h("span", { style: styles.hint }, message || testMessage || (error ? "状态读取失败：" + error : "")),
            ),

            h("div", { style: styles.small }, status && status.configPath ? "配置文件：" + status.configPath : ""),
          );
        }

        ctx.effect(
          () =>
            slots.inject("settings.section", () =>
              slots.register({ name: "settings.section", id: "gpt-sovits-voice", order: 61, label: "dsh声音" }, () => h(VoicePanel)),
            ),
          "gpt-sovits-voice: settings page",
        );
      },
    };
  },
});

const state = {
  uploadedText: "",
  messages: [],
  mode: "对话协作",
  rules: ""
};

const presets = {
  local: { type: "local", name: "本地模拟", baseUrl: "", model: "" },
  openai: { type: "openai", name: "OpenAI Compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  deepseek: { type: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  "deepseek-v4-flash": { type: "deepseek", name: "DeepSeek V4 Flash", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  "deepseek-v4-pro": { type: "deepseek", name: "DeepSeek V4 Pro", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro" },
  doubao: { type: "doubao", name: "豆包 / 火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "ep-你的方舟推理接入点ID" },
  qwen: { type: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  custom: { type: "custom", name: "自定义", baseUrl: "", model: "" }
};

const $ = (id) => document.getElementById(id);

const els = {
  fileInput: $("fileInput"),
  fileList: $("fileList"),
  insertUploadBtn: $("insertUploadBtn"),
  providerPreset: $("providerPreset"),
  baseUrl: $("baseUrl"),
  model: $("model"),
  apiKey: $("apiKey"),
  providerStatus: $("providerStatus"),
  keywordInput: $("keywordInput"),
  editor: $("editor"),
  chatInput: $("chatInput"),
  chatLog: $("chatLog")
};

function addMessage(role, content) {
  state.messages.push({ role, content });
  renderChat();
}

function renderChat() {
  els.chatLog.innerHTML = "";
  for (const message of state.messages) {
    const item = document.createElement("div");
    item.className = `msg ${message.role}`;
    item.textContent = message.content;
    els.chatLog.appendChild(item);
  }
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function getProvider() {
  const preset = presets[els.providerPreset.value] || presets.local;
  return {
    ...preset,
    baseUrl: els.baseUrl.value.trim(),
    model: els.model.value.trim(),
    apiKey: els.apiKey.value.trim()
  };
}

function saveProvider() {
  localStorage.setItem("geo-api-provider", JSON.stringify({
    preset: els.providerPreset.value,
    baseUrl: els.baseUrl.value,
    model: els.model.value,
    apiKey: els.apiKey.value
  }));
  updateProviderStatus();
}

function loadProvider() {
  const saved = JSON.parse(localStorage.getItem("geo-api-provider") || "{}");
  els.providerPreset.value = saved.preset || "local";
  const preset = presets[els.providerPreset.value] || presets.local;
  els.baseUrl.value = saved.baseUrl ?? preset.baseUrl;
  els.model.value = saved.model ?? preset.model;
  els.apiKey.value = saved.apiKey ?? "";
  updateProviderStatus();
}

function updateProviderStatus() {
  const provider = getProvider();
  els.providerStatus.textContent = `当前：${provider.name}${provider.model ? ` · ${provider.model}` : ""}`;
}

function applyPreset() {
  const preset = presets[els.providerPreset.value] || presets.local;
  els.baseUrl.value = preset.baseUrl;
  els.model.value = preset.model;
  saveProvider();
}

async function askAssistant(prompt, mode = state.mode) {
  const userMessage = prompt.trim();
  if (!userMessage) return;

  addMessage("user", userMessage);
  const pending = { role: "assistant", content: "处理中..." };
  state.messages.push(pending);
  renderChat();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: getProvider(),
        mode,
        messages: state.messages.filter((item) => item !== pending).slice(-10),
        editorContent: els.editor.value,
        uploadedContext: state.uploadedText,
        ruleContext: state.rules
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    pending.content = data.content || "没有返回内容。";
  } catch (error) {
    pending.role = "system";
    pending.content = `请求失败：${error.message}`;
  }
  renderChat();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".modeBtn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
}

async function loadRules() {
  const response = await fetch("/api/rules");
  const data = await response.json();
  state.rules = `${data.summary}\n\n${data.extracted || ""}`;
  addMessage("system", "已载入 GEO 规则。后续选题、成文、审核都会把它作为规则上下文。");
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isOfficeFile(file) {
  return /\.(docx|xlsx|pptx|doc|xls|ppt)$/i.test(file.name);
}

async function extractOfficeFile(file) {
  const base64 = await fileToBase64(file);
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename: file.name, base64 })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "文件解析失败");
  return data.text || "";
}

async function handleFiles(files) {
  const chunks = [];
  els.fileList.innerHTML = "";
  for (const file of files) {
    let text = "";
    let status = "已读取";
    try {
      text = isOfficeFile(file) ? await extractOfficeFile(file) : await fileToText(file);
      if (!text.trim()) status = "未提取到文字";
    } catch (error) {
      status = error.message;
    }
    chunks.push(`\n\n===== ${file.name} =====\n${text}`);
    const item = document.createElement("div");
    item.className = "file-item";
    item.textContent = `${file.name} · ${Math.round(file.size / 1024)} KB · ${status}`;
    els.fileList.appendChild(item);
  }
  state.uploadedText = chunks.join("");
  addMessage("system", `已上传 ${files.length} 个文件，内容已进入对话上下文。`);
}

async function saveWorkspace() {
  const localPayload = {
    title: els.keywordInput.value || "GEO内容工作区",
    content: els.editor.value,
    uploadedContext: state.uploadedText,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem("geo-workspace", JSON.stringify(localPayload));

  const response = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(localPayload)
  });
  const data = await response.json();
  addMessage(response.ok ? "system" : "assistant", response.ok ? `已保存：${data.savedAt || localPayload.savedAt}` : `已保存到浏览器本地，服务器保存失败：${data.error}`);
}

async function loadWorkspace() {
  const localPayload = JSON.parse(localStorage.getItem("geo-workspace") || "{}");
  if (localPayload.content || localPayload.uploadedContext) {
    els.editor.value = localPayload.content || "";
    state.uploadedText = localPayload.uploadedContext || "";
    return;
  }
  try {
    const response = await fetch("/api/load");
    const data = await response.json();
    els.editor.value = data.content || "";
    state.uploadedText = data.uploadedContext || "";
  } catch {
    els.editor.value = "";
    state.uploadedText = "";
  }
}

function bindEvents() {
  els.providerPreset.addEventListener("change", applyPreset);
  [els.baseUrl, els.model, els.apiKey].forEach((el) => el.addEventListener("change", saveProvider));
  els.fileInput.addEventListener("change", (event) => handleFiles([...event.target.files]));
  $("loadRulesBtn").addEventListener("click", loadRules);
  $("saveBtn").addEventListener("click", saveWorkspace);
  $("insertUploadBtn").addEventListener("click", () => {
    els.editor.value = `${els.editor.value}\n${state.uploadedText}`.trim();
  });
  $("sendBtn").addEventListener("click", () => {
    const value = els.chatInput.value;
    els.chatInput.value = "";
    askAssistant(value);
  });
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) $("sendBtn").click();
  });
  $("resetChatBtn").addEventListener("click", () => {
    state.messages = [];
    renderChat();
  });
  document.querySelectorAll(".modeBtn").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  $("topicBtn").addEventListener("click", () => {
    setMode("选题生成");
    askAssistant(`请基于关键词“${els.keywordInput.value || "未填写"}”生成 5-10 个 GEO 选题，并按优先级排序。`, "选题生成");
  });
  $("generateBtn").addEventListener("click", () => {
    setMode("内容生成");
    askAssistant(`请基于当前关键词、上传资料和编辑区内容，按 GEO 内容规则生成一版完整内容。`, "内容生成");
  });
  $("reviewBtn").addEventListener("click", () => {
    setMode("内容审核");
    askAssistant("请审核当前编辑区内容，按照 GEO 规则给出通过/不通过、问题寻因和修改建议。", "内容审核");
  });
  $("clearBtn").addEventListener("click", () => {
    els.editor.value = "";
  });
}

loadProvider();
bindEvents();
setMode("对话协作");
loadWorkspace();
addMessage("assistant", "工作台已就绪。你可以先上传资料，输入关键词，然后生成选题、成文或审核。");

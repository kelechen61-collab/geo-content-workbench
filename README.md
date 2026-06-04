# GEO 客户初轮检测台

一个面向前端销售的 GEO 初轮诊断网页，用于快速评估新客户的品牌基础、内容资产、关键词在 AI 平台中的展示情况，以及首轮沟通切入点。

## 功能

- 客户初检：输入公司、官网、行业、业务、关键词、竞品和已有素材，生成 GEO Score、风险、资产和行动建议。
- 关键词展示检测：按目标品牌、关键词和 AI 平台生成展示率、前三率、首位率、中正率、平均名次。
- 后台跑数：客户提交关键词后，系统按“关键词 × AI 平台 × 采样次数”批量采样，默认每个平台重复 3 次，可选择 4 次或 5 次。
- AI 平台覆盖：DeepSeek、豆包、腾讯元宝、Kimi、通义千问、文心一言。
- 报告输出：复制销售报告，导出关键词展示明细 CSV。
- 销售话术：自动生成首轮沟通判断和优先修复方向。

## 指标口径

- 展示率：AI 答案中提及目标品牌的比例。
- 前三率：目标品牌进入推荐前三的比例。
- 首位率：目标品牌成为第一推荐的比例。
- 中正率：已展示目标品牌的答案中，中性或正向口径的比例。
- 平均名次：仅统计已出现目标品牌的答案排名。

当前版本用于销售首轮诊断，展示和口径指标为规则化模拟结果；接入真实 AI 平台查询后，可把前端模拟逻辑替换为正式监测接口。

## 免费 API 接入

当前已预留 OpenRouter 免费模型路由。OpenRouter 官方提供 `openrouter/free`，会自动路由到可用免费模型。

本地启动前配置：

```bash
export OPENROUTER_API_KEY="你的 OpenRouter Key"
export OPENROUTER_MODEL="openrouter/free"
```

然后启动：

```bash
node server.js
```

如果没有配置 `OPENROUTER_API_KEY`，系统会自动使用本地模拟采样器，方便销售演示和离线测试。

注意：OpenRouter 免费模型可用于低成本采样和口径判断，但它不等于真实进入 DeepSeek、豆包、腾讯元宝客户端查询。要做正式监测，应把 `server.js` 中的采样函数替换为对应平台的官方 API、企业接口或合规采集方式。

## 后台跑数接口

### `POST /api/visibility-run`

用于关键词展示检测。前端提交品牌、业务、关键词、竞品、平台和采样次数，后台统一返回明细和汇总。

```json
{
  "brand": "云栖增长科技",
  "business": "GEO / AEO 内容优化服务",
  "keywords": ["GEO 服务哪家好", "AI 搜索优化公司"],
  "competitors": ["传统 SEO 代运营", "内容营销机构"],
  "platforms": ["DeepSeek", "豆包", "腾讯元宝"],
  "sampleCount": 3
}
```

后续接入真实平台时，替换 `server.js` 里的采样逻辑即可：保持返回结构不变，前端无需改动。

## 启动

```bash
cd /Users/chenkaiqing/Documents/管理文档/geo-content-workbench
/Users/chenkaiqing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

打开：

```text
http://127.0.0.1:4788
```

## 部署到 Vercel

1. 把 `geo-content-workbench` 这个目录上传到 GitHub 仓库。
2. 打开 Vercel，点击 `Add New...` -> `Project`。
3. 选择你的 GitHub 仓库。
4. 如果仓库根目录就是本项目，保持默认即可；如果你把整个 `管理文档` 仓库上传了，需要在 Vercel 的 `Root Directory` 选择：

```text
geo-content-workbench
```

5. Framework Preset 选择 `Other`。
6. Build Command 留空。
7. Output Directory 留空。
8. 点击 `Deploy`。

Vercel 会自动安装 `package.json` 里的依赖，并识别：

```text
public/       静态前端
api/*.js      Serverless 后端接口
```

如果只部署当前销售检测网页，不使用历史内容工作台接口，也可以把 `public/` 作为静态站点部署到任意静态托管服务。

### Vercel 注意事项

- 云端不能持久写入 `data/latest-workspace.json`，所以网页会把工作区保存到浏览器本地 `localStorage`。
- 当前销售检测页不依赖后端即可运行。
- `api/` 目录保留了后续接入真实 LLM、文件解析和内容工作台的扩展能力。

## 开放局域网访问

默认只允许本机访问。需要让同一网络下的其他设备访问时，使用：

```bash
cd /Users/chenkaiqing/Documents/管理文档/geo-content-workbench
PUBLIC_ACCESS=true /Users/chenkaiqing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

服务会监听：

```text
http://0.0.0.0:4788
```

其他设备访问时，把 `0.0.0.0` 替换成这台电脑的局域网 IP。

## 后端接口

### `POST /api/chat`

用于对话、选题、内容生成和审核。

请求体：

```json
{
  "provider": {
    "type": "openai",
    "name": "OpenAI Compatible",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4.1-mini",
    "apiKey": "YOUR_API_KEY"
  },
  "mode": "选题生成",
  "messages": [
    {
      "role": "user",
      "content": "基于 GEO 服务生成 10 个选题"
    }
  ],
  "editorContent": "",
  "uploadedContext": "",
  "ruleContext": ""
}
```

当 `provider.type` 为 `local` 或 `baseUrl` 为空时，后端会使用本地模拟回复，方便无 Key 测试。

### `GET /api/rules`

读取内置 GEO 规则和当前工作区中的 GEO PDF 抽取文本。

### `POST /api/extract`

提取上传文件中的文字内容。支持 `.docx`、`.xlsx`、`.pptx`，以及常见文本格式。旧版 `.doc`、`.xls`、`.ppt` 请先另存为新版 Office 格式。

请求体：

```json
{
  "filename": "内容资料.docx",
  "base64": "..."
}
```

响应：

```json
{
  "filename": "内容资料.docx",
  "text": "提取后的文本"
}
```

### `POST /api/save`

保存当前编辑器内容和上传上下文到 `data/latest-workspace.json`。

### `GET /api/load`

加载上一次保存的工作区内容。

## 目录

```text
geo-content-workbench/
  server.js
  package.json
  README.md
  public/
    index.html
    styles.css
    app.js
  data/
    latest-workspace.json
```

## API 兼容规则

后端会把请求转发到：

```text
{baseUrl}/chat/completions
```

因此供应商需要支持 OpenAI Chat Completions 格式。

如果填写的 `baseUrl` 已经以 `/chat/completions` 结尾，后端会直接使用该完整地址，不再重复拼接。

## 供应商预设

### DeepSeek V4

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
Model: deepseek-v4-pro
```

### 豆包 / 火山方舟

```text
Base URL: https://ark.cn-beijing.volces.com/api/v3
Model: ep-你的方舟推理接入点ID
```

豆包在火山方舟里通常需要先创建推理接入点，然后把接入点 ID 填到 `Model` 字段。

### 硅基流动

```text
Base URL: https://api.siliconflow.cn/v1
Model: deepseek-ai/DeepSeek-V3
Environment Variable: SILICONFLOW_API_KEY
```

线上部署建议把 Key 配到 Vercel 环境变量 `SILICONFLOW_API_KEY`，前端 API Key 留空即可调用。

# GEO Content Workbench

一个用于 GEO 内容生产流程的本地网页应用，支持上传资料、编辑内容、对话生成、内容审核，以及切换 OpenAI-compatible API。

## 功能

- 关键词输入
- 生成 5-10 个 GEO 选题
- 上传 TXT / MD / CSV / JSON / HTML / DOCX / XLSX / PPTX 内容
- 编辑内容草稿
- 按 GEO 规则生成内容
- 按 GEO 审核规则检查内容
- 本地保存/加载工作区
- API 供应商切换
  - 本地模拟
  - OpenAI Compatible
  - DeepSeek
  - DeepSeek V4 Flash
  - DeepSeek V4 Pro
  - 硅基流动
  - 豆包 / 火山方舟
  - 通义千问 OpenAI 兼容
  - 自定义 OpenAI-compatible endpoint

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

### Vercel 注意事项

- 云端不能持久写入 `data/latest-workspace.json`，所以网页会把工作区保存到浏览器本地 `localStorage`。
- API Key 目前由前端发送到后端代理，请只给可信用户使用。
- Word/Excel/PPT 云端解析支持 `.docx`、`.xlsx`、`.pptx`。

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

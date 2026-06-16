import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import visibilityRunHandler from "./api/visibility-run.js";

const rootDir = resolve(process.cwd());
const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const extractorPath = join(rootDir, "scripts", "extract_file.py");
const pythonPath = process.env.PYTHON_PATH || "/Users/chenkaiqing/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const port = Number(process.env.PORT || 4788);
const host = process.env.PUBLIC_ACCESS === "true" ? "0.0.0.0" : (process.env.HOST || "127.0.0.1");
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "openrouter/free";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const geoRules = `GEO 内容规则库：
1. 目标从“获取点击”转为“被 AI 理解、信任、引用、推荐”。
2. 优先级先防守再进攻：先修正品牌基础事实，再做场景化问题、对比问题、行业知识和长尾 FAQ。
3. 内容四步法：帮 AI 看懂、让 AI 信任、教 AI 跟进、替 AI 预判。
4. 好内容必须清晰结构化，包含直接答案、事实证据、数据或案例、可引用表达、FAQ 和下一步建议。
5. 选题优先选择用户会向 AI 提问的高意向问题，如“是什么、怎么样、多少钱、靠谱吗、怎么选、哪家好、对比、适合谁、如何解决某痛点”。
6. 审核重点：事实准确、口径一致、证据可信、结构可摘取、表达非空泛、不过度营销、包含 FAQ、适合目标平台、能构成品牌标准答案。
7. 失败处理：审核不通过时先定位根因，再回到选题或内容生成，不直接盲目重写。`;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function runExtractor(payload) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(pythonPath, [extractorPath], {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const parsed = JSON.parse(stdout || "{}");
        if (code !== 0 || parsed.error) {
          reject(new Error(parsed.error || stderr || "File extraction failed"));
          return;
        }
        resolveRun(parsed);
      } catch (error) {
        reject(new Error(stderr || error.message));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function safePublicPath(urlPath) {
  const cleaned = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, cleaned === "/" ? "index.html" : cleaned);
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

function makeSystemPrompt(mode, extraRules = "") {
  return `你是一个 GEO 内容工作流助手，必须使用中文输出，遵循以下规则。

${geoRules}

用户补充规则：
${extraRules || "无"}

当前工作模式：${mode || "对话协作"}

输出要求：
- 如果是选题生成，给出 5-10 个选题，并包含搜索意图、优先级、GEO价值、内容角度。
- 如果是内容生成，按“直接答案-结构化展开-证据/案例-FAQ-发布建议”输出。
- 如果是内容审核，给出通过/不通过、阻断问题、优化建议、可直接修改的版本。
- 如果信息不足，先基于已有信息给出可执行版本，并标注需要补充的关键字段。`;
}

function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/\n|,|，|、/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function buildVisibilityReport(payload = {}) {
  const brand = String(payload.brand || "").trim() || "目标品牌";
  const business = String(payload.business || "").trim() || "核心业务";
  const keywords = splitLines(payload.keywords);
  const competitors = splitLines(payload.competitors);
  const platforms = splitLines(payload.platforms);
  const sampleCount = Math.max(3, Math.min(5, Number(payload.sampleCount || 3)));
  const safeKeywords = keywords.length ? keywords : ["品牌服务哪家好", `${business}怎么选`, `${brand}怎么样`];
  const safePlatforms = platforms.length ? platforms : ["DeepSeek", "豆包", "腾讯元宝"];
  const safeCompetitors = competitors.length ? competitors : ["竞品 A", "竞品 B", "竞品 C"];
  const samples = Array.from({ length: sampleCount }, (_, index) => index + 1);

  const rows = safeKeywords.flatMap((keyword) => safePlatforms.flatMap((platform) => samples.map((sample) => {
    const seed = hashText(`${brand}-${keyword}-${platform}-${business}-${sample}`);
    const signal = seed % 100;
    const rank = signal < 18 ? 0 : signal < 39 ? 5 : signal < 58 ? 4 : signal < 78 ? 3 : signal < 91 ? 2 : 1;
    const competitor = safeCompetitors[(seed + platform.length) % safeCompetitors.length];
    const toneSignal = (seed + keyword.length + platform.length) % 100;
    const tone = rank === 0 ? "未判断" : toneSignal < 16 ? "偏负" : toneSignal < 47 ? "中性" : "正向";
    return {
      keyword,
      platform,
      sample,
      brand,
      rank,
      tone,
      isNeutral: tone === "中性" || tone === "正向",
      competitor,
      status: rank === 0 ? "未展示" : rank === 1 ? "首位" : rank <= 3 ? "前三" : "出现"
    };
  })));

  const total = rows.length;
  const mentioned = rows.filter((row) => row.rank > 0).length;
  const top3 = rows.filter((row) => row.rank > 0 && row.rank <= 3).length;
  const first = rows.filter((row) => row.rank === 1).length;
  const rankedRows = rows.filter((row) => row.rank > 0);
  const neutral = rankedRows.filter((row) => row.isNeutral).length;
  const avgRankValue = rankedRows.length
    ? (rankedRows.reduce((sum, row) => sum + row.rank, 0) / rankedRows.length).toFixed(1)
    : "-";
  const platformStats = safePlatforms.map((platform) => {
    const items = rows.filter((row) => row.platform === platform);
    const appeared = items.filter((row) => row.rank > 0);
    return {
      platform,
      mentionRate: percent(appeared.length, items.length),
      top3Rate: percent(items.filter((row) => row.rank > 0 && row.rank <= 3).length, items.length),
      firstRate: percent(items.filter((row) => row.rank === 1).length, items.length),
      neutralRate: percent(appeared.filter((row) => row.isNeutral).length, appeared.length)
    };
  });
  const weakRows = rows.filter((row) => row.rank === 0 || row.rank > 3);
  const weakKeywords = [...new Set(weakRows.map((row) => row.keyword))].slice(0, 4);
  const findings = [
    `优先补强关键词：${weakKeywords.length ? weakKeywords.join("、") : safeKeywords.slice(0, 3).join("、")}。`,
    `把“${brand} + ${business}”整理成标准答案页，确保 AI 能明确识别品牌与业务绑定关系。`,
    `围绕低展示平台补充案例、价格、适合人群、对比竞品和 FAQ，提升被引用概率。`,
    `对首位率低的关键词制作“哪家好 / 怎么选 / 对比 / 多少钱”类型内容，争取推荐位前移。`
  ];

  return {
    brand,
    business,
    sampleCount,
    rows,
    platformStats,
    mentionRate: percent(mentioned, total),
    top3Rate: percent(top3, total),
    firstRate: percent(first, total),
    neutralRate: percent(neutral, rankedRows.length),
    avgRank: avgRankValue,
    findings,
    tag: percent(mentioned, total) >= 75 ? "展示基础较好" : percent(mentioned, total) >= 45 ? "存在展示缺口" : "展示明显不足",
    generatedAt: new Date().toISOString()
  };
}

function summarizeVisibilityReport({ brand, business, sampleCount, rows, platforms, keywords }) {
  const total = rows.length;
  const mentioned = rows.filter((row) => row.rank > 0).length;
  const top3 = rows.filter((row) => row.rank > 0 && row.rank <= 3).length;
  const first = rows.filter((row) => row.rank === 1).length;
  const rankedRows = rows.filter((row) => row.rank > 0);
  const neutral = rankedRows.filter((row) => row.isNeutral).length;
  const avgRankValue = rankedRows.length
    ? (rankedRows.reduce((sum, row) => sum + row.rank, 0) / rankedRows.length).toFixed(1)
    : "-";
  const platformStats = platforms.map((platform) => {
    const items = rows.filter((row) => row.platform === platform);
    const appeared = items.filter((row) => row.rank > 0);
    return {
      platform,
      mentionRate: percent(appeared.length, items.length),
      top3Rate: percent(items.filter((row) => row.rank > 0 && row.rank <= 3).length, items.length),
      firstRate: percent(items.filter((row) => row.rank === 1).length, items.length),
      neutralRate: percent(appeared.filter((row) => row.isNeutral).length, appeared.length)
    };
  });
  const weakRows = rows.filter((row) => row.rank === 0 || row.rank > 3);
  const weakKeywords = [...new Set(weakRows.map((row) => row.keyword))].slice(0, 4);
  const findings = [
    `优先补强关键词：${weakKeywords.length ? weakKeywords.join("、") : keywords.slice(0, 3).join("、")}。`,
    `把“${brand} + ${business}”整理成标准答案页，确保 AI 能明确识别品牌与业务绑定关系。`,
    `围绕低展示平台补充案例、价格、适合人群、对比竞品和 FAQ，提升被引用概率。`,
    `对首位率低的关键词制作“哪家好 / 怎么选 / 对比 / 多少钱”类型内容，争取推荐位前移。`
  ];
  return {
    brand,
    business,
    sampleCount,
    rows,
    platformStats,
    mentionRate: percent(mentioned, total),
    top3Rate: percent(top3, total),
    firstRate: percent(first, total),
    neutralRate: percent(neutral, rankedRows.length),
    avgRank: avgRankValue,
    findings,
    tag: percent(mentioned, total) >= 75 ? "展示基础较好" : percent(mentioned, total) >= 45 ? "存在展示缺口" : "展示明显不足",
    generatedAt: new Date().toISOString()
  };
}

function parseJsonObject(content) {
  const match = String(content || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function sampleWithOpenRouter({ brand, business, keyword, platform, sample, competitors }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${openRouterApiKey}`,
      "HTTP-Referer": process.env.SITE_URL || "http://127.0.0.1:4788",
      "X-Title": "GEO Visibility Detector"
    },
    body: JSON.stringify({
      model: openRouterModel,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "你是GEO关键词展示检测采样器。只输出JSON，不要输出解释。"
        },
        {
          role: "user",
          content: `模拟用户在${platform}中搜索/提问：请推荐适合做「${keyword}」的品牌或服务商，并按推荐优先级列出5个。\n目标品牌：${brand}\n业务：${business}\n已知竞品：${competitors.join("、") || "无"}\n第${sample}次采样。\n请判断目标品牌在答案中的排名与口径。输出JSON：{"rank":0到5的整数,"tone":"正向|中性|偏负|未判断","competitor":"最主要占位竞品","status":"未展示|出现|前三|首位"}。rank为0表示未展示。`
        }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "OpenRouter request failed");
  const parsed = parseJsonObject(data.choices?.[0]?.message?.content);
  const rank = Math.max(0, Math.min(5, Number(parsed?.rank || 0)));
  const tone = ["正向", "中性", "偏负", "未判断"].includes(parsed?.tone) ? parsed.tone : (rank > 0 ? "中性" : "未判断");
  return {
    keyword,
    platform,
    sample,
    brand,
    rank,
    tone,
    isNeutral: tone === "中性" || tone === "正向",
    competitor: String(parsed?.competitor || competitors[0] || "未识别"),
    status: rank === 0 ? "未展示" : rank === 1 ? "首位" : rank <= 3 ? "前三" : "出现"
  };
}

async function buildOpenRouterVisibilityReport(payload = {}) {
  const brand = String(payload.brand || "").trim() || "目标品牌";
  const business = String(payload.business || "").trim() || "核心业务";
  const keywords = splitLines(payload.keywords).slice(0, 10);
  const competitors = splitLines(payload.competitors).slice(0, 8);
  const platforms = splitLines(payload.platforms).slice(0, 6);
  const sampleCount = Math.max(3, Math.min(5, Number(payload.sampleCount || 3)));
  const safeKeywords = keywords.length ? keywords : ["品牌服务哪家好", `${business}怎么选`, `${brand}怎么样`];
  const safePlatforms = platforms.length ? platforms : ["DeepSeek", "豆包", "腾讯元宝"];
  const samples = Array.from({ length: sampleCount }, (_, index) => index + 1);
  const rows = [];
  for (const keyword of safeKeywords) {
    for (const platform of safePlatforms) {
      for (const sample of samples) {
        rows.push(await sampleWithOpenRouter({ brand, business, keyword, platform, sample, competitors }));
      }
    }
  }
  return summarizeVisibilityReport({ brand, business, sampleCount, rows, platforms: safePlatforms, keywords: safeKeywords });
}

function localAssistant({ message, mode, editorContent, uploadedContext }) {
  const source = `${editorContent || ""}\n${uploadedContext || ""}`.slice(0, 1600);
  const topicSeeds = [
    "品牌基础事实标准答案",
    "用户高意向场景问题",
    "产品/服务选择指南",
    "费用与投入产出解释",
    "靠谱性与信任背书",
    "竞品对比与替代方案",
    "行业常见误区澄清",
    "适合人群与不适合人群",
    "落地步骤与检查清单",
    "FAQ 问答资产"
  ];

  if ((mode || "").includes("选题") || /选题|题目|topic/i.test(message)) {
    return `以下是基于 GEO 规则生成的 10 个选题方向：\n\n${topicSeeds
      .map((item, index) => `${index + 1}. ${item}\n   - 搜索意图：用户希望 AI 给出可直接决策的答案。\n   - 优先级：${index < 3 ? "高" : index < 7 ? "中" : "低"}\n   - GEO价值：强化 AI 对品牌事实、专业能力和推荐理由的理解。\n   - 内容角度：围绕“问题定义 → 标准答案 → 证据 → FAQ”展开。`)
      .join("\n")}\n\n下一步建议：选择 1-3 个高优先级选题进入内容生成。`;
  }

  if ((mode || "").includes("审核") || /审核|检查|review/i.test(message)) {
    return `GEO 内容审核结果：需要优化后再输出。\n\n阻断问题：\n1. 是否有清晰的“直接答案”需要确认。\n2. 是否提供事实证据、案例、数据或资质背书需要加强。\n3. 是否包含 FAQ 和后续问题预判需要检查。\n\n修改建议：\n- 开头用 2-3 句话直接回答用户核心问题。\n- 正文改成 H2/H3 结构，方便 AI 摘取。\n- 增加品牌事实、产品参数、客户案例或可验证数据。\n- 补充 3-5 个 FAQ。\n\n当前可参考内容片段：\n${source || "暂无编辑区或上传内容。"} `;
  }

  return `我会按 GEO 内容四步法处理：帮 AI 看懂、让 AI 信任、教 AI 跟进、替 AI 预判。\n\n基于你的输入，我建议这样推进：\n1. 先把关键词转换成 5-10 个高意向问题。\n2. 选出防守型和进攻型选题。\n3. 对每个选题生成结构化内容。\n4. 用审核模板检查事实、证据、结构、FAQ 和品牌口径。\n\n你刚才的问题是：${message || "未输入"}\n\n我已读取的上下文片段：\n${source || "暂无上下文。"} `;
}

async function handleChat(req, res) {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const provider = body.provider || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const latest = messages[messages.length - 1]?.content || "";
    const mode = body.mode || "对话协作";

    if (!provider.baseUrl || provider.type === "local") {
      return sendJson(res, 200, {
        provider: "local",
        content: localAssistant({
          message: latest,
          mode,
          editorContent: body.editorContent,
          uploadedContext: body.uploadedContext
        })
      });
    }

    const normalizedBaseUrl = (provider.type === "siliconflow"
      ? "https://api.siliconflow.cn/v1"
      : provider.baseUrl
    ).replace(/\/$/, "");
    const endpoint = normalizedBaseUrl.endsWith("/chat/completions")
      ? normalizedBaseUrl
      : normalizedBaseUrl + "/chat/completions";
    const apiKey = provider.type === "siliconflow" && process.env.SILICONFLOW_API_KEY
      ? process.env.SILICONFLOW_API_KEY
      : provider.apiKey;
    const model = String(provider.model || "")
      .replace(/[\u2010-\u2015]/g, "-")
      .trim() || (provider.type === "siliconflow" ? "deepseek-ai/DeepSeek-V3" : provider.model);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey || ""}`
      },
      body: JSON.stringify({
        model,
        temperature: Number(provider.temperature ?? 0.3),
        messages: [
          { role: "system", content: makeSystemPrompt(mode, body.ruleContext) },
          {
            role: "user",
            content: `编辑区内容：\n${body.editorContent || "无"}\n\n上传内容：\n${body.uploadedContext || "无"}`
          },
          ...messages
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return sendJson(res, response.status, { error: data.error?.message || "API request failed", detail: data });
    }

    sendJson(res, 200, {
      provider: provider.name || "custom",
      content: data.choices?.[0]?.message?.content || "",
      raw: data
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleSave(req, res) {
  try {
    await mkdir(dataDir, { recursive: true });
    const body = JSON.parse(await readBody(req) || "{}");
    const payload = {
      savedAt: new Date().toISOString(),
      title: body.title || "未命名内容",
      content: body.content || "",
      uploadedContext: body.uploadedContext || ""
    };
    await writeFile(join(dataDir, "latest-workspace.json"), JSON.stringify(payload, null, 2), "utf-8");
    sendJson(res, 200, { ok: true, savedAt: payload.savedAt });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleLoad(res) {
  const filePath = join(dataDir, "latest-workspace.json");
  if (!existsSync(filePath)) return sendJson(res, 200, { content: "", uploadedContext: "" });
  const content = await readFile(filePath, "utf-8");
  sendJson(res, 200, JSON.parse(content));
}

async function handleExtract(req, res) {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    if (!body.filename || !body.base64) {
      return sendJson(res, 400, { error: "filename and base64 are required" });
    }
    const result = await runExtractor({
      filename: body.filename,
      base64: body.base64
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleRules(res) {
  const extractedPath = resolve(rootDir, "../geo_pdf_extracted.txt");
  let extracted = "";
  if (existsSync(extractedPath)) {
    extracted = await readFile(extractedPath, "utf-8");
  }
  sendJson(res, 200, { summary: geoRules, extracted: extracted.slice(0, 18000) });
}

async function handleVisibilityRun(req, res) {
  try {
    const body = JSON.parse(await readBody(req) || "{}");
    const adapter = {
      method: req.method,
      body,
      setHeader(name, value) {
        res.setHeader(name, value);
      },
      status(statusCode) {
        res.statusCode = statusCode;
        return this;
      },
      json(payload) {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(payload));
      }
    };
    await visibilityRunHandler(adapter, adapter);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    });
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && url.pathname === "/api/extract") return handleExtract(req, res);
  if (req.method === "POST" && url.pathname === "/api/save") return handleSave(req, res);
  if (req.method === "POST" && url.pathname === "/api/visibility-run") return handleVisibilityRun(req, res);
  if (req.method === "GET" && url.pathname === "/api/load") return handleLoad(res);
  if (req.method === "GET" && url.pathname === "/api/rules") return handleRules(res);
  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true });

  const filePath = safePublicPath(url.pathname);
  if (!filePath) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "access-control-allow-origin": "*"
    });
    res.end(file);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(fallback);
  }
});

server.listen(port, host, () => {
  console.log(`GEO Content Workbench running at http://${host}:${port}`);
});

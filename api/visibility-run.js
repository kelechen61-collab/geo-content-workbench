import { applyCors, getBody, sendJson } from "./_shared.js";

const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "openrouter/free";
const siliconFlowApiKey = process.env.SILICONFLOW_API_KEY || "";
const siliconFlowModel = process.env.SILICONFLOW_VISIBILITY_MODEL || "deepseek-ai/DeepSeek-V3";

function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/\n|,|，|、/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s·・.。,“”，,、（）()【】\[\]「」]/g, "");
}

function brandAliases(brand, aliases) {
  return [...new Set([brand, ...splitLines(aliases)].map((item) => String(item).trim()).filter(Boolean))];
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
    mode: rows.some((row) => row.mode === "真实采样") ? "真实采样" : "模拟检测",
    evidenceNote: rows.some((row) => row.rawAnswer)
      ? "已保存每次采样的原始回答，可追溯展示率、排名和口径判断。"
      : "当前为规则化模拟结果，用于销售初筛，不等同于真实平台搜索结果。",
    generatedAt: new Date().toISOString()
  };
}

function buildLocalVisibilityReport(payload = {}) {
  const brand = String(payload.brand || "").trim() || "目标品牌";
  const business = String(payload.business || "").trim() || "核心业务";
  const aliases = brandAliases(brand, payload.aliases);
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
      status: rank === 0 ? "未展示" : rank === 1 ? "首位" : rank <= 3 ? "前三" : "出现",
      matchedAlias: rank > 0 ? aliases[0] : "",
      rawAnswer: "",
      mode: "模拟检测",
      sampledAt: new Date().toISOString(),
      sourceModel: "local-rule-sampler"
    };
  })));
  return summarizeVisibilityReport({ brand, business, sampleCount, rows, platforms: safePlatforms, keywords: safeKeywords });
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

async function mapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function fallbackRemoteRow({ brand, keyword, platform, sample, error }) {
  return {
    keyword,
    platform,
    sample,
    brand,
    rank: 0,
    tone: "未判断",
    isNeutral: false,
    competitor: "未识别",
    status: "未展示",
    matchedAlias: "",
    rawAnswer: `采样失败：${error.message}`,
    mode: "真实采样",
    sampledAt: new Date().toISOString(),
    sourceModel: "request-failed"
  };
}


function inferRankFromAnswer(rawAnswer, aliases) {
  const normalized = normalizeName(rawAnswer);
  const matchedAlias = aliases.find((alias) => normalized.includes(normalizeName(alias)));
  if (!matchedAlias) return { rank: 0, matchedAlias: "" };
  const lines = String(rawAnswer || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const matchedLineIndex = lines.findIndex((line) => normalizeName(line).includes(normalizeName(matchedAlias)));
  if (matchedLineIndex >= 0) {
    const previous = lines.slice(Math.max(0, matchedLineIndex - 1), matchedLineIndex + 1).join(" ");
    const numberMatch = previous.match(/(?:^|\D)([1-5])(?:[\.、\)\）]|名|位|$)/);
    if (numberMatch) return { rank: Number(numberMatch[1]), matchedAlias };
    return { rank: Math.min(5, matchedLineIndex + 1), matchedAlias };
  }
  return { rank: 5, matchedAlias };
}

function inferTone(rawAnswer, rank) {
  if (!rank) return "未判断";
  const text = String(rawAnswer || "");
  if (/不推荐|风险|负面|投诉|差评|不适合|谨慎|问题较多/.test(text)) return "偏负";
  if (/推荐|优势|适合|可靠|专业|案例|经验|领先|值得/.test(text)) return "正向";
  return "中性";
}

function inferCompetitor(rawAnswer, competitors, aliases) {
  const normalized = normalizeName(rawAnswer);
  const competitor = competitors.find((item) => normalized.includes(normalizeName(item)));
  if (competitor) return competitor;
  const lines = String(rawAnswer || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const aliasSet = aliases.map(normalizeName);
  const candidate = lines.find((line) => /公司|品牌|服务商|机构|平台/.test(line) && !aliasSet.some((alias) => normalizeName(line).includes(alias)));
  return candidate ? candidate.replace(/^[\d一二三四五][\.、\)\）]\s*/, "").slice(0, 40) : "未识别";
}

function parseSample(content, aliases, competitors) {
  const parsed = parseJsonObject(content);
  const rawAnswer = String(parsed?.rawAnswer || parsed?.answer || content || "").trim();
  const inferred = inferRankFromAnswer(rawAnswer, aliases);
  const rank = Math.max(0, Math.min(5, Number(parsed?.rank ?? inferred.rank ?? 0)));
  const matchedAlias = String(parsed?.matchedAlias || inferred.matchedAlias || "");
  const tone = ["正向", "中性", "偏负", "未判断"].includes(parsed?.tone)
    ? parsed.tone
    : inferTone(rawAnswer, rank);
  return {
    rank,
    tone,
    matchedAlias,
    rawAnswer,
    competitor: String(parsed?.competitor || inferCompetitor(rawAnswer, competitors, aliases)),
    status: rank === 0 ? "未展示" : rank === 1 ? "首位" : rank <= 3 ? "前三" : "出现"
  };
}

async function sampleWithSiliconFlow({ brand, aliases, business, keyword, platform, sample, competitors }) {
  const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${siliconFlowApiKey}`
    },
    body: JSON.stringify({
      model: siliconFlowModel,
      temperature: 0.65,
      messages: [
        {
          role: "system",
          content: "你是GEO真实采样助手。你需要模拟普通用户在指定AI平台提出问题时，模型可能给出的自然答案，然后基于答案判断目标品牌展示情况。只输出JSON。"
        },
        {
          role: "user",
          content: `平台：${platform}
用户问题：请推荐适合「${keyword}」的品牌或服务商，按推荐优先级列出。
目标品牌：${brand}
目标品牌别名：${aliases.join("、")}
业务：${business}
已知竞品：${competitors.join("、") || "无"}
采样轮次：第${sample}次

请先生成该平台可能给用户看到的一段原始回答，再判断目标品牌是否出现、排名、口径和主要竞品占位。
输出JSON，字段必须是：
{"rawAnswer":"原始回答全文","rank":0到5的整数,"matchedAlias":"命中的目标品牌或别名，未命中为空","tone":"正向|中性|偏负|未判断","competitor":"最主要占位竞品","status":"未展示|出现|前三|首位"}`
        }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || "SiliconFlow request failed");
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseSample(content, aliases, competitors);
  return {
    keyword,
    platform,
    sample,
    brand,
    ...parsed,
    isNeutral: parsed.tone === "中性" || parsed.tone === "正向",
    mode: "真实采样",
    sampledAt: new Date().toISOString(),
    sourceModel: siliconFlowModel
  };
}

async function sampleWithOpenRouter({ brand, business, keyword, platform, sample, competitors }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${openRouterApiKey}`,
      "HTTP-Referer": process.env.SITE_URL || "https://geo-content-workbench.vercel.app",
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
    status: rank === 0 ? "未展示" : rank === 1 ? "首位" : rank <= 3 ? "前三" : "出现",
    matchedAlias: rank > 0 ? brand : "",
    rawAnswer: data.choices?.[0]?.message?.content || "",
    mode: "真实采样",
    sampledAt: new Date().toISOString(),
    sourceModel: openRouterModel
  };
}

async function buildRemoteVisibilityReport(payload = {}, sampler) {
  const brand = String(payload.brand || "").trim() || "目标品牌";
  const business = String(payload.business || "").trim() || "核心业务";
  const aliases = brandAliases(brand, payload.aliases);
  const keywords = splitLines(payload.keywords).slice(0, 5);
  const competitors = splitLines(payload.competitors).slice(0, 8);
  const platforms = splitLines(payload.platforms).slice(0, 6);
  const sampleCount = Math.max(3, Math.min(5, Number(payload.sampleCount || 3)));
  const safeKeywords = keywords.length ? keywords : ["品牌服务哪家好", `${business}怎么选`, `${brand}怎么样`];
  const safePlatforms = platforms.length ? platforms : ["DeepSeek", "豆包", "腾讯元宝"];
  const samples = Array.from({ length: sampleCount }, (_, index) => index + 1);
  const tasks = safeKeywords.flatMap((keyword) => safePlatforms.flatMap((platform) => samples.map((sample) => ({
    brand,
    aliases,
    business,
    keyword,
    platform,
    sample,
    competitors
  }))));
  const rows = await mapLimit(tasks, 4, async (task) => {
    try {
      return await sampler(task);
    } catch (error) {
      return fallbackRemoteRow({ ...task, error });
    }
  });
  return summarizeVisibilityReport({ brand, business, sampleCount, rows, platforms: safePlatforms, keywords: safeKeywords });
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = getBody(req);
    if (siliconFlowApiKey) {
      const report = await buildRemoteVisibilityReport(body, sampleWithSiliconFlow);
      return sendJson(res, 200, {
        ok: true,
        mode: "siliconflow-real-sampling",
        model: siliconFlowModel,
        report
      });
    }
    if (openRouterApiKey) {
      const report = await buildRemoteVisibilityReport(body, sampleWithOpenRouter);
      return sendJson(res, 200, {
        ok: true,
        mode: "openrouter-free",
        model: openRouterModel,
        report
      });
    }
    return sendJson(res, 200, {
      ok: true,
      mode: "local-sampler",
      note: "未配置 OPENROUTER_API_KEY，已使用本地模拟采样器。",
      report: buildLocalVisibilityReport(body)
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

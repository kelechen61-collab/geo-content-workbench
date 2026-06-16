import { applyCors, getBody, sendJson } from "./_shared.js";

const siliconFlowApiKey = process.env.SILICONFLOW_API_KEY || "";
const siliconFlowModel = process.env.SILICONFLOW_VISIBILITY_MODEL || "deepseek-ai/DeepSeek-V3";
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "deepseek/deepseek-chat-v3-0324:free";

const doubaoApiKey = process.env.DOUBAO_API_KEY || "";
const doubaoBaseUrl = process.env.DOUBAO_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const doubaoModel = process.env.DOUBAO_MODEL || "";

const tongyiApiKey = process.env.DASHSCOPE_API_KEY || process.env.TONGYI_API_KEY || "";
const tongyiBaseUrl = process.env.TONGYI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const tongyiModel = process.env.TONGYI_MODEL || "qwen-plus";

const kimiApiKey = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || "";
const kimiBaseUrl = process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1";
const kimiModel = process.env.KIMI_MODEL || "moonshot-v1-8k";

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
    .replace(/[\s·・.。,“”，,、（）()【】\[\]「」《》\-_/\\|:：]/g, "");
}

function brandAliases(brand, aliases) {
  return [...new Set([brand, ...splitLines(aliases)].map((item) => String(item).trim()).filter(Boolean))];
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
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

function inferRankFromAnswer(rawAnswer, aliases) {
  const normalized = normalizeName(rawAnswer);
  const matchedAlias = aliases.find((alias) => normalizeName(alias) && normalized.includes(normalizeName(alias)));
  if (!matchedAlias) return { rank: 0, matchedAlias: "" };

  const lines = String(rawAnswer || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const matchedLineIndex = lines.findIndex((line) => normalizeName(line).includes(normalizeName(matchedAlias)));
  if (matchedLineIndex >= 0) {
    const nearby = lines.slice(Math.max(0, matchedLineIndex - 1), matchedLineIndex + 1).join(" ");
    const numberMatch = nearby.match(/(?:^|\D)([1-5])(?:[\.、\)\）]|名|位|$)/);
    if (numberMatch) return { rank: Number(numberMatch[1]), matchedAlias };
    return { rank: Math.min(5, matchedLineIndex + 1), matchedAlias };
  }

  return { rank: 5, matchedAlias };
}

function inferTone(rawAnswer, rank) {
  if (!rank) return "未判断";
  const text = String(rawAnswer || "");
  if (/不推荐|风险|负面|投诉|差评|不适合|谨慎|问题较多|慎选/.test(text)) return "偏负";
  if (/推荐|优势|适合|可靠|专业|案例|经验|领先|值得|首选|优先/.test(text)) return "正向";
  return "中性";
}

function inferCompetitor(rawAnswer, competitors, aliases) {
  const normalized = normalizeName(rawAnswer);
  const competitor = competitors.find((item) => normalizeName(item) && normalized.includes(normalizeName(item)));
  if (competitor) return competitor;

  const aliasSet = aliases.map(normalizeName);
  const lines = String(rawAnswer || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => {
    const normalizedLine = normalizeName(line);
    return /公司|品牌|服务商|机构|平台/.test(line) && !aliasSet.some((alias) => alias && normalizedLine.includes(alias));
  });
  return candidate ? candidate.replace(/^[\d一二三四五][\.、\)\）]\s*/, "").slice(0, 40) : "未识别";
}

function parseSample(content, aliases, competitors) {
  const parsed = parseJsonObject(content);
  const rawAnswer = String(parsed?.rawAnswer || parsed?.answer || content || "").trim();
  const inferred = inferRankFromAnswer(rawAnswer, aliases);
  const parsedRank = Number(parsed?.rank);
  const rank = Math.max(0, Math.min(5, Number.isFinite(parsedRank) ? parsedRank : inferred.rank));
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

function chatEndpoint(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function makeSamplingPrompt({ brand, aliases, business, keyword, platform, sample, competitors }) {
  return `请推荐适合「${keyword}」的品牌或服务商，按推荐优先级列出 5 个，并说明每个推荐理由。

背景：
- 我正在评估「${business}」相关服务。
- 可参考品牌包括但不限于：${[brand, ...competitors].filter(Boolean).join("、") || "无"}。
- 如果你认为某个品牌不适合，也可以不推荐。

请直接给出用户在 ${platform} 中会看到的自然回答，不要输出 JSON，不要说明你在做检测。`;
}

async function sampleOpenAICompatible(task, provider) {
  const response = await fetch(chatEndpoint(provider.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.55,
      messages: [
        {
          role: "system",
          content: `你是${task.platform}中的问答助手。请像真实用户问答一样自然回答，给出清晰推荐排序和理由。`
        },
        {
          role: "user",
          content: makeSamplingPrompt(task)
        }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || `${provider.name} request failed`);
  const content = data.choices?.[0]?.message?.content || "";
  if (String(content).trim().length < 20) throw new Error(`${provider.name} returned empty answer`);
  const parsed = parseSample(content, task.aliases, task.competitors);
  return {
    keyword: task.keyword,
    platform: task.platform,
    sample: task.sample,
    brand: task.brand,
    ...parsed,
    isNeutral: parsed.tone === "中性" || parsed.tone === "正向",
    sampleQuality: "sampled",
    mode: "真实采样",
    sampledAt: new Date().toISOString(),
    sourceModel: provider.model,
    sourceProvider: provider.name
  };
}

function providerForPlatform(platform) {
  const name = String(platform || "").toLowerCase();

  if (/deepseek|硅基|silicon/.test(name)) {
    if (siliconFlowApiKey) {
      return {
        name: "硅基流动",
        model: siliconFlowModel,
        apiKey: siliconFlowApiKey,
        baseUrl: "https://api.siliconflow.cn/v1",
        note: "通过硅基流动 API 调用 DeepSeek 模型真实采样。"
      };
    }
    if (openRouterApiKey) {
      return {
        name: "OpenRouter",
        model: openRouterModel,
        apiKey: openRouterApiKey,
        baseUrl: "https://openrouter.ai/api/v1",
        note: "通过 OpenRouter 调用 DeepSeek 兼容模型采样。"
      };
    }
  }

  if (/豆包|doubao|火山|volc/.test(name) && doubaoApiKey && doubaoModel) {
    return {
      name: "豆包",
      model: doubaoModel,
      apiKey: doubaoApiKey,
      baseUrl: doubaoBaseUrl,
      note: "通过火山方舟 OpenAI-compatible API 调用豆包模型采样。"
    };
  }

  if (/通义|qwen|千问|tongyi/.test(name) && tongyiApiKey) {
    return {
      name: "通义千问",
      model: tongyiModel,
      apiKey: tongyiApiKey,
      baseUrl: tongyiBaseUrl,
      note: "通过 DashScope 兼容 API 调用通义千问采样。"
    };
  }

  if (/kimi|moonshot/.test(name) && kimiApiKey) {
    return {
      name: "Kimi",
      model: kimiModel,
      apiKey: kimiApiKey,
      baseUrl: kimiBaseUrl,
      note: "通过 Moonshot API 调用 Kimi 模型采样。"
    };
  }

  return null;
}

function unavailableRow({ brand, keyword, platform, sample }) {
  return {
    keyword,
    platform,
    sample,
    brand,
    rank: null,
    tone: "未判断",
    isNeutral: false,
    competitor: "未采样",
    status: "未接入",
    matchedAlias: "",
    rawAnswer: "",
    sampleQuality: "unavailable",
    mode: "未接入",
    sampledAt: new Date().toISOString(),
    sourceModel: "not-configured",
    sourceProvider: "not-configured"
  };
}

function failedRow({ brand, keyword, platform, sample, error, provider }) {
  return {
    keyword,
    platform,
    sample,
    brand,
    rank: null,
    tone: "未判断",
    isNeutral: false,
    competitor: "未识别",
    status: "采样失败",
    matchedAlias: "",
    rawAnswer: `采样失败：${error.message}`,
    sampleQuality: "failed",
    mode: "真实采样失败",
    sampledAt: new Date().toISOString(),
    sourceModel: provider?.model || "request-failed",
    sourceProvider: provider?.name || "request-failed"
  };
}

function summarizeVisibilityReport({ brand, business, sampleCount, rows, platforms, keywords, providerNotes, truncatedKeywords }) {
  const validRows = rows.filter((row) => row.sampleQuality === "sampled");
  const failedRows = rows.filter((row) => row.sampleQuality === "failed");
  const unavailableRows = rows.filter((row) => row.sampleQuality === "unavailable");
  const total = validRows.length;
  const mentioned = validRows.filter((row) => row.rank > 0).length;
  const top3 = validRows.filter((row) => row.rank > 0 && row.rank <= 3).length;
  const first = validRows.filter((row) => row.rank === 1).length;
  const rankedRows = validRows.filter((row) => row.rank > 0);
  const neutral = rankedRows.filter((row) => row.isNeutral).length;
  const avgRankValue = rankedRows.length
    ? (rankedRows.reduce((sum, row) => sum + row.rank, 0) / rankedRows.length).toFixed(1)
    : "-";

  const platformStats = platforms.map((platform) => {
    const items = rows.filter((row) => row.platform === platform);
    const sampled = items.filter((row) => row.sampleQuality === "sampled");
    const appeared = sampled.filter((row) => row.rank > 0);
    const unavailable = items.filter((row) => row.sampleQuality === "unavailable").length;
    const failed = items.filter((row) => row.sampleQuality === "failed").length;
    return {
      platform,
      mentionRate: percent(appeared.length, sampled.length),
      top3Rate: percent(sampled.filter((row) => row.rank > 0 && row.rank <= 3).length, sampled.length),
      firstRate: percent(sampled.filter((row) => row.rank === 1).length, sampled.length),
      neutralRate: percent(appeared.filter((row) => row.isNeutral).length, appeared.length),
      validSamples: sampled.length,
      failedSamples: failed,
      unavailableSamples: unavailable,
      requestedSamples: items.length,
      status: sampled.length ? "已采样" : failed ? "采样失败" : "未接入"
    };
  });

  const weakRows = validRows.filter((row) => row.rank === 0 || row.rank > 3);
  const weakKeywords = [...new Set(weakRows.map((row) => row.keyword))].slice(0, 4);
  const unavailablePlatforms = [...new Set(unavailableRows.map((row) => row.platform))];
  const findings = [
    total
      ? `本次共有 ${total} 条真实有效样本参与统计，未接入或失败样本未计入展示率。`
      : "当前没有可用真实样本，不能给出有效展示率判断。请先配置至少一个平台 API。",
    truncatedKeywords > 0
      ? `同步采样为避免超时，当前只检测前 ${keywords.length} 个关键词；还有 ${truncatedKeywords} 个关键词建议分批检测。`
      : `本次同步检测关键词数：${keywords.length} 个。`,
    unavailablePlatforms.length
      ? `未接入平台：${unavailablePlatforms.join("、")}。这些平台需要配置官方/兼容 API 或导入原始回答后再统计。`
      : "已选平台均产生了真实采样或明确失败记录。",
    `优先补强关键词：${weakKeywords.length ? weakKeywords.join("、") : keywords.slice(0, 3).join("、")}。`,
    `把“${brand} + ${business}”整理成标准答案页，配合品牌别名库，减少 AI 漏识别。`
  ];

  const mentionRate = percent(mentioned, total);
  const tag = !total ? "无有效样本" : mentionRate >= 75 ? "展示基础较好" : mentionRate >= 45 ? "存在展示缺口" : "展示明显不足";
  const providerSummary = providerNotes.length ? [...new Set(providerNotes)].join("；") : "未配置可用真实采样平台。";

  return {
    brand,
    business,
    sampleCount,
    rows,
    platformStats,
    mentionRate,
    top3Rate: percent(top3, total),
    firstRate: percent(first, total),
    neutralRate: percent(neutral, rankedRows.length),
    avgRank: avgRankValue,
    findings,
    tag,
    mode: total ? "真实采样检测" : "无有效真实样本",
    evidenceNote: `真实样本：${total} 条；采样失败：${failedRows.length} 条；未接入：${unavailableRows.length} 条。${providerSummary}`,
    methodology: {
      requestedSamples: rows.length,
      validSamples: total,
      failedSamples: failedRows.length,
      unavailableSamples: unavailableRows.length,
      keywordLimit: keywords.length,
      truncatedKeywords,
      metricRule: "展示率、前三率、首位率、中正率只用 sampleQuality=sampled 的真实样本计算；未接入和失败样本只计入覆盖率，不计入表现指标。同步模式为避免超时，会优先采样前 2 个关键词。"
    },
    generatedAt: new Date().toISOString()
  };
}

async function buildRealVisibilityReport(payload = {}) {
  const brand = String(payload.brand || "").trim() || "目标品牌";
  const business = String(payload.business || "").trim() || "核心业务";
  const aliases = brandAliases(brand, payload.aliases);
  const allKeywords = splitLines(payload.keywords);
  const maxSyncKeywords = Math.max(1, Math.min(3, Number(process.env.REAL_SAMPLING_MAX_KEYWORDS || 2)));
  const keywords = allKeywords.slice(0, maxSyncKeywords);
  const competitors = splitLines(payload.competitors).slice(0, 10);
  const platforms = splitLines(payload.platforms).slice(0, 8);
  const sampleCount = Math.max(3, Math.min(5, Number(payload.sampleCount || 3)));
  const safeKeywords = keywords.length ? keywords : ["品牌服务哪家好", `${business}怎么选`, `${brand}怎么样`];
  const safePlatforms = platforms.length ? platforms : ["DeepSeek"];
  const samples = Array.from({ length: sampleCount }, (_, index) => index + 1);
  const providerNotes = [];

  const tasks = safeKeywords.flatMap((keyword) => safePlatforms.flatMap((platform) => samples.map((sample) => ({
    brand,
    aliases,
    business,
    keyword,
    platform,
    sample,
    competitors
  }))));

  const rows = await mapLimit(tasks, 3, async (task) => {
    const provider = providerForPlatform(task.platform);
    if (!provider) return unavailableRow(task);
    providerNotes.push(`${task.platform}：${provider.note}`);
    try {
      return await sampleOpenAICompatible(task, provider);
    } catch (error) {
      return failedRow({ ...task, error, provider });
    }
  });

  return summarizeVisibilityReport({
    brand,
    business,
    sampleCount,
    rows,
    platforms: safePlatforms,
    keywords: safeKeywords,
    providerNotes,
    truncatedKeywords: Math.max(0, allKeywords.length - safeKeywords.length)
  });
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = getBody(req);
    const report = await buildRealVisibilityReport(body);
    return sendJson(res, 200, {
      ok: true,
      mode: "real-sampling-system",
      report
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

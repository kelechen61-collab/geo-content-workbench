import { applyCors, getBody, sendJson } from "./_shared.js";

const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "openrouter/free";

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

function buildLocalVisibilityReport(payload = {}) {
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

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = getBody(req);
    if (openRouterApiKey) {
      const report = await buildOpenRouterVisibilityReport(body);
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

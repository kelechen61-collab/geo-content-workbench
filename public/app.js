const $ = (id) => document.getElementById(id);

const fieldWeights = {
  companyName: 9,
  website: 10,
  business: 12,
  keywords: 16,
  competitors: 10,
  assets: 18
};

const industryProfiles = {
  saas: { name: "SaaS / 企业服务", pressure: 5, trustNeed: "案例、集成能力、ROI 数据" },
  retail: { name: "零售 / 加盟", pressure: 8, trustNeed: "门店数量、回本周期、加盟政策" },
  medical: { name: "医疗 / 健康", pressure: 10, trustNeed: "资质、专家背书、合规说明" },
  education: { name: "教育 / 培训", pressure: 7, trustNeed: "课程体系、师资、学员结果" },
  manufacturing: { name: "制造 / B2B", pressure: 6, trustNeed: "产能、认证、交付案例" },
  finance: { name: "金融 / 保险", pressure: 10, trustNeed: "牌照、风控、合规披露" },
  local: { name: "本地生活 / 门店", pressure: 6, trustNeed: "门店评价、服务范围、价格口径" }
};

const demoData = {
  companyName: "云栖增长科技",
  website: "https://www.example-geo.cn",
  industry: "saas",
  business: "面向连锁品牌和企业服务公司的 GEO / AEO 内容优化服务",
  keywords: "GEO 服务\nAI 搜索优化\nChatGPT 品牌推荐\n生成式搜索引擎优化",
  competitors: "传统 SEO 代运营\n内容营销机构\nAI 问答优化顾问",
  assets: "官网有服务介绍、3 个客户案例、公众号文章 28 篇、1 份行业白皮书、销售 FAQ 文档"
};

const visibilityDemoData = {
  targetBrand: "云栖增长科技",
  brandAliases: "云栖增长, 云栖GEO",
  visibilityBusiness: "GEO / AEO 内容优化服务",
  visibilityKeywords: "GEO 服务哪家好\nAI 搜索优化公司",
  visibilityCompetitors: "传统 SEO 代运营\n内容营销机构\nAI 问答优化顾问\n增长咨询公司"
};

const state = {
  report: null,
  activeView: "risks",
  visibilityReport: null,
  activePage: "visibilityPage"
};

function lines(value) {
  return value
    .split(/\n|,|，|、/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function fieldScore(id) {
  const el = $(id);
  const value = (el?.value || "").trim();
  if (!value) return 0;
  if (id === "keywords" || id === "competitors") return Math.min(fieldWeights[id], lines(value).length * 4);
  if (id === "assets") return Math.min(fieldWeights[id], Math.ceil(value.length / 16) + lines(value).length * 3);
  if (id === "website") return /^https?:\/\/.+\..+/.test(value) ? fieldWeights[id] : 5;
  return Math.min(fieldWeights[id], Math.ceil(value.length / 3));
}

function buildReport() {
  const industry = industryProfiles[$("industry").value] || industryProfiles.saas;
  const keywordList = lines($("keywords").value);
  const competitorList = lines($("competitors").value);
  const assetText = $("assets").value.trim();
  const assetList = lines(assetText);
  const business = $("business").value.trim() || "核心业务";
  const company = $("companyName").value.trim() || "该公司";

  const base = Object.keys(fieldWeights).reduce((sum, id) => sum + fieldScore(id), 24);
  const evidenceBonus = /案例|客户|数据|白皮书|资质|认证|媒体|报告|评价|FAQ/i.test(assetText) ? 10 : 0;
  const pressurePenalty = Math.max(0, industry.pressure - competitorList.length) * 2;
  const score = Math.max(18, Math.min(96, base + evidenceBonus - pressurePenalty));

  const metrics = [
    {
      name: "实体清晰度",
      value: fieldScore("companyName") + fieldScore("website") + fieldScore("business"),
      max: 31,
      note: "AI 能否识别品牌是谁、做什么、官网在哪里"
    },
    {
      name: "问题覆盖",
      value: Math.min(28, keywordList.length * 7),
      max: 28,
      note: "是否覆盖用户会问 AI 的高意向问题"
    },
    {
      name: "可信证据",
      value: Math.min(24, fieldScore("assets") + evidenceBonus),
      max: 24,
      note: `当前行业更需要：${industry.trustNeed}`
    },
    {
      name: "竞品压力",
      value: Math.max(4, 22 - industry.pressure - competitorList.length * 2),
      max: 22,
      note: "分数越低，越容易被竞品或泛行业答案稀释"
    }
  ];

  const risks = [
    score < 55 ? "品牌基础事实不足，AI 很难稳定判断公司定位与服务边界。" : "品牌基础事实已有雏形，但仍需要统一标准口径。",
    keywordList.length < 4 ? "高意向问题覆盖偏少，容易只出现在泛关键词内容里。" : "关键词覆盖较完整，下一步要拆成问答型内容资产。",
    evidenceBonus ? "已有证据素材可用，但需要整理成可引用的案例、数据和 FAQ。" : "可信证据不足，AI 推荐时缺少可验证理由。",
    competitorList.length ? "竞品已被纳入判断，建议做对比型和替代方案型内容。" : "尚未输入竞品，难以判断客户在 AI 答案中的相对位置。"
  ];

  const assets = [
    `品牌标准答案：${company} 是谁、服务什么客户、解决什么问题。`,
    `业务解释页：围绕“${business}是什么、适合谁、怎么做、多少钱、效果如何”展开。`,
    `证据资产：把${assetList.length ? assetList.slice(0, 3).join("、") : "案例、数据、资质、媒体报道"}改写成 AI 可摘取段落。`,
    `FAQ 资产：补齐价格、周期、适配行业、与竞品区别、交付物等问题。`
  ];

  const actions = [
    "第 1 周：统一官网、销售资料、百科/媒体中的品牌事实和服务定义。",
    "第 2 周：选择 6-10 个高意向问题，生成直接答案型内容。",
    "第 3 周：补充案例、数据、资质和客户评价，形成可信证据库。",
    "第 4 周：做竞品对比、替代方案和行业误区内容，提升 AI 推荐理由。"
  ];

  const queries = [
    `${business}哪家公司比较靠谱？`,
    `${company}是做什么的？适合什么客户？`,
    `${business}一般多少钱，效果怎么评估？`,
    `${company}和${competitorList[0] || "传统服务商"}有什么区别？`,
    `如果我要做${keywordList[0] || "GEO"}，第一步应该检查什么？`
  ];

  return {
    company,
    score,
    industry,
    metrics,
    risks,
    assets,
    actions,
    queries,
    title: getScoreTitle(score),
    tag: score >= 80 ? "可进入方案沟通" : score >= 60 ? "需补强证据" : "需先做基础修复"
  };
}

function getScoreTitle(score) {
  if (score >= 80) return "具备 GEO 基础，可推进方案沟通";
  if (score >= 60) return "可被 AI 理解，但推荐理由不足";
  if (score >= 40) return "品牌事实不稳，内容资产需要重组";
  return "生成式搜索可见度偏弱，建议先做基础修复";
}

function setScore(score) {
  const ring = document.querySelector(".score-ring");
  ring.style.setProperty("--score", `${score * 3.6}deg`);
  $("scoreValue").textContent = score;
}

function renderMetrics(metrics) {
  $("metricGrid").innerHTML = metrics.map((metric) => {
    const percent = Math.round((metric.value / metric.max) * 100);
    return `
      <article class="metric-card">
        <div class="metric-top">
          <h3>${escapeHtml(metric.name)}</h3>
          <strong>${percent}</strong>
        </div>
        <div class="bar"><span style="width:${percent}%"></span></div>
        <p>${escapeHtml(metric.note)}</p>
      </article>
    `;
  }).join("");
}

function renderQueries(queries) {
  $("queryList").innerHTML = queries.map((query, index) => `
    <div class="query-item">
      <span>Q${index + 1}</span>
      <p>${escapeHtml(query)}</p>
    </div>
  `).join("");
}

function renderReportView() {
  if (!state.report) return;
  const items = state.report[state.activeView];
  $("reportContent").innerHTML = items.map((item, index) => `
    <article class="finding">
      <span>${index + 1}</span>
      <p>${escapeHtml(item)}</p>
    </article>
  `).join("");
}

function renderReport(report) {
  state.report = report;
  setScore(report.score);
  $("scoreTitle").textContent = report.title;
  $("scoreNote").textContent = `${report.company} 当前处于「${report.industry.name}」场景，首轮重点是让 AI 先理解品牌事实，再补足推荐证据。`;
  $("reportTag").textContent = report.tag;
  $("reportTag").classList.toggle("warn", report.score < 80);
  $("pitchText").textContent = `初步看，${report.company} 的 GEO 工作不应只做关键词排名，而要把官网、案例、FAQ 和第三方素材整理成 AI 能直接引用的标准答案。建议先用 2-4 周完成基础修复，再进入内容扩张。`;
  renderMetrics(report.metrics);
  renderQueries(report.queries);
  renderReportView();
}

function fillForm(data) {
  for (const [key, value] of Object.entries(data)) {
    const el = $(key);
    if (el) el.value = value;
  }
}

function resetForm() {
  document.querySelectorAll("input, textarea").forEach((el) => {
    el.value = "";
  });
  $("industry").value = "saas";
  renderReport(buildReport());
}

function reportText(report) {
  return [
    `GEO 初轮检测报告：${report.company}`,
    `评分：${report.score}/100`,
    `结论：${report.title}`,
    "",
    "主要风险：",
    ...report.risks.map((item, index) => `${index + 1}. ${item}`),
    "",
    "建议建设资产：",
    ...report.assets.map((item, index) => `${index + 1}. ${item}`),
    "",
    "下一步行动：",
    ...report.actions.map((item, index) => `${index + 1}. ${item}`)
  ].join("\n");
}

function selectedPlatforms() {
  return [...document.querySelectorAll('input[name="platform"]:checked')].map((item) => item.value);
}

function setPlatforms(platforms) {
  document.querySelectorAll('input[name="platform"]').forEach((item) => {
    item.checked = platforms.includes(item.value);
  });
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function buildVisibilityReport() {
  const brand = $("targetBrand").value.trim() || "目标品牌";
  const business = $("visibilityBusiness").value.trim() || "核心业务";
  const keywords = lines($("visibilityKeywords").value);
  const competitors = lines($("visibilityCompetitors").value);
  const platforms = selectedPlatforms();
  const sampleCount = Math.max(3, Math.min(5, Number($("sampleCount").value || 3)));
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
      matchedAlias: rank > 0 ? brand : "",
      rawAnswer: "",
      mode: "模拟检测",
      sampledAt: new Date().toISOString(),
      sourceModel: "local-rule-sampler"
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
    return {
      platform,
      mentionRate: percent(items.filter((row) => row.rank > 0).length, items.length),
      top3Rate: percent(items.filter((row) => row.rank > 0 && row.rank <= 3).length, items.length),
      firstRate: percent(items.filter((row) => row.rank === 1).length, items.length),
      neutralRate: percent(items.filter((row) => row.rank > 0 && row.isNeutral).length, items.filter((row) => row.rank > 0).length)
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
    mode: "模拟检测",
    evidenceNote: "当前为规则化模拟结果，用于销售初筛，不等同于真实平台搜索结果。",
    generatedAt: new Date().toISOString()
  };
}

function renderPlatformCards(stats) {
  $("platformCards").innerHTML = stats.map((item) => `
    <article class="platform-card ${item.status === "未接入" ? "unavailable" : item.status === "采样失败" ? "failed" : ""}">
      <div class="metric-top">
        <h3>${escapeHtml(item.platform)}</h3>
        <strong>${item.status === "已采样" || !item.status ? `${item.mentionRate}%` : escapeHtml(item.status)}</strong>
      </div>
      <p class="sample-meta">有效 ${item.validSamples ?? "-"} / 失败 ${item.failedSamples ?? 0} / 未接入 ${item.unavailableSamples ?? 0}</p>
      <div class="platform-bars">
        <p><span>展示</span><i><b style="width:${item.mentionRate}%"></b></i></p>
        <p><span>前三</span><i><b style="width:${item.top3Rate}%"></b></i></p>
        <p><span>首位</span><i><b style="width:${item.firstRate}%"></b></i></p>
        <p><span>中正</span><i><b style="width:${item.neutralRate}%"></b></i></p>
      </div>
    </article>
  `).join("");
}

function renderVisibilityRows(rows) {
  $("visibilityRows").innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.keyword)}</td>
      <td>${escapeHtml(row.platform)}</td>
      <td>第 ${row.sample || 1} 次</td>
      <td>${escapeHtml(row.brand)}</td>
      <td>${row.rank ? `第 ${row.rank} 位` : "-"}</td>
      <td><span class="tone-badge ${row.tone === "偏负" ? "negative" : row.tone === "正向" ? "positive" : ""}">${escapeHtml(row.tone)}</span></td>
      <td>${escapeHtml(row.competitor)}</td>
      <td><span class="rank-badge ${row.sampleQuality === "unavailable" ? "unavailable" : row.sampleQuality === "failed" ? "failed" : row.rank === 0 ? "miss" : row.rank === 1 ? "first" : row.rank <= 3 ? "top" : ""}">${escapeHtml(row.status)}</span></td>
      <td>${escapeHtml(row.matchedAlias || "-")}</td>
      <td>
        ${row.rawAnswer
          ? `<details><summary>查看证据</summary><p>${escapeHtml(row.rawAnswer)}</p><small>${escapeHtml(row.sampledAt || "")} · ${escapeHtml(row.sourceModel || row.mode || "")}</small></details>`
          : `<span class="muted-cell">${row.sampleQuality === "unavailable" ? "平台未接入，暂无原文" : "暂无原文"}</span>`}
      </td>
    </tr>
  `).join("");
}

function renderVisibilityReport(report) {
  state.visibilityReport = report;
  $("visibilityTitle").textContent = `${report.brand} 在 AI 答案中的展示情况`;
  $("mentionRate").textContent = `${report.mentionRate}%`;
  $("top3Rate").textContent = `${report.top3Rate}%`;
  $("firstRate").textContent = `${report.firstRate}%`;
  $("neutralRate").textContent = `${report.neutralRate}%`;
  $("avgRank").textContent = report.avgRank;
  $("visibilityTag").textContent = report.tag;
  $("visibilityTag").classList.toggle("warn", report.mentionRate < 75 || !report.methodology?.validSamples);
  $("samplingMode").textContent = `当前模式：${report.mode || "模拟检测"}`;
  $("samplingMode").classList.toggle("real", String(report.mode || "").includes("真实"));
  $("samplingMeta").textContent = report.methodology
    ? `有效样本：${report.methodology.validSamples} / 请求样本：${report.methodology.requestedSamples} / 未接入：${report.methodology.unavailableSamples} / 失败：${report.methodology.failedSamples}`
    : `采样数：${report.rows.length} 条 · 生成时间：${report.generatedAt ? new Date(report.generatedAt).toLocaleString("zh-CN") : "-"}`;
  $("evidenceNote").textContent = report.evidenceNote || "已生成检测结果。";
  $("visibilityPitch").textContent = report.methodology?.validSamples
    ? `${report.brand} 当前按每个平台 ${report.sampleCount || 3} 次采样跑数，有效真实样本 ${report.methodology.validSamples} 条，展示率为 ${report.mentionRate}%，前三率为 ${report.top3Rate}%，首位率为 ${report.firstRate}%。未接入和失败样本没有混入表现指标。`
    : `${report.brand} 当前没有可用真实样本，不能判断展示率。请先配置 DeepSeek/豆包/通义/Kimi 等平台 API，或导入平台原始回答后再统计。`;
  renderPlatformCards(report.platformStats);
  renderVisibilityRows(report.rows);
  $("visibilityFindings").innerHTML = report.findings.map((item, index) => `
    <article class="finding">
      <span>${index + 1}</span>
      <p>${escapeHtml(item)}</p>
    </article>
  `).join("");
}

function fillVisibilityForm(data) {
  for (const [key, value] of Object.entries(data)) {
    const el = $(key);
    if (el) el.value = value;
  }
  setPlatforms(["DeepSeek", "豆包"]);
  $("sampleCount").value = "3";
}

function resetVisibilityForm() {
  ["targetBrand", "brandAliases", "visibilityBusiness", "visibilityKeywords", "visibilityCompetitors"].forEach((id) => {
    $(id).value = "";
  });
  setPlatforms(["DeepSeek", "豆包"]);
  $("sampleCount").value = "3";
  renderVisibilityReport(buildVisibilityReport());
}

function visibilityReportText(report) {
  return [
    `GEO 关键词展示检测：${report.brand}`,
    `展示率：${report.mentionRate}%`,
    `前三率：${report.top3Rate}%`,
    `首位率：${report.firstRate}%`,
    `中正率：${report.neutralRate}%`,
    `平均名次：${report.avgRank}`,
    `检测模式：${report.mode || "模拟检测"}`,
    `生成时间：${report.generatedAt || "-"}`,
    `采样次数：每个平台 ${report.sampleCount || 3} 次`,
    report.methodology
      ? `样本口径：有效 ${report.methodology.validSamples} / 请求 ${report.methodology.requestedSamples} / 失败 ${report.methodology.failedSamples} / 未接入 ${report.methodology.unavailableSamples}`
      : "",
    `证据说明：${report.evidenceNote || "-"}`,
    report.methodology?.metricRule ? `统计规则：${report.methodology.metricRule}` : "",
    "",
    "平台表现：",
    ...report.platformStats.map((item) => `${item.platform}：${item.status || "已采样"} / 有效样本 ${item.validSamples ?? "-"} / 展示率 ${item.mentionRate}% / 前三率 ${item.top3Rate}% / 首位率 ${item.firstRate}% / 中正率 ${item.neutralRate}%`),
    "",
    "优先修复方向：",
    ...report.findings.map((item, index) => `${index + 1}. ${item}`)
  ].join("\n");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadVisibilityCsv(report) {
  const header = ["关键词", "AI平台", "采样", "目标品牌", "排名", "口径", "竞品占位", "状态", "命中别名", "检测模式", "采样时间", "来源模型", "原始回答"];
  const rows = report.rows.map((row) => [
    row.keyword,
    row.platform,
    `第 ${row.sample || 1} 次`,
    row.brand,
    row.rank ? `第 ${row.rank} 位` : "-",
    row.tone,
    row.competitor,
    row.status,
    row.matchedAlias || "",
    row.mode || report.mode || "",
    row.sampledAt || "",
    row.sourceModel || "",
    row.rawAnswer || ""
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.brand}-GEO关键词展示明细.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function switchPage(pageId) {
  state.activePage = pageId;
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".page-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.page === pageId));
  document.querySelectorAll(".page-action").forEach((action) => {
    const isAudit = pageId === "auditPage" && action.dataset.action.startsWith("audit");
    const isVisibility = pageId === "visibilityPage" && action.dataset.action.startsWith("visibility");
    action.classList.toggle("active", isAudit || isVisibility);
  });
}

async function runVisibilityAudit() {
  const button = $("runVisibilityBtn");
  button.disabled = true;
  button.textContent = "真实采样中...";
  try {
    const response = await fetch("/api/visibility-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brand: $("targetBrand").value.trim(),
        aliases: lines($("brandAliases").value),
        business: $("visibilityBusiness").value.trim(),
        keywords: lines($("visibilityKeywords").value),
        competitors: lines($("visibilityCompetitors").value),
        platforms: selectedPlatforms(),
        sampleCount: Number($("sampleCount").value || 3)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "后台跑数失败");
    renderVisibilityReport(data.report);
  } catch (error) {
    const failedReport = {
      brand: $("targetBrand").value.trim() || "目标品牌",
      business: $("visibilityBusiness").value.trim() || "核心业务",
      sampleCount: Number($("sampleCount").value || 3),
      rows: [],
      platformStats: selectedPlatforms().map((platform) => ({
        platform,
        mentionRate: 0,
        top3Rate: 0,
        firstRate: 0,
        neutralRate: 0,
        validSamples: 0,
        failedSamples: 0,
        unavailableSamples: 0,
        requestedSamples: 0,
        status: "采样失败"
      })),
      mentionRate: 0,
      top3Rate: 0,
      firstRate: 0,
      neutralRate: 0,
      avgRank: "-",
      findings: ["真实采样请求失败，请检查 API 配置、网络或 Vercel 函数日志。", `错误信息：${error.message}`],
      tag: "采样失败",
      mode: "真实采样失败",
      evidenceNote: "没有生成模拟兜底结果，避免误导数据判断。",
      methodology: {
        requestedSamples: 0,
        validSamples: 0,
        failedSamples: 0,
        unavailableSamples: 0
      },
      generatedAt: new Date().toISOString()
    };
    renderVisibilityReport(failedReport);
  } finally {
    button.disabled = false;
    button.textContent = "开始真实采样";
  }
}

function bindEvents() {
  $("auditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    renderReport(buildReport());
  });
  $("demoBtn").addEventListener("click", () => {
    fillForm(demoData);
    renderReport(buildReport());
  });
  $("resetBtn").addEventListener("click", resetForm);
  $("visibilityForm").addEventListener("submit", (event) => {
    event.preventDefault();
    runVisibilityAudit();
  });
  $("visibilityDemoBtn").addEventListener("click", () => {
    fillVisibilityForm(visibilityDemoData);
    renderVisibilityReport(buildVisibilityReport());
  });
  $("visibilityResetBtn").addEventListener("click", resetVisibilityForm);
  $("copyVisibilityBtn").addEventListener("click", async () => {
    if (!state.visibilityReport) return;
    await navigator.clipboard.writeText(visibilityReportText(state.visibilityReport));
    $("copyVisibilityBtn").textContent = "已复制";
    setTimeout(() => {
      $("copyVisibilityBtn").textContent = "复制报告";
    }, 1200);
  });
  $("downloadVisibilityBtn").addEventListener("click", () => {
    if (!state.visibilityReport) return;
    downloadVisibilityCsv(state.visibilityReport);
  });
  document.querySelectorAll(".page-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchPage(tab.dataset.page));
  });
  $("copyReportBtn").addEventListener("click", async () => {
    if (!state.report) return;
    await navigator.clipboard.writeText(reportText(state.report));
    $("copyReportBtn").textContent = "已复制";
    setTimeout(() => {
      $("copyReportBtn").textContent = "复制报告";
    }, 1200);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeView = tab.dataset.view;
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      renderReportView();
    });
  });
}

bindEvents();
fillForm(demoData);
renderReport(buildReport());
fillVisibilityForm(visibilityDemoData);
renderVisibilityReport(buildVisibilityReport());
switchPage("visibilityPage");

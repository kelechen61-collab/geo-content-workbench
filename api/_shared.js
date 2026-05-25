export const geoRules = `GEO 内容规则库：
1. 目标从“获取点击”转为“被 AI 理解、信任、引用、推荐”。
2. 优先级先防守再进攻：先修正品牌基础事实，再做场景化问题、对比问题、行业知识和长尾 FAQ。
3. 内容四步法：帮 AI 看懂、让 AI 信任、教 AI 跟进、替 AI 预判。
4. 好内容必须清晰结构化，包含直接答案、事实证据、数据或案例、可引用表达、FAQ 和下一步建议。
5. 选题优先选择用户会向 AI 提问的高意向问题，如“是什么、怎么样、多少钱、靠谱吗、怎么选、哪家好、对比、适合谁、如何解决某痛点”。
6. 审核重点：事实准确、口径一致、证据可信、结构可摘取、表达非空泛、不过度营销、包含 FAQ、适合目标平台、能构成品牌标准答案。
7. 失败处理：审核不通过时先定位根因，再回到选题或内容生成，不直接盲目重写。`;

export function applyCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
}

export function sendJson(res, status, payload) {
  applyCors(res);
  res.status(status).json(payload);
}

export function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export function makeSystemPrompt(mode, extraRules = "") {
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

export function localAssistant({ message, mode, editorContent, uploadedContext }) {
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

import { applyCors, getBody, localAssistant, makeSystemPrompt, sendJson } from "./_shared.js";

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = getBody(req);
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

    return sendJson(res, 200, {
      provider: provider.name || "custom",
      content: data.choices?.[0]?.message?.content || "",
      raw: data
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

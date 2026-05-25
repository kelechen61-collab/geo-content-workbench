import { sendJson } from "./_shared.js";

export default function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  return sendJson(res, 200, {
    ok: true,
    savedAt: new Date().toISOString(),
    note: "Vercel 环境不持久化服务器文件，前端会同时保存到浏览器本地。"
  });
}

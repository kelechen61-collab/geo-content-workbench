import { sendJson } from "./_shared.js";

export default function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  return sendJson(res, 200, { content: "", uploadedContext: "" });
}

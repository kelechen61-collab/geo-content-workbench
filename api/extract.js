import JSZip from "jszip";
import * as XLSX from "xlsx";
import { getBody, sendJson } from "./_shared.js";

function xmlText(value = "") {
  return value
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function extractDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return "";
  return xmlText(documentXml);
}

function extractXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: ""
    });
    parts.push(`\n[Sheet: ${sheetName}]`);
    for (const row of rows) {
      const values = row.map((value) => String(value ?? "").trim());
      if (values.some(Boolean)) parts.push(values.join(" | "));
    }
  }
  return parts.join("\n");
}

async function extractPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));
  const parts = [];
  for (let index = 0; index < slideFiles.length; index += 1) {
    const xml = await zip.file(slideFiles[index]).async("string");
    const text = xmlText(xml);
    if (text) parts.push(`\n[Slide ${index + 1}]\n${text}`);
  }
  return parts.join("\n");
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = getBody(req);
    const filename = body.filename || "";
    const extension = filename.toLowerCase().split(".").pop();
    const buffer = Buffer.from(body.base64 || "", "base64");
    let text = "";

    if (extension === "docx") text = await extractDocx(buffer);
    else if (extension === "xlsx") text = extractXlsx(buffer);
    else if (extension === "pptx") text = await extractPptx(buffer);
    else if (["doc", "xls", "ppt"].includes(extension)) {
      return sendJson(res, 400, { error: "暂不支持旧版 Office 二进制格式，请另存为 .docx / .xlsx / .pptx 后上传。" });
    } else {
      text = buffer.toString("utf-8");
    }

    return sendJson(res, 200, { filename, text });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

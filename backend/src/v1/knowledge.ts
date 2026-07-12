import { load } from "cheerio";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { PDFParse } from "pdf-parse";
import type { V1Config } from "./config.js";
import type { V1Gemini } from "./gemini.js";
import type { KnowledgeSourceRecord, RecordingRecord, SkillRecord, V1Repositories } from "./db/repositories.js";
import { fetchPublicDocument, resolvePublicHttpsUrl } from "./network.js";
import { AppError } from "../utils/errors.js";
import { createId } from "../utils/id.js";

const DOCUMENT_FETCH_LIMIT = 8 * 1024 * 1024;
const MAX_CRAWL_PAGES = 100;
const MAX_INDEXED_CHARACTERS = 5_000_000;
const CHUNK_TARGET = 1_200;
const CHUNK_OVERLAP = 160;

type KnowledgeModel = Pick<V1Gemini, "embed" | "analyzeRecording">;
type ExtractedPage = { url: string; title: string; text: string };

export class V1KnowledgeService {
  private readonly jobs = new Map<string, Promise<void>>();
  private closing = false;

  constructor(
    private readonly config: V1Config,
    private readonly repositories: V1Repositories,
    private readonly model: KnowledgeModel
  ) {}

  async createDocumentationSource(input: { name: string; url: string; maxPages?: number }): Promise<KnowledgeSourceRecord> {
    const resolved = await resolvePublicHttpsUrl(input.url);
    const product = await this.repositories.product.get();
    if (!product.documentationOrigins.includes(resolved.url.origin)) {
      await this.repositories.product.update({
        documentationOrigins: [...product.documentationOrigins, resolved.url.origin].sort()
      });
    }
    const source = await this.repositories.knowledge.createSource({
      id: createId("knowledge"),
      kind: "documentation_url",
      name: input.name,
      sourceUrl: resolved.url.toString(),
      metadata: { maxPages: Math.min(Math.max(input.maxPages ?? 30, 1), MAX_CRAWL_PAGES) }
    });
    this.scheduleSource(source.id);
    return source;
  }

  async createDocumentFileSource(input: {
    name: string;
    filePath: string;
    originalName: string;
    mimeType: string;
    size: number;
  }): Promise<KnowledgeSourceRecord> {
    assertDocumentMime(input.mimeType, input.originalName);
    const source = await this.repositories.knowledge.createSource({
      id: createId("knowledge"),
      kind: "document_file",
      name: input.name,
      filePath: input.filePath,
      metadata: { originalName: basename(input.originalName), mimeType: input.mimeType, size: input.size }
    });
    this.scheduleSource(source.id);
    return source;
  }

  async processSource(id: string): Promise<void> {
    const source = await this.repositories.knowledge.getSource(id);
    if (source.status === "archived") return;
    await this.repositories.knowledge.updateSource(id, { status: "processing", error: null });
    try {
      const pages = source.kind === "documentation_url"
        ? await this.crawlSource(source)
        : source.kind === "document_file"
          ? [await this.readDocumentSource(source)]
          : [];
      if (pages.length === 0) throw new AppError("KNOWLEDGE_EMPTY", "No indexable content was found.", 400);
      const prepared = pages.flatMap((page) => chunkText(page.text).map((content, index) => ({
        content,
        metadata: { url: page.url, title: page.title, chunk: index }
      })));
      if (prepared.length === 0) throw new AppError("KNOWLEDGE_EMPTY", "No indexable content was found.", 400);
      const embeddings = await this.model.embed(prepared.map((chunk) => chunk.content), undefined, "RETRIEVAL_DOCUMENT");
      await this.repositories.knowledge.replaceChunks(source.id, prepared.map((chunk, index) => ({
        id: createId("chunk"),
        kind: source.kind,
        content: chunk.content,
        contentHash: digest(chunk.content),
        metadata: chunk.metadata,
        embedding: embeddings[index]
      })));
      await this.repositories.knowledge.updateSource(id, {
        status: "ready",
        error: null,
        metadata: { ...source.metadata, pageCount: pages.length, chunkCount: prepared.length, indexedAt: new Date().toISOString() }
      });
    } catch (error) {
      await this.repositories.knowledge.updateSource(id, {
        status: "failed",
        error: safeJobError(error),
        metadata: source.metadata
      });
      throw error;
    }
  }

  async retrySource(id: string): Promise<KnowledgeSourceRecord> {
    const source = await this.repositories.knowledge.getSource(id);
    if (source.status === "archived") throw new AppError("KNOWLEDGE_ARCHIVED", "Archived knowledge cannot be reprocessed.", 409);
    await this.repositories.knowledge.updateSource(id, { status: "pending", error: null });
    this.scheduleSource(id);
    return this.repositories.knowledge.getSource(id);
  }

  async createRecording(input: {
    name: string;
    description?: string;
    filePath: string;
    originalName: string;
    mimeType: string;
    size: number;
  }): Promise<RecordingRecord> {
    assertRecordingMime(input.mimeType);
    const recording = await this.repositories.knowledge.createRecording({
      id: createId("recording"),
      name: input.name,
      description: input.description,
      filePath: input.filePath
    });
    await this.repositories.knowledge.updateRecording(recording.id, {
      status: "uploaded",
      analysis: { originalName: basename(input.originalName), mimeType: input.mimeType, size: input.size }
    });
    this.scheduleRecording(recording.id);
    return this.repositories.knowledge.getRecording(recording.id);
  }

  async processRecording(id: string): Promise<void> {
    const recording = await this.repositories.knowledge.getRecording(id);
    await this.repositories.knowledge.updateRecording(id, { status: "processing", error: null });
    try {
      const product = await this.repositories.product.get();
      const maps = await this.repositories.knowledge.listMapVersions();
      const routes = maps.find((map) => map.status === "ready")?.routes ?? [];
      const mimeType = typeof recording.analysis?.mimeType === "string" ? recording.analysis.mimeType : "video/mp4";
      const analysis = await this.model.analyzeRecording({
        filePath: recording.filePath,
        mimeType,
        productName: product.name,
        knownRoutes: routes
      });
      const skill = await this.repositories.knowledge.createSkill({
        id: createId("skill"),
        ...analysis,
        recordingId: recording.id
      });
      await this.repositories.knowledge.updateRecording(id, {
        status: "needs_review",
        analysis: { ...analysis, skillId: skill.id }
      });
    } catch (error) {
      await this.repositories.knowledge.updateRecording(id, { status: "failed", error: safeJobError(error) });
      throw error;
    }
  }

  async updateSkill(id: string, input: Partial<Pick<SkillRecord, "name" | "description" | "goal" | "businessContext" | "steps" | "constraints" | "expectedOutcomes">>): Promise<SkillRecord> {
    const skill = await this.repositories.knowledge.updateSkill(id, input);
    await this.repositories.knowledge.upsertSource({
      id: skillSourceId(skill.id), kind: "skill", name: skill.name, status: "archived", metadata: { skillId: skill.id, version: skill.version }
    });
    return skill;
  }

  async setSkillStatus(id: string, status: "published" | "archived"): Promise<SkillRecord> {
    const skill = await this.repositories.knowledge.setSkillStatus(id, status);
    if (status === "archived") {
      await this.repositories.knowledge.upsertSource({
        id: skillSourceId(skill.id), kind: "skill", name: skill.name, status: "archived", metadata: { skillId: skill.id, version: skill.version }
      });
      return skill;
    }
    const content = skillContent(skill);
    const [embedding] = await this.model.embed([content], undefined, "RETRIEVAL_DOCUMENT");
    const source = await this.repositories.knowledge.upsertSource({
      id: skillSourceId(skill.id), kind: "skill", name: skill.name, status: "ready", metadata: { skillId: skill.id, version: skill.version }
    });
    await this.repositories.knowledge.replaceChunks(source.id, [{
      id: createId("chunk"), kind: "skill", content, contentHash: digest(content),
      metadata: { skillId: skill.id, version: skill.version }, embedding
    }]);
    if (skill.recordingId) await this.repositories.knowledge.updateRecording(skill.recordingId, { status: "ready" });
    return skill;
  }

  async resumePending(): Promise<void> {
    const [sources, recordings] = await Promise.all([
      this.repositories.knowledge.listSources(),
      this.repositories.knowledge.listRecordings()
    ]);
    for (const source of sources) {
      if (["pending", "processing"].includes(source.status) && ["documentation_url", "document_file"].includes(source.kind)) this.scheduleSource(source.id);
    }
    for (const recording of recordings) {
      if (["uploaded", "processing"].includes(recording.status)) this.scheduleRecording(recording.id);
    }
  }

  async waitForJob(id: string): Promise<void> {
    await (this.jobs.get(id) ?? this.jobs.get(`source:${id}`) ?? this.jobs.get(`recording:${id}`));
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.jobs.values());
  }

  private scheduleSource(id: string): void {
    this.schedule(`source:${id}`, () => this.processSource(id));
  }

  private scheduleRecording(id: string): void {
    this.schedule(`recording:${id}`, () => this.processRecording(id));
  }

  private schedule(key: string, run: () => Promise<void>): void {
    if (this.closing || this.jobs.has(key)) return;
    const job = run().catch(() => undefined).finally(() => this.jobs.delete(key));
    this.jobs.set(key, job);
  }

  private async crawlSource(source: KnowledgeSourceRecord): Promise<ExtractedPage[]> {
    if (!source.sourceUrl) throw new AppError("KNOWLEDGE_SOURCE_INVALID", "Documentation source has no URL.", 500);
    const start = new URL(source.sourceUrl);
    const product = await this.repositories.product.get();
    if (!product.documentationOrigins.includes(start.origin)) {
      throw new AppError("DOCUMENT_ORIGIN_NOT_APPROVED", "Documentation origin is no longer approved.", 409);
    }
    const maxPages = Math.min(Math.max(Number(source.metadata.maxPages ?? 30), 1), MAX_CRAWL_PAGES);
    const queue = [normalizeCrawlUrl(start)];
    const seen = new Set<string>();
    const pages: ExtractedPage[] = [];
    let characters = 0;
    while (queue.length > 0 && pages.length < maxPages && characters < MAX_INDEXED_CHARACTERS) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const document = await fetchPublicDocument(url, {
        maxBytes: DOCUMENT_FETCH_LIMIT,
        timeoutMs: Math.min(this.config.PROVIDER_REQUEST_TIMEOUT_MS, 30_000)
      });
      if (new URL(document.url).origin !== start.origin) {
        throw new AppError("DOCUMENT_REDIRECT_ORIGIN", "Documentation redirects must remain on the approved origin.", 400);
      }
      if (document.contentType === "application/pdf") {
        const text = await extractPdf(document.body);
        pages.push({ url: document.url, title: basename(new URL(document.url).pathname) || source.name, text });
        characters += text.length;
        continue;
      }
      if (["text/markdown", "text/plain"].includes(document.contentType)) {
        const text = decodeText(document.body);
        pages.push({ url: document.url, title: source.name, text });
        characters += text.length;
        continue;
      }
      if (document.contentType !== "text/html" && document.contentType !== "application/xhtml+xml") continue;
      const extracted = extractHtml(document.body.toString("utf8"), document.url);
      if (extracted.text) {
        pages.push({ url: document.url, title: extracted.title || source.name, text: extracted.text });
        characters += extracted.text.length;
      }
      for (const link of extracted.links) {
        const candidate = new URL(link, document.url);
        if (candidate.origin === start.origin && candidate.protocol === "https:" && !seen.has(normalizeCrawlUrl(candidate)) && isUsefulDocumentPath(candidate.pathname)) {
          queue.push(normalizeCrawlUrl(candidate));
        }
      }
    }
    return pages;
  }

  private async readDocumentSource(source: KnowledgeSourceRecord): Promise<ExtractedPage> {
    if (!source.filePath) throw new AppError("KNOWLEDGE_SOURCE_INVALID", "Document source has no file.", 500);
    const body = await readFile(source.filePath);
    const mimeType = String(source.metadata.mimeType ?? "text/plain");
    const text = mimeType === "application/pdf" ? await extractPdf(body) : decodeText(body);
    return { url: `file:${basename(source.filePath)}`, title: source.name, text };
  }
}

export function extractHtml(html: string, baseUrl: string): { title: string; text: string; links: string[] } {
  const $ = load(html);
  $("script,style,noscript,svg,canvas,nav,footer,[aria-hidden='true']").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body").first();
  const blocks: string[] = [];
  root.find("h1,h2,h3,h4,h5,h6,p,li,dt,dd,pre,code,th,td").each((_index, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    const tag = element.tagName.toLowerCase();
    blocks.push(tag.startsWith("h") ? `${"#".repeat(Number(tag.slice(1)))} ${text}` : text);
  });
  const links = $("a[href]").map((_index, element) => {
    try {
      return new URL($(element).attr("href")!, baseUrl).toString();
    } catch {
      return undefined;
    }
  }).get().filter((value): value is string => Boolean(value));
  return { title, text: dedupeAdjacent(blocks).join("\n\n"), links: [...new Set(links)] };
}

export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return [];
  const paragraphs = text.split(/\n\n+/).flatMap((paragraph) => splitLong(paragraph.trim(), CHUNK_TARGET)).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_TARGET) {
      chunks.push(current);
      current = `${current.slice(-CHUNK_OVERLAP)}\n\n${paragraph}`;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return [...new Set(chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length >= 20))];
}

async function extractPdf(body: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(body) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function decodeText(body: Buffer): string {
  if (body.subarray(0, 8).includes(0)) throw new AppError("DOCUMENT_BINARY_INVALID", "The uploaded file is not plain text.", 400);
  return body.toString("utf8");
}

function assertDocumentMime(mimeType: string, name: string): void {
  const normalized = mimeType.toLowerCase();
  const extension = name.toLowerCase().split(".").pop();
  if (!["application/pdf", "text/plain", "text/markdown"].includes(normalized) && !["pdf", "txt", "md", "markdown"].includes(extension ?? "")) {
    throw new AppError("DOCUMENT_TYPE_INVALID", "Upload a PDF, Markdown, or plain-text document.", 400);
  }
}

function assertRecordingMime(mimeType: string): void {
  if (!new Set([
    "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/wav", "audio/mp4", "audio/webm"
  ]).has(mimeType.toLowerCase())) {
    throw new AppError("RECORDING_TYPE_INVALID", "Upload an MP4, MOV, WebM, MP3, WAV, or M4A recording.", 400);
  }
}

function normalizeCrawlUrl(url: URL): string {
  const normalized = new URL(url);
  normalized.hash = "";
  for (const parameter of [...normalized.searchParams.keys()]) {
    if (/^(utm_|ref$|source$|session)/i.test(parameter)) normalized.searchParams.delete(parameter);
  }
  normalized.searchParams.sort();
  return normalized.toString();
}

function isUsefulDocumentPath(path: string): boolean {
  return !/\.(?:zip|gz|tar|png|jpe?g|gif|webp|svg|ico|mp[34]|webm|mov|woff2?|ttf)(?:$|\/)/i.test(path)
    && !/(?:^|\/)(?:logout|signout|login|signin)(?:\/|$)/i.test(path);
}

function splitLong(value: string, target: number): string[] {
  if (value.length <= target) return [value];
  const sentences = value.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > target) {
      if (current) parts.push(current);
      for (let offset = 0; offset < sentence.length; offset += target) parts.push(sentence.slice(offset, offset + target));
      current = "";
    } else if (current && current.length + sentence.length + 1 > target) {
      parts.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function dedupeAdjacent(values: string[]): string[] {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function skillContent(skill: SkillRecord): string {
  return [
    `Skill: ${skill.name}`,
    `Goal: ${skill.goal}`,
    `Description: ${skill.description}`,
    `Business context: ${skill.businessContext}`,
    `Successful pattern: ${skill.steps.map((step) => JSON.stringify(step)).join("\n")}`,
    `Constraints: ${skill.constraints.join("; ")}`,
    `Expected outcomes: ${skill.expectedOutcomes.join("; ")}`
  ].join("\n");
}

function skillSourceId(skillId: string): string {
  return `knowledge_skill_${skillId}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeJobError(error: unknown): string {
  const value = error instanceof AppError && error.statusCode < 500
    ? error.message
    : error instanceof AppError && error.code.startsWith("GEMINI_")
      ? "Gemini could not process this source. Check provider configuration and retry."
      : "Processing failed. Review the protected server logs and retry.";
  return value.replace(/(?:AIza|mia_(?:key|rt|admin|resume))_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 2_000);
}

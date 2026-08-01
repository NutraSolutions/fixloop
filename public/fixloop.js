const DEFAULTS = {
  endpoint: "/api/reports",
  label: "Report a bug",
  title: "Report a problem",
  repositories: [],
  includeQuery: false,
  maxFiles: 6,
  maxFileBytes: 2 * 1024 * 1024,
  statusPageUrl: "/status"
};

export const TRACKED_REPORTS_KEY = "fixloop.reports.v1";
const REPORT_ID = /^[a-f0-9]{24}$/;

function availableStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function trackedReports(storage = null) {
  try {
    const target = availableStorage(storage);
    if (!target) return [];
    const parsed = JSON.parse(target.getItem(TRACKED_REPORTS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => REPORT_ID.test(String(item?.id || "")))
      .map((item) => ({ id: item.id, createdAt: item.createdAt || null }))
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function rememberReport(report, storage = null) {
  const id = String(report?.id || "");
  if (!REPORT_ID.test(id)) return trackedReports(storage);
  const target = availableStorage(storage);
  const next = [
    { id, createdAt: report.createdAt || new Date().toISOString() },
    ...trackedReports(target).filter((item) => item.id !== id)
  ].slice(0, 50);
  try {
    target?.setItem(TRACKED_REPORTS_KEY, JSON.stringify(next));
  } catch {
    // Status tracking is a convenience. Submission remains successful if storage is unavailable.
  }
  return next;
}

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

export function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

class FixloopHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "FixloopHttpError";
    this.status = status;
    this.retryable = retryableStatus(status);
  }
}

function sourceUrl(includeQuery) {
  const url = new URL(window.location.href);
  if (!includeQuery) {
    url.search = "";
    url.hash = "";
  }
  return url.toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function openOutbox() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fixloop", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("outbox")) {
        request.result.createObjectStore("outbox", { keyPath: "clientRequestId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function outboxPut(payload) {
  const db = await openOutbox();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readwrite").objectStore("outbox").put(payload);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function outboxDelete(clientRequestId) {
  const db = await openOutbox();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readwrite").objectStore("outbox").delete(clientRequestId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function outboxList() {
  const db = await openOutbox();
  if (!db) return [];
  const records = await new Promise((resolve, reject) => {
    const request = db.transaction("outbox", "readonly").objectStore("outbox").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records;
}

export class FixloopWidget {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.files = [];
    this.root = null;
    this.modal = null;
    this.flushing = false;
  }

  mount(target = document.body) {
    if (this.root) return this;
    this.injectStyles();
    const root = document.createElement("div");
    root.className = "fixloop";
    root.innerHTML = `
      <button class="fixloop__trigger" type="button" aria-label="${escapeHtml(this.options.label)}">
        <span aria-hidden="true">+</span>
        <strong>${escapeHtml(this.options.label)}</strong>
      </button>
      <div class="fixloop__backdrop" hidden>
        <section class="fixloop__modal" role="dialog" aria-modal="true" aria-labelledby="fixloop-title">
          <header>
            <div>
              <p class="fixloop__eyebrow">FIXLOOP</p>
              <h2 id="fixloop-title">${escapeHtml(this.options.title)}</h2>
            </div>
            <button class="fixloop__close" type="button" aria-label="Close">×</button>
          </header>
          <form>
            <label>
              <span>What happened?</span>
              <textarea name="description" maxlength="8000" rows="5" required
                placeholder="What did you expect, and what happened instead?"></textarea>
            </label>
            ${this.repositoryField()}
            <div class="fixloop__dropzone" tabindex="0">
              <input name="files" type="file" multiple hidden
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/json,.docx,.xlsx">
              <span class="fixloop__clip" aria-hidden="true">⌁</span>
              <strong>Paste a screenshot or add files</strong>
              <small>Images, PDF, text, CSV, JSON, DOCX, XLSX. Up to ${this.options.maxFiles} files.</small>
              <button type="button" class="fixloop__browse">Choose files</button>
            </div>
            <ul class="fixloop__files" aria-live="polite"></ul>
            <p class="fixloop__message" role="status"></p>
            <footer>
              <span>${escapeHtml(document.title)} · ${escapeHtml(new URL(location.href).pathname)}</span>
              <button class="fixloop__submit" type="submit">Send report</button>
            </footer>
          </form>
        </section>
      </div>`;
    target.appendChild(root);
    this.root = root;
    this.modal = root.querySelector(".fixloop__backdrop");
    this.bind();
    if (!this.options.submit) {
      this.flushOutbox();
      window.addEventListener("online", () => this.flushOutbox());
    }
    return this;
  }

  repositoryField() {
    if (!this.options.repositories.length) return "";
    return `
      <label>
        <span>Project <small>optional</small></span>
        <select name="repository">
          <option value="">Choose automatically</option>
          ${this.options.repositories.map((repo) => `<option value="${escapeHtml(repo.value)}">${escapeHtml(repo.label)}</option>`).join("")}
        </select>
      </label>`;
  }

  injectStyles() {
    if (document.querySelector("link[data-fixloop]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.fixloop = "true";
    link.href = this.options.cssUrl || new URL("./fixloop.css", import.meta.url).href;
    document.head.appendChild(link);
  }

  bind() {
    const trigger = this.root.querySelector(".fixloop__trigger");
    const close = this.root.querySelector(".fixloop__close");
    const form = this.root.querySelector("form");
    const input = this.root.querySelector("input[type=file]");
    const browse = this.root.querySelector(".fixloop__browse");
    const dropzone = this.root.querySelector(".fixloop__dropzone");
    trigger.addEventListener("click", () => this.open());
    close.addEventListener("click", () => this.close());
    this.modal.addEventListener("click", (event) => {
      if (event.target === this.modal) this.close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.modal.hidden) this.close();
    });
    browse.addEventListener("click", () => input.click());
    dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") input.click();
    });
    input.addEventListener("change", () => this.addFiles([...input.files]));
    dropzone.addEventListener("dragover", (event) => event.preventDefault());
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      this.addFiles([...event.dataTransfer.files]);
    });
    form.addEventListener("paste", (event) => {
      const pasted = [...event.clipboardData.items]
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (pasted.length) {
        event.preventDefault();
        this.addFiles(pasted.map((file, index) => new File(
          [file],
          file.name || `clipboard-${Date.now()}-${index + 1}.png`,
          { type: file.type || "image/png" }
        )));
      }
    });
    form.addEventListener("submit", (event) => this.submit(event));
  }

  open() {
    this.modal.hidden = false;
    document.body.classList.add("fixloop-open");
    this.root.querySelector("textarea").focus();
  }

  close() {
    this.modal.hidden = true;
    document.body.classList.remove("fixloop-open");
    this.root.querySelector(".fixloop__trigger").focus();
  }

  message(text, state = "", link = null) {
    const element = this.root.querySelector(".fixloop__message");
    element.replaceChildren(document.createTextNode(text));
    if (link) {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.textContent = "View status";
      element.append(" ", anchor);
    }
    element.dataset.state = state;
  }

  addFiles(files) {
    this.message("");
    for (const file of files) {
      if (this.files.length >= this.options.maxFiles) {
        this.message(`Only ${this.options.maxFiles} files can be attached.`, "error");
        break;
      }
      if (file.size > this.options.maxFileBytes) {
        this.message(`${file.name} is too large.`, "error");
        continue;
      }
      if (!ALLOWED_ATTACHMENT_TYPES.has(String(file.type).toLowerCase())) {
        this.message(`${file.name} uses an unsupported file type.`, "error");
        continue;
      }
      if (!this.files.some((item) => item.name === file.name && item.size === file.size)) {
        this.files.push(file);
      }
    }
    this.renderFiles();
  }

  renderFiles() {
    const list = this.root.querySelector(".fixloop__files");
    list.innerHTML = "";
    this.files.forEach((file, index) => {
      const item = document.createElement("li");
      item.innerHTML = `<span>${escapeHtml(file.name)}<small>${Math.ceil(file.size / 1024)} KB</small></span><button type="button" aria-label="Remove ${escapeHtml(file.name)}">×</button>`;
      item.querySelector("button").addEventListener("click", () => {
        this.files.splice(index, 1);
        this.renderFiles();
      });
      list.appendChild(item);
    });
  }

  async submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector(".fixloop__submit");
    submit.disabled = true;
    this.message("Saving your report…");
    try {
      const attachments = await Promise.all(this.files.map(async (file) => ({
        name: file.name,
        type: file.type,
        data: await fileToDataUrl(file)
      })));
      const values = new FormData(form);
      const payload = {
        clientRequestId: crypto.randomUUID(),
        pageTitle: document.title,
        pageUrl: sourceUrl(this.options.includeQuery),
        description: values.get("description"),
        repository: values.get("repository") || null,
        attachments
      };
      let result;
      if (this.options.submit) {
        result = await this.options.submit(payload);
      } else {
        await outboxPut(payload);
        try {
          result = await this.sendPayload(payload);
          await outboxDelete(payload.clientRequestId);
        } catch (error) {
          if (error.retryable === false) await outboxDelete(payload.clientRequestId);
          throw error;
        }
      }
      rememberReport(result);
      const statusPage = result.statusPageUrl || `${this.options.statusPageUrl}#${encodeURIComponent(result.id)}`;
      this.message(`Saved. Tracking ID: ${result.id}`, "success", statusPage);
      this.options.onSubmitted?.(result);
      form.reset();
      this.files = [];
      this.renderFiles();
    } catch (error) {
      this.message(error.message || "The report could not be saved.", "error");
    } finally {
      submit.disabled = false;
    }
  }

  async sendPayload(payload) {
    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new FixloopHttpError(result.error || `Report failed (${response.status})`, response.status);
    }
    return result;
  }

  async flushOutbox() {
    if (this.flushing || !navigator.onLine) return;
    this.flushing = true;
    try {
      for (const payload of await outboxList()) {
        try {
          const result = await this.sendPayload(payload);
          await outboxDelete(payload.clientRequestId);
          rememberReport(result);
          this.options.onSubmitted?.(result);
        } catch (error) {
          if (error.retryable === false) {
            await outboxDelete(payload.clientRequestId);
            this.options.onRejected?.({ payload, error });
            continue;
          }
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

export function mountFixloop(options) {
  return new FixloopWidget(options).mount();
}

if (typeof document !== "undefined" && document.currentScript?.dataset.auto === "true") mountFixloop();

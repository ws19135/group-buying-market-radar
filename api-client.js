export function newClientRequestId(prefix = "req") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `${prefix}_${[...bytes].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

export class RadarApi {
  constructor({ role = "OPS_MANAGER" } = {}) {
    this.role = role;
    this.connected = false;
    this.health = null;
  }

  setRole(role) {
    this.role = role;
  }

  async probe() {
    try {
      const response = await fetch("api/v1/health", { headers: { accept: "application/json", "x-role": this.role }, cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
      this.health = await response.json();
      this.connected = this.health?.mode === "MVP_SANDBOX";
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async request(path, { method = "GET", body } = {}) {
    if (!this.connected && path !== "/health") throw new Error("Sandbox API 未連線");
    const response = await fetch(`api/v1${path}`, {
      method,
      headers: { accept: "application/json", "content-type": "application/json", "x-role": this.role, "x-request-id": newClientRequestId() },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `API ${response.status}`);
      error.code = payload?.error?.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  dashboard() { return this.request("/dashboard"); }
  observations(query = "") { return this.request(`/observations?page_size=200${query ? `&query=${encodeURIComponent(query)}` : ""}`); }
  discoveryFeed(view = "latest") { return this.request(`/discovery-feed?view=${encodeURIComponent(view)}&limit=200`); }
  sources() { return this.request("/sources"); }
  leads(type = "") { return this.request(`/leads${type ? `?lead_type=${encodeURIComponent(type)}` : ""}`); }
  reviews() { return this.request("/reviews"); }
  promotions() { return this.request("/promotion-drafts"); }
  runs() { return this.request("/runs"); }
  createObservation(body) { return this.request("/observations", { method: "POST", body }); }
  importRecords(body) { return this.request("/imports", { method: "POST", body }); }
  createSource(body) { return this.request("/sources", { method: "POST", body }); }
  collectSource(id, body = {}) { return this.request(`/sources/${encodeURIComponent(id)}/collect`, { method: "POST", body }); }
  rebuildLeads() { return this.request("/leads/rebuild", { method: "POST", body: {} }); }
  reviewLead(id, body) { return this.request(`/leads/${encodeURIComponent(id)}/review`, { method: "POST", body }); }
  createPromotion(id) { return this.request(`/leads/${encodeURIComponent(id)}/promotion-drafts`, { method: "POST", body: {} }); }
  dryRun(id) { return this.request(`/promotion-drafts/${encodeURIComponent(id)}/dry-run`, { method: "POST", body: {} }); }
}

import { Ban, Check, KeyRound, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { BackendApi } from "../api";
import { Alert, Button, CodeBlock, EmptyState, Field, IconButton, Loading, Section, Segmented, StatusBadge } from "../components/ui";
import type { AdminUser, CreatedIntegrationKey, GeminiStatus, IntegrationKey, MiaVoiceName, Product, ScanAuth, TranscriptMode } from "../types";
import { errorMessage, formatDateTime, lines } from "../utils/format";

type Tab = "product" | "privacy" | "credentials" | "scan" | "admin";

export function SettingsPage({ api, user, refreshNonce, notify, onProductChange }: {
  api: BackendApi;
  user: AdminUser;
  refreshNonce: number;
  notify: (message: string) => void;
  onProductChange: (product: Product) => void;
}) {
  const [tab, setTab] = useState<Tab>("product");
  const [product, setProduct] = useState<Product | null>(null);
  const [gemini, setGemini] = useState<GeminiStatus | null>(null);
  const [keys, setKeys] = useState<IntegrationKey[]>([]);
  const [scanAuth, setScanAuth] = useState<ScanAuth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedIntegrationKey | null>(null);
  const [revokeId, setRevokeId] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextProduct, nextGemini, nextKeys, nextScanAuth] = await Promise.all([api.product(), api.gemini(), api.integrationKeys(), api.scanAuth()]);
      setProduct(nextProduct); setGemini(nextGemini); setKeys(nextKeys); setScanAuth(nextScanAuth); onProductChange(nextProduct); setError("");
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }, [api, onProductChange]);
  useEffect(() => { void load(); }, [load, refreshNonce]);
  const perform = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError("");
    try { await work(); notify(message); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  if (loading || !product || !gemini || !scanAuth) return <Loading label="Loading deployment settings" />;
  return (
    <div className="page-stack">
      {error ? <Alert tone="danger" onClose={() => setError("")}>{error}</Alert> : null}
      {revokeId ? <Alert tone="danger" title="Revoke integration key?">The product server using this key will stop minting runtime tokens. <span className="alert-actions"><Button size="sm" variant="danger" disabled={busy} onClick={() => void perform(async () => { await api.revokeIntegrationKey(revokeId); setRevokeId(""); }, "Integration key revoked.")}><Trash2 /> Revoke</Button><Button size="sm" variant="secondary" onClick={() => setRevokeId("")}>Cancel</Button></span></Alert> : null}
      <div className="page-tools settings-tabs"><Segmented value={tab} onChange={setTab} label="Settings section" options={[{ value: "product", label: "Product" }, { value: "privacy", label: "Privacy" }, { value: "credentials", label: "Credentials" }, { value: "scan", label: "Scan access" }, { value: "admin", label: "Administrator" }]} /></div>
      {tab === "product" ? <ProductSettings product={product} busy={busy} save={(input) => perform(async () => { const updated = await api.updateProduct(input); setProduct(updated); onProductChange(updated); }, "Product settings saved.")} /> : null}
      {tab === "privacy" ? <PrivacySettings product={product} busy={busy} save={(input) => perform(async () => { const updated = await api.updateProduct(input); setProduct(updated); onProductChange(updated); }, "Privacy settings saved.")} /> : null}
      {tab === "credentials" ? <Credentials api={api} gemini={gemini} keys={keys} product={product} busy={busy} createdKey={createdKey} setCreatedKey={setCreatedKey} setRevokeId={setRevokeId} perform={perform} /> : null}
      {tab === "scan" ? <ScanSettings current={scanAuth} busy={busy} save={(input) => perform(() => api.updateScanAuth(input), "Scan access saved.")} /> : null}
      {tab === "admin" ? <AdminSettings api={api} user={user} busy={busy} perform={perform} /> : null}
    </div>
  );
}

function ProductSettings({ product, busy, save }: { product: Product; busy: boolean; save: (input: Partial<Product>) => Promise<void> }) {
  const [name, setName] = useState(product.name);
  const [origin, setOrigin] = useState(product.origin);
  const [voiceEnabled, setVoiceEnabled] = useState(product.voiceConfig.enabled);
  const [voice, setVoice] = useState<MiaVoiceName>(product.voiceConfig.voice || "Aoede");
  useEffect(() => { setName(product.name); setOrigin(product.origin); setVoiceEnabled(product.voiceConfig.enabled); setVoice(product.voiceConfig.voice || "Aoede"); }, [product]);
  return <Section title="Product identity" description="Mia is bound to one production origin."><form className="settings-form" onSubmit={(event) => { event.preventDefault(); void save({ name, origin: origin.replace(/\/$/, ""), voiceConfig: { enabled: voiceEnabled, voice, language: "en-US" } }); }}><div className="form-grid two"><Field label="Product name"><input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Production origin" hint="Changing this revokes every integration key and runtime token. Create a new server key afterward."><input type="url" required value={origin} onChange={(event) => setOrigin(event.target.value)} /></Field><Field label="Mia voice" hint="Aoede is the default. Runtime SDK requests cannot override this setting."><select value={voice} onChange={(event) => setVoice(event.target.value as MiaVoiceName)}><option value="Aoede">Aoede - breezy</option><option value="Kore">Kore - firm</option><option value="Leda">Leda - youthful</option></select></Field><div className="field"><span className="field-label">Voice availability</span><label className="switch-row"><input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} /><span /><strong>{voiceEnabled ? "Enabled" : "Disabled"}</strong></label></div></div><div className="form-actions"><Button type="submit" disabled={busy}><Save /> Save product</Button></div></form></Section>;
}

function PrivacySettings({ product, busy, save }: { product: Product; busy: boolean; save: (input: Partial<Product>) => Promise<void> }) {
  const [mode, setMode] = useState<TranscriptMode>(product.transcriptMode);
  const [days, setDays] = useState(String(product.transcriptRetentionDays));
  const [selectors, setSelectors] = useState(product.redactedSelectors.join("\n"));
  useEffect(() => { setMode(product.transcriptMode); setDays(String(product.transcriptRetentionDays)); setSelectors(product.redactedSelectors.join("\n")); }, [product]);
  return <Section title="Privacy and retention" description="Secrets and configured private regions are always redacted before Gemini and diagnostics."><form className="settings-form" onSubmit={(event) => { event.preventDefault(); void save({ transcriptMode: mode, transcriptRetentionDays: Number(days), redactedSelectors: lines(selectors) }); }}><div className="form-grid two"><Field label="Run transcript diagnostics"><select value={mode} onChange={(event) => setMode(event.target.value as TranscriptMode)}><option value="full">Full, with mandatory secret redaction</option><option value="redacted">Metadata with redacted content</option><option value="disabled">Disabled, do not store transcript content</option></select></Field><Field label="Retention days"><input type="number" min={1} max={365} required value={days} onChange={(event) => setDays(event.target.value)} /></Field><Field label="Private CSS selectors" hint="One selector per line. Matching regions never leave the browser." className="span-2"><textarea rows={8} value={selectors} onChange={(event) => setSelectors(event.target.value)} placeholder={"[data-private]\n.payment-details"} /></Field></div><div className="form-actions"><Button type="submit" disabled={busy}><Save /> Save privacy</Button></div></form></Section>;
}

function Credentials({ api, gemini, keys, product, busy, createdKey, setCreatedKey, setRevokeId, perform }: {
  api: BackendApi; gemini: GeminiStatus; keys: IntegrationKey[]; product: Product; busy: boolean; createdKey: CreatedIntegrationKey | null;
  setCreatedKey: (value: CreatedIntegrationKey | null) => void; setRevokeId: (id: string) => void; perform: (work: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [geminiKey, setGeminiKey] = useState("");
  const [keyName, setKeyName] = useState("Production server");
  return <div className="page-stack"><Section title="Gemini credential" description="Stored encrypted with the deployment encryption key." action={<StatusBadge value={gemini.configured ? "configured" : "missing"} />}><form className="credential-row" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await api.setGemini(geminiKey); setGeminiKey(""); }, "Gemini credential saved."); }}><Field label={gemini.configured ? "Replace API key" : "API key"}><input type="password" minLength={20} required value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} autoComplete="off" /></Field><Button type="submit" disabled={busy}>Save credential</Button>{gemini.configured && gemini.source !== "environment" ? <Button type="button" variant="danger" disabled={busy} onClick={() => void perform(() => api.clearGemini(), "Stored Gemini credential removed.")}><Ban /> Remove</Button> : null}</form></Section>
    <Section title="Server integration keys" description={`Keys mint short-lived browser tokens only for ${product.origin}.`} action={<span className="section-count">{keys.filter((key) => !key.revokedAt).length} active</span>}>
      {createdKey ? <div className="one-time-key"><Alert tone="warning" title="Copy this key now">It cannot be retrieved after you leave this page.</Alert><CodeBlock label="MIA_INTEGRATION_KEY" value={createdKey.key} /><Button size="sm" variant="secondary" onClick={() => setCreatedKey(null)}><Check /> Stored securely</Button></div> : <form className="credential-row" onSubmit={(event) => { event.preventDefault(); void perform(async () => setCreatedKey(await api.createIntegrationKey(keyName)), "Integration key created."); }}><Field label="New key name"><input required value={keyName} onChange={(event) => setKeyName(event.target.value)} /></Field><Button type="submit" disabled={busy}><Plus /> Create key</Button></form>}
      {keys.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Key</th><th>Origin</th><th>Last used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{keys.map((key) => <tr key={key.id}><td><div className="table-primary"><strong><KeyRound className="inline-icon" />{key.name}</strong><span>mia_key_{key.prefix}_...</span></div></td><td><code>{key.allowedOrigin}</code></td><td>{formatDateTime(key.lastUsedAt)}</td><td><StatusBadge value={key.revokedAt ? "revoked" : "active"} /></td><td>{!key.revokedAt ? <IconButton label={`Revoke ${key.name}`} onClick={() => setRevokeId(key.id)}><Trash2 /></IconButton> : null}</td></tr>)}</tbody></table></div> : <EmptyState title="No integration keys" detail="Create one for the production product server." />}
    </Section></div>;
}

function ScanSettings({ current, busy, save }: { current: ScanAuth; busy: boolean; save: (input: Parameters<BackendApi["updateScanAuth"]>[0]) => Promise<void> }) {
  const config = current.config;
  const [mode, setMode] = useState<"none" | "login_form">(config.authMode ?? "none");
  const [form, setForm] = useState({ loginUrl: config.loginUrl ?? "", username: config.username ?? "", password: "", usernameSelector: config.usernameSelector ?? "", passwordSelector: config.passwordSelector ?? "", submitSelector: config.submitSelector ?? "", successUrlPattern: config.successUrlPattern ?? "", allowedResourceOrigins: (config.allowedResourceOrigins ?? []).join("\n"), waitAfterLoginMs: String(config.waitAfterLoginMs ?? 500) });
  const set = (key: keyof typeof form, value: string) => setForm((value_) => ({ ...value_, [key]: value }));
  return <Section title="UI scan access" description="Credentials are encrypted and used only by the isolated Playwright scanner."><form className="settings-form" onSubmit={(event) => { event.preventDefault(); void save({ authMode: mode, ...(mode === "login_form" ? { loginUrl: form.loginUrl, username: form.username, password: form.password || undefined, usernameSelector: form.usernameSelector, passwordSelector: form.passwordSelector, submitSelector: form.submitSelector, successUrlPattern: form.successUrlPattern || undefined } : {}), allowedResourceOrigins: lines(form.allowedResourceOrigins), waitAfterLoginMs: Number(form.waitAfterLoginMs) }); }}><Field label="Authentication"><select value={mode} onChange={(event) => setMode(event.target.value as "none" | "login_form")}><option value="none">No login required</option><option value="login_form">Login form</option></select></Field>{mode === "login_form" ? <div className="form-grid two"><Field label="Login URL"><input required value={form.loginUrl} onChange={(event) => set("loginUrl", event.target.value)} /></Field><Field label="Username"><input required value={form.username} onChange={(event) => set("username", event.target.value)} /></Field><Field label="Password" hint={current.passwordConfigured ? "Leave blank to keep the encrypted password." : undefined}><input type="password" required={!current.passwordConfigured} value={form.password} onChange={(event) => set("password", event.target.value)} /></Field><Field label="Success URL pattern"><input value={form.successUrlPattern} onChange={(event) => set("successUrlPattern", event.target.value)} /></Field><Field label="Username selector"><input required value={form.usernameSelector} onChange={(event) => set("usernameSelector", event.target.value)} /></Field><Field label="Password selector"><input required value={form.passwordSelector} onChange={(event) => set("passwordSelector", event.target.value)} /></Field><Field label="Submit selector"><input required value={form.submitSelector} onChange={(event) => set("submitSelector", event.target.value)} /></Field><Field label="Post-login wait (ms)"><input type="number" min={0} max={5000} value={form.waitAfterLoginMs} onChange={(event) => set("waitAfterLoginMs", event.target.value)} /></Field></div> : null}<Field label="Allowed resource origins" hint="Optional CDN or asset origins, one per line."><textarea rows={5} value={form.allowedResourceOrigins} onChange={(event) => set("allowedResourceOrigins", event.target.value)} /></Field><div className="form-actions"><Button type="submit" disabled={busy}><Save /> Save scan access</Button></div></form></Section>;
}

function AdminSettings({ api, user, busy, perform }: { api: BackendApi; user: AdminUser; busy: boolean; perform: (work: () => Promise<unknown>, message: string) => Promise<void> }) {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [confirm, setConfirm] = useState(""); const [localError, setLocalError] = useState("");
  return <Section title="Administrator security" description="This deployment has one administrator."><div className="admin-identity"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.email}</span><small>Last sign in {formatDateTime(user.lastLoginAt)}</small></div></div>{localError ? <Alert tone="danger" onClose={() => setLocalError("")}>{localError}</Alert> : null}<form className="settings-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (next !== confirm) { setLocalError("New passwords do not match."); return; } void perform(async () => { await api.changePassword(current, next); setCurrent(""); setNext(""); setConfirm(""); }, "Administrator password changed."); }}><div className="form-grid three"><Field label="Current password"><input type="password" required autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></Field><Field label="New password"><input type="password" required minLength={12} autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></Field><Field label="Confirm new password"><input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field></div><div className="form-actions"><Button type="submit" disabled={busy}><LockKeyhole /> Change password</Button></div></form></Section>;
}

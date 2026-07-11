import { ArrowRight, Check, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "../components/ui";
import { errorMessage } from "../utils/format";

export function LoginPage({ setupRequired, backendUrl, onLogin, onSetup }: {
  setupRequired: boolean;
  backendUrl: string;
  onLogin: (email: string, password: string) => Promise<void>;
  onSetup: (input: {
    setupToken: string;
    productName: string;
    origin: string;
    adminEmail: string;
    adminName: string;
    password: string;
  }) => Promise<void>;
}) {
  return setupRequired
    ? <FirstRun backendUrl={backendUrl} onSubmit={onSetup} />
    : <SignIn backendUrl={backendUrl} onSubmit={onLogin} />;
}

function SignIn({ backendUrl, onSubmit }: { backendUrl: string; onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await onSubmit(email, password); } catch (cause) { setError(errorMessage(cause, "Sign in failed.")); } finally { setBusy(false); }
  };
  return (
    <main className="auth-page">
      <section className="auth-shell" aria-labelledby="auth-title">
        <AuthBrand />
        <div className="auth-heading"><span className="eyebrow">Administrator console</span><h1 id="auth-title">Sign in to Mia</h1><p>Manage one production product, its knowledge, permissions, and agent runs.</p></div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Button type="submit" disabled={busy}>{busy ? "Signing in" : "Sign in"}<ArrowRight /></Button>
        </form>
        <AuthFooter backendUrl={backendUrl} />
      </section>
    </main>
  );
}

function FirstRun({ backendUrl, onSubmit }: {
  backendUrl: string;
  onSubmit: (input: { setupToken: string; productName: string; origin: string; adminEmail: string; adminName: string; password: string }) => Promise<void>;
}) {
  const [values, setValues] = useState({ setupToken: "", productName: "", origin: "", adminEmail: "", adminName: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (values.password !== values.confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        setupToken: values.setupToken,
        productName: values.productName,
        origin: values.origin.replace(/\/$/, ""),
        adminEmail: values.adminEmail,
        adminName: values.adminName,
        password: values.password
      });
    } catch (cause) { setError(errorMessage(cause, "Setup failed.")); } finally { setBusy(false); }
  };
  return (
    <main className="auth-page first-run">
      <section className="auth-shell auth-shell-wide" aria-labelledby="setup-title">
        <AuthBrand />
        <div className="auth-heading"><span className="eyebrow">Secure first run</span><h1 id="setup-title">Create your Mia deployment</h1><p>This initializes the only product and administrator. No default account is created.</p></div>
        <div className="security-strip"><ShieldCheck /><span>PostgreSQL is connected</span><Check /><span>Fresh v1 data</span><Check /><span>Single administrator</span></div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <form className="auth-form auth-grid" onSubmit={(event) => void submit(event)}>
          <Field label="Setup token" hint="The SETUP_TOKEN configured on the Mia backend." className="span-2"><input type="password" autoComplete="off" required value={values.setupToken} onChange={(event) => set("setupToken", event.target.value)} /></Field>
          <Field label="Product name"><input required maxLength={200} value={values.productName} onChange={(event) => set("productName", event.target.value)} placeholder="Acme CRM" /></Field>
          <Field label="Production origin" hint="Exact HTTPS origin; localhost may use HTTP."><input type="url" required value={values.origin} onChange={(event) => set("origin", event.target.value)} placeholder="https://app.example.com" /></Field>
          <Field label="Administrator name"><input required autoComplete="name" value={values.adminName} onChange={(event) => set("adminName", event.target.value)} /></Field>
          <Field label="Administrator email"><input type="email" required autoComplete="username" value={values.adminEmail} onChange={(event) => set("adminEmail", event.target.value)} /></Field>
          <Field label="Password" hint="At least 12 characters."><input type="password" minLength={12} required autoComplete="new-password" value={values.password} onChange={(event) => set("password", event.target.value)} /></Field>
          <Field label="Confirm password"><input type="password" minLength={12} required autoComplete="new-password" value={values.confirm} onChange={(event) => set("confirm", event.target.value)} /></Field>
          <div className="span-2 auth-submit"><Button type="submit" disabled={busy}>{busy ? "Creating deployment" : "Create deployment"}<ArrowRight /></Button></div>
        </form>
        <AuthFooter backendUrl={backendUrl} />
      </section>
    </main>
  );
}

function AuthBrand() {
  return <div className="auth-brand"><div className="brand-mark"><span>M</span></div><div><strong>Mia</strong><span>Product Agent</span></div></div>;
}

function AuthFooter({ backendUrl }: { backendUrl: string }) {
  return <footer className="auth-footer"><LockKeyhole /><span>{backendUrl}</span><KeyRound /><span>Credentials stay on this deployment</span></footer>;
}

import { Command, Lock, Mail, Server, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

type LoginInput = {
  backendUrl: string;
  email: string;
  password: string;
};

type SetupInput = LoginInput & {
  name: string;
  bootstrapToken: string;
};

export function LoginPage({
  backendUrl,
  setupRequired,
  onLogin,
  onSetup
}: {
  backendUrl: string;
  setupRequired: boolean;
  onLogin: (input: LoginInput) => Promise<void>;
  onSetup: (input: SetupInput) => Promise<void>;
}) {
  const [urlDraft, setUrlDraft] = useState(backendUrl);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextBackendUrl = urlDraft.trim();
    const nextEmail = email.trim();
    const nextName = name.trim();
    const nextPassword = password;
    const nextBootstrapToken = bootstrapToken.trim();

    if (!nextBackendUrl) {
      setError("Enter the backend URL.");
      return;
    }
    if (!nextEmail || !nextPassword) {
      setError("Enter your email and password.");
      return;
    }
    if (setupRequired && !nextName) {
      setError("Enter the admin name.");
      return;
    }
    if (setupRequired && !nextBootstrapToken) {
      setError("Enter the bootstrap token from the backend environment.");
      return;
    }

    setPending(true);
    setError("");
    try {
      if (setupRequired) {
        await onSetup({
          backendUrl: nextBackendUrl,
          email: nextEmail,
          name: nextName,
          password: nextPassword,
          bootstrapToken: nextBootstrapToken
        });
      } else {
        await onLogin({ backendUrl: nextBackendUrl, email: nextEmail, password: nextPassword });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-visual" aria-hidden="true">
        <div className="login-visual-brand">
          <span className="brand-tile large">
            <Command size={18} />
          </span>
          <span>Mia Console</span>
        </div>
        <div className="login-grid-pattern" />
        <blockquote>
          <p>Review UI maps, approve workflow steps, publish onboarding flows, and manage SDK access from one console.</p>
          <footer>Self-hosted admin console</footer>
        </blockquote>
      </section>
      <section className="login-card">
        <div className="login-brand-row">
          <span className="brand-tile">
            <Command size={17} />
          </span>
          <div>
            <div className="brand-name">Mia Console</div>
            <div className="brand-subtitle">{setupRequired ? "Create admin account" : "Admin sign in"}</div>
          </div>
        </div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <div>
            <h1>{setupRequired ? "Create the first admin" : "Sign in to console"}</h1>
            <p>
              {setupRequired
                ? "Set up the first console admin with the backend bootstrap token."
                : "Use your console email and password to manage this backend."}
            </p>
          </div>

          <label>
            Backend URL
            <span className="input-with-icon">
              <Server size={15} />
              <input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} autoComplete="url" />
            </span>
          </label>

          {setupRequired && (
            <label>
              Name
              <span className="input-with-icon">
                <UserPlus size={15} />
                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
              </span>
            </label>
          )}

          <label>
            Email
            <span className="input-with-icon">
              <Mail size={15} />
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
            </span>
          </label>

          <label>
            Password
            <span className="input-with-icon">
              <Lock size={15} />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={setupRequired ? "new-password" : "current-password"}
              />
            </span>
          </label>

          {setupRequired && (
            <label>
              Bootstrap token
              <span className="input-with-icon">
                <Lock size={15} />
                <input value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} type="password" autoComplete="off" />
              </span>
            </label>
          )}

          {error && <div className="error-line">{error}</div>}
          <button className="button primary full" type="submit" disabled={pending}>
            {setupRequired ? <UserPlus size={16} /> : <Lock size={16} />}
            {pending ? "Please wait" : setupRequired ? "Create admin" : "Sign in"}
          </button>
          {setupRequired && <div className="login-hint">The bootstrap token is only accepted while no console admin exists.</div>}
        </form>
      </section>
    </main>
  );
}

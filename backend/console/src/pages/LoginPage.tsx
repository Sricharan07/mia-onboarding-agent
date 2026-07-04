import { Command, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";

export function LoginPage({
  backendUrl,
  onLogin
}: {
  backendUrl: string;
  onLogin: (input: { backendUrl: string; adminApiKey?: string; bootstrapToken?: string }) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(backendUrl);
  const [adminApiKey, setAdminApiKey] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextBackendUrl = urlDraft.trim();
    if (!nextBackendUrl) {
      setError("Enter the backend URL.");
      return;
    }
    if (adminApiKey.trim() || bootstrapToken.trim()) {
      onLogin({ backendUrl: nextBackendUrl, adminApiKey, bootstrapToken });
      return;
    }
    setError("Enter an admin API key, or a bootstrap token to create the first admin key.");
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
          <p>Review UI maps, approve workflow steps, and publish the onboarding agent from one console.</p>
          <footer>Local backend console</footer>
        </blockquote>
      </section>
      <section className="login-card">
        <div className="login-brand-row">
          <span className="brand-tile">
            <Command size={17} />
          </span>
          <div>
            <div className="brand-name">Mia Console</div>
            <div className="brand-subtitle">Developer interface</div>
          </div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p>Use an admin API key to operate the console, or bootstrap once with `BOOTSTRAP_ADMIN_TOKEN`.</p>
          </div>
          <label>
            Backend URL
            <input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} autoComplete="url" />
          </label>
          <label>
            Admin API key
            <input value={adminApiKey} onChange={(event) => setAdminApiKey(event.target.value)} type="password" autoComplete="off" />
          </label>
          <label>
            Bootstrap token
            <input value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} type="password" autoComplete="off" />
          </label>
          {error && <div className="error-line">{error}</div>}
          <button className="button primary full" type="submit">
            <Lock size={16} />
            Sign in
          </button>
          <div className="login-hint">Bootstrap token is only used for `POST /api/v1/api-keys`.</div>
        </form>
      </section>
    </main>
  );
}

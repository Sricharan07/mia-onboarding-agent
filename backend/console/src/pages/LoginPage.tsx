import { Command, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (username === "admin" && password === "admin") {
      onLogin();
      return;
    }
    setError("Use admin / admin for the local console.");
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
            <p>Use the local admin credentials to configure and publish onboarding workflows.</p>
          </div>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {error && <div className="error-line">{error}</div>}
          <button className="button primary full" type="submit">
            <Lock size={16} />
            Sign in
          </button>
          <div className="login-hint">Default credentials: admin / admin</div>
        </form>
      </section>
    </main>
  );
}

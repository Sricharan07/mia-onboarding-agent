import { Command, Lock, Mail, Server, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../utils/format";

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
  onSetup,
  onCheckSetupRequired
}: {
  backendUrl: string;
  setupRequired: boolean;
  onLogin: (input: LoginInput) => Promise<void>;
  onSetup: (input: SetupInput) => Promise<void>;
  onCheckSetupRequired: (backendUrl: string) => Promise<boolean>;
}) {
  const [urlDraft, setUrlDraft] = useState(backendUrl);
  const [draftSetupRequired, setDraftSetupRequired] = useState(setupRequired);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUrlDraft(backendUrl);
    setDraftSetupRequired(setupRequired);
  }, [backendUrl, setupRequired]);

  const checkSetupRequired = async (nextBackendUrl: string): Promise<boolean> => {
    const nextSetupRequired = await onCheckSetupRequired(nextBackendUrl);
    setDraftSetupRequired(nextSetupRequired);
    return nextSetupRequired;
  };

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
    setPending(true);
    setError("");
    try {
      const nextSetupRequired = await checkSetupRequired(nextBackendUrl);
      if (nextSetupRequired && !nextName) {
        setError("Enter the admin name.");
        return;
      }
      if (nextSetupRequired && !nextBootstrapToken) {
        setError("Enter the bootstrap token from the backend environment.");
        return;
      }

      if (nextSetupRequired) {
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
      setError(errorMessage(cause, "Unable to sign in."));
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
            <div className="brand-subtitle">{draftSetupRequired ? "Create admin account" : "Admin sign in"}</div>
          </div>
        </div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <div>
            <h1>{draftSetupRequired ? "Create the first admin" : "Sign in to console"}</h1>
            <p>
              {draftSetupRequired
                ? "Set up the first console admin with the backend bootstrap token."
                : "Use your console email and password to manage this backend."}
            </p>
          </div>

          <label>
            Backend URL
            <span className="input-with-icon">
              <Server size={15} />
              <input
                value={urlDraft}
                onBlur={() => {
                  const nextBackendUrl = urlDraft.trim();
                  if (nextBackendUrl) void checkSetupRequired(nextBackendUrl).catch((cause) => setError(errorMessage(cause, "Unable to check backend auth status.")));
                }}
                onChange={(event) => setUrlDraft(event.target.value)}
                autoComplete="url"
              />
            </span>
          </label>

          {draftSetupRequired && (
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
                autoComplete={draftSetupRequired ? "new-password" : "current-password"}
              />
            </span>
          </label>

          {draftSetupRequired && (
              <label>
                Bootstrap token
                <span className="input-with-icon">
                  <Lock size={15} />
                  <input value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} type="password" autoComplete="off" />
                </span>
                <span className="field-help">Use the backend environment value named BOOTSTRAP_ADMIN_TOKEN. It only works before the first admin exists.</span>
              </label>
          )}

          {error && <div className="error-line">{error}</div>}
          <button className="button primary full" type="submit" disabled={pending}>
            {draftSetupRequired ? <UserPlus size={16} /> : <Lock size={16} />}
            {pending ? "Please wait" : draftSetupRequired ? "Create admin" : "Sign in"}
          </button>
          {draftSetupRequired && <div className="login-hint">After setup, sign in with this admin email and password. Do not use the bootstrap token as a normal password.</div>}
        </form>
      </section>
    </main>
  );
}

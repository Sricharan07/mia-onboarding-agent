import type pg from "pg";

type Migration = {
  id: number;
  name: string;
  sql: string;
};

const migrations: Migration[] = [{
  id: 1,
  name: "mia_v1_initial",
  sql: `
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE product (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      name TEXT NOT NULL,
      origin TEXT NOT NULL,
      documentation_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
      redacted_selectors JSONB NOT NULL DEFAULT '[]'::jsonb,
      transcript_mode TEXT NOT NULL DEFAULT 'full' CHECK (transcript_mode IN ('full', 'redacted', 'disabled')),
      transcript_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (transcript_retention_days BETWEEN 1 AND 365),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE admin_user (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );

    CREATE TABLE admin_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX admin_sessions_active_idx ON admin_sessions (expires_at) WHERE revoked_at IS NULL;

    CREATE TABLE integration_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL,
      allowed_origin TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE runtime_tokens (
      id TEXT PRIMARY KEY,
      prefix TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      user_id TEXT NOT NULL,
      allowed_origin TEXT NOT NULL,
      capabilities JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      max_uses INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX runtime_tokens_expiry_idx ON runtime_tokens (expires_at);

    CREATE TABLE knowledge_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('documentation_url', 'document_file', 'ui_map', 'recording', 'skill')),
      name TEXT NOT NULL,
      source_url TEXT,
      file_path TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'archived')),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE knowledge_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      embedding VECTOR(768),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source_id, content_hash)
    );
    CREATE INDEX knowledge_chunks_search_idx ON knowledge_chunks USING GIN (search_vector);
    CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

    CREATE TABLE ui_map_versions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'scanning', 'ready', 'failed')),
      routes JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error TEXT
    );

    CREATE TABLE ui_elements (
      id TEXT PRIMARY KEY,
      map_version_id TEXT NOT NULL REFERENCES ui_map_versions(id) ON DELETE CASCADE,
      element_key TEXT NOT NULL,
      route TEXT NOT NULL,
      role TEXT,
      name TEXT,
      description TEXT,
      locators JSONB NOT NULL DEFAULT '[]'::jsonb,
      fingerprint TEXT NOT NULL,
      action_policy TEXT NOT NULL DEFAULT 'guide_only' CHECK (action_policy IN ('guide_only', 'navigate', 'reversible_write', 'manual', 'blocked')),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (map_version_id, element_key)
    );
    CREATE INDEX ui_elements_route_idx ON ui_elements (map_version_id, route);

    CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('uploaded', 'processing', 'needs_review', 'ready', 'failed')),
      analysis JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      goal TEXT NOT NULL,
      business_context TEXT NOT NULL DEFAULT '',
      steps JSONB NOT NULL,
      constraints JSONB NOT NULL DEFAULT '[]'::jsonb,
      expected_outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL CHECK (status IN ('draft', 'needs_review', 'published', 'archived')),
      version INTEGER NOT NULL DEFAULT 1,
      recording_id TEXT REFERENCES recordings(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ
    );

    CREATE TABLE host_actions (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      input_schema JSONB NOT NULL,
      risk TEXT NOT NULL CHECK (risk IN ('read', 'navigate', 'reversible_write', 'manual', 'blocked')),
      status TEXT NOT NULL CHECK (status IN ('detected', 'needs_review', 'published', 'blocked')),
      manifest_hash TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );

    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY,
      resume_token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'waiting_user', 'waiting_confirmation', 'completed', 'failed', 'cancelled')),
      revision INTEGER NOT NULL DEFAULT 0,
      goal TEXT NOT NULL,
      current_route TEXT,
      step_count INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      loop_signature TEXT,
      loop_count INTEGER NOT NULL DEFAULT 0,
      pending_confirmation JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      error TEXT
    );
    CREATE INDEX agent_sessions_user_idx ON agent_sessions (user_id, updated_at DESC);

    CREATE TABLE agent_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      source TEXT NOT NULL CHECK (source IN ('text', 'voice', 'runtime')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX agent_turns_session_idx ON agent_turns (session_id, created_at);

    CREATE TABLE agent_steps (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL,
      observation_revision INTEGER NOT NULL,
      assessment TEXT NOT NULL,
      progress TEXT NOT NULL,
      directive JSONB NOT NULL,
      retrieved_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      model TEXT NOT NULL,
      latency_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      status TEXT NOT NULL CHECK (status IN ('issued', 'completed', 'failed', 'cancelled')),
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (session_id, step_index)
    );

    CREATE TABLE action_receipts (
      action_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES agent_steps(id) ON DELETE SET NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      action_type TEXT NOT NULL,
      target_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed', 'unverified', 'failed', 'cancelled', 'manual')),
      message TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE confirmations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      binding_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
      source TEXT CHECK (source IN ('text', 'voice', 'ui')),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX confirmations_pending_idx ON confirmations (session_id, expires_at) WHERE status = 'pending';

    CREATE TABLE runtime_events (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      user_id TEXT,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX runtime_events_created_idx ON runtime_events (created_at DESC);

    CREATE TABLE ai_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
      purpose TEXT NOT NULL,
      model TEXT NOT NULL,
      latency_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
}, {
  id: 2,
  name: "encrypted_product_settings",
  sql: `
    ALTER TABLE product
      ADD COLUMN scan_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN voice_config JSONB NOT NULL DEFAULT '{"enabled":true,"voice":"Aoede","language":"en-US"}'::jsonb;

    CREATE TABLE encrypted_secrets (
      name TEXT PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$'),
      ciphertext TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `
}];

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [7_319_941]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = await client.query<{ id: number; name: string }>("SELECT id, name FROM schema_migrations ORDER BY id");
    const byId = new Map(applied.rows.map((row) => [row.id, row.name]));
    for (const migration of migrations) {
      const existing = byId.get(migration.id);
      if (existing && existing !== migration.name) throw new Error(`Migration ${migration.id} was recorded as ${existing}, expected ${migration.name}.`);
      if (existing) continue;
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [migration.id, migration.name]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

-- Legacy AgentMail schema, retained verbatim for migration safety.
--
-- This migration was applied to production as 20260715060100_init_agentmail but
-- previously existed in this repository only as a Prisma migration, so a fresh
-- database could not reproduce production: 20260724105855_foreign_key_indexes
-- indexes public."Attachment" and public."EmailTemplate", which are created
-- here. It is recorded so `supabase db push` against an empty project produces
-- the production schema without any manually created state.
--
-- These tables back no v1 marketplace route. The v1 surface uses the v1_*
-- tables exclusively. They are kept rather than dropped so that already-applied
-- production migrations stay reproducible; see docs.md "Retained legacy schema".

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Agent" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "emailAddress" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "webhookUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "signature" TEXT,
  "autoReply" TEXT,
  "autoReplyActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Email" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agentId" TEXT NOT NULL REFERENCES "Agent"("id") ON DELETE CASCADE,
  "messageId" TEXT,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "cc" TEXT,
  "bcc" TEXT,
  "replyTo" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "html" TEXT,
  "direction" TEXT NOT NULL,
  "threadId" TEXT,
  "inReplyTo" TEXT,
  "references" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "openedAt" TIMESTAMPTZ,
  "deliveredAt" TIMESTAMPTZ,
  "bouncedAt" TIMESTAMPTZ,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "emailId" TEXT NOT NULL REFERENCES "Email"("id") ON DELETE CASCADE,
  "filename" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastUsed" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "EmailTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "html" TEXT,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_agent ON "Email"("agentId");
CREATE INDEX idx_email_thread ON "Email"("threadId");
CREATE INDEX idx_email_direction ON "Email"("direction");
CREATE INDEX idx_email_created ON "Email"("createdAt" DESC);
CREATE INDEX idx_agent_user ON "Agent"("userId");
CREATE INDEX idx_apikey_user ON "ApiKey"("userId");

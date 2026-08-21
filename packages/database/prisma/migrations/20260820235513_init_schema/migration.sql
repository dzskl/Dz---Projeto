-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('CONNECTED', 'DISABLED', 'INVALID_TOKEN', 'ERROR');

-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('PRIVATE', 'GROUP', 'SUPERGROUP', 'CHANNEL');

-- CreateEnum
CREATE TYPE "BotChatStatus" AS ENUM ('MEMBER', 'ADMINISTRATOR', 'LEFT', 'KICKED');

-- CreateEnum
CREATE TYPE "BotUserStatus" AS ENUM ('ACTIVE', 'BLOCKED_BOT', 'DEACTIVATED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('START_COMMAND', 'PRIVATE_MESSAGE', 'CALLBACK_QUERY', 'MANUAL');

-- CreateEnum
CREATE TYPE "OptOutReason" AS ENUM ('USER_REQUEST', 'BLOCKED_BOT', 'DEACTIVATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE', 'ANIMATION');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "EventSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'OWNER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" UUID NOT NULL,
    "telegram_bot_id" BIGINT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "token_hint" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "status" "BotStatus" NOT NULL DEFAULT 'CONNECTED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rate_per_second" INTEGER NOT NULL DEFAULT 20,
    "last_check_at" TIMESTAMPTZ(3),
    "last_error_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "telegram_chat_id" BIGINT NOT NULL,
    "type" "ChatType" NOT NULL,
    "title" TEXT,
    "username" TEXT,
    "member_count" INTEGER,
    "bot_status" "BotChatStatus" NOT NULL DEFAULT 'MEMBER',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_users" (
    "id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "username" TEXT,
    "language_code" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "telegram_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_users" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "telegram_user_id" UUID NOT NULL,
    "private_chat_id" BIGINT,
    "status" "BotUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "consent_source" "ConsentSource" NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_payload" TEXT,
    "last_interaction_at" TIMESTAMPTZ(3),
    "status_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bot_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opt_outs" (
    "id" UUID NOT NULL,
    "bot_id" UUID,
    "telegram_user_id" UUID NOT NULL,
    "reason" "OptOutReason" NOT NULL,
    "note" TEXT,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_sec" INTEGER,
    "storage_path" TEXT NOT NULL,
    "checksum_sha256" TEXT,
    "telegram_file_id" TEXT,
    "derived_via" TEXT,
    "parent_id" UUID,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bot_id" UUID NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "audience_filter" JSONB,
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "rate_per_second" INTEGER NOT NULL DEFAULT 20,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_messages" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "text" TEXT,
    "parse_mode" TEXT,
    "caption" TEXT,
    "media_asset_id" UUID,
    "buttons" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "bot_user_id" UUID NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "telegram_message_id" BIGINT,
    "queued_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_logs" (
    "id" UUID NOT NULL,
    "campaign_id" UUID,
    "recipient_id" UUID,
    "bot_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "success" BOOLEAN NOT NULL,
    "http_status" INTEGER,
    "telegram_error_code" TEXT,
    "error_description" TEXT,
    "retry_after_sec" INTEGER,
    "duration_ms" INTEGER,
    "correlation_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "id" UUID NOT NULL,
    "bot_id" UUID NOT NULL,
    "update_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_events" (
    "id" UUID NOT NULL,
    "severity" "EventSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_admin_id_idx" ON "sessions"("admin_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_created_at_idx" ON "audit_logs"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bots_telegram_bot_id_key" ON "bots"("telegram_bot_id");

-- CreateIndex
CREATE INDEX "bots_status_idx" ON "bots"("status");

-- CreateIndex
CREATE INDEX "chats_bot_id_type_idx" ON "chats"("bot_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "chats_bot_id_telegram_chat_id_key" ON "chats"("bot_id", "telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_users_telegram_user_id_key" ON "telegram_users"("telegram_user_id");

-- CreateIndex
CREATE INDEX "telegram_users_username_idx" ON "telegram_users"("username");

-- CreateIndex
CREATE INDEX "bot_users_bot_id_status_idx" ON "bot_users"("bot_id", "status");

-- CreateIndex
CREATE INDEX "bot_users_bot_id_last_interaction_at_idx" ON "bot_users"("bot_id", "last_interaction_at");

-- CreateIndex
CREATE UNIQUE INDEX "bot_users_bot_id_telegram_user_id_key" ON "bot_users"("bot_id", "telegram_user_id");

-- CreateIndex
CREATE INDEX "opt_outs_telegram_user_id_idx" ON "opt_outs"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "opt_outs_bot_id_telegram_user_id_key" ON "opt_outs"("bot_id", "telegram_user_id");

-- CreateIndex
CREATE INDEX "media_assets_kind_idx" ON "media_assets"("kind");

-- CreateIndex
CREATE INDEX "media_assets_checksum_sha256_idx" ON "media_assets"("checksum_sha256");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "campaigns_bot_id_status_idx" ON "campaigns"("bot_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_messages_campaign_id_order_key" ON "campaign_messages"("campaign_id", "order");

-- CreateIndex
CREATE INDEX "campaign_recipients_campaign_id_status_idx" ON "campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaign_id_bot_user_id_key" ON "campaign_recipients"("campaign_id", "bot_user_id");

-- CreateIndex
CREATE INDEX "send_logs_campaign_id_created_at_idx" ON "send_logs"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "send_logs_bot_id_created_at_idx" ON "send_logs"("bot_id", "created_at");

-- CreateIndex
CREATE INDEX "send_logs_correlation_id_idx" ON "send_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "telegram_updates_bot_id_created_at_idx" ON "telegram_updates"("bot_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_bot_id_update_id_key" ON "telegram_updates"("bot_id", "update_id");

-- CreateIndex
CREATE INDEX "system_events_severity_resolved_at_idx" ON "system_events"("severity", "resolved_at");

-- CreateIndex
CREATE INDEX "system_events_created_at_idx" ON "system_events"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_users" ADD CONSTRAINT "bot_users_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_users" ADD CONSTRAINT "bot_users_telegram_user_id_fkey" FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_telegram_user_id_fkey" FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_bot_user_id_fkey" FOREIGN KEY ("bot_user_id") REFERENCES "bot_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

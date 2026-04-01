import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1711900000000 implements MigrationInterface {
  name = 'InitialSchema1711900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_role_enum" AS ENUM ('platform_admin', 'store_admin', 'content_reviewer', 'auditor');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "user_status_enum" AS ENUM ('active', 'suspended', 'locked');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "seat_status_enum" AS ENUM ('available', 'disabled', 'maintenance');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "reservation_status_enum" AS ENUM ('hold', 'confirmed', 'cancelled', 'expired');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "product_status_enum" AS ENUM ('draft', 'pending_review', 'published', 'unpublished');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "order_status_enum" AS ENUM ('pending', 'confirmed', 'fulfilled', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "promotion_type_enum" AS ENUM ('threshold', 'percentage', 'first_order');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "discount_type_enum" AS ENUM ('fixed_cents', 'percentage');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "coupon_status_enum" AS ENUM ('active', 'expired', 'exhausted');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "question_type_enum" AS ENUM ('objective', 'subjective');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "question_status_enum" AS ENUM ('draft', 'pending_review', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "attempt_status_enum" AS ENUM ('in_progress', 'submitted', 'graded');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "rule_type_enum" AS ENUM ('completeness', 'range', 'uniqueness');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // Stores
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_stores_name" UNIQUE ("name"),
        CONSTRAINT "PK_stores" PRIMARY KEY ("id")
      )
    `);

    // Users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" varchar NOT NULL,
        "password_hash" varchar NOT NULL,
        "role" "user_role_enum" NOT NULL DEFAULT 'store_admin',
        "store_id" uuid,
        "status" "user_status_enum" NOT NULL DEFAULT 'active',
        "failed_login_count" integer NOT NULL DEFAULT 0,
        "locked_until" TIMESTAMP WITH TIME ZONE,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "FK_users_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL
      )
    `);

    // Study Rooms
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "study_rooms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_study_rooms" PRIMARY KEY ("id")
      )
    `);

    // Zones
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "zones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "room_id" uuid NOT NULL,
        "name" varchar NOT NULL,
        CONSTRAINT "PK_zones" PRIMARY KEY ("id"),
        CONSTRAINT "FK_zones_room" FOREIGN KEY ("room_id") REFERENCES "study_rooms"("id") ON DELETE CASCADE
      )
    `);

    // Seats
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seats" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "zone_id" uuid NOT NULL,
        "label" varchar NOT NULL,
        "power_outlet" boolean NOT NULL DEFAULT false,
        "quiet_zone" boolean NOT NULL DEFAULT false,
        "ada_accessible" boolean NOT NULL DEFAULT false,
        "status" "seat_status_enum" NOT NULL DEFAULT 'available',
        CONSTRAINT "PK_seats" PRIMARY KEY ("id"),
        CONSTRAINT "FK_seats_zone" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE
      )
    `);

    // Seat Map Versions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "seat_map_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "room_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "created_by" uuid NOT NULL,
        "change_note" text NOT NULL,
        "snapshot" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_seat_map_versions_room_version" UNIQUE ("room_id", "version_number"),
        CONSTRAINT "PK_seat_map_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_seat_map_versions_room" FOREIGN KEY ("room_id") REFERENCES "study_rooms"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_seat_map_versions_user" FOREIGN KEY ("created_by") REFERENCES "users"("id")
      )
    `);

    // Reservations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reservations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "seat_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "status" "reservation_status_enum" NOT NULL DEFAULT 'hold',
        "hold_until" TIMESTAMP WITH TIME ZONE NOT NULL,
        "confirmed_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reservations_seat" FOREIGN KEY ("seat_id") REFERENCES "seats"("id"),
        CONSTRAINT "FK_reservations_user" FOREIGN KEY ("user_id") REFERENCES "users"("id")
      )
    `);

    // Categories
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        "parent_id" uuid,
        CONSTRAINT "UQ_categories_name" UNIQUE ("name"),
        CONSTRAINT "PK_categories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_categories_parent" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL
      )
    `);

    // Brands
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "brands" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar NOT NULL,
        CONSTRAINT "UQ_brands_name" UNIQUE ("name"),
        CONSTRAINT "PK_brands" PRIMARY KEY ("id")
      )
    `);

    // Products (SPU)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "name" varchar NOT NULL,
        "category_id" uuid,
        "brand_id" uuid,
        "status" "product_status_enum" NOT NULL DEFAULT 'draft',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "FK_products_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "FK_products_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id"),
        CONSTRAINT "FK_products_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id")
      )
    `);

    // SKUs
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "skus" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "sku_code" varchar NOT NULL,
        "price_cents" integer NOT NULL,
        "member_price_cents" integer,
        "attributes" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_skus_sku_code" UNIQUE ("sku_code"),
        CONSTRAINT "PK_skus" PRIMARY KEY ("id"),
        CONSTRAINT "FK_skus_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    // SKU Price Tiers
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sku_price_tiers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sku_id" uuid NOT NULL,
        "tier_name" varchar NOT NULL,
        "price_cents" integer NOT NULL,
        CONSTRAINT "PK_sku_price_tiers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sku_price_tiers_sku" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE CASCADE
      )
    `);

    // Inventory Lots
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_lots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sku_id" uuid NOT NULL,
        "batch_code" varchar NOT NULL,
        "expiration_date" date,
        "quantity" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_lots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_lots_sku" FOREIGN KEY ("sku_id") REFERENCES "skus"("id")
      )
    `);

    // Inventory Adjustments
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_adjustments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "lot_id" uuid NOT NULL,
        "delta" integer NOT NULL,
        "reason_code" varchar NOT NULL,
        "idempotency_key" varchar NOT NULL,
        "adjusted_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_inventory_adjustments_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "PK_inventory_adjustments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventory_adjustments_lot" FOREIGN KEY ("lot_id") REFERENCES "inventory_lots"("id"),
        CONSTRAINT "FK_inventory_adjustments_user" FOREIGN KEY ("adjusted_by") REFERENCES "users"("id")
      )
    `);

    // Promotions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "promotions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "name" varchar NOT NULL,
        "type" "promotion_type_enum" NOT NULL,
        "priority" integer NOT NULL,
        "discount_type" "discount_type_enum" NOT NULL,
        "discount_value" integer NOT NULL,
        "min_order_cents" integer,
        "starts_at" TIMESTAMP WITH TIME ZONE,
        "ends_at" TIMESTAMP WITH TIME ZONE,
        "redemption_cap" integer,
        "redemption_count" integer NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_promotions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_promotions_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      )
    `);

    // Coupons
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupons" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "code" varchar NOT NULL,
        "promotion_id" uuid NOT NULL,
        "remaining_quantity" integer,
        "starts_at" TIMESTAMP WITH TIME ZONE,
        "ends_at" TIMESTAMP WITH TIME ZONE,
        "status" "coupon_status_enum" NOT NULL DEFAULT 'active',
        CONSTRAINT "UQ_coupons_code" UNIQUE ("code"),
        CONSTRAINT "PK_coupons" PRIMARY KEY ("id"),
        CONSTRAINT "FK_coupons_promotion" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id"),
        CONSTRAINT "FK_coupons_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      )
    `);

    // Orders
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "user_id" uuid NOT NULL,
        "status" "order_status_enum" NOT NULL DEFAULT 'pending',
        "idempotency_key" varchar NOT NULL,
        "total_cents" integer NOT NULL,
        "discount_cents" integer NOT NULL DEFAULT 0,
        "coupon_id" uuid,
        "promotion_id" uuid,
        "internal_notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orders_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "FK_orders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id")
      )
    `);

    // Order Items
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "sku_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "unit_price_cents" integer NOT NULL,
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_sku" FOREIGN KEY ("sku_id") REFERENCES "skus"("id")
      )
    `);

    // Coupon Claims
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coupon_claims" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "coupon_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "claimed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "redeemed_at" TIMESTAMP WITH TIME ZONE,
        "order_id" uuid,
        CONSTRAINT "PK_coupon_claims" PRIMARY KEY ("id"),
        CONSTRAINT "FK_coupon_claims_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id"),
        CONSTRAINT "FK_coupon_claims_user" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_coupon_claims_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      )
    `);

    // Idempotency Keys
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_keys" (
        "key" varchar NOT NULL,
        "operation_type" varchar NOT NULL,
        "response_body" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key")
      )
    `);

    // Questions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "questions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "type" "question_type_enum" NOT NULL,
        "body" text NOT NULL,
        "status" "question_status_enum" NOT NULL DEFAULT 'draft',
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_questions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_questions_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "FK_questions_user" FOREIGN KEY ("created_by") REFERENCES "users"("id")
      )
    `);

    // Question Options
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "question_options" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "question_id" uuid NOT NULL,
        "body" text NOT NULL,
        "is_correct" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_question_options" PRIMARY KEY ("id"),
        CONSTRAINT "FK_question_options_question" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE
      )
    `);

    // Question Explanations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "question_explanations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "question_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "body" text NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_question_explanations_question_version" UNIQUE ("question_id", "version_number"),
        CONSTRAINT "PK_question_explanations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_question_explanations_question" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_question_explanations_user" FOREIGN KEY ("created_by") REFERENCES "users"("id")
      )
    `);

    // Papers
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "papers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "name" varchar NOT NULL,
        "generation_rule" jsonb NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_papers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_papers_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "FK_papers_user" FOREIGN KEY ("created_by") REFERENCES "users"("id")
      )
    `);

    // Paper Questions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_questions" (
        "paper_id" uuid NOT NULL,
        "question_id" uuid NOT NULL,
        "position" integer NOT NULL,
        CONSTRAINT "PK_paper_questions" PRIMARY KEY ("paper_id", "question_id"),
        CONSTRAINT "FK_paper_questions_paper" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_paper_questions_question" FOREIGN KEY ("question_id") REFERENCES "questions"("id")
      )
    `);

    // Attempts
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "paper_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "parent_attempt_id" uuid,
        "status" "attempt_status_enum" NOT NULL DEFAULT 'in_progress',
        "score" decimal,
        "graded_at" TIMESTAMP WITH TIME ZONE,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "submitted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attempts_paper" FOREIGN KEY ("paper_id") REFERENCES "papers"("id"),
        CONSTRAINT "FK_attempts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_attempts_parent" FOREIGN KEY ("parent_attempt_id") REFERENCES "attempts"("id")
      )
    `);

    // Attempt Answers
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attempt_answers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "attempt_id" uuid NOT NULL,
        "question_id" uuid NOT NULL,
        "selected_option_id" uuid,
        "text_answer" text,
        "is_correct" boolean,
        CONSTRAINT "PK_attempt_answers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attempt_answers_attempt" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attempt_answers_question" FOREIGN KEY ("question_id") REFERENCES "questions"("id"),
        CONSTRAINT "FK_attempt_answers_option" FOREIGN KEY ("selected_option_id") REFERENCES "question_options"("id")
      )
    `);

    // Data Quality Rules
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "data_quality_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entity_type" varchar NOT NULL,
        "rule_type" "rule_type_enum" NOT NULL,
        "config" jsonb NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_quality_rules" PRIMARY KEY ("id")
      )
    `);

    // Data Quality Scores
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "data_quality_scores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "entity_type" varchar NOT NULL,
        "score" decimal NOT NULL,
        "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_data_quality_scores" PRIMARY KEY ("id")
      )
    `);

    // Notifications
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "type" varchar NOT NULL,
        "message" text NOT NULL,
        "read" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id")
      )
    `);

    // Audit Logs
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actor_id" uuid,
        "action" varchar NOT NULL,
        "resource_type" varchar,
        "resource_id" uuid,
        "detail" jsonb,
        "trace_id" varchar,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_user" FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      )
    `);

    // Indexes for performance
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_store_id" ON "users" ("store_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_zones_room_id" ON "zones" ("room_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_seats_zone_id" ON "seats" ("zone_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reservations_seat_id" ON "reservations" ("seat_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reservations_user_id" ON "reservations" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reservations_hold_until" ON "reservations" ("hold_until")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_reservations_status" ON "reservations" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_products_store_id" ON "products" ("store_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_products_category_id" ON "products" ("category_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_products_brand_id" ON "products" ("brand_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_skus_product_id" ON "skus" ("product_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_inventory_lots_sku_id" ON "inventory_lots" ("sku_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_orders_store_id" ON "orders" ("store_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_orders_user_id" ON "orders" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_order_items_order_id" ON "order_items" ("order_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_promotions_store_id" ON "promotions" ("store_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_promotions_priority" ON "promotions" ("priority")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coupons_store_id" ON "coupons" ("store_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coupon_claims_coupon_id" ON "coupon_claims" ("coupon_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coupon_claims_user_id" ON "coupon_claims" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_questions_store_id" ON "questions" ("store_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_questions_type" ON "questions" ("type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_questions_status" ON "questions" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_question_options_question_id" ON "question_options" ("question_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attempts_paper_id" ON "attempts" ("paper_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attempts_user_id" ON "attempts" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attempt_answers_attempt_id" ON "attempt_answers" ("attempt_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_attempt_answers_question_id" ON "attempt_answers" ("question_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notifications_user_id" ON "notifications" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_actor_id" ON "audit_logs" ("actor_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_created_at" ON "audit_logs" ("created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action" ON "audit_logs" ("action")`);

    // Seed a default platform admin user (password: admin123)
    // bcrypt hash for 'admin123' with 12 rounds
    await queryRunner.query(`
      INSERT INTO "users" ("username", "password_hash", "role", "status")
      VALUES ('admin', '$2b$12$2JZa1O4tyW/SrKYxRoOXjOlgdvD8gzGiC2Ai3bkUk/XMnB5Emnn.S', 'platform_admin', 'active')
      ON CONFLICT ("username") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "attempt_answers" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attempts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_questions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "papers" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "question_explanations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "question_options" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "questions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "data_quality_scores" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "data_quality_rules" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupon_claims" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coupons" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_adjustments" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_lots" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sku_price_tiers" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skus" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "brands" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "categories" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reservations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "seat_map_versions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "seats" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "zones" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "study_rooms" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stores" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "rule_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "attempt_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "question_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "question_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "coupon_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "discount_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "promotion_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "order_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "product_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "reservation_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "seat_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}

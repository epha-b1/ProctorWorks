import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedDemoData1711900000001 implements MigrationInterface {
  name = 'SeedDemoData1711900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Demo store
    await queryRunner.query(`
      INSERT INTO "stores" ("id", "name")
      VALUES ('a0000000-0000-0000-0000-000000000001', 'Downtown Study Center')
      ON CONFLICT ("name") DO NOTHING
    `);

    // Demo store_admin user (password: Admin1234!)
    //
    // audit_report-2 P2-8: this comment previously read "Store1234!"
    // which conflicted with README §"Default Credentials" — the
    // README is the source of truth, every seeded demo user shares
    // the password `Admin1234!` (the bcrypt hash below is identical
    // to the reviewer/auditor seed rows, which proves the claim).
    await queryRunner.query(`
      INSERT INTO "users" ("id", "username", "password_hash", "role", "store_id", "status")
      VALUES (
        'b0000000-0000-0000-0000-000000000001',
        'store_admin',
        '$2b$12$2JZa1O4tyW/SrKYxRoOXjOlgdvD8gzGiC2Ai3bkUk/XMnB5Emnn.S',
        'store_admin',
        'a0000000-0000-0000-0000-000000000001',
        'active'
      )
      ON CONFLICT ("username") DO NOTHING
    `);

    // Content reviewer (password: Admin1234!)
    await queryRunner.query(`
      INSERT INTO "users" ("id", "username", "password_hash", "role", "status")
      VALUES (
        'b0000000-0000-0000-0000-000000000002',
        'reviewer',
        '$2b$12$2JZa1O4tyW/SrKYxRoOXjOlgdvD8gzGiC2Ai3bkUk/XMnB5Emnn.S',
        'content_reviewer',
        'active'
      )
      ON CONFLICT ("username") DO NOTHING
    `);

    // Auditor (password: Admin1234!)
    await queryRunner.query(`
      INSERT INTO "users" ("id", "username", "password_hash", "role", "status")
      VALUES (
        'b0000000-0000-0000-0000-000000000003',
        'auditor',
        '$2b$12$2JZa1O4tyW/SrKYxRoOXjOlgdvD8gzGiC2Ai3bkUk/XMnB5Emnn.S',
        'auditor',
        'active'
      )
      ON CONFLICT ("username") DO NOTHING
    `);

    // Demo study room
    await queryRunner.query(`
      INSERT INTO "study_rooms" ("id", "name")
      VALUES ('c0000000-0000-0000-0000-000000000001', 'Main Study Hall')
      ON CONFLICT DO NOTHING
    `);

    // Demo zones
    await queryRunner.query(`
      INSERT INTO "zones" ("id", "room_id", "name") VALUES
        ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Quiet Zone'),
        ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Group Zone'),
        ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'ADA Zone')
      ON CONFLICT DO NOTHING
    `);

    // Demo seats — 12 seats with mixed attributes
    await queryRunner.query(`
      INSERT INTO "seats" ("id", "zone_id", "label", "power_outlet", "quiet_zone", "ada_accessible", "status") VALUES
        ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Q-1', true,  true,  false, 'available'),
        ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Q-2', true,  true,  false, 'available'),
        ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001', 'Q-3', false, true,  false, 'available'),
        ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'Q-4', false, true,  true,  'available'),
        ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'G-1', true,  false, false, 'available'),
        ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000002', 'G-2', true,  false, false, 'available'),
        ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000002', 'G-3', false, false, false, 'disabled'),
        ('e0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000002', 'G-4', true,  false, false, 'maintenance'),
        ('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000003', 'A-1', true,  false, true,  'available'),
        ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000003', 'A-2', true,  false, true,  'available'),
        ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000003', 'A-3', true,  true,  true,  'available'),
        ('e0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000003', 'A-4', false, false, true,  'available')
      ON CONFLICT DO NOTHING
    `);

    // Demo category + brand + product + SKU
    await queryRunner.query(`
      INSERT INTO "categories" ("id", "name") VALUES
        ('f0000000-0000-0000-0000-000000000001', 'Study Guides'),
        ('f0000000-0000-0000-0000-000000000002', 'Practice Exams')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "brands" ("id", "name") VALUES
        ('f1000000-0000-0000-0000-000000000001', 'ProctorBooks')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "products" ("id", "store_id", "name", "category_id", "brand_id", "status") VALUES
        ('f2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'GRE Practice Pack', 'f0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'published')
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "skus" ("id", "product_id", "sku_code", "price_cents", "member_price_cents") VALUES
        ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'GRE-PP-001', 2999, 2499)
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "skus" WHERE id = 'f3000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM "products" WHERE id = 'f2000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM "brands" WHERE id = 'f1000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM "categories" WHERE id IN ('f0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002')`);
    await queryRunner.query(`DELETE FROM "seats" WHERE id LIKE 'e0000000%'`);
    await queryRunner.query(`DELETE FROM "zones" WHERE id LIKE 'd0000000%'`);
    await queryRunner.query(`DELETE FROM "study_rooms" WHERE id = 'c0000000-0000-0000-0000-000000000001'`);
    await queryRunner.query(`DELETE FROM "users" WHERE username IN ('store_admin','reviewer','auditor')`);
    await queryRunner.query(`DELETE FROM "stores" WHERE id = 'a0000000-0000-0000-0000-000000000001'`);
  }
}

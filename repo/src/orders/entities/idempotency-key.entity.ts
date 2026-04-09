import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Idempotency keys for write operations like order creation.
 *
 * audit_report-1 §5.4 — the original schema used `key` as the primary
 * key, so a duplicate lookup was global by key and could replay another
 * tenant's response. This entity is now scoped by
 * (operation_type, actor_id, store_id, key); a separate composite
 * unique index (created in migration `1711900000003-ScopeIdempotencyKeys`)
 * enforces uniqueness inside that scope and uses a sentinel for
 * NULL store_id so platform-admin / cross-store operations still
 * collide deterministically.
 *
 * `actor_id` is part of the scope so two users in the same store also
 * cannot replay each other's responses by reusing a guessable key.
 */
@Entity('idempotency_keys')
@Index('IDX_idempotency_keys_actor', ['operation_type', 'actor_id', 'store_id'])
export class IdempotencyKey {
  // Synthetic surrogate PK so we can keep `store_id` nullable while
  // still enforcing scoped uniqueness via the composite index.
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  operation_type: string;

  @Column({ type: 'uuid' })
  actor_id: string;

  // Nullable on purpose: some operations are not store-bound
  // (e.g. platform-admin cross-store actions). The composite unique
  // index normalizes NULLs to a sentinel UUID so collisions still fire.
  @Column({ type: 'uuid', nullable: true })
  store_id: string | null;

  @Column()
  key: string;

  @Column({ type: 'jsonb' })
  response_body: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

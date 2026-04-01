import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

const SENSITIVE_KEYS = ['password', 'hash', 'secret', 'token', 'encrypted', 'notes', 'key'];

function maskSensitiveFields(
  detail: Record<string, any> | null,
): Record<string, any> | null {
  if (!detail || typeof detail !== 'object') return detail;

  const masked: Record<string, any> = {};
  for (const [key, value] of Object.entries(detail)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk));
    if (isSensitive) {
      masked[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitiveFields(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(
    actorId: string | null,
    action: string,
    resourceType?: string,
    resourceId?: string,
    detail?: Record<string, any>,
    traceId?: string,
  ): Promise<AuditLog> {
    const entry = this.auditRepo.create({
      actor_id: actorId,
      action,
      resource_type: resourceType || null,
      resource_id: resourceId || null,
      detail: detail || null,
      trace_id: traceId || null,
    });
    return this.auditRepo.save(entry);
  }

  async findAll(filters: {
    actorId?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AuditLog[]; total: number; page: number; limit: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 25;

    const qb = this.auditRepo.createQueryBuilder('log');

    if (filters.actorId) {
      qb.andWhere('log.actor_id = :actorId', { actorId: filters.actorId });
    }
    if (filters.action) {
      qb.andWhere('log.action = :action', { action: filters.action });
    }
    if (filters.from) {
      qb.andWhere('log.created_at >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('log.created_at <= :to', { to: filters.to });
    }

    qb.orderBy('log.created_at', 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async exportCsv(from?: string, to?: string): Promise<string> {
    const qb = this.auditRepo.createQueryBuilder('log');

    if (from) {
      qb.andWhere('log.created_at >= :from', { from });
    }
    if (to) {
      qb.andWhere('log.created_at <= :to', { to });
    }

    qb.orderBy('log.created_at', 'ASC');
    const logs = await qb.getMany();

    const headers = [
      'id',
      'actor_id',
      'action',
      'resource_type',
      'resource_id',
      'detail',
      'trace_id',
      'created_at',
    ];

    const rows = logs.map((log) => {
      const maskedDetail = maskSensitiveFields(log.detail);
      return [
        log.id,
        log.actor_id || '',
        escapeCsvField(log.action),
        log.resource_type || '',
        log.resource_id || '',
        escapeCsvField(maskedDetail ? JSON.stringify(maskedDetail) : ''),
        log.trace_id || '',
        log.created_at.toISOString(),
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }
}

function escapeCsvField(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

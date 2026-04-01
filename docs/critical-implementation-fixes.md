# Critical Implementation Fixes for ProctorWorks Project 104

## Overview
The project has passing tests but is missing several critical features required for AI self-test compliance. These gaps will cause submission failure. Here are the specific implementations needed:

## 1. Field-Level Encryption for Sensitive Data

**Problem:** No AES-256-GCM encryption for sensitive notes
**Solution:** Implement encryption service and apply to user notes

### Implementation Steps:
1. Create `src/common/services/encryption.service.ts`:
   - Use Node.js `crypto` module with AES-256-GCM
   - Load encryption key from environment variable `ENCRYPTION_KEY`
   - Provide `encrypt()` and `decrypt()` methods
   - Handle initialization vectors (IV) properly

2. Update User entity to encrypt/decrypt notes field:
   - Add `@BeforeInsert` and `@BeforeUpdate` hooks
   - Encrypt notes before saving to database
   - Add getter method to decrypt notes when reading

3. Add to `.env.example`:
   ```
   ENCRYPTION_KEY=your-64-character-hex-key-here
   ```

## 2. Audit Log Security and Masking

**Problem:** Sensitive fields exposed in audit log exports
**Solution:** Implement field masking for CSV exports

### Implementation Steps:
1. Update `src/audit/audit.service.ts`:
   - In `exportCsv()` method, replace sensitive fields with `[REDACTED]`
   - Mask: `password_hash`, `notes`, `encryption_key`, any field containing "password" or "secret"
   - Keep audit functionality intact, only mask exports

2. Add database constraints for audit log protection:
   - Create migration to add CHECK constraints preventing DELETE operations
   - Ensure audit_logs table is append-only
   - Add 7-year retention policy as database constraint

## 3. Missing API Endpoints

**Problem:** Several required endpoints are missing
**Solution:** Implement the missing endpoints

### 3.1 Auth Logout Endpoint
Add to `src/auth/auth.controller.ts`:
```typescript
@Post('logout')
@HttpCode(204)
@ApiOperation({ summary: 'Logout user' })
async logout(@Request() req) {
  // Log audit entry for logout
  // Return 204 No Content
}
```

### 3.2 Coupon Redeem Endpoint
Add to `src/promotions/promotions.controller.ts`:
```typescript
@Post('coupons/:code/redeem')
@HttpCode(200)
@ApiOperation({ summary: 'Redeem a coupon' })
async redeemCoupon(@Param('code') code: string, @Body() dto: RedeemCouponDto) {
  // Implement coupon redemption logic
  // Decrease remaining quantity
  // Return redemption details
}
```

### 3.3 Quality Management Endpoints
Create complete quality module:
- `GET/POST /quality/rules` - CRUD for data quality rules
- `GET /quality/scores` - Get quality scores by entity type
- `POST /quality/scores/:entityType/compute` - Trigger score computation

### 3.4 Notifications Endpoints
Create notifications module:
- `GET /notifications` - List user notifications
- `PATCH /notifications/:id/read` - Mark notification as read

## 4. Background Job System

**Problem:** No scheduled jobs for critical operations
**Solution:** Implement NestJS scheduled jobs

### Implementation Steps:
1. Create `src/jobs/` module with scheduled services:

2. **Expired Holds Cleanup** (every 60 seconds):
   ```typescript
   @Cron('*/60 * * * * *')
   async releaseExpiredHolds() {
     // Update expired reservations to 'expired' status
     // Query reservations where hold_until < NOW() and status = 'hold'
   }
   ```

3. **Low Stock Alerts** (every hour):
   ```typescript
   @Cron('0 0 * * * *')
   async checkLowStock() {
     // Find inventory lots below threshold
     // Create notifications for admins
   }
   ```

4. **Quality Score Computation** (every hour):
   ```typescript
   @Cron('0 0 * * * *')
   async recomputeQualityScores() {
     // Calculate quality scores for all entity types
     // Update quality_scores table
   }
   ```

5. **Freshness Monitoring** (every hour):
   ```typescript
   @Cron('0 0 * * * *')
   async checkDataFreshness() {
     // Check for stale data (24+ hours old)
     // Create freshness alerts
   }
   ```

## 5. Enhanced Role-Based Access Control

**Problem:** Role restrictions not fully enforced
**Solution:** Add proper role guards and store scoping

### Implementation Steps:
1. **Content Reviewer Restrictions**:
   - Can only access `/questions/:id/approve` and `/questions/:id/reject`
   - Cannot create, update, or delete questions
   - Cannot access other modules

2. **Store Admin Scoping**:
   - All queries must filter by `store_id`
   - Cross-store access returns 403
   - Implement store scoping middleware

3. **Auditor Read-Only**:
   - Only GET requests to audit logs
   - All POST/PUT/PATCH/DELETE return 403

## 6. Business Logic Enhancements

**Problem:** Missing deterministic promotion conflict resolution
**Solution:** Implement proper tie-breaker logic

### Implementation Steps:
1. Update `src/promotions/promotions.service.ts`:
   ```typescript
   resolvePromotions(promotions: Promotion[]): Promotion {
     // Sort by priority (higher first)
     // If same priority, calculate discount amounts
     // If same discount, use lower UUID (deterministic)
     // Return winning promotion
   }
   ```

2. **Idempotency Key Expiration**:
   - Add 24-hour expiration to idempotency keys
   - Clean up expired keys automatically
   - Allow reuse after expiration

## 7. Database Security Enhancements

**Problem:** No database-level security constraints
**Solution:** Add proper database constraints and policies

### Implementation Steps:
1. Create migration for audit log protection:
   ```sql
   -- Prevent DELETE operations on audit_logs
   CREATE POLICY audit_no_delete ON audit_logs FOR DELETE TO app_role USING (false);
   
   -- Add 7-year retention constraint
   ALTER TABLE audit_logs ADD CONSTRAINT retention_7_years 
   CHECK (created_at > NOW() - INTERVAL '7 years');
   ```

2. Add database indexes for performance:
   - Index on `audit_logs.created_at`
   - Index on `reservations.hold_until`
   - Index on `orders.idempotency_key`

## 8. Testing Enhancements

**Problem:** Missing security and business logic tests
**Solution:** Add comprehensive test coverage

### Implementation Steps:
1. Add security tests:
   - Test field encryption/decryption
   - Test audit log masking
   - Test role-based access restrictions
   - Test cross-store access prevention

2. Add business logic tests:
   - Test promotion conflict resolution
   - Test idempotency key expiration
   - Test background job execution
   - Test quality score computation

## 9. Configuration and Environment

**Problem:** Missing environment variables
**Solution:** Update configuration

### Add to `.env.example`:
```
# Encryption
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Thresholds
LOW_STOCK_THRESHOLD=10
STALENESS_THRESHOLD_HOURS=24

# Job Scheduling
ENABLE_BACKGROUND_JOBS=true
```

## Implementation Priority

### Phase 1 (Critical Security):
1. Field-level encryption
2. Audit log masking
3. Database security constraints

### Phase 2 (Missing Features):
1. Missing API endpoints
2. Background job system
3. Enhanced RBAC

### Phase 3 (Business Logic):
1. Promotion conflict resolution
2. Quality monitoring
3. Comprehensive testing

## Verification Steps

After implementation:
1. Run `./run_tests.sh` - all tests must pass
2. Test each new endpoint manually
3. Verify background jobs are running
4. Test role restrictions thoroughly
5. Verify audit log masking works
6. Test field encryption/decryption

## Expected Outcome

After implementing these fixes:
- ✅ All AI self-test requirements met
- ✅ Security vulnerabilities addressed
- ✅ Complete feature implementation
- ✅ Ready for submission

This implementation should take 3-5 days of focused development work to complete all critical requirements.
# ProctorWorks — Feature Overview

Offline-first backend API platform built with NestJS + TypeORM + PostgreSQL. No UI. Pure backend.

---

## Authentication and Accounts

What it does: Local username/password login with role-based access.

What needs to be built:
- Login endpoint with bcrypt password verification
- JWT token issuance (local, no external IdP)
- Role enum: platform_admin, store_admin, content_reviewer, auditor
- Store assignment for store_admin role
- Account lockout after failed attempts
- Password change endpoint
- Audit log on login/logout/role change

---

## Resource Modeling — Study Rooms, Zones, Seats

What it does: Hierarchical physical space management with versioned seat maps.

What needs to be built:
- CRUD for study rooms, zones, seats
- Seat attributes: power_outlet, quiet_zone, ada_accessible (booleans)
- Seat status enum: available, disabled, maintenance
- Seat map versioning: draft → publish creates immutable SeatMapVersion
- Change note validation: 20–500 characters required on publish
- Seat map version history endpoint

---

## Seat Reservations

What it does: Atomic seat holds with 15-minute expiry.

What needs to be built:
- Hold endpoint: creates reservation with holdUntil = now + 15 min
- Maintenance seats cannot be held (400 error)
- Confirm endpoint: transitions hold to confirmed
- Cancel endpoint: releases hold
- Background job: releases expired holds every 60 seconds
- Conflict check: seat already held returns 409

---

## Commerce — Products (SPU/SKU)

What it does: Full product catalog with categories, brands, pricing tiers.

What needs to be built:
- SPU (Standard Product Unit) CRUD
- SKU CRUD (unique per SPU, price in cents)
- Categories and brands CRUD
- Specification attributes (key-value pairs per SKU)
- Tiered/member pricing per SKU
- Publish/unpublish with Content Reviewer approval workflow
- Low-stock alert at configurable threshold (default 10 units)

---

## Commerce — Inventory

What it does: Batch and expiration date tracking with reason-coded adjustments.

What needs to be built:
- InventoryLot CRUD (batch code, expiration date, quantity)
- Stock adjustment endpoint (requires reason code)
- Idempotency key on adjustments
- Low-stock notification trigger
- Expiration date alerts

---

## Commerce — Orders

What it does: End-to-end order lifecycle with state machine.

What needs to be built:
- Order create with idempotency key (required)
- State machine: pending → confirmed → fulfilled → cancelled
- Order line items linked to SKUs
- Promotion/coupon application at order time
- Order history per store

---

## Marketing Rules — Promotions and Coupons

What it does: Discount engine with deterministic conflict resolution.

What needs to be built:
- Coupon CRUD (code, validity window, remaining quantity)
- Claim, distribute, redeem, expire endpoints
- Threshold discounts (order total > X → discount Y)
- Percentage discounts
- First-order offers
- Campaign time windows and per-campaign redemption caps
- Conflict resolution: priority (1–1000) then best customer value
- One coupon + one automatic promotion max per order

---

## Practice Assessment — Questions

What it does: Question bank with versioned explanations and bulk operations.

What needs to be built:
- Question CRUD (objective/subjective types)
- Answer options for objective questions
- Explanation/answer versioning
- Bulk import (JSON) and export (CSV)
- Wrong-answer aggregation stats per question
- Content Reviewer approval workflow

---

## Practice Assessment — Papers and Attempts

What it does: Paper generation, auto-grading, and practice history.

What needs to be built:
- Paper generation: random or rule-based question selection
- Attempt create (starts a practice session)
- Submit attempt with answers
- Auto-grading for objective questions
- Score calculation and gradedAt timestamp
- Practice history per user
- Redo: new attempt from same paper, preserves prior attempts
- Wrong-answer aggregation across attempts

---

## Data Quality and Observability

What it does: Configurable quality scoring and freshness monitoring.

What needs to be built:
- Data quality rules CRUD (completeness, range, uniqueness per entity type)
- Quality score computation (0–100) per dataset
- Freshness monitoring (24-hour staleness threshold)
- Persisted notifications for admins
- Scheduled jobs for quality and freshness checks

---

## Security

What it does: Encryption, masking, row-level access, immutable audit trail.

What needs to be built:
- bcrypt password hashing
- AES-256-GCM field-level encryption for sensitive notes
- Masking in audit log exports
- Row-level access control by role and store_id
- Append-only audit_logs table (no DELETE for app role)
- 7-year retention policy (no delete, optional archive)
- Trace IDs on every request

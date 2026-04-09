openapi: "3.0.3"
info:
  title: ProctorWorks API
  version: "1.0.0"
  description: |
    ProctorWorks Offline Operations Platform.
    All endpoints require Bearer JWT unless marked public.
    Base URL: http://localhost:3000
servers:
  - url: http://localhost:3000
    description: Local

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    Error:
      type: object
      properties:
        statusCode:
          type: integer
        code:
          type: string
        message:
          type: string
        traceId:
          type: string

security:
  - bearerAuth: []

paths:
  /health:
    get:
      tags: [Health]
      summary: Health check
      security: []
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: ok

  /auth/login:
    post:
      tags: [Auth]
      summary: Login
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username, password]
              properties:
                username:
                  type: string
                password:
                  type: string
      responses:
        "200":
          description: Login successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  accessToken:
                    type: string
                  user:
                    type: object
                    properties:
                      id:
                        type: string
                        format: uuid
                      username:
                        type: string
                      role:
                        type: string
        "401":
          description: Invalid credentials

  /auth/me:
    get:
      tags: [Auth]
      summary: Get current user
      responses:
        "200":
          description: Current user

  /auth/change-password:
    patch:
      tags: [Auth]
      summary: Change own password
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [currentPassword, newPassword]
              properties:
                currentPassword:
                  type: string
                newPassword:
                  type: string
                  minLength: 8
      responses:
        "200":
          description: Password changed

  /users:
    get:
      tags: [Users]
      summary: List users (Platform Admin only)
      parameters:
        - in: query
          name: page
          schema:
            type: integer
            default: 1
        - in: query
          name: limit
          schema:
            type: integer
            default: 20
      responses:
        "200":
          description: User list
    post:
      tags: [Users]
      summary: Create user (Platform Admin only)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [username, password, role]
              properties:
                username:
                  type: string
                password:
                  type: string
                role:
                  type: string
                  enum: [platform_admin, store_admin, content_reviewer, auditor]
                storeId:
                  type: string
                  format: uuid
      responses:
        "201":
          description: User created

  /users/{id}:
    patch:
      tags: [Users]
      summary: Update user
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                status:
                  type: string
                  enum: [active, suspended, locked]
                role:
                  type: string
                storeId:
                  type: string
                  format: uuid
      responses:
        "200":
          description: Updated
    delete:
      tags: [Users]
      summary: Delete user (Platform Admin only)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "204":
          description: Deleted

  /rooms:
    get:
      tags: [Rooms]
      summary: List study rooms
      responses:
        "200":
          description: Rooms list
    post:
      tags: [Rooms]
      summary: Create study room (Platform Admin)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
      responses:
        "201":
          description: Created

  /rooms/{id}/zones:
    get:
      tags: [Rooms]
      summary: List zones in room
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Zones
    post:
      tags: [Rooms]
      summary: Create zone
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
      responses:
        "201":
          description: Created

  /zones/{id}/seats:
    get:
      tags: [Rooms]
      summary: List seats in zone
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Seats
    post:
      tags: [Rooms]
      summary: Create seat
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [label]
              properties:
                label:
                  type: string
                powerOutlet:
                  type: boolean
                quietZone:
                  type: boolean
                adaAccessible:
                  type: boolean
      responses:
        "201":
          description: Created

  /rooms/{id}/publish:
    post:
      tags: [Rooms]
      summary: Publish seat map version
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [changeNote]
              properties:
                changeNote:
                  type: string
                  minLength: 20
                  maxLength: 500
      responses:
        "201":
          description: Version created
        "400":
          description: Invalid change note

  /rooms/{id}/versions:
    get:
      tags: [Rooms]
      summary: Get seat map version history
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Version history

  /reservations:
    post:
      tags: [Reservations]
      summary: Create seat hold
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [seatId]
              properties:
                seatId:
                  type: string
                  format: uuid
      responses:
        "201":
          description: Hold created
        "400":
          description: Seat is in maintenance
        "409":
          description: Seat already held

  /reservations/{id}/confirm:
    post:
      tags: [Reservations]
      summary: Confirm hold
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Confirmed
        "409":
          description: Hold expired

  /reservations/{id}/cancel:
    post:
      tags: [Reservations]
      summary: Cancel reservation
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Cancelled

  /products:
    get:
      tags: [Products]
      summary: List products (store-scoped)
      parameters:
        - in: query
          name: status
          schema:
            type: string
            enum: [draft, pending_review, published, unpublished]
        - in: query
          name: page
          schema:
            type: integer
            default: 1
      responses:
        "200":
          description: Products
    post:
      tags: [Products]
      summary: Create product (SPU)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, categoryId, brandId]
              properties:
                name:
                  type: string
                categoryId:
                  type: string
                  format: uuid
                brandId:
                  type: string
                  format: uuid
      responses:
        "201":
          description: Created

  /products/{id}/skus:
    get:
      tags: [Products]
      summary: List SKUs for product
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: SKUs
    post:
      tags: [Products]
      summary: Create SKU
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [skuCode, priceCents]
              properties:
                skuCode:
                  type: string
                priceCents:
                  type: integer
                memberPriceCents:
                  type: integer
                attributes:
                  type: object
      responses:
        "201":
          description: Created

  /products/{id}/publish:
    post:
      tags: [Products]
      summary: Submit for review / publish (Content Reviewer approves)
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Status updated

  /inventory/lots:
    get:
      tags: [Inventory]
      summary: List inventory lots
      parameters:
        - in: query
          name: skuId
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Lots
    post:
      tags: [Inventory]
      summary: Create inventory lot
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [skuId, batchCode, quantity]
              properties:
                skuId:
                  type: string
                  format: uuid
                batchCode:
                  type: string
                expirationDate:
                  type: string
                  format: date
                quantity:
                  type: integer
      responses:
        "201":
          description: Created

  /inventory/adjust:
    post:
      tags: [Inventory]
      summary: Adjust stock (requires reason code and idempotency key)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [lotId, delta, reasonCode, idempotencyKey]
              properties:
                lotId:
                  type: string
                  format: uuid
                delta:
                  type: integer
                reasonCode:
                  type: string
                idempotencyKey:
                  type: string
      responses:
        "201":
          description: Adjustment recorded
        "409":
          description: Duplicate idempotency key

  /orders:
    get:
      tags: [Orders]
      summary: List orders (store-scoped)
      responses:
        "200":
          description: Orders
    post:
      tags: [Orders]
      summary: Create order (idempotency key required)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [idempotencyKey, items]
              properties:
                idempotencyKey:
                  type: string
                items:
                  type: array
                  items:
                    type: object
                    properties:
                      skuId:
                        type: string
                        format: uuid
                      quantity:
                        type: integer
                couponCode:
                  type: string
      responses:
        "201":
          description: Order created
        "200":
          description: Duplicate idempotency key — returns existing order

  /orders/{id}/confirm:
    post:
      tags: [Orders]
      summary: Confirm order
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Confirmed
        "409":
          description: Cannot confirm in current state

  /orders/{id}/fulfill:
    post:
      tags: [Orders]
      summary: Fulfill order
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Fulfilled
        "409":
          description: Cannot fulfill in current state

  /orders/{id}/cancel:
    post:
      tags: [Orders]
      summary: Cancel order
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Cancelled
        "409":
          description: Cannot cancel in current state

  /promotions:
    get:
      tags: [Promotions]
      summary: List promotions
      responses:
        "200":
          description: Promotions
    post:
      tags: [Promotions]
      summary: Create promotion
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, type, priority, discountType, discountValue]
              properties:
                name:
                  type: string
                type:
                  type: string
                  enum: [threshold, percentage, first_order]
                priority:
                  type: integer
                  minimum: 1
                  maximum: 1000
                discountType:
                  type: string
                  enum: [fixed_cents, percentage]
                discountValue:
                  type: integer
                minOrderCents:
                  type: integer
                startsAt:
                  type: string
                  format: date-time
                endsAt:
                  type: string
                  format: date-time
                redemptionCap:
                  type: integer
      responses:
        "201":
          description: Created

  /coupons:
    get:
      tags: [Promotions]
      summary: List coupons
      responses:
        "200":
          description: Coupons
    post:
      tags: [Promotions]
      summary: Create coupon
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [code, promotionId]
              properties:
                code:
                  type: string
                promotionId:
                  type: string
                  format: uuid
                remainingQuantity:
                  type: integer
                startsAt:
                  type: string
                  format: date-time
                endsAt:
                  type: string
                  format: date-time
      responses:
        "201":
          description: Created

  /coupons/{code}/claim:
    post:
      tags: [Promotions]
      summary: Claim coupon
      parameters:
        - in: path
          name: code
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Claimed
        "409":
          description: Coupon exhausted or expired

  /questions:
    get:
      tags: [Questions]
      summary: List questions
      parameters:
        - in: query
          name: type
          schema:
            type: string
            enum: [objective, subjective]
        - in: query
          name: status
          schema:
            type: string
      responses:
        "200":
          description: Questions
    post:
      tags: [Questions]
      summary: Create question
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [type, body]
              properties:
                type:
                  type: string
                  enum: [objective, subjective]
                body:
                  type: string
                options:
                  type: array
                  items:
                    type: object
                    properties:
                      body:
                        type: string
                      isCorrect:
                        type: boolean
      responses:
        "201":
          description: Created

  /questions/import:
    post:
      tags: [Questions]
      summary: Bulk import questions (JSON)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                questions:
                  type: array
      responses:
        "200":
          description: Import result

  /questions/export:
    get:
      tags: [Questions]
      summary: Bulk export questions (CSV)
      responses:
        "200":
          description: CSV file
          content:
            text/csv:
              schema:
                type: string

  /questions/{id}/wrong-answer-stats:
    get:
      tags: [Questions]
      summary: Wrong answer aggregation for a question
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Wrong answer stats

  /papers:
    get:
      tags: [Assessments]
      summary: List papers
      description: |
        Allowed roles: platform_admin, store_admin, content_reviewer, auditor (read-only).
      responses:
        "200":
          description: Papers
        "403":
          description: Role not permitted
    post:
      tags: [Assessments]
      summary: Generate paper
      description: |
        Allowed roles: platform_admin, store_admin, content_reviewer.
        auditor is denied with 403 (read-only role).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, generationRule]
              properties:
                name:
                  type: string
                generationRule:
                  type: object
                  description: |
                    Random: {"type":"random","count":20}
                    Rule-based: {"type":"rule","filters":{"type":"objective","minDifficulty":3}}
      responses:
        "201":
          description: Paper created
        "403":
          description: Role not permitted

  /attempts:
    post:
      tags: [Assessments]
      summary: Start attempt
      description: |
        Allowed roles: platform_admin, store_admin, content_reviewer.
        auditor is denied with 403 (read-only role).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [paperId]
              properties:
                paperId:
                  type: string
                  format: uuid
      responses:
        "201":
          description: Attempt started
        "403":
          description: Role not permitted

  /attempts/{id}/submit:
    post:
      tags: [Assessments]
      summary: Submit attempt with answers
      description: |
        Allowed roles: platform_admin, store_admin, content_reviewer.
        auditor is denied with 403 (read-only role).
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [answers]
              properties:
                answers:
                  type: array
                  items:
                    type: object
                    properties:
                      questionId:
                        type: string
                        format: uuid
                      selectedOptionId:
                        type: string
                        format: uuid
                      textAnswer:
                        type: string
      responses:
        "201":
          description: Graded result
        "403":
          description: Role not permitted

  /attempts/{id}/redo:
    post:
      tags: [Assessments]
      summary: Redo attempt (new attempt from same paper, preserves prior)
      description: |
        Allowed roles: platform_admin, store_admin, content_reviewer.
        auditor is denied with 403 (read-only role).
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "201":
          description: New attempt created
        "403":
          description: Role not permitted

  /attempts/history:
    get:
      tags: [Assessments]
      summary: Practice history for current user
      description: |
        Allowed roles: platform_admin, store_admin, content_reviewer, auditor (read-only).
      responses:
        "200":
          description: Attempt history

  /quality/rules:
    get:
      tags: [Quality]
      summary: List data quality rules
      responses:
        "200":
          description: Rules
    post:
      tags: [Quality]
      summary: Create data quality rule
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [entityType, ruleType, config]
              properties:
                entityType:
                  type: string
                  enum: [products, orders, questions, users, inventory]
                ruleType:
                  type: string
                  enum: [completeness, range, uniqueness]
                config:
                  type: object
      responses:
        "201":
          description: Created

  /quality/scores:
    get:
      tags: [Quality]
      summary: Get latest quality scores per entity type
      responses:
        "200":
          description: Scores

  /quality/scores/{entityType}/compute:
    post:
      tags: [Quality]
      summary: Trigger on-demand quality score computation
      parameters:
        - in: path
          name: entityType
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Score computed

  /notifications:
    get:
      tags: [Notifications]
      summary: List notifications for current user
      parameters:
        - in: query
          name: read
          schema:
            type: boolean
      responses:
        "200":
          description: Notifications

  /notifications/{id}/read:
    patch:
      tags: [Notifications]
      summary: Mark notification as read
      parameters:
        - in: path
          name: id
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Marked read

  /audit-logs:
    get:
      tags: [Audit]
      summary: Query audit log (Auditor + Platform Admin)
      parameters:
        - in: query
          name: actorId
          schema:
            type: string
            format: uuid
        - in: query
          name: action
          schema:
            type: string
        - in: query
          name: from
          schema:
            type: string
            format: date-time
        - in: query
          name: to
          schema:
            type: string
            format: date-time
        - in: query
          name: page
          schema:
            type: integer
            default: 1
      responses:
        "200":
          description: Audit log entries

  /audit-logs/export:
    get:
      tags: [Audit]
      summary: Export audit log as CSV (sensitive fields masked)
      parameters:
        - in: query
          name: from
          schema:
            type: string
            format: date-time
        - in: query
          name: to
          schema:
            type: string
            format: date-time
      responses:
        "200":
          description: CSV export
          content:
            text/csv:
              schema:
                type: string

tags:
  - name: Health
  - name: Auth
  - name: Users
  - name: Rooms
  - name: Reservations
  - name: Products
  - name: Inventory
  - name: Orders
  - name: Promotions
  - name: Questions
  - name: Assessments
  - name: Quality
  - name: Notifications
  - name: Audit

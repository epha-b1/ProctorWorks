# ProctorWorks — Submission Folder Structure

Task ID: 104
Project Type: pure_backend
Stack: NestJS + TypeORM + PostgreSQL

---

## ZIP Root Layout

```
104/
├── docs/
│   ├── design.md
│   ├── api-spec.md
│   ├── questions.md
│   ├── features.md
│   ├── build-order.md
│   └── structure.md
├── repo/                             # project code lives directly here
├── sessions/
│   ├── develop-1.json
│   └── bugfix-1.json
├── metadata.json
├── prompt.md
└── questions.md
```

---

## repo/ — Full Project Structure

```
repo/
├── src/
│   ├── main.ts                       # bootstrap
│   ├── app.module.ts                 # root module
│   ├── common/
│   │   ├── decorators/               # roles, current-user
│   │   ├── filters/                  # global exception filter
│   │   ├── guards/                   # jwt, roles
│   │   ├── interceptors/             # trace-id, logging, transform
│   │   ├── middleware/               # request logger
│   │   └── pipes/                    # validation pipe
│   ├── config/
│   │   └── configuration.ts          # env config
│   ├── database/
│   │   └── database.module.ts        # TypeORM setup
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── entities/user.entity.ts
│   ├── rooms/                        # study rooms, zones, seats
│   │   ├── rooms.module.ts
│   │   ├── rooms.controller.ts
│   │   ├── rooms.service.ts
│   │   └── entities/
│   ├── reservations/
│   │   ├── reservations.module.ts
│   │   ├── reservations.controller.ts
│   │   ├── reservations.service.ts
│   │   └── entities/
│   ├── products/                     # SPU, SKU, categories, brands
│   │   ├── products.module.ts
│   │   ├── products.controller.ts
│   │   ├── products.service.ts
│   │   └── entities/
│   ├── inventory/
│   │   ├── inventory.module.ts
│   │   ├── inventory.controller.ts
│   │   ├── inventory.service.ts
│   │   └── entities/
│   ├── orders/
│   │   ├── orders.module.ts
│   │   ├── orders.controller.ts
│   │   ├── orders.service.ts
│   │   └── entities/
│   ├── promotions/                   # coupons, discounts, campaigns
│   │   ├── promotions.module.ts
│   │   ├── promotions.controller.ts
│   │   ├── promotions.service.ts
│   │   └── entities/
│   ├── questions/                    # question bank
│   │   ├── questions.module.ts
│   │   ├── questions.controller.ts
│   │   ├── questions.service.ts
│   │   └── entities/
│   ├── assessments/                  # papers, attempts
│   │   ├── assessments.module.ts
│   │   ├── assessments.controller.ts
│   │   ├── assessments.service.ts
│   │   └── entities/
│   ├── quality/                      # data quality, freshness
│   │   ├── quality.module.ts
│   │   ├── quality.service.ts
│   │   └── entities/
│   ├── notifications/
│   │   ├── notifications.module.ts
│   │   ├── notifications.controller.ts
│   │   └── entities/
│   └── audit/
│       ├── audit.module.ts
│       ├── audit.service.ts
│       └── entities/audit-log.entity.ts
├── unit_tests/
│   ├── auth.spec.ts
│   ├── reservations.spec.ts
│   ├── orders.spec.ts
│   ├── promotions.spec.ts
│   └── assessments.spec.ts
├── API_tests/
│   ├── auth.api.spec.ts
│   ├── rooms.api.spec.ts
│   ├── reservations.api.spec.ts
│   ├── products.api.spec.ts
│   ├── inventory.api.spec.ts
│   ├── orders.api.spec.ts
│   ├── promotions.api.spec.ts
│   ├── questions.api.spec.ts
│   └── assessments.api.spec.ts
├── migrations/                       # TypeORM migration files
├── run_tests.sh
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
├── nest-cli.json
└── README.md
```

---

## Submission Checklist

- [ ] `docker compose up` completes without errors
- [ ] Cold start tested in clean environment
- [ ] README has startup command, ports, test credentials
- [ ] `docs/design.md` and `docs/api-spec.md` present
- [ ] `unit_tests/` and `API_tests/` exist, `run_tests.sh` passes
- [ ] No `node_modules/`, `dist/`, or compiled output in ZIP
- [ ] No real credentials in any config file
- [ ] All prompt requirements implemented
- [ ] `sessions/develop-1.json` trajectory file present
- [ ] `metadata.json` at root with all required fields
- [ ] Swagger UI at `http://localhost:3000/api/docs`

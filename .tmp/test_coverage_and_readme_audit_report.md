# Test Coverage Audit

## Scope, Method, and Project Type
- Audit mode: **static inspection only** (no test/script execution).
- Project type declaration found: `backend` in `repo/README.md:3`.
- Inference check: backend-only structure confirmed (`repo/src/**` NestJS API, no frontend code/tests found via `**/*.{tsx,jsx,vue,svelte}` glob).

## Backend Endpoint Inventory
Resolved endpoints (method + fully resolved path):

1. `GET /health`
2. `POST /auth/login`
3. `POST /auth/logout`
4. `GET /auth/me`
5. `PATCH /auth/change-password`
6. `GET /users`
7. `POST /users`
8. `GET /users/:id`
9. `PATCH /users/:id`
10. `DELETE /users/:id`
11. `GET /stores`
12. `POST /stores`
13. `PATCH /stores/:id`
14. `DELETE /stores/:id`
15. `POST /rooms`
16. `GET /rooms`
17. `GET /rooms/:id`
18. `PATCH /rooms/:id`
19. `DELETE /rooms/:id`
20. `GET /rooms/:id/zones`
21. `POST /rooms/:id/zones`
22. `GET /zones/:id/seats`
23. `POST /zones/:id/seats`
24. `PATCH /seats/:id`
25. `DELETE /seats/:id`
26. `POST /rooms/:id/publish`
27. `GET /rooms/:id/versions`
28. `POST /reservations`
29. `GET /reservations`
30. `POST /reservations/:id/confirm`
31. `POST /reservations/:id/cancel`
32. `POST /products`
33. `GET /products`
34. `GET /products/:id`
35. `PATCH /products/:id`
36. `DELETE /products/:id`
37. `POST /products/:id/publish`
38. `POST /products/:id/approve`
39. `POST /products/:id/unpublish`
40. `GET /products/:id/skus`
41. `POST /products/:id/skus`
42. `PATCH /skus/:id`
43. `DELETE /skus/:id`
44. `GET /categories`
45. `POST /categories`
46. `GET /brands`
47. `POST /brands`
48. `POST /inventory/lots`
49. `GET /inventory/lots`
50. `PATCH /inventory/lots/:id`
51. `POST /inventory/adjust`
52. `POST /orders`
53. `GET /orders`
54. `GET /orders/:id`
55. `POST /orders/:id/confirm`
56. `POST /orders/:id/fulfill`
57. `POST /orders/:id/cancel`
58. `GET /promotions`
59. `POST /promotions`
60. `PATCH /promotions/:id`
61. `DELETE /promotions/:id`
62. `GET /coupons`
63. `POST /coupons`
64. `POST /coupons/:code/claim`
65. `POST /coupons/:code/redeem`
66. `POST /coupons/:id/distribute`
67. `POST /coupons/:id/expire`
68. `GET /questions`
69. `POST /questions`
70. `GET /questions/export`
71. `POST /questions/import`
72. `GET /questions/:id`
73. `PATCH /questions/:id`
74. `DELETE /questions/:id`
75. `POST /questions/:id/approve`
76. `POST /questions/:id/reject`
77. `GET /questions/:id/wrong-answer-stats`
78. `GET /questions/:id/explanations`
79. `POST /questions/:id/explanations`
80. `GET /papers`
81. `POST /papers`
82. `GET /papers/:id`
83. `POST /attempts`
84. `POST /attempts/:id/submit`
85. `POST /attempts/:id/redo`
86. `GET /attempts/history`
87. `POST /quality/rules`
88. `GET /quality/rules`
89. `GET /quality/scores`
90. `POST /quality/scores/:entityType/compute`
91. `GET /notifications`
92. `PATCH /notifications/:id/read`
93. `GET /audit-logs`
94. `GET /audit-logs/export`

Sources for endpoint inventory: controller decorators in `repo/src/**/*.controller.ts`.

## API Test Mapping Table
Legend: all entries below are HTTP tests against real routes.

| Endpoint | Covered | Test type | Test file(s) | Evidence |
|---|---|---|---|---|
| `GET /health` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | `describe('GET /health'...)` in `repo/API_tests/auth.api.spec.ts:88`; `it('GET /health returns ok...'...)` in `repo/e2e_tests/core-flow.e2e.spec.ts:36` |
| `POST /auth/login` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | `describe('POST /auth/login'...)` in `repo/API_tests/auth.api.spec.ts:104`; `it('POST /auth/login without credentials...'...)` in `repo/e2e_tests/core-flow.e2e.spec.ts:44` |
| `POST /auth/logout` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | `describe('POST /auth/logout'...)` in `repo/API_tests/auth.api.spec.ts:147`; logout test in `repo/e2e_tests/core-flow.e2e.spec.ts:175` |
| `GET /auth/me` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | `describe('GET /auth/me'...)` in `repo/API_tests/auth.api.spec.ts:192`; `me` request in `repo/e2e_tests/core-flow.e2e.spec.ts:155` |
| `PATCH /auth/change-password` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts` | `describe('PATCH /auth/change-password'...)` in `repo/API_tests/auth.api.spec.ts:216` |
| `GET /users` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `e2e_tests/authorization.e2e.spec.ts` | `describe('GET /users'...)` in `repo/API_tests/auth.api.spec.ts:271`; `401 on protected surface with no token` in `repo/e2e_tests/authorization.e2e.spec.ts:44` |
| `POST /users` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts` | `describe('POST /users'...)` in `repo/API_tests/auth.api.spec.ts:299` |
| `GET /users/:id` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts` | user readback in `repo/API_tests/security.api.spec.ts:591` |
| `PATCH /users/:id` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `API_tests/security.api.spec.ts` | `PATCH /users/:id and DELETE /users/:id` in `repo/API_tests/auth.api.spec.ts:341`; encryption patch in `repo/API_tests/security.api.spec.ts:584` |
| `DELETE /users/:id` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts` | delete test in `repo/API_tests/auth.api.spec.ts:371` |
| `GET /stores` | yes | true no-mock HTTP | `API_tests/stores.api.spec.ts` | `describe('GET /stores'...)` in `repo/API_tests/stores.api.spec.ts:87` |
| `POST /stores` | yes | true no-mock HTTP | `API_tests/stores.api.spec.ts`, `API_tests/auth.api.spec.ts` | setup/create calls in `repo/API_tests/stores.api.spec.ts:63` and `repo/API_tests/auth.api.spec.ts:75` |
| `PATCH /stores/:id` | yes | true no-mock HTTP | `API_tests/stores.api.spec.ts` | `describe('PATCH /stores/:id'...)` in `repo/API_tests/stores.api.spec.ts:126` |
| `DELETE /stores/:id` | yes | true no-mock HTTP | `API_tests/stores.api.spec.ts` | `describe('DELETE /stores/:id'...)` in `repo/API_tests/stores.api.spec.ts:175` |
| `POST /rooms` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts`, `e2e_tests/concurrency.e2e.spec.ts` | `describe('POST /rooms'...)` in `repo/API_tests/rooms.api.spec.ts:81`; concurrent setup in `repo/e2e_tests/concurrency.e2e.spec.ts:29` |
| `GET /rooms` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('GET /rooms'...)` in `repo/API_tests/rooms.api.spec.ts:103` |
| `GET /rooms/:id` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('GET /rooms/:id'...)` in `repo/API_tests/rooms.api.spec.ts:123` |
| `PATCH /rooms/:id` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('PATCH /rooms/:id'...)` in `repo/API_tests/rooms.api.spec.ts:142` |
| `DELETE /rooms/:id` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('DELETE /rooms/:id'...)` in `repo/API_tests/rooms.api.spec.ts:385` |
| `GET /rooms/:id/zones` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('GET /rooms/:id/zones'...)` in `repo/API_tests/rooms.api.spec.ts:185` |
| `POST /rooms/:id/zones` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('POST /rooms/:id/zones'...)` in `repo/API_tests/rooms.api.spec.ts:162` |
| `GET /zones/:id/seats` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('GET /zones/:id/seats'...)` in `repo/API_tests/rooms.api.spec.ts:234` |
| `POST /zones/:id/seats` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('POST /zones/:id/seats'...)` in `repo/API_tests/rooms.api.spec.ts:205` |
| `PATCH /seats/:id` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts`, `e2e_tests/concurrency.e2e.spec.ts` | `describe('PATCH /seats/:id'...)` in `repo/API_tests/rooms.api.spec.ts:255`; maintenance flip in `repo/e2e_tests/concurrency.e2e.spec.ts:304` |
| `DELETE /seats/:id` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('DELETE /seats/:id'...)` in `repo/API_tests/rooms.api.spec.ts:360` |
| `POST /rooms/:id/publish` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | publish validation and success in `repo/API_tests/rooms.api.spec.ts:273` and `repo/API_tests/rooms.api.spec.ts:289` |
| `GET /rooms/:id/versions` | yes | true no-mock HTTP | `API_tests/rooms.api.spec.ts` | `describe('GET /rooms/:id/versions'...)` in `repo/API_tests/rooms.api.spec.ts:333` |
| `POST /reservations` | yes | true no-mock HTTP | `API_tests/reservations.api.spec.ts`, `e2e_tests/concurrency.e2e.spec.ts` | create-hold tests in `repo/API_tests/reservations.api.spec.ts:129`; concurrency in `repo/e2e_tests/concurrency.e2e.spec.ts:51` |
| `GET /reservations` | yes | true no-mock HTTP | `API_tests/reservations.api.spec.ts` | `describe('GET /reservations - list all'...)` in `repo/API_tests/reservations.api.spec.ts:313` |
| `POST /reservations/:id/confirm` | yes | true no-mock HTTP | `API_tests/reservations.api.spec.ts` | confirm tests in `repo/API_tests/reservations.api.spec.ts:191` |
| `POST /reservations/:id/cancel` | yes | true no-mock HTTP | `API_tests/reservations.api.spec.ts` | cancel tests in `repo/API_tests/reservations.api.spec.ts:229` |
| `POST /products` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | `describe('POST /products'...)` in `repo/API_tests/products.api.spec.ts:166`; lifecycle setup in `repo/e2e_tests/lifecycle.e2e.spec.ts:55` |
| `GET /products` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('GET /products'...)` in `repo/API_tests/products.api.spec.ts:191` |
| `GET /products/:id` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | `describe('GET /products/:id'...)` in `repo/API_tests/products.api.spec.ts:214`; read-back in `repo/e2e_tests/lifecycle.e2e.spec.ts:81` |
| `PATCH /products/:id` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('PATCH /products/:id'...)` in `repo/API_tests/products.api.spec.ts:236` |
| `DELETE /products/:id` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('DELETE /products/:id'...)` in `repo/API_tests/products.api.spec.ts:387` |
| `POST /products/:id/publish` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | publish tests in `repo/API_tests/products.api.spec.ts:312`; E2E state-machine in `repo/e2e_tests/lifecycle.e2e.spec.ts:67` |
| `POST /products/:id/approve` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `API_tests/remediation.api.spec.ts` | approve tests in `repo/API_tests/products.api.spec.ts:327`; reviewer policy in `repo/API_tests/remediation.api.spec.ts:675` |
| `POST /products/:id/unpublish` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | unpublish tests in `repo/API_tests/products.api.spec.ts:343`; E2E unpublish in `repo/e2e_tests/lifecycle.e2e.spec.ts:139` |
| `GET /products/:id/skus` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('GET /products/:id/skus'...)` in `repo/API_tests/products.api.spec.ts:287` |
| `POST /products/:id/skus` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('POST /products/:id/skus'...)` in `repo/API_tests/products.api.spec.ts:254` |
| `PATCH /skus/:id` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('PATCH /skus/:id'...)` in `repo/API_tests/products.api.spec.ts:360` |
| `DELETE /skus/:id` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('DELETE /skus/:id'...)` in `repo/API_tests/products.api.spec.ts:419` |
| `GET /categories` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('GET /categories'...)` in `repo/API_tests/products.api.spec.ts:107` |
| `POST /categories` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | create category in `repo/API_tests/products.api.spec.ts:88`; E2E flow in `repo/e2e_tests/core-flow.e2e.spec.ts:54` |
| `GET /brands` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts` | `describe('GET /brands'...)` in `repo/API_tests/products.api.spec.ts:146` |
| `POST /brands` | yes | true no-mock HTTP | `API_tests/products.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | create brand in `repo/API_tests/products.api.spec.ts:127`; E2E flow in `repo/e2e_tests/core-flow.e2e.spec.ts:61` |
| `POST /inventory/lots` | yes | true no-mock HTTP | `API_tests/inventory.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | `describe('POST /inventory/lots'...)` in `repo/API_tests/inventory.api.spec.ts:131`; seed lot in `repo/e2e_tests/lifecycle.e2e.spec.ts:170` |
| `GET /inventory/lots` | yes | true no-mock HTTP | `API_tests/inventory.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | listing tests in `repo/API_tests/inventory.api.spec.ts:159`; verification in `repo/e2e_tests/lifecycle.e2e.spec.ts:211` |
| `PATCH /inventory/lots/:id` | yes | true no-mock HTTP | `API_tests/inventory.api.spec.ts`, `API_tests/security.api.spec.ts` | patch lot in `repo/API_tests/inventory.api.spec.ts:200`; cross-store denial in `repo/API_tests/security.api.spec.ts:267` |
| `POST /inventory/adjust` | yes | true no-mock HTTP | `API_tests/inventory.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | idempotency/validation suite in `repo/API_tests/inventory.api.spec.ts:218`; E2E idempotency in `repo/e2e_tests/lifecycle.e2e.spec.ts:181` |
| `POST /orders` | yes | true no-mock HTTP | `API_tests/orders.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | create/dedup tests in `repo/API_tests/orders.api.spec.ts:46`; E2E create+replay in `repo/e2e_tests/core-flow.e2e.spec.ts:85` |
| `GET /orders` | yes | true no-mock HTTP | `API_tests/orders.api.spec.ts`, `e2e_tests/concurrency.e2e.spec.ts` | list test in `repo/API_tests/orders.api.spec.ts:70`; invariant checks in `repo/e2e_tests/concurrency.e2e.spec.ts:157` |
| `GET /orders/:id` | yes | true no-mock HTTP | `API_tests/orders.api.spec.ts`, `API_tests/security.api.spec.ts` | by-id test in `repo/API_tests/orders.api.spec.ts:81`; object-level denial in `repo/API_tests/security.api.spec.ts:80` |
| `POST /orders/:id/confirm` | yes | true no-mock HTTP | `API_tests/orders.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | confirm test in `repo/API_tests/orders.api.spec.ts:91`; E2E in `repo/e2e_tests/core-flow.e2e.spec.ts:104` |
| `POST /orders/:id/fulfill` | yes | true no-mock HTTP | `API_tests/orders.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | fulfill test in `repo/API_tests/orders.api.spec.ts:101`; E2E in `repo/e2e_tests/core-flow.e2e.spec.ts:110` |
| `POST /orders/:id/cancel` | yes | true no-mock HTTP | `API_tests/orders.api.spec.ts`, `e2e_tests/core-flow.e2e.spec.ts` | cancel-path tests in `repo/API_tests/orders.api.spec.ts:110` and `repo/API_tests/orders.api.spec.ts:117`; E2E conflict in `repo/e2e_tests/core-flow.e2e.spec.ts:118` |
| `GET /promotions` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts`, `e2e_tests/tenant-isolation.e2e.spec.ts` | list test in `repo/API_tests/promotions.api.spec.ts:54`; cross-tenant list in `repo/e2e_tests/tenant-isolation.e2e.spec.ts:69` |
| `POST /promotions` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | create test in `repo/API_tests/promotions.api.spec.ts:43`; E2E promo lifecycle in `repo/e2e_tests/lifecycle.e2e.spec.ts:264` |
| `PATCH /promotions/:id` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts` | update persistence test in `repo/API_tests/security.api.spec.ts:163` |
| `DELETE /promotions/:id` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts`, `e2e_tests/tenant-isolation.e2e.spec.ts` | delete persistence test in `repo/API_tests/security.api.spec.ts:178`; cross-tenant denial in `repo/e2e_tests/tenant-isolation.e2e.spec.ts:80` |
| `GET /coupons` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | list test in `repo/API_tests/promotions.api.spec.ts:76`; E2E verification in `repo/e2e_tests/lifecycle.e2e.spec.ts:294` |
| `POST /coupons` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | create test in `repo/API_tests/promotions.api.spec.ts:65`; E2E coupon create in `repo/e2e_tests/lifecycle.e2e.spec.ts:277` |
| `POST /coupons/:code/claim` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts`, `e2e_tests/lifecycle.e2e.spec.ts` | claim tests in `repo/API_tests/promotions.api.spec.ts:87`; E2E claim in `repo/e2e_tests/lifecycle.e2e.spec.ts:288` |
| `POST /coupons/:code/redeem` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts` | redeem/cap tests in `repo/API_tests/promotions.api.spec.ts:325` and `repo/API_tests/promotions.api.spec.ts:347` |
| `POST /coupons/:id/distribute` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts`, `API_tests/security.api.spec.ts` | distribute edge tests in `repo/API_tests/promotions.api.spec.ts:224`; cross-store denial in `repo/API_tests/security.api.spec.ts:220` |
| `POST /coupons/:id/expire` | yes | true no-mock HTTP | `API_tests/promotions.api.spec.ts` | expire test in `repo/API_tests/promotions.api.spec.ts:110` |
| `GET /questions` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/remediation.api.spec.ts` | list/filter tests in `repo/API_tests/questions.api.spec.ts:68`; tenant list check in `repo/API_tests/remediation.api.spec.ts:318` |
| `POST /questions` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/remediation.api.spec.ts` | create tests in `repo/API_tests/questions.api.spec.ts:39`; tenant-scope create in `repo/API_tests/remediation.api.spec.ts:257` |
| `GET /questions/export` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts` | export CSV test in `repo/API_tests/questions.api.spec.ts:168` |
| `POST /questions/import` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts` | import test in `repo/API_tests/questions.api.spec.ts:153` |
| `GET /questions/:id` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/remediation.api.spec.ts` | by-id test in `repo/API_tests/questions.api.spec.ts:86`; cross-tenant 404 in `repo/API_tests/remediation.api.spec.ts:289` |
| `PATCH /questions/:id` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/remediation.api.spec.ts` | patch test in `repo/API_tests/questions.api.spec.ts:95`; cross-tenant 404 in `repo/API_tests/remediation.api.spec.ts:296` |
| `DELETE /questions/:id` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/remediation.api.spec.ts` | delete test in `repo/API_tests/questions.api.spec.ts:184`; cross-tenant 404 in `repo/API_tests/remediation.api.spec.ts:304` |
| `POST /questions/:id/approve` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/assessments.api.spec.ts` | approve test in `repo/API_tests/questions.api.spec.ts:105`; approvals in setup `repo/API_tests/assessments.api.spec.ts:48` |
| `POST /questions/:id/reject` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts` | reject test in `repo/API_tests/questions.api.spec.ts:115` |
| `GET /questions/:id/wrong-answer-stats` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts`, `API_tests/remediation.api.spec.ts` | stats test in `repo/API_tests/questions.api.spec.ts:177`; cross-tenant denial in `repo/API_tests/remediation.api.spec.ts:311` |
| `GET /questions/:id/explanations` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts` | explanations read test in `repo/API_tests/questions.api.spec.ts:142` |
| `POST /questions/:id/explanations` | yes | true no-mock HTTP | `API_tests/questions.api.spec.ts` | explanation create tests in `repo/API_tests/questions.api.spec.ts:124` and `repo/API_tests/questions.api.spec.ts:133` |
| `GET /papers` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | list test in `repo/API_tests/assessments.api.spec.ts:69`; tenant filtering in `repo/API_tests/remediation.api.spec.ts:418` |
| `POST /papers` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | create paper test in `repo/API_tests/assessments.api.spec.ts:59`; role/tenant variants in `repo/API_tests/remediation.api.spec.ts:178` and `repo/API_tests/remediation.api.spec.ts:395` |
| `GET /papers/:id` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | by-id test in `repo/API_tests/assessments.api.spec.ts:77`; tenant 404 in `repo/API_tests/remediation.api.spec.ts:448` |
| `POST /attempts` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | start attempt test in `repo/API_tests/assessments.api.spec.ts:86`; cross-store denial in `repo/API_tests/remediation.api.spec.ts:553` |
| `POST /attempts/:id/submit` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | submit tests in `repo/API_tests/assessments.api.spec.ts:121`; role denial in `repo/API_tests/remediation.api.spec.ts:197` |
| `POST /attempts/:id/redo` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | redo tests in `repo/API_tests/assessments.api.spec.ts:141`; role denial in `repo/API_tests/remediation.api.spec.ts:209` |
| `GET /attempts/history` | yes | true no-mock HTTP | `API_tests/assessments.api.spec.ts`, `API_tests/remediation.api.spec.ts` | history test in `repo/API_tests/assessments.api.spec.ts:185`; additional checks in `repo/API_tests/remediation.api.spec.ts:230` |
| `POST /quality/rules` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts` | create/validation tests in `repo/API_tests/quality.api.spec.ts:92` |
| `GET /quality/rules` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts` | list/auth tests in `repo/API_tests/quality.api.spec.ts:158` |
| `GET /quality/scores` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts` | list/auth tests in `repo/API_tests/quality.api.spec.ts:190` |
| `POST /quality/scores/:entityType/compute` | yes | true no-mock HTTP | `API_tests/remediation.api.spec.ts` | compute tests in `repo/API_tests/remediation.api.spec.ts:1113` and `repo/API_tests/remediation.api.spec.ts:1136` |
| `GET /notifications` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts` | notification ownership setup/read in `repo/API_tests/security.api.spec.ts:102` and `repo/API_tests/security.api.spec.ts:113` |
| `PATCH /notifications/:id/read` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts` | mark-read tests in `repo/API_tests/security.api.spec.ts:107` and `repo/API_tests/security.api.spec.ts:117` |
| `GET /audit-logs` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts`, `e2e_tests/authorization.e2e.spec.ts` | role matrix and query semantics in `repo/API_tests/security.api.spec.ts:325` and `repo/API_tests/security.api.spec.ts:488`; e2e read in `repo/e2e_tests/authorization.e2e.spec.ts:131` |
| `GET /audit-logs/export` | yes | true no-mock HTTP | `API_tests/security.api.spec.ts` | CSV export masking test in `repo/API_tests/security.api.spec.ts:563` |

## API Test Classification
1. **True No-Mock HTTP**
   - `API_tests/*.api.spec.ts`: in-process Nest app bootstrap + real route handling via `supertest(app.getHttpServer())` (evidence: `repo/API_tests/auth.api.spec.ts:59-69`).
   - `e2e_tests/*.e2e.spec.ts`: real network HTTP to running service (`supertest(BASE_URL)`), no in-process AppModule (evidence: `repo/e2e_tests/helpers.ts:25-27`, `repo/e2e_tests/core-flow.e2e.spec.ts:4-6`).
2. **HTTP with Mocking**
   - None found in API/e2e tests.
3. **Non-HTTP (unit/integration without HTTP)**
   - `unit_tests/*.spec.ts` directly import services/controllers/guards and test them without HTTP transport.

## Mock Detection
- API/e2e tests: no `jest.mock`, `vi.mock`, `sinon.stub`, `overrideProvider`, `overrideGuard`, or equivalent provider stubbing detected (`grep` over `API_tests` and `e2e_tests` returned no matches).
- Unit tests with mocking/stubbing:
  - Logger spy in `repo/unit_tests/common.spec.ts:84` and `repo/unit_tests/common.spec.ts:108` (`jest.spyOn(...logger, 'log')`).
  - Time stub in `repo/unit_tests/reservations.spec.ts:78` (`jest.spyOn(Date, 'now').mockReturnValue(...)`).
- HTTP bypass by design in unit suite:
  - Direct class imports and non-HTTP invocation (evidence: `repo/unit_tests/auth.spec.ts:8`, `repo/unit_tests/orders.spec.ts:5`, `repo/unit_tests/assessments.spec.ts:6`, etc.).

## Coverage Summary
- Total endpoints: **94**
- Endpoints with HTTP tests: **94**
- Endpoints with TRUE no-mock HTTP tests: **94**
- HTTP coverage: **100.00%**
- True API coverage: **100.00%**

## Unit Test Summary

### Backend Unit Tests
- Test files detected: 18 files under `repo/unit_tests/`.
- Modules covered (by direct import and test blocks):
  - Controllers: `HealthController`, `StoresController` (`repo/unit_tests/health.spec.ts`, `repo/unit_tests/stores-controller.spec.ts`)
  - Services: `AuthService`, `OrdersService`, `InventoryService`, `ReservationsService`, `RoomsService`, `AssessmentsService`, `PromotionsService`, `QualityService`, `NotificationsService`, `AuditService`, `SessionsService`
  - Security/auth: `JwtStrategy`, `RolesGuard`
  - Middleware/filter/interceptor-like cross-cutting components: `GlobalExceptionFilter`, `LoggingInterceptor`, encryption service
- Important backend modules not explicitly unit-tested (from visible test file names/imports):
  - `ProductsService`
  - `QuestionsService`
  - `AuditController` (controller-level unit)
  - `NotificationsController` (controller-level unit)
  - `QualityController` (controller-level unit)

### Frontend Unit Tests
- Frontend test files: **NONE**
- Frameworks/tools detected for frontend tests: **NONE**
- Frontend components/modules covered: **NONE**
- Important frontend components/modules not tested: **Not applicable (backend project; no frontend layer detected)**
- Frontend unit tests verdict: **Not applicable**

### Cross-Layer Observation
- Only backend layer is present; backend/frontend balance check is not applicable.

## API Observability Check
- Overall observability quality: **mostly strong**.
- Strong evidence patterns:
  - Explicit method/path calls in tests (e.g., `repo/API_tests/orders.api.spec.ts:46-54`).
  - Request payload assertions and response body/state invariants (e.g., `repo/API_tests/promotions.api.spec.ts:87-100`, `repo/API_tests/inventory.api.spec.ts:221-239`).
  - Negative paths and auth checks are explicit in many tests (`repo/e2e_tests/authorization.e2e.spec.ts`).
- Weak spots (non-blocking):
  - Some tests primarily assert status with limited response-shape validation (e.g., selected role-matrix checks in `repo/API_tests/security.api.spec.ts:277-343`).

## Test Quality & Sufficiency
- Success paths: broadly covered across all controller surfaces.
- Failure/edge paths: strong coverage for auth, role denial, idempotency, tenant-isolation, concurrency, and state-machine conflicts.
- Validation coverage: present on DTO-required fields and malformed inputs (examples in `repo/API_tests/inventory.api.spec.ts:288-319`, `repo/API_tests/remediation.api.spec.ts:1113-1147`).
- Auth/permission coverage: extensive role matrix + unauthorized scenarios (`repo/API_tests/security.api.spec.ts`, `repo/e2e_tests/authorization.e2e.spec.ts`).
- Integration boundary depth: good (API tests + black-box e2e + DB-level side-effect checks).
- Over-mocking risk: low for API surface; mocking mostly isolated to unit tests.
- `run_tests.sh` execution model: Docker-based containerized flow is present and aligned with constraint (`repo/run_tests.sh:76-107`, `repo/run_tests.sh:152-196`); no local runtime dependency requirement in that script path.

## End-to-End Expectations
- Project type is backend; fullstack FE↔BE E2E expectation is not applicable.

## Tests Check
- Static evidence indicates endpoint-level HTTP coverage is comprehensive and real-route based.
- Unit test layer is substantial but not complete for all high-value services/controllers.
- No API-level mock/stub shortcuts detected.

## Test Coverage Score (0-100)
**92/100**

## Score Rationale
- + Full endpoint HTTP coverage with true no-mock path evidence.
- + Strong negative/security/concurrency/isolation scenarios.
- + Black-box E2E suite over real HTTP boundary.
- - Not all core backend services/controllers are explicitly unit-tested.
- - Some tests assert mostly status code with shallow payload validation.

## Key Gaps
1. Missing direct unit coverage for `ProductsService` and `QuestionsService` logic branches.
2. Controller-level unit coverage is uneven (several controllers only covered via API tests).
3. A minority of role-matrix tests are status-only and could assert response contract details more deeply.

## Confidence & Assumptions
- Confidence: **high** for endpoint inventory and HTTP mapping; **medium-high** for deep test quality judgment due to large suite size.
- Assumptions:
  - Route prefixes are exactly those in controller decorators (no hidden runtime prefixing; supported by `repo/src/main.ts` showing no global prefix).
  - Coverage classification relies on visible static test code only.

## Test Coverage Verdict
**PASS with targeted quality improvements recommended.**

---

# README Audit

## README Location Check
- Found at required location: `repo/README.md`.

## Hard Gate Evaluation
- Formatting/readability: **PASS** (`repo/README.md` is structured and consistent markdown).
- Startup instructions (backend/fullstack rule): **PASS** (`docker-compose up --build` explicitly present at `repo/README.md:20`; `docker compose up --build` also documented).
- Access method (URL + port): **PASS** (`repo/README.md:25-29`, `repo/README.md:169-173`).
- Verification method: **PASS** (`curl`-based health/login/auth-me walkthrough at `repo/README.md:36-89`).
- Environment rules (no runtime installs/manual DB setup): **PASS** (README repeatedly states Docker-contained workflow and no host installs; see `repo/README.md:9`, `repo/README.md:105-120`).
- Demo credentials with all roles (auth exists): **PASS** (`repo/README.md:90-100` includes username+password for `platform_admin`, `store_admin`, `content_reviewer`, `auditor`).

## Engineering Quality Review
- Tech stack clarity: strong (`repo/README.md:7-10`).
- Architecture/operational behavior: strong (API/DB/services, audit retention, idempotency sections).
- Testing instructions: strong and deterministic (`repo/README.md:103-166`).
- Security/roles explanation: present with role credentials and protected endpoint examples.
- Workflow usability: high for offline Docker operation.

## High Priority Issues
- None.

## Medium Priority Issues
- None.

## Low Priority Issues
- README is long and mixes quick-start with deep operational policy; splitting deep operational policies into `docs/` runbooks would improve maintainability without changing correctness.

## Hard Gate Failures
- None.

## README Verdict
**PASS**

## Final Combined Verdict
- **Test Coverage Audit:** PASS (strong coverage; minor quality gaps).
- **README Audit:** PASS.

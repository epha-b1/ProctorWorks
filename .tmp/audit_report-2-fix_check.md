# aduit_report-2 Fix Check (Static)

## Verdict
- **Pass**
- **Addressed:** 2 / 2
- **Open:** 0 / 2
- Boundary: static verification only (no runtime execution in this pass).

## Issue-by-issue status

### 1) High — `/coupons/:code/redeem` was not audit-logged
- **Status:** **Fixed**
- **Code evidence:** redeem endpoint now writes an audit event (`redeem_coupon`) with actor/resource/detail/trace.
  - `repo/src/promotions/promotions.controller.ts:229`
  - `repo/src/promotions/promotions.controller.ts:239`
  - `repo/src/promotions/promotions.controller.ts:246`
- **Test evidence:** remediation API coverage added for redeem audit log.
  - `repo/API_tests/remediation.api.spec.ts:1469`
  - `repo/API_tests/remediation.api.spec.ts:1556`
  - `repo/API_tests/remediation.api.spec.ts:1571`

### 2) Medium — coupon claim role scope may be broader than business intent
- **Status:** **Fixed**
- **Code evidence:** claim route now allows only `store_admin` and `platform_admin`; `content_reviewer` removed from mutating coupon claim surface.
  - `repo/src/promotions/promotions.controller.ts:193`
- **Test evidence:** 4-role matrix added and enforced:
  - auditor claim -> 403 + no mutation
  - content_reviewer claim -> 403 + no mutation
  - store_admin claim -> 200/201
  - platform_admin claim -> 200/201
  - `repo/API_tests/remediation.api.spec.ts:1243`
  - `repo/API_tests/remediation.api.spec.ts:1319`
  - `repo/API_tests/remediation.api.spec.ts:1338`
  - `repo/API_tests/remediation.api.spec.ts:1352`
- **Documentation evidence:** claim-role policy now aligned in API/design docs.
  - `docs/api-spec.md:981`
  - `docs/design.md:466`

## Final opinion for aduit_report-2
- Both tracked items are closed with code + regression evidence.
- Remaining verification is operational only (run full API suite and wrapper once to confirm no runtime regressions).

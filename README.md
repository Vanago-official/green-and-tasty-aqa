# Green & Tasty: group pre-order E2E tests

**Direction:** 1. Backend and frontend are integrated and deployed, so the suite covers the main scenarios through the UI and authorization and validation through the API. It runs against my own deployment.

**Approach:** Playwright + TypeScript with Page Objects, an API client and fixtures that own test data. BDD was left out on purpose: the readers of these tests are developers, and test titles already state the behaviour, so a Gherkin layer would add code without adding a reader.

## Layout

| Path | Purpose |
|---|---|
| `tests/ui/` | User scenarios through the browser, levels 1 to 3 |
| `tests/api/` | Authorization, validation and business rules, levels 1 to 3 |
| `src/api.ts` | API client; returns raw responses so negatives can be asserted |
| `src/pages.ts` | Page Objects: owner's group order page, waiter dashboard |
| `src/fixtures.ts` | Scenario building blocks: `restaurant`, `newGroup`, `Group`, `Guest` |
| `src/seed.ts` | Direct environment access, tracking and cleanup |

## Run

Requires Node.js 22.

```bash
npm ci
npx playwright install chromium
cp .env.example .env   # fill in your own deployment
npm test
```

Credentials come from `.env` or the standard AWS chain. `.env` is git-ignored. The identity needs write access to the application's DynamoDB tables and `AdminAddUserToGroup`, `AdminDeleteUser` and `CreateGroup` on the Cognito user pool.

### Subset by tag or level

```bash
npx playwright test --grep @L1          # level: @L1, @L2, @L3
npx playwright test --grep @api         # layer: @api, @ui
npx playwright test --grep "(?=.*@L2)(?=.*@ui)"
npx playwright test --grep-invert @known-defect
```

## Reports

- Locally: `npx playwright show-report reports/html`, and JUnit XML in `reports/junit.xml`.
- Failed tests: screenshot, video and trace in `test-results/`.
- CI: the `playwright-report` and `failure-artifacts` artifacts of an [E2E run](../../actions/workflows/e2e.yml), and a summary on the run page. Upload steps run even when tests fail. A run can be started by hand with a tag filter. CI retries a failed test once with fresh data, because Lambda cold starts can exceed the API Gateway 29 s limit (504); the report marks such tests as flaky.

CI reads `UI_URL`, `API_URL`, `COGNITO_USER_POOL_ID` and `AWS_REGION` from repository variables, and `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from secrets. The CI identity is limited to the policy described above.

## Test data

Every worker creates its own location, menu and waiter. Every test creates its own users, table and reservation with unique ids. The reservation always starts at `now + 3 days`. Tests are independent and run in parallel. Everything created is deleted afterwards, including after a failure.

Reservations, orders, guests and carts are prepared through the public API. Direct access is used only for what the API does not offer:

- reference data (locations, tables, dishes) and promoting a user to Waiter, because these have no open endpoint;
- reading the stored order and group status;
- a submitted cart with no dishes: the API refuses to submit an empty cart, so that state can only be seeded.

## Chosen behaviour where the requirements leave it open

| Case | Behaviour | Covered by |
|---|---|---|
| Repeat submit | 400 `Group reservation was submitted.`; the order does not change | `tests/api/submit.spec.ts` |
| Non-owner, including waiter | 403 | `tests/api/view.spec.ts`, `submit.spec.ts`, `remove.spec.ts` |
| Guest session token on owner endpoints | 401: not a Cognito token | `tests/api/view.spec.ts` |
| Removing the last participant | Allowed: `participants: []`, `total: 0` | `tests/api/remove.spec.ts` |
| Removing a submitted participant | Allowed: their dishes do not reach the order | `tests/api/remove.spec.ts` |
| Submit with no submitted carts in the UI | The button is disabled, so the API error cannot occur there | `tests/ui/group-order.spec.ts` |
| Reservation that belongs to another group | 400 | `tests/api/submit.spec.ts` |

## Known limits of the application

- **Defect, reload after submit:** the page shows `Group reservation was submitted.` instead of the read-only view. The test tagged `@known-defect` is expected to fail and will flag when this gets fixed.
- **Two meanings of total:** the API `total` sums all participants. The UI Grand Total sums only submitted carts, because only those reach the order. Both are tested.
- **Owner's own dishes:** guest endpoints need a guest token, and the owner session has none, so the owner cannot add dishes through it. The tests use the owner's own pre-order (`POST /orders`), which the group submit merges into.
- **Blocked access in the UI:** non-owner and unauthorized visitors are checked by what they must not see. Status codes for all roles are asserted at API level.

## Not done

The star task (Report Portal, pipeline in a dedicated cloud) is not implemented. CI runs on GitHub Actions.

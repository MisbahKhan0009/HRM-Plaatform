# Tables and lists

Every list in the app is **server-paginated, server-sorted and server-filtered**, rendered with **TanStack Table** in manual mode, with its state held in **URL search params**. Visual spec: `docs/04-design/COMPONENT-SPECS.md` sections 7 to 9. API list contract: `docs/05-backend/API-STANDARDS.md` sections 5 and 6, which this file follows.

## 1. The API list contract (summary)

```text
GET /employees?page=2&pageSize=25&sort=lastName,-joiningDate&status=active,probation&q=rah
```

```json
{ "data": [ … ], "page": { "number": 2, "size": 25, "totalItems": 47, "totalPages": 2 } }
```

- `page` starts at 1; `pageSize` default 25, maximum 100.
- `sort`: comma-separated fields, `-` prefix for descending, at most 3.
- Filters: `field=value`, multiple values comma-separated, ranges `from`/`to`, search `q` (minimum 2 characters).
- Each endpoint has an allow-list of filter and sort fields; unknown parameters are a `400`. The frontend must only send fields listed for that endpoint in `@hrm/contracts` (the list query schemas are shared).
- `/attendance` and `/audit-logs` require a date range of at most 366 days.

## 2. Table setup

```ts
const table = useReactTable({
  data: query.data?.data ?? [],
  columns,                                  // features/<module>/tables/*.columns.tsx
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
  manualSorting: true,
  manualFiltering: true,
  pageCount: query.data?.page.totalPages ?? -1,
  state: { pagination, sorting, columnVisibility },
  onPaginationChange: (u) => setSearch(paginationToSearch(u)),
  onSortingChange: (u) => setSearch(sortingToSearch(u)),
  onColumnVisibilityChange: setColumnVisibility,
  getRowId: (row) => row.id,
})
```

- **Columns** are defined once per table in `features/<module>/tables/`, with `id` equal to the API sort field when sortable (`enableSorting` only for fields in the endpoint's sort allow-list).
- Cell renderers use shared formatters and components: `<Money>`, `<DateText>`, `<StatusBadge status=…>`, `<EmployeeCell>` (code and name). No formatting logic inside column files.
- `keepPreviousData` (`placeholderData: keepPreviousData`) so the table doesn't flash empty between pages; a thin progress bar at the top of the table shows fetching.
- Row selection only where a bulk action exists (payroll payments, bulk record). Selection is per page; "Select all N results" is not offered in v1.

## 3. State in the URL

One adapter per table maps between search params and table state, so the URL is the single source of truth:

```ts
// validateSearch for /employees
const employeesSearch = employeeListQuery      // from @hrm/contracts: page, pageSize, sort, status, departmentId, q …
  .extend({ view: z.enum(['comfortable', 'compact']).optional() })
  .catch({ page: 1, pageSize: 25, status: 'draft,preboarding,probation,active,notice_period,separated' })
```

- The validated search object is passed directly as the API query and as part of the query key, so a URL change refetches and the back button restores the previous view.
- Defaults are applied by the schema, then **visible as filter chips** ("Status: not archived") so users know the list is filtered (COMPONENT-SPECS.md section 8).
- Search input updates `q` with a 300 ms debounce and resets `page` to 1. Changing any filter or sort resets `page` to 1.
- Invalid or stale params (a page beyond the last) are corrected by `.catch()` defaults or by redirecting to the last page.
- Column visibility and density are **not** in the URL; they are stored per table in `localStorage` (`hrm.table.<tableId>`), since they are personal display preferences.

## 4. Filters

- Filter controls are generated from a small config per table (field, label key, control type: select, multi-select, date range, combobox, boolean) and only for fields in the endpoint's filter allow-list.
- Date range filters send `from` and `to` as `YYYY-MM-DD`. Lists that require a range default to the current month.
- Filters never widen access (API-STANDARDS.md section 6): a manager filtering by an employee outside their team gets an empty result, not an error.

## 5. Loading, empty, error

| State | Behaviour |
|---|---|
| First load | Table skeleton with the real column headers and 8 placeholder rows |
| Refetch (page, sort, filter change) | Previous rows stay, dimmed to 60% opacity, with the top progress bar; `aria-busy="true"` on the table |
| Empty with no filters | First-use empty state (brand moment) with the create action if permitted |
| Empty with filters | No-results state with **Reset filters**; no DotGrid |
| Error | Inline error panel in place of the body, with **Try again**; toolbar remains usable |

## 6. Export

Exports are built **in the browser** from permission-filtered API data (D-037, ADR-0006), using `@hrm/documents`.

1. User clicks **Export** and picks CSV or XLSX.
2. The client fetches all pages for the current filters and sort with `pageSize=100`, sequentially, showing progress ("Fetching 3 of 12 pages") with **Cancel** (AbortController).
3. `@hrm/documents` (dynamically imported) builds the file. Columns are the visible columns plus any export-only columns defined in the table config. Money columns are exported as numbers with 2 decimals in XLSX (cell format `#,##0.00`) and as plain decimal strings in CSV; dates as `YYYY-MM-DD`.
4. The file downloads as `<report>-<from>-<to>.csv|xlsx`. Nothing is uploaded.

Limits: exports above 5,000 rows show a warning before starting (performance in the browser and Worker request count). The API applies the same permission checks to every page request as to the on-screen list (FR-REP-006).

CSV safety: cells beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` to prevent formula injection in spreadsheet apps.

## 7. Mobile card fallback

Below 768px, tables render as a **card list** instead of horizontal scrolling, using the same data and pagination:

- Each table config marks columns as `primary` (card title, usually name or code), `secondary` (subtitle), `badge` (status, top right), `meta` (up to 3 small label-value pairs) and `hidden-on-mobile`.
- The card is a single link to the record when the list is navigational; row actions move into a "More" menu on the card.
- Sorting moves into a "Sort by" select; filters open in a bottom sheet.
- Pagination shows previous and next only.

Tables that are inherently wide and used on desktop (payroll items, reconciliation, ledger) keep the table on tablet widths with a sticky first column and horizontal scroll inside the container, and fall back to cards only below 768px.

## 8. Accessibility

- Real `<table>` markup with `<caption>`, `<th scope="col">`, `aria-sort` on sorted headers (ACCESSIBILITY.md section 5).
- Sort buttons inside headers announce the new sort state.
- Pagination controls are labelled and announce the range after change through a polite live region ("Showing 26 to 50 of 132").
- Card lists use `<ul>`/`<li>` with each card's title as its link text.

## 9. Testing

Feature tests per table: renders rows from MSW fixture; sort header click updates the URL and request; filter change resets page; empty and no-results states; export builds a file with the expected header row (using a small fixture) and formula-injection escaping.

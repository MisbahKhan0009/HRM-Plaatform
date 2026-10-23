export interface PageQuery {
  page: number;
  pageSize: number;
}

export const pageOffset = (q: PageQuery) => (q.page - 1) * q.pageSize;

/** Page metadata for `{ data, page }` responses (API-STANDARDS §5). */
export const pageMeta = (q: PageQuery, totalItems: number) => ({
  number: q.page,
  size: q.pageSize,
  totalItems,
  totalPages: Math.max(1, Math.ceil(totalItems / q.pageSize)),
});

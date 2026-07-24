import {
  buildPageEnvelope,
  isPaginationRequested,
  paginate,
  paginationQuerySchema,
  resolvePagination,
} from '../../src/routes/pagination';

describe('paginationQuerySchema', () => {
  it('accepts a valid page/per_page pair, coercing strings from query params', () => {
    const result = paginationQuerySchema.safeParse({ page: '2', per_page: '10' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ page: 2, per_page: 10 });
  });

  it('accepts an empty query (both optional)', () => {
    expect(paginationQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects page < 1', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects per_page above the MAX_PER_PAGE cap (100)', () => {
    expect(paginationQuerySchema.safeParse({ per_page: '101' }).success).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(paginationQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

describe('isPaginationRequested', () => {
  it('is false when neither page nor per_page is present', () => {
    expect(isPaginationRequested({})).toBe(false);
  });

  it('is true when only page is present', () => {
    expect(isPaginationRequested({ page: 1 })).toBe(true);
  });

  it('is true when only per_page is present', () => {
    expect(isPaginationRequested({ per_page: 10 })).toBe(true);
  });
});

describe('resolvePagination', () => {
  it('defaults page to 1 and per_page to defaultPerPage when neither is given', () => {
    expect(resolvePagination({}, 20)).toEqual({ page: 1, per_page: 20 });
  });

  it('uses the given page/per_page when present', () => {
    expect(resolvePagination({ page: 3, per_page: 5 }, 20)).toEqual({ page: 3, per_page: 5 });
  });

  it('caps the default per_page at MAX_PER_PAGE even when defaultPerPage exceeds it', () => {
    expect(resolvePagination({}, 500)).toEqual({ page: 1, per_page: 100 });
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it('slices the requested page and reports total/total_pages', () => {
    const result = paginate(items, { page: 2, per_page: 10 });
    expect(result).toEqual({
      data: Array.from({ length: 10 }, (_, i) => i + 11),
      page: 2,
      per_page: 10,
      total: 25,
      total_pages: 3,
    });
  });

  it('returns an empty data array for a page beyond the last one', () => {
    const result = paginate(items, { page: 10, per_page: 10 });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(25);
  });

  it('total_pages is at least 1 even for an empty list', () => {
    const result = paginate([], { page: 1, per_page: 10 });
    expect(result.total_pages).toBe(1);
  });
});

describe('buildPageEnvelope', () => {
  it('wraps already-sliced items with the pagination envelope', () => {
    const items = [1, 2, 3];
    const result = buildPageEnvelope(items, 30, { page: 2, per_page: 3 });
    expect(result).toEqual({ data: items, page: 2, per_page: 3, total: 30, total_pages: 10 });
  });
});

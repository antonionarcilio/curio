import { z } from 'zod';

const MAX_PER_PAGE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(MAX_PER_PAGE).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function isPaginationRequested({ page, per_page }: PaginationQuery): boolean {
  return page !== undefined || per_page !== undefined;
}

export type ResolvedPagination = { page: number; per_page: number };

// Só deve ser chamada quando isPaginationRequested for true. `defaultPerPage`
// é o que vale quando só `page` foi passado sem `per_page` — nas rotas que
// têm `limit`, o chamador passa esse `limit` aqui, pra ele continuar valendo
// mesmo em modo paginado; rotas sem `limit` (ex: /channels) usam o default.
// Sempre capado em MAX_PER_PAGE, mesmo quando `defaultPerPage` vem de um
// `limit` sem teto próprio (ex: /videos, onde `limit` também é o cap de
// busca por chat, não só o tamanho de página).
export function resolvePagination({ page, per_page }: PaginationQuery, defaultPerPage = 20): ResolvedPagination {
  return { page: page ?? 1, per_page: per_page ?? Math.min(defaultPerPage, MAX_PER_PAGE) };
}

export type Paginated<T> = {
  data: T[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

function totalPages(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

// Corte em memória, usado pelas rotas que não têm paginação nativa
// disponível (/videos agregada e /channels).
export function paginate<T>(items: T[], { page, per_page }: ResolvedPagination): Paginated<T> {
  const total = items.length;
  const start = (page - 1) * per_page;
  return {
    data: items.slice(start, start + per_page),
    page,
    per_page,
    total,
    total_pages: totalPages(total, per_page),
  };
}

// Usado pelas rotas com paginação nativa: os itens já vêm exatamente na
// página certa (o Telegram fez o corte), só falta montar o envelope.
export function buildPageEnvelope<T>(items: T[], total: number, { page, per_page }: ResolvedPagination): Paginated<T> {
  return { data: items, page, per_page, total, total_pages: totalPages(total, per_page) };
}

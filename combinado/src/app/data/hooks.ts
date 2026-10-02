// Ganchos de dados (React Query) usados pelas telas.
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './api';
import type { Query, RowMap, TableName } from './types';

export const keys = {
  me: ['me'] as const,
  list: (t: TableName, q?: Query) => ['list', t, q ?? null] as const,
  get: (t: TableName, id: string) => ['get', t, id] as const,
  stats: (from: string, to: string) => ['stats', from, to] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.me(), staleTime: 60_000 });
}

export function useList<T extends TableName>(table: T, q?: Query, opts: Partial<UseQueryOptions<RowMap[T][]>> = {}) {
  return useQuery<RowMap[T][]>({ queryKey: keys.list(table, q), queryFn: () => api.list(table, q), staleTime: 15_000, ...opts });
}

export function useGet<T extends TableName>(table: T, id: string | null | undefined) {
  return useQuery<RowMap[T] | null>({ queryKey: keys.get(table, id ?? ''), queryFn: () => (id ? api.get(table, id) : Promise.resolve(null)), enabled: !!id });
}

export function useStats(from: string, to: string) {
  return useQuery({ queryKey: keys.stats(from, to), queryFn: () => api.dailyStats(from, to), staleTime: 30_000 });
}

/** Invalida tudo que depende de uma tabela (listas, registros e números do painel). */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...tables: TableName[]) => {
    for (const t of tables) {
      void qc.invalidateQueries({ queryKey: ['list', t] });
      void qc.invalidateQueries({ queryKey: ['get', t] });
    }
    void qc.invalidateQueries({ queryKey: ['stats'] });
    void qc.invalidateQueries({ queryKey: ['quote'] });
  };
}

export function useInsert<T extends TableName>(table: T, also: TableName[] = []) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (row: Partial<RowMap[T]>) => api.insert(table, row), onSuccess: () => inv(table, ...also) });
}
export function useUpdate<T extends TableName>(table: T, also: TableName[] = []) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<RowMap[T]> }) => api.update(table, id, patch), onSuccess: () => inv(table, ...also) });
}
export function useRemove(table: TableName, also: TableName[] = []) {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.remove(table, id), onSuccess: () => inv(table, ...also) });
}

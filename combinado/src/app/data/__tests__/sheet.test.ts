import { describe, expect, it } from 'vitest';
import { normNumber, parseCsv, toProductRows, PRODUCT_TEMPLATE } from '../sheet';

describe('importação de planilha', () => {
  it('lê CSV do Excel em português (ponto e vírgula, aspas, BOM)', () => {
    const rows = parseCsv('﻿Nome;Estoque;Preço\n"Sabão ""neutro""; 5L";10;"1.234,50"\r\nLuva;3;\n');
    expect(rows).toEqual([['Nome', 'Estoque', 'Preço'], ['Sabão "neutro"; 5L', '10', '1.234,50'], ['Luva', '3', '']]);
  });
  it('lê CSV com vírgula', () => {
    expect(parseCsv('nome,qtd\nA,1\n')).toEqual([['nome', 'qtd'], ['A', '1']]);
  });
  it('números em formato brasileiro e internacional', () => {
    expect([normNumber('1.234,56'), normNumber('1234.56'), normNumber('R$ 10'), normNumber('1,234.5'), normNumber('abc')]).toEqual(['1234.56', '1234.56', '10', '1234.5', undefined]);
  });
  it('descobre as colunas pelo cabeçalho (com ou sem acento) e usa o modelo', () => {
    const { items, columns } = toProductRows(parseCsv(PRODUCT_TEMPLATE));
    expect(columns).toEqual(['name', 'sku', 'unit', 'category', 'stock', 'min_stock', 'cost', 'price']);
    expect(items[0]).toEqual({ name: 'Shampoo para estofados 5L', sku: 'SHA-5L', unit: 'galão', category: 'Produtos', stock: '8', min_stock: '3', cost: '89.90' });
    expect(toProductRows([['PRODUTO', 'SALDO ATUAL', 'Preco de venda'], ['X', '2', '9,9']]).items).toEqual([{ name: 'X', stock: '2', price: '9.9' }]);
    expect(() => toProductRows([['Qtd'], ['1']])).toThrow(/coluna “Nome”/);
  });
});

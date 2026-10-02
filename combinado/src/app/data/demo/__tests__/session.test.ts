import { describe, expect, it } from 'vitest';
import { DemoSource, setDemoSession } from '../demoSource';
import { table } from '../db';

describe('acesso simulado da vitrine', () => {
  it('sai, cria conta, configura a empresa e entra no painel', async () => {
    const api = new DemoSource();
    setDemoSession({ state: 'on' });
    expect((await api.me())?.company).toBeTruthy();
    await api.signOut();
    expect(await api.me()).toBeNull();
    await api.signUp({ name: 'Ana Souza', email: 'ana@clinica.com.br', password: 'Senha-forte-1' });
    const novo = await api.me();
    expect(novo?.name).toBe('Ana Souza');
    expect(novo?.company).toBeNull();
    await api.onboard({ company: 'Clínica Bem Estar', segment: 'saude', phone: '5561988887766', city: 'Brasília', preset: true });
    const pronto = await api.me();
    expect(pronto?.company.name).toBe('Clínica Bem Estar');
    expect(table('services').length).toBeGreaterThan(0);
    expect(table('services').every((s) => !/sofá/i.test(s.name))).toBe(true);
  });
  it('login com Google entra direto; criar conta com Apple pede a empresa', async () => {
    const api = new DemoSource();
    setDemoSession({ state: 'off' });
    await api.signInWithProvider('google');
    expect((await api.me())?.email).toBe('voce@gmail.com');
    setDemoSession({ state: 'off' });
    await api.signInWithProvider('apple', 'cadastro');
    expect((await api.me())?.company).toBeNull();
    await expect(api.signIn('sem-arroba')).rejects.toThrow('e-mail válido');
  });
});

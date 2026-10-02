// Rotas do painel, sessão e atualização em tempo real.
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './data/api';
import { useMe } from './data/hooks';
import { AssistantProvider, MeContext, readTheme, applyTheme } from './context';
import { Shell } from './layout/Shell';
import { Loader, Empty, Button, useToast } from './ui';
import { setDisplayTimeZone } from '../shared/format';
import { AssistantDrawer } from './assistant/AssistantDrawer';
import Dashboard from './pages/Dashboard';

const Inbox = lazy(() => import('./pages/Inbox'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Quotes = lazy(() => import('./pages/Quotes'));
const Agenda = lazy(() => import('./pages/Agenda'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Automations = lazy(() => import('./pages/Automations'));
const Sales = lazy(() => import('./pages/Sales'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Simulator = lazy(() => import('./pages/Simulator'));
const History = lazy(() => import('./pages/History'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const Help = lazy(() => import('./pages/Help'));
const Auth = lazy(() => import('./pages/auth/Auth'));
const Onboarding = lazy(() => import('./pages/auth/Onboarding'));
const NewPassword = lazy(() => import('./pages/auth/NewPassword'));

applyTheme(readTheme());

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loader />}>{children}</Suspense>;
}

export function App() {
  const { data: me, isLoading, error, refetch } = useMe();
  const qc = useQueryClient();
  const loc = useLocation();

  const toast = useToast();

  useEffect(() => api.onAuthChange(() => { void qc.invalidateQueries({ queryKey: ['me'] }); }), [qc]);
  useEffect(() => { if (!isLoading) { const n = api.authNotice?.(); if (n) toast(n, 'err'); } }, [isLoading, toast]);
  useEffect(() => { if (me?.company) setDisplayTimeZone(me.company.timezone); }, [me?.company]);
  // atualização ao vivo: qualquer mudança no banco invalida as listas da tabela e os números
  useEffect(() => {
    if (!me?.company) return;
    return api.subscribe((t) => {
      void qc.invalidateQueries({ queryKey: ['list', t] });
      void qc.invalidateQueries({ queryKey: ['get', t] });
      if (['messages', 'sales', 'quotes', 'appointments', 'contacts'].includes(t)) void qc.invalidateQueries({ queryKey: ['stats'] });
      if (t === 'members') void qc.invalidateQueries({ queryKey: ['me'] });
    });
  }, [me?.company, qc]);

  if (isLoading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Loader /></div>;
  if (error) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Empty title="Não foi possível carregar o painel" action={<Button onClick={() => refetch()}>Tentar de novo</Button>}>{String((error as Error).message)}</Empty></div>;

  if (loc.pathname === '/nova-senha') return <Page><NewPassword /></Page>;
  if (!me) return <Page><Auth /></Page>;
  if (!me.company) return <Page><Onboarding /></Page>;

  return (
    <MeContext.Provider value={{ me, refresh: () => void refetch() }}>
      <AssistantProvider>
        <Shell>
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/conversas" element={<Inbox />} />
              <Route path="/conversas/:id" element={<Inbox />} />
              <Route path="/clientes" element={<Contacts />} />
              <Route path="/clientes/:id" element={<Contacts />} />
              <Route path="/orcamentos" element={<Quotes />} />
              <Route path="/orcamentos/:id" element={<Quotes />} />
              <Route path="/agenda" element={<Agenda />} />
              <Route path="/analises" element={<Analytics />} />
              <Route path="/automacoes" element={<Automations />} />
              <Route path="/vendas" element={<Sales />} />
              <Route path="/catalogo" element={<Catalog />} />
              <Route path="/tarefas" element={<Tasks />} />
              <Route path="/simulador" element={<Simulator />} />
              <Route path="/historico" element={<History />} />
              <Route path="/configuracoes" element={<Settings />} />
              <Route path="/configuracoes/:tab" element={<Settings />} />
              <Route path="/admin" element={me.isPlatformAdmin ? <Admin /> : <Navigate to="/" replace />} />
              <Route path="/ajuda" element={<Help />} />
              <Route path="/entrar" element={<Navigate to="/" replace />} />
              <Route path="/cadastro" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Empty title="Página não encontrada" action={<Button onClick={() => history.back()}>Voltar</Button>}>O endereço pode ter mudado.</Empty>} />
            </Routes>
          </Suspense>
        </Shell>
        <AssistantDrawer />
      </AssistantProvider>
    </MeContext.Provider>
  );
}

// Função "push": notificações nos aparelhos.
// Painel (login): chave pública, ativar/desativar este aparelho, preferências e teste.
// Banco (x-cron-secret): entrega de cada aviso novo nos aparelhos da equipe.
import { bad, HttpError, json, readJson, safeEqual, serve, str } from '../_shared/http.ts';
import { caller, db, rateLimit } from '../_shared/db.ts';
import { ALL_KINDS, deliver, getPrefs, MAX_DEVICES, sendTo, vapidKeys } from '../_shared/push.ts';
import { validSubscription } from '../_shared/webpush.ts';
import type { Notification } from '../_shared/types.ts';

serve(async (req) => {
  const body = await readJson(req);
  const action = str(body.action, 40);

  if (action === 'deliver') {
    const secret = Deno.env.get('CRON_SECRET') ?? '';
    if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) throw new HttpError(401, 'nao_autorizado', 'Não autorizado.');
    const id = str(body.id, 64);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad('Aviso inválido.');
    return json(await deliver(id), 200, req);
  }

  const me = await caller(req);

  if (action === 'config') {
    const [keys, prefs, { count }] = await Promise.all([
      vapidKeys(), getPrefs(me.userId),
      db.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', me.userId),
    ]);
    return json({ publicKey: keys.publicKey, prefs, devices: count ?? 0 }, 200, req);
  }

  if (action === 'subscribe') {
    const sub = validSubscription(body.subscription);
    if (!sub) throw bad('Este navegador mandou um endereço de notificação que não reconheço.');
    const device = str(body.device, 80);
    // o mesmo aparelho pode ter sido usado por outra pessoa antes: passa a ser de quem está logado agora
    const { error } = await db.from('push_subscriptions').upsert(
      { user_id: me.userId, company_id: me.companyId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, device, failures: 0 },
      { onConflict: 'endpoint' },
    );
    if (error) throw new Error(`gravar aparelho: ${error.message}`);
    // até 10 aparelhos por pessoa: os mais antigos saem
    const { data: mine } = await db.from('push_subscriptions').select('id').eq('user_id', me.userId).order('created_at', { ascending: false });
    const extra = (mine ?? []).slice(MAX_DEVICES).map((r) => r.id);
    if (extra.length) await db.from('push_subscriptions').delete().in('id', extra);
    return json({ ok: true, devices: Math.min(mine?.length ?? 1, MAX_DEVICES) }, 200, req);
  }

  if (action === 'unsubscribe') {
    const endpoint = str(body.endpoint, 1024);
    if (endpoint) await db.from('push_subscriptions').delete().eq('user_id', me.userId).eq('endpoint', endpoint);
    return json({ ok: true }, 200, req);
  }

  // "sair dos outros aparelhos": para de mandar avisos para todos, menos (opcionalmente) este
  if (action === 'unsubscribe_all') {
    const keep = str(body.keep, 1024);
    let q = db.from('push_subscriptions').delete().eq('user_id', me.userId);
    if (keep) q = q.neq('endpoint', keep);
    await q;
    return json({ ok: true }, 200, req);
  }

  if (action === 'prefs') {
    const muted = Array.isArray(body.muted) ? [...new Set(body.muted.map(String))].filter((k): k is Notification['kind'] => (ALL_KINDS as string[]).includes(k)) : undefined;
    const patch: Record<string, unknown> = { user_id: me.userId, updated_at: new Date().toISOString() };
    if (muted) patch.muted = muted;
    if (typeof body.details === 'boolean') patch.details = body.details;
    const { error } = await db.from('push_prefs').upsert(patch, { onConflict: 'user_id' });
    if (error) throw new Error(`preferências: ${error.message}`);
    return json({ prefs: await getPrefs(me.userId) }, 200, req);
  }

  if (action === 'test') {
    await rateLimit(`push-teste:${me.userId}`, 5, 300);
    const endpoint = str(body.endpoint, 1024);
    let q = db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, failures').eq('user_id', me.userId).eq('company_id', me.companyId);
    if (endpoint) q = q.eq('endpoint', endpoint);
    const { data: subs } = await q;
    if (!subs?.length) throw bad('Ative as notificações neste aparelho primeiro.');
    const r = await sendTo(subs, () => ({ title: 'Notificações da ORBYTA ativadas', body: 'É assim que os avisos vão chegar neste aparelho.', link: '#/configuracoes/app', kind: 'sistema', tag: 'teste', always: true, at: new Date().toISOString() }), { urgency: 'high', ttl: 600 });
    return json(r, 200, req);
  }

  throw bad('Ação desconhecida.');
});

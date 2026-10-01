// Equipe e conta: criar acesso, redefinir senha, remover pessoa e excluir a conta da empresa.
import { admin, caller, cors, json, stripe } from '../_shared/common.ts';

const ROLES = ['admin', 'financeiro', 'leitura'];

function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  try {
    const me = await caller(req);
    if (!me) return json(req, { error: 'not_authenticated' }, 401);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'delete_account') {
      if (me.role !== 'owner') return json(req, { error: 'not_owner' }, 403);
      const { data: company } = await admin.from('companies').select('*').eq('id', me.company_id).single();
      if (company?.stripe_subscription_id) {
        try { await stripe.subscriptions.cancel(company.stripe_subscription_id); } catch (e) { console.error('cancelamento', e); }
      }
      const { data: people } = await admin.from('members').select('user_id').eq('company_id', me.company_id);
      await admin.from('companies').delete().eq('id', me.company_id);
      for (const p of people ?? []) await admin.auth.admin.deleteUser(p.user_id);
      return json(req, { ok: true });
    }

    if (!['owner', 'admin'].includes(me.role)) return json(req, { error: 'not_allowed' }, 403);
    const { data: company } = await admin.from('companies').select('plan').eq('id', me.company_id).single();
    if (company?.plan !== 'empresa') return json(req, { error: 'plan_required' }, 403);

    if (body.action === 'add') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const name = String(body.name ?? '').trim().slice(0, 80);
      const role = String(body.role ?? '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2 || !ROLES.includes(role)) return json(req, { error: 'invalid' }, 400);
      const temp = tempPassword();
      const { data: created, error } = await admin.auth.admin.createUser({ email, password: temp, email_confirm: true, user_metadata: { name } });
      if (error || !created.user) return json(req, { error: /already|registered|exists/i.test(error?.message ?? '') ? 'email_in_use' : 'create_failed' }, 409);
      const { error: e2 } = await admin.from('members').insert({
        user_id: created.user.id, company_id: me.company_id, email, name, role, must_change: true, invited_by: me.user_id,
      });
      if (e2) { await admin.auth.admin.deleteUser(created.user.id); return json(req, { error: 'create_failed' }, 500); }
      return json(req, { ok: true, temp, user_id: created.user.id });
    }

    const target = String(body.user_id ?? '');
    const { data: t } = await admin.from('members').select('*').eq('user_id', target).eq('company_id', me.company_id).maybeSingle();
    if (!t || t.role === 'owner' || t.user_id === me.user_id) return json(req, { error: 'not_allowed' }, 403);

    if (body.action === 'reset') {
      const temp = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(t.user_id, { password: temp });
      if (error) return json(req, { error: 'reset_failed' }, 500);
      await admin.from('members').update({ must_change: true }).eq('user_id', t.user_id);
      return json(req, { ok: true, temp });
    }
    if (body.action === 'remove') {
      await admin.auth.admin.deleteUser(t.user_id);
      return json(req, { ok: true });
    }
    return json(req, { error: 'invalid_action' }, 400);
  } catch (e) {
    console.error(e);
    return json(req, { error: 'server_error' }, 500);
  }
});

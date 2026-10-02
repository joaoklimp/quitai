// Função "team" (painel): convidar e remover pessoas da equipe e excluir a conta da empresa (LGPD).
import { bad, forbidden, json, readJson, serve, str } from '../_shared/http.ts';
import { audit, caller, db, requireRole } from '../_shared/db.ts';
import { asaas, billingAccount } from '../_shared/asaas.ts';
import type { Role } from '../_shared/types.ts';

const ROLES: Role[] = ['dono', 'gerente', 'atendente'];

serve(async (req) => {
  const me = await caller(req);
  const body = await readJson(req);

  if (body.action === 'invite') {
    requireRole(me, 'dono', 'gerente');
    const email = str(body.email, 200).toLowerCase();
    const name = str(body.name, 80);
    const role = (ROLES.includes(body.role as Role) ? body.role : 'atendente') as Role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2) throw bad('Informe nome e e-mail válidos.');
    if (role === 'dono' && me.role !== 'dono') throw forbidden('Só o dono pode convidar outro dono.');
    const { data: company } = await db.from('companies').select('plan').eq('id', me.companyId).single();
    const { data: plan } = await db.from('plans').select('users, name').eq('id', company?.plan ?? 'teste').single();
    const { count } = await db.from('members').select('user_id', { count: 'exact', head: true }).eq('company_id', me.companyId).eq('active', true);
    if (plan && (count ?? 0) >= plan.users) throw bad(`O plano ${plan.name} permite até ${plan.users} pessoas na equipe. Mude de plano para convidar mais.`, 'limite_plano');

    const redirectTo = str(body.redirect, 300) || `${(Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')}/app/#/nova-senha`;
    const { data: invited, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: { name } });
    if (error || !invited?.user) {
      throw bad(/already|registered|exists/i.test(error?.message ?? '') ? 'Este e-mail já tem uma conta no Combinado. Use outro e-mail ou peça para a pessoa excluir a conta atual.' : 'Não consegui enviar o convite. Tente de novo.');
    }
    const { data: member, error: e2 } = await db.from('members').insert({ company_id: me.companyId, user_id: invited.user.id, role, name, email, invited: true }).select('*').single();
    if (e2) { await db.auth.admin.deleteUser(invited.user.id); throw new Error(e2.message); }
    await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'convidar_membro', summary: `Convidou ${name} (${email}) como ${role}` });
    return json({ member }, 200, req);
  }

  if (body.action === 'remove') {
    requireRole(me, 'dono');
    const target = str(body.user_id, 64);
    const { data: t } = await db.from('members').select('*').eq('user_id', target).eq('company_id', me.companyId).maybeSingle();
    if (!t) throw bad('Pessoa não encontrada na equipe.');
    if (t.user_id === me.userId) throw bad('Você não pode remover a si mesmo.');
    if (t.role === 'dono') {
      const { count } = await db.from('members').select('user_id', { count: 'exact', head: true }).eq('company_id', me.companyId).eq('role', 'dono').eq('active', true);
      if ((count ?? 0) <= 1) throw bad('A empresa precisa de pelo menos um dono.');
    }
    await db.from('members').delete().eq('user_id', t.user_id).eq('company_id', me.companyId);
    await db.auth.admin.deleteUser(t.user_id); // cada pessoa participa de uma empresa só: o acesso some junto
    await audit({ company_id: me.companyId, actor_type: 'usuario', actor_name: me.name, actor_user_id: me.userId, channel: 'painel', action: 'remover_membro', summary: `Removeu ${t.name} (${t.email}) da equipe` });
    return json({ ok: true }, 200, req);
  }

  if (body.action === 'delete_account') {
    requireRole(me, 'dono');
    const acct = await billingAccount(me.companyId);
    if (acct?.asaas_subscription_id) {
      try { await asaas(`/subscriptions/${acct.asaas_subscription_id}`, { method: 'DELETE' }); } catch (e) { console.error('cancelar assinatura', e); }
    }
    // arquivos recebidos pelo WhatsApp
    try {
      for (let round = 0; round < 50; round++) {
        const { data: folders } = await db.storage.from('whatsapp-media').list(me.companyId, { limit: 100 });
        if (!folders?.length) break;
        let removed = 0;
        for (const f of folders) {
          const { data: files } = await db.storage.from('whatsapp-media').list(`${me.companyId}/${f.name}`, { limit: 1000 });
          const paths = (files ?? []).map((x) => `${me.companyId}/${f.name}/${x.name}`);
          if (paths.length) { await db.storage.from('whatsapp-media').remove(paths); removed += paths.length; }
        }
        if (!removed) break;
      }
    } catch (e) { console.error('apagar arquivos', e); }
    const { data: people } = await db.from('members').select('user_id').eq('company_id', me.companyId);
    const { error } = await db.from('companies').delete().eq('id', me.companyId); // apaga tudo da empresa (em cascata)
    if (error) throw new Error(error.message);
    for (const p of people ?? []) await db.auth.admin.deleteUser(p.user_id).catch((e) => console.error('apagar usuário', e));
    return json({ ok: true }, 200, req);
  }

  throw bad('Ação desconhecida.');
});

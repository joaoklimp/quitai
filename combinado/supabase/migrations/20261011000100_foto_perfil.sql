-- Foto de perfil de quem usa o painel. A imagem chega pequena (cortada e reduzida no navegador, cerca de 20 KB)
-- e só é aceita como imagem embutida: nada de endereço externo, para nenhum site de fora saber quem abriu o painel.
alter table public.members
  add column avatar_url text check (avatar_url is null or (avatar_url ~ '^data:image/(jpeg|png|webp);base64,' and length(avatar_url) <= 200000));
-- cada pessoa troca a própria foto (o dono também pode trocar a de alguém da equipe, como já faz com nome e telefone)
grant update (avatar_url) on public.members to authenticated;

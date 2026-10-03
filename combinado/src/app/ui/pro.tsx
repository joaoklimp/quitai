// Foto do profissional: avatar (foto ou iniciais na cor dele) e redução da imagem no navegador.
import type { Professional } from '../data/types';

/** Iniciais sem o título (Dra., Dr., Prof.). */
export const proInitials = (name: string) => name.replace(/^(Dra?|Prof(a|ª)?)\.?\s+/i, '').split(' ').map((x) => x[0]).slice(0, 2).join('');

/** Foto do profissional ou as iniciais na cor dele. */
export function ProAvatar({ p, size = 44 }: { p: Pick<Professional, 'name' | 'color' | 'photo_url'>; size?: number }) {
  return (
    <span className="pro-av" aria-hidden="true" style={{ ['--pro' as string]: p.color, width: size, height: size, fontSize: Math.round(size * 0.34), borderRadius: Math.round(size * 0.32) }}>
      {p.photo_url ? <img src={p.photo_url} alt="" /> : proInitials(p.name)}
    </span>
  );
}

/** Reduz a foto no navegador (quadrada, 320 px, JPEG) para guardar leve no cadastro. */
export async function shrinkPhoto(file: File, side = 320): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('Escolha uma imagem (JPG, PNG ou WEBP).');
  if (file.size > 15 * 1024 * 1024) throw new Error('A imagem passa de 15 MB. Escolha uma menor.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Não deu para abrir essa imagem.')); i.src = url; });
    const c = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, (img.naturalWidth - c) / 2, (img.naturalHeight - c) / 4, c, c, 0, 0, side, side); // corta mais embaixo: o rosto costuma ficar em cima
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

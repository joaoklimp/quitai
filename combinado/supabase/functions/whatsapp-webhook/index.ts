// Webhook do WhatsApp (Meta Cloud API). Configure no app da Meta:
//   URL: https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook   ·   token de verificação: META_VERIFY_TOKEN
import { handleWebhook } from './handler.ts';

Deno.serve(handleWebhook);

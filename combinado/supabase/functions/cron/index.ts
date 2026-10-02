// Função "cron": chamada a cada 5 minutos pelo agendador do banco (pg_cron), com o cabeçalho x-cron-secret.
import { runCron } from './handler.ts';

Deno.serve(runCron);

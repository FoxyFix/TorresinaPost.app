// Sul piano gratuito Supabase mette in pausa i progetti senza attività per 7 giorni.
// Una lettura leggera ogni giorno evita che l'app si spenga nei periodi tranquilli.
import { db } from '../lib/db.mjs';

export default async () => {
  const { count, error } = await db.from('profiles').select('id', { count: 'exact', head: true });
  if (error) console.error('Tieni attivo', error);
  else console.log(`Database attivo, ${count} profili`);
};

export const config = { schedule: '@daily' };

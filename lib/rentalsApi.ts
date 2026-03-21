import { supabase } from '@/lib/supabase';

export type RentalCalendarDay = {
  date: string;
  color: 'green' | 'orange' | 'red';
};

export type RentalBooking = {
  id: string;
  start_date: string;
  end_date: string;
  tenant_name: string;
  adults: number | null;
  children: number | null;
  cash_on_arrival: number | null;
  phone: string | null;
  details: string | null;
};

export async function fetchRentalCalendarDays(fromISO: string, toISO: string) {
  const { data, error } = await supabase
    .from('calendar_days')
    .select('date,color')
    .gte('date', fromISO)
    .lte('date', toISO)
    .order('date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as RentalCalendarDay[];
}

export async function fetchRentalBookings() {
  const { data, error } = await supabase
    .from('bookings')
    .select('id,start_date,end_date,tenant_name,adults,children,cash_on_arrival,phone,details')
    .order('start_date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as RentalBooking[];
}

export async function findRentalBookingCovering(dateISO: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id,start_date,end_date,tenant_name,adults,children,cash_on_arrival,phone,details')
    .lte('start_date', dateISO)
    .gte('end_date', dateISO)
    .limit(1);

  if (error) throw error;
  return (data?.[0] ?? null) as RentalBooking | null;
}

export async function hasRentalOverlap(params: {
  start_date: string;
  end_date: string;
  exclude_id?: string;
}) {
  const { start_date, end_date, exclude_id } = params;

  let query = supabase
    .from('bookings')
    .select('id')
    .lte('start_date', end_date)
    .gte('end_date', start_date)
    .limit(1);

  if (exclude_id) {
    query = query.neq('id', exclude_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function createRentalBooking(payload: Omit<RentalBooking, 'id'>) {
  const { error } = await supabase.from('bookings').insert(payload);
  if (error) throw error;
}

export async function updateRentalBooking(id: string, patch: Partial<Omit<RentalBooking, 'id'>>) {
  const { error } = await supabase.from('bookings').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteRentalBooking(id: string) {
  const { error } = await supabase.from('bookings').delete().eq('id', id);
  if (error) throw error;
}

export async function hasRentalCleaning(dateISO: string) {
  const { data, error } = await supabase
    .from('day_blocks')
    .select('id')
    .eq('date', dateISO)
    .eq('type', 'cleaning')
    .limit(1);

  if (error) throw error;
  return !!data?.length;
}

export async function setRentalCleaning(dateISO: string, enabled: boolean) {
  if (enabled) {
    const { error } = await supabase
      .from('day_blocks')
      .upsert({ date: dateISO, type: 'cleaning' }, { onConflict: 'date' });
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('day_blocks')
    .delete()
    .eq('date', dateISO)
    .eq('type', 'cleaning');

  if (error) throw error;
}

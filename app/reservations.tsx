import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { RentalBookingPanel } from '@/components/RentalBookingPanel';
import { fetchWhitelistByEmail, type AccessRole } from '@/lib/accessControl';
import { fetchRentalBookings, fetchRentalCalendarDays, RentalBooking } from '@/lib/rentalsApi';
import { supabase } from '@/lib/supabase';

type ViewMode = 'calendar' | 'list';

type CalDay = {
  date: string;
  color: 'green' | 'orange' | 'red';
};

const FRENCH_MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
] as const;

function calendarBackground(color: CalDay['color']) {
  if (color === 'green') return '#79d36b';
  if (color === 'orange') return '#f2b247';
  return '#ef6b5d';
}

function calendarText(color: CalDay['color']) {
  return color === 'green' ? '#103b11' : '#2a1a0d';
}

function monthTitle(year: number, month: number) {
  return `${FRENCH_MONTHS[month - 1]} ${year}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function firstWeekdayMonday0(year: number, month: number) {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function iso(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addDaysISO(dateISO: string, days: number) {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function monthRange(fromISO: string, toISO: string) {
  const fromYear = Number(fromISO.slice(0, 4));
  const fromMonth = Number(fromISO.slice(5, 7));
  const toYear = Number(toISO.slice(0, 4));
  const toMonth = Number(toISO.slice(5, 7));
  const months: { y: number; m: number }[] = [];

  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push({ y: year, m: month });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function buildRangeSet(startISO: string | null, days: number) {
  const values = new Set<string>();
  if (!startISO) return values;
  const count = Math.max(1, days);
  for (let index = 0; index < count; index += 1) {
    values.add(addDaysISO(startISO, index));
  }
  return values;
}

function isoLocalDate(date: Date) {
  return iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function daysBetween(aIso: string, bIso: string) {
  const a = new Date(`${aIso}T00:00:00`);
  const b = new Date(`${bIso}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatDayMonth(dateISO: string) {
  const [, month, day] = dateISO.split('-').map(Number);
  return `${day} ${FRENCH_MONTHS[month - 1]}`;
}

function formatRange(startISO: string, endISO: string) {
  return `${formatDayMonth(startISO)} -> ${formatDayMonth(endISO)}`;
}

export default function ReservationsScreen() {
  const [hydrated, setHydrated] = useState(Platform.OS !== 'web');
  const [accessRole, setAccessRole] = useState<AccessRole | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [mode, setMode] = useState<ViewMode>('calendar');
  const [dayMap, setDayMap] = useState<Record<string, CalDay>>({});
  const [bookings, setBookings] = useState<RentalBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelDate, setPanelDate] = useState<string | null>(null);
  const [previewDays, setPreviewDays] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [todayISO, setTodayISO] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setTodayISO(isoLocalDate(new Date()));
  }, []);

  const fromISO = useMemo(() => {
    if (!todayISO) return null;
    const [year, month] = todayISO.split('-').map(Number);
    return iso(year, month, 1);
  }, [todayISO]);

  const toISO = useMemo(() => {
    if (!todayISO) return null;
    const [year] = todayISO.split('-').map(Number);
    return `${year}-12-31`;
  }, [todayISO]);

  const months = useMemo(() => {
    if (!fromISO || !toISO) return [];
    return monthRange(fromISO, toISO);
  }, [fromISO, toISO]);
  const previewSet = useMemo(() => buildRangeSet(panelDate, previewDays), [panelDate, previewDays]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      if (!email) {
        router.replace('/');
        return;
      }

      const access = await fetchWhitelistByEmail(email);
      if (!alive) return;
      if (!access || !['admin', 'manager'].includes(access.role)) {
        setAccessRole(null);
        setAccessChecked(true);
        return;
      }
      setAccessRole(access.role);
      setAccessChecked(true);
    })().catch(() => {
      if (alive) {
        setAccessRole(null);
        setAccessChecked(true);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!accessRole || !fromISO || !toISO) return;

    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [days, allBookings] = await Promise.all([
          fetchRentalCalendarDays(fromISO, toISO),
          fetchRentalBookings(),
        ]);
        if (!alive) return;

        const nextMap: Record<string, CalDay> = {};
        days.forEach((day) => {
          nextMap[day.date] = day;
        });
        setDayMap(nextMap);
        setBookings(allBookings);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [accessRole, fromISO, refreshKey, toISO]);

  const rows = useMemo(() => {
    const output: (
      | { type: 'gapTop'; days: number }
      | { type: 'gap'; days: number }
      | { type: 'cleaning'; date: string }
      | { type: 'booking'; data: RentalBooking }
    )[] = [];

    if (bookings.length > 0) {
      if (!todayISO) {
        return output;
      }
      const today = todayISO;
      const first = bookings[0];
      const gapToFirst = Math.max(0, daysBetween(today, first.start_date));
      if (gapToFirst > 0) {
        output.push({ type: 'gapTop', days: gapToFirst });
      }
    }

    for (let index = 0; index < bookings.length; index += 1) {
      const current = bookings[index];
      output.push({ type: 'cleaning', date: current.start_date });
      output.push({ type: 'booking', data: current });

      const next = bookings[index + 1];
      if (!next) continue;
      const gap = Math.max(0, daysBetween(current.end_date, next.start_date) - 1);
      if (gap > 0) {
        output.push({ type: 'gap', days: gap });
      }
    }

    return output;
  }, [bookings, todayISO]);

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      </SafeAreaView>
    );
  }

  if (accessChecked && accessRole === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.lockedCard}>
          <Text style={styles.lockedTitle}>Accès refusé</Text>
          <Text style={styles.lockedText}>Cette brique est réservée aux administrateurs.</Text>
          <Pressable style={styles.backButton} onPress={() => router.replace('/')}>
            <Text style={styles.backButtonText}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <View>
          <Text style={styles.title}>Montegordo</Text>
          <Text style={styles.subtitle}>Réservations de la maison</Text>
        </View>
        <Pressable style={styles.backChip} onPress={() => router.back()}>
          <Text style={styles.backChipText}>Fermer</Text>
        </Pressable>
      </View>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleButton, mode === 'calendar' && styles.toggleButtonActive]}
          onPress={() => setMode('calendar')}>
          <Text style={[styles.toggleText, mode === 'calendar' && styles.toggleTextActive]}>Calendrier</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleButton, mode === 'list' && styles.toggleButtonActive]}
          onPress={() => setMode('list')}>
          <Text style={[styles.toggleText, mode === 'list' && styles.toggleTextActive]}>Liste</Text>
        </Pressable>
      </View>

      {loading || !accessChecked || !accessRole || !fromISO || !toISO || !todayISO ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#111827" />
        </View>
      ) : null}

      {!loading && mode === 'calendar' ? (
        <ScrollView contentContainerStyle={styles.calendarContent}>
          {months.map(({ y, m }) => {
            const offset = firstWeekdayMonday0(y, m);
            const totalDays = daysInMonth(y, m);
            const cells: (number | null)[] = [
              ...Array.from({ length: offset }, () => null),
              ...Array.from({ length: totalDays }, (_, i) => i + 1),
            ];
            while (cells.length % 7 !== 0) cells.push(null);

            return (
              <View key={`${y}-${m}`} style={styles.monthSection}>
                <Text style={styles.monthTitle}>{monthTitle(y, m)}</Text>
                <View style={styles.weekHeader}>
                  {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((name) => (
                    <Text key={name} style={styles.weekHeaderText}>
                      {name}
                    </Text>
                  ))}
                </View>

                <View style={styles.grid}>
                  {cells.map((day, index) => {
                    if (day === null) {
                      return <View key={`${y}-${m}-empty-${index}`} style={styles.emptyCell} />;
                    }

                    const dateISO = iso(y, m, day);
                    const info = dayMap[dateISO] ?? { date: dateISO, color: 'green' as const };
                    const highlighted = panelDate !== null && previewSet.has(dateISO);

                    return (
                      <Pressable
                        key={`${y}-${m}-${day}`}
                        disabled={panelDate !== null}
                        onPress={() => {
                          setPanelDate(dateISO);
                          setPreviewDays(1);
                        }}
                        style={styles.cellWrap}>
                        <View
                          style={[
                            styles.cell,
                            { backgroundColor: calendarBackground(info.color) },
                            highlighted && styles.cellHighlighted,
                          ]}>
                          <Text style={[styles.cellText, { color: calendarText(info.color) }]}>{day}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {!loading && mode === 'list' ? (
        <ScrollView contentContainerStyle={styles.listContent}>
          {rows.length === 0 ? (
            <View style={styles.emptyListCard}>
              <Text style={styles.emptyListText}>Aucune réservation.</Text>
            </View>
          ) : null}

          {rows.map((row, index) => {
            if (row.type === 'gapTop' || row.type === 'gap') {
              return (
                <View key={`${row.type}-${index}`} style={styles.gapCard}>
                  <Text style={styles.gapText}>
                    {row.type === 'gapTop'
                      ? `${row.days} jours libres avant la prochaine réservation`
                      : `${row.days} jours libres`}
                  </Text>
                </View>
              );
            }

            if (row.type === 'cleaning') {
              return (
                <View key={`cleaning-${index}`} style={styles.cleaningCard}>
                  <Text style={styles.cleaningCardText}>Ménage prévu le {formatDayMonth(row.date)}</Text>
                </View>
              );
            }

            const booking = row.data;
            return (
              <View key={booking.id} style={styles.bookingCard}>
                <Text style={styles.bookingName}>{booking.tenant_name}</Text>
                <Text style={styles.bookingRange}>{formatRange(booking.start_date, booking.end_date)}</Text>
                {booking.phone ? <Text style={styles.bookingMeta}>Téléphone : {booking.phone}</Text> : null}
                {booking.cash_on_arrival != null ? (
                  <Text style={styles.bookingMeta}>À payer sur place : {booking.cash_on_arrival} EUR</Text>
                ) : null}
                <Text style={styles.bookingMeta}>
                  Adultes : {booking.adults ?? 0} | Enfants : {booking.children ?? 0}
                </Text>
                {booking.details ? <Text style={styles.bookingNote}>{booking.details}</Text> : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      <RentalBookingPanel
        visible={panelDate !== null}
        dateISO={panelDate}
        readOnly={accessRole === 'manager'}
        onClose={() => {
          setPanelDate(null);
          setPreviewDays(1);
        }}
        onSaved={() => setRefreshKey((value) => value + 1)}
        onPreviewDaysChange={setPreviewDays}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#efe4c8',
  },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#2b1f10',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#6f5e46',
  },
  backChip: {
    backgroundColor: '#fff7eb',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#d5c3a1',
  },
  backChipText: {
    color: '#3b2f1d',
    fontWeight: '800',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  toggleButton: {
    flex: 1,
    backgroundColor: '#f9f2e7',
    borderColor: '#d9c9ab',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#171717',
    borderColor: '#171717',
  },
  toggleText: {
    fontWeight: '800',
    color: '#4b3b29',
  },
  toggleTextActive: {
    color: '#fff5e6',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarContent: {
    paddingHorizontal: 10,
    paddingBottom: 110,
    gap: 14,
  },
  monthSection: {
    gap: 8,
  },
  monthTitle: {
    fontSize: 22,
    fontWeight: '900',
    textTransform: 'capitalize',
    color: '#2e2416',
    paddingHorizontal: 6,
  },
  weekHeader: {
    flexDirection: 'row',
  },
  weekHeaderText: {
    width: '14.2857%',
    textAlign: 'center',
    fontWeight: '800',
    color: '#705f48',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emptyCell: {
    width: '14.2857%',
    aspectRatio: 1,
    padding: 3,
  },
  cellWrap: {
    width: '14.2857%',
    aspectRatio: 1,
    padding: 3,
  },
  cell: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellHighlighted: {
    borderWidth: 3,
    borderColor: '#7f1d1d',
  },
  cellText: {
    fontSize: 18,
    fontWeight: '900',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 28,
    gap: 10,
  },
  gapCard: {
    backgroundColor: '#d9efd0',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#a8c89d',
    padding: 14,
  },
  gapText: {
    color: '#31572c',
    fontWeight: '800',
  },
  cleaningCard: {
    backgroundColor: '#fde0b9',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#efb45d',
    padding: 14,
  },
  cleaningCardText: {
    color: '#7b4d10',
    fontWeight: '800',
  },
  bookingCard: {
    backgroundColor: '#fffaf1',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbcaa7',
    padding: 16,
    gap: 6,
  },
  bookingName: {
    fontSize: 20,
    fontWeight: '900',
    color: '#2e2416',
  },
  bookingRange: {
    fontWeight: '800',
    color: '#594a36',
  },
  bookingMeta: {
    color: '#433725',
  },
  bookingNote: {
    color: '#6c5d49',
    fontStyle: 'italic',
  },
  emptyListCard: {
    backgroundColor: '#fffaf1',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbcaa7',
    padding: 16,
  },
  emptyListText: {
    color: '#463724',
    fontWeight: '800',
  },
  lockedCard: {
    margin: 24,
    padding: 22,
    borderRadius: 20,
    backgroundColor: '#fff7eb',
    borderWidth: 1,
    borderColor: '#ddc9a6',
    gap: 10,
  },
  lockedTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#2b1f10',
  },
  lockedText: {
    color: '#6a5b44',
  },
  backButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#171717',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButtonText: {
    color: '#fff5e6',
    fontWeight: '800',
  },
});

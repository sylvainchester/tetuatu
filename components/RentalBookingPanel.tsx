import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createRentalBooking,
  deleteRentalBooking,
  findRentalBookingCovering,
  hasRentalCleaning,
  hasRentalOverlap,
  RentalBooking,
  setRentalCleaning,
  updateRentalBooking,
} from '@/lib/rentalsApi';

type Props = {
  visible: boolean;
  dateISO: string | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPreviewDaysChange: (days: number) => void;
};

function addDaysISO(dateISO: string, days: number) {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function numOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function RentalBookingPanel({
  visible,
  dateISO,
  readOnly = false,
  onClose,
  onSaved,
  onPreviewDaysChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [booking, setBooking] = useState<RentalBooking | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [numDays, setNumDays] = useState('1');
  const [prevValidNumDays, setPrevValidNumDays] = useState('1');
  const [tenantName, setTenantName] = useState('');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [cash, setCash] = useState('');
  const [phone, setPhone] = useState('');
  const [details, setDetails] = useState('');
  const [cleaning, setCleaning] = useState(true);

  useEffect(() => {
    if (!visible || !dateISO || mode !== 'create') return;
    onPreviewDaysChange(Math.max(1, parseInt(numDays || '1', 10)));
  }, [dateISO, mode, numDays, onPreviewDaysChange, visible]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const title = useMemo(() => {
    if (!dateISO) return '';
    return mode === 'create' ? `Nouvelle réservation (${dateISO})` : `Modifier la réservation (${dateISO})`;
  }, [dateISO, mode]);

  useEffect(() => {
    if (!visible || !dateISO) return;

    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [existingBooking, cleaningEnabled] = await Promise.all([
          findRentalBookingCovering(dateISO),
          hasRentalCleaning(dateISO).catch(() => false),
        ]);
        if (!alive) return;

        if (existingBooking) {
          setMode('edit');
          setBooking(existingBooking);
          setTenantName(existingBooking.tenant_name ?? '');
          setAdults(String(existingBooking.adults ?? ''));
          setChildren(String(existingBooking.children ?? ''));
          setCash(String(existingBooking.cash_on_arrival ?? ''));
          setPhone(existingBooking.phone ?? '');
          setDetails(existingBooking.details ?? '');
          setNumDays('0');
          setPrevValidNumDays('1');
          setCleaning(cleaningEnabled);
          return;
        }

        setMode('create');
        setBooking(null);
        setTenantName('');
        setAdults('2');
        setChildren('0');
        setCash('');
        setPhone('');
        setDetails('');
        setNumDays('1');
        setPrevValidNumDays('1');
        setCleaning(true);
        onPreviewDaysChange(1);
      } catch (error: any) {
        Alert.alert('Erreur', error?.message ?? 'Chargement impossible.');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [dateISO, onPreviewDaysChange, visible]);

  async function handleNumDaysChange(next: string) {
    setNumDays(next);
    const days = Math.max(1, parseInt(next || '1', 10));
    if (!dateISO) return;

    try {
      const overlap = await hasRentalOverlap({
        start_date: dateISO,
        end_date: addDaysISO(dateISO, days - 1),
        exclude_id: booking?.id,
      });

      if (overlap) {
        Alert.alert('Conflit de dates', 'Cette période chevauche déjà une autre réservation.');
        setNumDays(prevValidNumDays);
        onPreviewDaysChange(Math.max(1, parseInt(prevValidNumDays || '1', 10)));
        return;
      }

      const validValue = String(days);
      setPrevValidNumDays(validValue);
      onPreviewDaysChange(days);
    } catch (error: any) {
      Alert.alert('Erreur', error?.message ?? 'Vérification des dates impossible.');
      setNumDays(prevValidNumDays);
    }
  }

  async function handleDelete() {
    if (!booking?.id) return;

    Alert.alert(
      'Annuler la réservation ?',
      'Cette action supprime définitivement la réservation.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await deleteRentalBooking(booking.id);
              onSaved();
              onClose();
            } catch (error: any) {
              Alert.alert('Erreur', error?.message ?? 'Suppression impossible.');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  }

  async function handleSubmit() {
    if (readOnly || !dateISO) return;

    const name = tenantName.trim();
    if (!name) {
      Alert.alert('Nom manquant', 'Le nom du locataire est requis.');
      return;
    }

    try {
      setLoading(true);

      if (mode === 'create') {
        const days = Math.max(1, parseInt(numDays || '1', 10));
        const endDate = addDaysISO(dateISO, days - 1);
        const overlap = await hasRentalOverlap({
          start_date: dateISO,
          end_date: endDate,
        });

        if (overlap) {
          Alert.alert('Conflit de dates', 'Impossible d’enregistrer: chevauchement détecté.');
          return;
        }

        await createRentalBooking({
          start_date: dateISO,
          end_date: endDate,
          tenant_name: name,
          adults: numOrNull(adults),
          children: numOrNull(children),
          cash_on_arrival: numOrNull(cash),
          phone: phone.trim() || null,
          details: details.trim() || null,
        });
      } else {
        if (!booking?.id) {
          throw new Error('Réservation introuvable.');
        }
        await updateRentalBooking(booking.id, {
          tenant_name: name,
          adults: numOrNull(adults),
          children: numOrNull(children),
          cash_on_arrival: numOrNull(cash),
          phone: phone.trim() || null,
          details: details.trim() || null,
        });
      }

      await setRentalCleaning(dateISO, cleaning);
      onSaved();
      onClose();
    } catch (error: any) {
      Alert.alert('Erreur', error?.message ?? 'Enregistrement impossible.');
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <View style={styles.sheetWrap} pointerEvents="auto">
      <KeyboardAvoidingView
        style={styles.sheetWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.sheetContent, { paddingBottom: keyboardHeight + 16 }]}>
            <Text style={styles.sheetTitle}>{title}</Text>

            {loading ? <ActivityIndicator /> : null}

            {!loading ? (
              <>
                {mode === 'create' ? (
                  <View style={styles.row}>
                    <Text style={styles.label}>Nombre de nuits</Text>
                    <TextInput
                      editable={!readOnly}
                      value={numDays}
                      onChangeText={handleNumDaysChange}
                      keyboardType="numeric"
                      style={[styles.input, styles.shortInput]}
                    />
                  </View>
                ) : null}

                <View style={styles.row}>
                  <Text style={styles.label}>Locataire</Text>
                  <TextInput
                    editable={!readOnly}
                    value={tenantName}
                    onChangeText={setTenantName}
                    style={[styles.input, styles.flexInput]}
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Personnes</Text>
                  <View style={styles.splitRow}>
                    <View style={styles.splitCol}>
                      <Text style={styles.miniLabel}>Adultes</Text>
                      <TextInput
                        editable={!readOnly}
                        value={adults}
                        onChangeText={setAdults}
                        keyboardType="numeric"
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.splitCol}>
                      <Text style={styles.miniLabel}>Enfants</Text>
                      <TextInput
                        editable={!readOnly}
                        value={children}
                        onChangeText={setChildren}
                        keyboardType="numeric"
                        style={styles.input}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>À payer sur place</Text>
                  <TextInput
                    editable={!readOnly}
                    value={cash}
                    onChangeText={setCash}
                    keyboardType="numeric"
                    style={[styles.input, styles.flexInput]}
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Téléphone</Text>
                  <TextInput
                    editable={!readOnly}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    style={[styles.input, styles.flexInput]}
                  />
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Ménage</Text>
                  <Pressable
                    disabled={readOnly}
                    onPress={() => setCleaning((current) => !current)}
                    style={[styles.cleaningPill, cleaning ? styles.cleaningOn : styles.cleaningOff]}>
                    <Text style={styles.cleaningText}>{cleaning ? 'Oui' : 'Non'}</Text>
                  </Pressable>
                </View>

                <Text style={styles.miniLabel}>Informations complémentaires</Text>
                <TextInput
                  editable={!readOnly}
                  multiline
                  value={details}
                  onChangeText={setDetails}
                  style={[styles.input, styles.detailsInput]}
                />

                <View style={styles.actionsRow}>
                  <Pressable style={styles.cancelButton} onPress={onClose}>
                    <Text style={styles.cancelText}>Fermer</Text>
                  </Pressable>
                  {!readOnly ? (
                    <Pressable style={styles.saveButton} onPress={handleSubmit}>
                      <Text style={styles.saveText}>Enregistrer</Text>
                    </Pressable>
                  ) : null}
                </View>

                {!readOnly && mode === 'edit' && booking?.id ? (
                  <Pressable style={styles.deleteButton} onPress={handleDelete} disabled={loading}>
                    <Text style={styles.deleteText}>Supprimer la réservation</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '72%',
    zIndex: 999,
    elevation: 30,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#fff8ec',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#e6d6b7',
    padding: 14,
  },
  sheetContent: {
    gap: 12,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#2f2412',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    width: 132,
    fontSize: 15,
    color: '#56422a',
    fontWeight: '700',
  },
  miniLabel: {
    fontSize: 12,
    color: '#7b684f',
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d8c6a6',
    backgroundColor: '#fffdf8',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: '#24180a',
  },
  shortInput: {
    width: 110,
    textAlign: 'center',
  },
  flexInput: {
    flex: 1,
  },
  splitRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  splitCol: {
    flex: 1,
    gap: 4,
  },
  cleaningPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  cleaningOn: {
    backgroundColor: '#ffe2cf',
    borderColor: '#ef8e5b',
  },
  cleaningOff: {
    backgroundColor: '#f1eee8',
    borderColor: '#d2c8bc',
  },
  cleaningText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#3a2611',
  },
  detailsInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#ddd2c2',
    paddingVertical: 12,
    borderRadius: 14,
  },
  cancelText: {
    color: '#3b3125',
    fontWeight: '900',
  },
  saveButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 14,
  },
  saveText: {
    color: '#fff8ec',
    fontWeight: '900',
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: '#b91c1c',
    paddingVertical: 12,
    borderRadius: 14,
  },
  deleteText: {
    color: '#fff',
    fontWeight: '900',
  },
});

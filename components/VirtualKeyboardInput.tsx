import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

type VirtualKeyboardInputProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<ViewStyle | TextStyle>;
};

const LETTER_ROWS = [
  ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm'],
  ['w', 'x', 'c', 'v', 'b', 'n', 'é', 'è', 'à', 'ù']
] as const;

const SYMBOL_ROW = ["'", '-', ',', '.', '?', '!'] as const;
const ACCENT_ROW = ['â', 'ê', 'î', 'ô', 'û', 'ç', 'ë', 'ï', 'ü'] as const;

export default function VirtualKeyboardInput({
  value,
  onChangeText,
  placeholder,
  multiline,
  disabled,
  containerStyle,
  inputStyle
}: VirtualKeyboardInputProps) {
  const [upper, setUpper] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [cursor, setCursor] = useState(value.length);

  useEffect(() => {
    if (!open) {
      setDraft(value);
      setCursor(value.length);
    }
  }, [open, value]);

  useEffect(() => {
    if (cursor > draft.length) {
      setCursor(draft.length);
    }
  }, [cursor, draft.length]);

  const rows = useMemo(
    () =>
      LETTER_ROWS.map((row) =>
        row.map((char) => (upper ? char.toUpperCase() : char))
      ),
    [upper]
  );
  const accentChars = useMemo(
    () => ACCENT_ROW.map((char) => (upper ? char.toUpperCase() : char)),
    [upper]
  );

  function append(char: string) {
    setDraft((prev) => `${prev.slice(0, cursor)}${char}${prev.slice(cursor)}`);
    setCursor((prev) => prev + char.length);
  }

  function backspace() {
    if (cursor <= 0) return;
    setDraft((prev) => `${prev.slice(0, cursor - 1)}${prev.slice(cursor)}`);
    setCursor((prev) => Math.max(0, prev - 1));
  }

  function deleteForward() {
    if (cursor >= draft.length) return;
    setDraft((prev) => `${prev.slice(0, cursor)}${prev.slice(cursor + 1)}`);
  }

  function openKeyboard() {
    setDraft(value);
    setCursor(value.length);
    setOpen(true);
  }

  function closeKeyboard() {
    onChangeText(draft);
    setOpen(false);
  }

  function moveCursorLeft() {
    setCursor((prev) => Math.max(0, prev - 1));
  }

  function moveCursorRight() {
    setCursor((prev) => Math.min(draft.length, prev + 1));
  }

  const previewBefore = draft.slice(0, cursor);
  const previewAfter = draft.slice(cursor);

  return (
    <View style={[styles.container, containerStyle]}>
      <Pressable
        style={[styles.input, multiline && styles.inputMultiline, disabled && styles.inputDisabled, inputStyle]}
        onPress={openKeyboard}
        disabled={!!disabled}
      >
        <Text style={[styles.inputText, !value && styles.placeholder]}>{value || placeholder || ''}</Text>
      </Pressable>

      <Modal visible={!disabled && open} transparent animationType="slide" onRequestClose={closeKeyboard}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalDismissZone} onPress={closeKeyboard} />
          <View style={styles.keyboardSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Clavier</Text>
              <Pressable onPress={closeKeyboard}>
                <Text style={styles.sheetClose}>Fermer</Text>
              </Pressable>
            </View>

            <View style={[styles.editorPreview, multiline && styles.editorPreviewMultiline]}>
              <Text style={[styles.editorPreviewText, !draft && styles.placeholder]}>
                {draft ? (
                  <>
                    {previewBefore}
                    <Text style={styles.cursorMark}>|</Text>
                    {previewAfter}
                  </>
                ) : (
                  <>
                    {placeholder || ''}
                    <Text style={styles.cursorMark}>|</Text>
                  </>
                )}
              </Text>
            </View>

            <View style={styles.keyboard}>
              {rows.map((row, index) => (
                <View key={`letters-${index}`} style={styles.row}>
                  {row.map((char) => (
                    <Pressable key={`${index}-${char}`} style={styles.key} onPress={() => append(char)}>
                      <Text style={styles.keyText}>{char}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}

              <View style={styles.row}>
                {accentChars.map((char) => (
                  <Pressable key={`accent-${char}`} style={styles.key} onPress={() => append(char)}>
                    <Text style={styles.keyText}>{char}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.row}>
                {SYMBOL_ROW.map((char) => (
                  <Pressable key={`symbol-${char}`} style={styles.key} onPress={() => append(char)}>
                    <Text style={styles.keyText}>{char}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.row}>
                <Pressable style={[styles.actionKey, styles.actionKeyNav]} onPress={() => setCursor(0)}>
                  <Text style={styles.actionText}>Debut</Text>
                </Pressable>
                <Pressable style={[styles.actionKey, styles.actionKeyNav]} onPress={moveCursorLeft}>
                  <Text style={styles.actionText}>{'<'}</Text>
                </Pressable>
                <Pressable style={[styles.actionKey, styles.actionKeyNav]} onPress={moveCursorRight}>
                  <Text style={styles.actionText}>{'>'}</Text>
                </Pressable>
                <Pressable style={[styles.actionKey, styles.actionKeyNav]} onPress={() => setCursor(draft.length)}>
                  <Text style={styles.actionText}>Fin</Text>
                </Pressable>
              </View>

              <View style={styles.row}>
                <Pressable style={[styles.actionKey, styles.actionKeyWide]} onPress={() => setUpper((prev) => !prev)}>
                  <Text style={styles.actionText}>{upper ? 'Min' : 'Maj'}</Text>
                </Pressable>
                <Pressable style={[styles.actionKey, styles.actionKeySpace]} onPress={() => append(' ')}>
                  <Text style={styles.actionText}>Espace</Text>
                </Pressable>
                {multiline ? (
                  <Pressable style={[styles.actionKey, styles.actionKeyWide]} onPress={() => append('\n')}>
                    <Text style={styles.actionText}>Retour</Text>
                  </Pressable>
                ) : null}
                <Pressable style={[styles.actionKey, styles.actionKeyWide]} onPress={backspace}>
                  <Text style={styles.actionText}>Suppr</Text>
                </Pressable>
                <Pressable style={[styles.actionKey, styles.actionKeyWide]} onPress={deleteForward}>
                  <Text style={styles.actionText}>Del</Text>
                </Pressable>
                <Pressable style={[styles.actionKey, styles.actionKeyWide]} onPress={() => setDraft('')}>
                  <Text style={styles.actionText}>Effacer</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    width: '100%',
    alignSelf: 'stretch'
  },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  inputDisabled: {
    opacity: 0.5
  },
  inputMultiline: {
    minHeight: 110,
    alignItems: 'flex-start'
  },
  inputText: {
    color: '#f8fafc'
  },
  placeholder: {
    color: '#64748b'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.28)',
    justifyContent: 'flex-end'
  },
  modalDismissZone: {
    flex: 1
  },
  keyboardSheet: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#020617',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    padding: 8,
    paddingBottom: 12
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingBottom: 8
  },
  sheetTitle: {
    color: '#cbd5e1',
    fontWeight: '700'
  },
  sheetClose: {
    color: '#e2e8f0',
    fontWeight: '700'
  },
  editorPreview: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    justifyContent: 'center'
  },
  editorPreviewMultiline: {
    minHeight: 110,
    justifyContent: 'flex-start'
  },
  editorPreviewText: {
    color: '#f8fafc'
  },
  cursorMark: {
    color: '#22c55e',
    fontWeight: '900'
  },
  keyboard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 4,
    backgroundColor: '#0b1220',
    gap: 4,
    width: '100%',
    alignSelf: 'stretch'
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 2,
    width: '100%'
  },
  key: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingHorizontal: 0,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  keyText: {
    color: '#e2e8f0',
    fontWeight: '800',
    fontSize: 21,
    lineHeight: 24
  },
  actionKey: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#166534',
    backgroundColor: '#14532d',
    paddingHorizontal: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionKeyWide: {
    minWidth: 62
  },
  actionKeyNav: {
    flex: 1,
    minWidth: 0
  },
  actionKeySpace: {
    flex: 1
  },
  actionText: {
    color: '#dcfce7',
    fontWeight: '800',
    fontSize: 16
  }
});

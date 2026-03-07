import { useMemo, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

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

  const rows = useMemo(
    () =>
      LETTER_ROWS.map((row) =>
        row.map((char) => (upper ? char.toUpperCase() : char))
      ),
    [upper]
  );

  function append(char: string) {
    onChangeText(`${value}${char}`);
  }

  function backspace() {
    onChangeText(value.slice(0, -1));
  }

  return (
    <View style={[styles.container, containerStyle]}>
      <Pressable
        style={[styles.input, multiline && styles.inputMultiline, disabled && styles.inputDisabled, inputStyle]}
        onPress={() => setOpen((prev) => !prev)}
        disabled={!!disabled}
      >
        <Text style={[styles.inputText, !value && styles.placeholder]}>{value || placeholder || ''}</Text>
      </Pressable>

      {!disabled && open ? (
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
            {SYMBOL_ROW.map((char) => (
              <Pressable key={`symbol-${char}`} style={styles.key} onPress={() => append(char)}>
                <Text style={styles.keyText}>{char}</Text>
              </Pressable>
            ))}
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
            <Pressable style={[styles.actionKey, styles.actionKeyWide]} onPress={() => onChangeText('')}>
              <Text style={styles.actionText}>Effacer</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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
  keyboard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 8,
    backgroundColor: '#020617',
    gap: 6,
    width: '100%',
    alignSelf: 'stretch'
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 4,
    width: '100%'
  },
  key: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingHorizontal: 2,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  keyText: {
    color: '#e2e8f0',
    fontWeight: '700'
  },
  actionKey: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#166534',
    backgroundColor: '#14532d',
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actionKeyWide: {
    minWidth: 58
  },
  actionKeySpace: {
    flex: 1
  },
  actionText: {
    color: '#dcfce7',
    fontWeight: '700'
  }
});

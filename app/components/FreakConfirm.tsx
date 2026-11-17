// FreakConfirm — the reusable two-step "ARE YOU FREAKING SURE?" danger modal.
//
// Ported from the GymForge (8002) web `gfConfirm` pattern. It is NOT a
// single-tap confirm: the danger button must be TAPPED TWICE.
//   tap 1 -> arms (text flips to "🔥 FREAKING CONFIRM", card shakes)
//   tap 2 -> fires `onConfirm`
// Cancel / tap-outside / navigate-away disarms. A random title + emoji each
// open keeps the tone alive (the 8002 GF_CONFIRM_LINES / EMOJI arrays).
//
// Usage:
//   const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
//   <FreakConfirm handle={setConfirm} />
//   ...
//   const ok = await confirm?.open({ title: "...", body: "...", okText: "🔥 ..." });
//   if (ok) { /* do the destructive thing */ }
//
// open() returns a Promise<boolean> that resolves true on armed-confirm, false
// on cancel. The component owns the animation; it cleans up on unmount.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Easing,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

export interface FreakConfirmResult {
  /** true = user confirmed (or, in password mode, submitted a password). */
  ok: boolean;
  /** Password entered in password mode (empty string otherwise). */
  password?: string;
  /** Passwords entered in multi-password mode (in field order). */
  passwords?: string[];
}

export interface FreakConfirmHandle {
  open: (opts: FreakConfirmOpts) => Promise<FreakConfirmResult>;
}

export interface FreakConfirmOpts {
  /** Title line. Random freakin' line if omitted. */
  title?: string;
  /** The consequence / prompt. Required. */
  body: string;
  /** Armed-state / confirm label. Defaults to "🔥 Yes, do it". */
  okText?: string;
  /**
   * Fire on the FIRST tap (no arm-and-shake two-tap). Use for non-destructive
   * "are you ready?" / "last chance" gates that are really just one click. The
   * default (two-tap: tap 1 arms + shakes, tap 2 fires) is for destructive acts.
   */
  singleTap?: boolean;
  /** Emoji above the title. Random if omitted. */
  emoji?: string;
  /**
   * PASSWORD MODE: instead of the two-tap arm-and-strike, render a secure
   * password field + a single "submit" button. open() resolves with the typed
   * password (ok=true) or {ok:false} on cancel. Used for the Backup/Restore
   * 401 "session expired — log in to the server to continue" flow.
   */
  password?: { label: string; placeholder?: string };
  /**
   * MULTI-PASSWORD MODE: render multiple secure password fields (e.g.
   * change-password: current, new, confirm). open() resolves with an
   * `FreakConfirmResult` where `passwords` is an array of the typed values
   * in order. All fields must be non-empty to submit.
   */
  passwords?: { label: string; placeholder?: string }[];
}

const FREAK_LINES = [
  "ARE YOU FREAKING SURE?",
  "WAIT. HOLD ON. WHAT?",
  "FREAKING SERIOUSLY?",
  "ARE YOU *ABSOLUTELY* CERTAIN?",
  "REALLY? GONNA DO IT?",
  "THINK ABOUT THAT. FREAKING THINK.",
];
const FREAK_EMOJI = ["😱", "🤯", "🚨", "⚠️", "😰", "💀"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function FreakConfirm({
  handle,
  inline = false,
}: {
  handle: (h: FreakConfirmHandle | null) => void;
  /**
   * inline=true: render as an absolutely-positioned View overlay instead of a
   * <Modal>. Use this when FreakConfirm must be shown WHILE another <Modal> is
   * already open (e.g. inside a leaderboard modal). iOS refuses to present a
   * second native Modal over an open one (silent no-op), so the inline overlay
   * avoids the conflict entirely. The overlay must be rendered INSIDE the parent
   * modal's content tree so it's a child View, not a sibling Modal.
   */
  inline?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [armed, setArmed] = useState(false);
  const [title, setTitle] = useState(FREAK_LINES[0]);
  const [body, setBody] = useState("");
  const [emoji, setEmoji] = useState(FREAK_EMOJI[0]);
  const [okText, setOkText] = useState("🔥 Yes, do it");
  // singleTap: fire on the first press (no arm-and-shake). Non-destructive gates.
  const [singleTap, setSingleTap] = useState(false);
  // Password-mode state (single + multi).
  const [pwMode, setPwMode] = useState(false);
  const [pwLabel, setPwLabel] = useState("");
  const [pwPlaceholder, setPwPlaceholder] = useState("");
  const [pwValue, setPwValue] = useState("");
  const [multiPwMode, setMultiPwMode] = useState(false);
  const [multiPwFields, setMultiPwFields] = useState<{ label: string; placeholder?: string }[]>([]);
  const [multiPwValues, setMultiPwValues] = useState<string[]>([]);

  // Resolve the pending open() promise when the dialog settles.
  const resolver = useRef<((v: FreakConfirmResult) => void) | null>(null);
  // Shake animation value (horizontal nudge that reads like the 8002 keyframe).
  const shake = useRef(new Animated.Value(0)).current;

  const runShake = useCallback(() => {
    shake.setValue(0);
    // A short, decaying left-right nudge. Reads as the web "ogshake" in RN.
    Animated.sequence([
      Animated.timing(shake, { toValue: -9, duration: 70, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 8, duration: 70, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 4, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    ]).start();
  }, [shake]);

  const open = useCallback(
    (opts: FreakConfirmOpts) =>
      new Promise<FreakConfirmResult>((resolve) => {
        setTitle(opts.title || pick(FREAK_LINES));
        setBody(opts.body || "");
        setEmoji(opts.emoji || pick(FREAK_EMOJI));
        setOkText(opts.okText || "🔥 Yes, do it");
        setArmed(false);
        setSingleTap(!!opts.singleTap);
        setPwMode(!!opts.password);
        setPwLabel(opts.password?.label ?? "");
        setPwPlaceholder(opts.password?.placeholder ?? "password");
        setPwValue("");
        setMultiPwMode(!!opts.passwords);
        setMultiPwFields(opts.passwords ?? []);
        setMultiPwValues((opts.passwords ?? []).map(() => ""));
        resolver.current = resolve;
        setVisible(true);
        // Shake on open (next frame so a re-open re-triggers it).
        requestAnimationFrame(runShake);
      }),
    [runShake]
  );

  const settle = useCallback((v: FreakConfirmResult) => {
    setVisible(false);
    setArmed(false);
    setPwValue("");
    const r = resolver.current;
    resolver.current = null;
    // On iOS, a new native screen (document picker, share sheet, etc.) cannot
    // be presented while a Modal's close animation is still playing. iOS will
    // silently refuse the presentation, leaving the native picker lock stuck —
    // every subsequent getDocumentAsync() call then fails with "Different
    // document picking in progress" until the app is reloaded. Delay the
    // resolution so the caller's .then() (which often opens a picker) fires
    // after the close animation finishes. 500ms matches the fade-out duration.
    if (Platform.OS === "ios") {
      setTimeout(() => r?.(v), 500);
    } else {
      r?.(v);
    }
  }, []);

  const onOk = useCallback(() => {
    if (singleTap) {
      settle({ ok: true }); // one tap -> fire (no arm-and-shake)
      return;
    }
    if (armed) {
      settle({ ok: true }); // second tap -> fire
      return;
    }
    setArmed(true); // first tap -> arm + shake
    runShake();
  }, [singleTap, armed, settle, runShake]);

  // Password-mode submit: require a non-empty password, then resolve with it.
  const onPwSubmit = useCallback(() => {
    if (!pwValue.trim()) return; // can't submit empty
    settle({ ok: true, password: pwValue });
  }, [pwValue, settle]);

  // Multi-password submit: require ALL fields non-empty, resolve with the array.
  const onMultiPwSubmit = useCallback(() => {
    if (multiPwValues.some((v) => !v.trim())) return;
    settle({ ok: true, passwords: multiPwValues });
  }, [multiPwValues, settle]);

  // Expose the handle to the parent; null it on unmount.
  const ref = useMemo<FreakConfirmHandle>(() => ({ open }), [open]);
  useEffect(() => {
    handle(ref);
    return () => handle(null);
  }, [handle, ref]);

  const cardContent = (
        <View style={inline ? styles.overlayInline : styles.overlay} pointerEvents={visible ? "auto" : "none"}>
          <Animated.View
            style={[styles.card, { transform: [{ translateX: shake }] }]}
          >
          <Text style={styles.emoji}>{emoji}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {multiPwMode ? (
            <View style={styles.pwcol}>
              {multiPwFields.map((f, i) => (
                <React.Fragment key={i}>
                  <Text style={styles.pwLabel}>{f.label}</Text>
                  <TextInput
                    style={styles.pwInput}
                    value={multiPwValues[i]}
                    onChangeText={(t) => {
                      const next = [...multiPwValues];
                      next[i] = t;
                      setMultiPwValues(next);
                    }}
                    secureTextEntry
                    autoFocus={i === 0}
                    placeholder={f.placeholder ?? "password"}
                    placeholderTextColor="#5a6b82"
                    testID={`freak-pw-multi-${i}`}
                    onSubmitEditing={() => {
                      if (i < multiPwFields.length - 1) return; // last field submits
                    }}
                  />
                </React.Fragment>
              ))}
              <View style={styles.btnrow}>
                <TouchableOpacity style={[styles.btn, styles.ghost]} onPress={() => settle({ ok: false })}>
                  <Text style={[styles.btnText, styles.ghostText]}>🏃 No, cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.danger, multiPwValues.some((v) => !v.trim()) && styles.btnDisabled]}
                  onPress={onMultiPwSubmit}
                  testID="freak-pw-multi-submit"
                >
                  <Text style={styles.btnText}>{okText || "🔑 Update"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : pwMode ? (
            <View style={styles.pwcol}>
              <Text style={styles.pwLabel}>{pwLabel}</Text>
              <TextInput
                style={styles.pwInput}
                value={pwValue}
                onChangeText={setPwValue}
                secureTextEntry
                autoFocus
                placeholder={pwPlaceholder}
                placeholderTextColor="#5a6b82"
                testID="freak-pw-input"
                onSubmitEditing={onPwSubmit}
              />
              <View style={styles.btnrow}>
                <TouchableOpacity style={[styles.btn, styles.ghost]} onPress={() => settle({ ok: false })}>
                  <Text style={[styles.btnText, styles.ghostText]}>🏃 No, cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.danger, !pwValue.trim() && styles.btnDisabled]}
                  onPress={onPwSubmit}
                  testID="freak-pw-submit"
                >
                  <Text style={styles.btnText}>{okText || "🔐 Log in & retry"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.btnrow}>
              <TouchableOpacity style={[styles.btn, styles.ghost]} onPress={() => settle({ ok: false })}>
                <Text style={[styles.btnText, styles.ghostText]}>🏃 No, cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.danger,
                  armed && styles.dangerArmed,
                ]}
                onPress={onOk}
                testID="freak-confirm-ok"
              >
                <Text style={styles.btnText}>
                  {armed ? "🔥 FREAKING CONFIRM" : okText}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          </Animated.View>
        </View>
  );

  if (inline) {
    // Inline overlay: no <Modal> wrapper. Must be rendered inside the parent
    // modal's content tree. Returns null when not visible (zero cost).
    return visible ? cardContent : null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      {/* Modal is a separate Android window — needs its own KAV.
          Parent KAV in App.tsx doesn't reach into Modal. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        {cardContent}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.62)", justifyContent: "center", alignItems: "center", padding: 28 },
  overlayInline: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,.62)", justifyContent: "center", alignItems: "center", padding: 28 },
  card: { width: "100%", maxWidth: 380, backgroundColor: "#1b2440", borderColor: "rgba(255,255,255,.15)", borderWidth: 1, borderRadius: 16, padding: 22, alignItems: "center" },
  emoji: { fontSize: 40, marginBottom: 10, textAlign: "center" },
  title: { color: "#fff", fontSize: 19, fontWeight: "800", textAlign: "center", marginBottom: 12, lineHeight: 24 },
  body: { color: "#9fb3c8", fontSize: 14, textAlign: "center", lineHeight: 21, marginBottom: 6 },
  btnrow: { flexDirection: "row", gap: 12, marginTop: 18, alignSelf: "stretch" },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 10, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,.15)" },
  ghost: { backgroundColor: "transparent" },
  ghostText: { color: "#9fb3c8", fontSize: 14, fontWeight: "600" },
  danger: { backgroundColor: "#c0392b", borderColor: "#c0392b" },
  dangerArmed: { backgroundColor: "#a93226", borderColor: "#f55" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center" },
  btnDisabled: { backgroundColor: "#5a3a34", borderColor: "#5a3a34", opacity: 0.8 },
  pwcol: { alignSelf: "stretch", marginTop: 6 },
  pwLabel: { color: "#9fb3c8", fontSize: 13, textAlign: "left", marginBottom: 8, lineHeight: 19 },
  pwInput: { backgroundColor: "#0f1730", borderColor: "rgba(255,255,255,.15)", borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, color: "#fff", fontSize: 15, marginBottom: 4 },
});

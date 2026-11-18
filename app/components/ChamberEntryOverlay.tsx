// ChamberEntryOverlay — the "descent" sequence (Phase 3.8).
//
// Fullscreen modal that plays a themed message sequence while the user
// transitions from the password modal to the Chamber lobby. Same pattern
// as FreakConfirm and EggToast: forwardRef + imperative handle.
//
//   open(reauthPromise) -> Modal fades in (native)
//   onShow -> plays 4 messages (~600ms each, pure animation)
//            -> awaits reauthPromise (usually already resolved)
//            -> success: "Welcome" flash (600ms) -> hide -> resolve
//            -> fail:    "Access Denied" flash (600ms) -> hide -> resolve
//
// Key design: the message loop starts in onShow, AFTER the Modal's native
// fade-in animation completes. This prevents the first message's
// Animated.timing from fighting the Modal's appearance animation for frames.
// The component is wrapped in React.memo so parent re-renders (from
// setBusy/commitSignIn in AppHeader) don't cascade into the overlay.
//
// Animation: fade in from bottom (300ms) → hold (300ms) → fade out (200ms)
// per message. Uses React Native Animated (no external libraries).

import React, { forwardRef, useImperativeHandle, useRef, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { colors } from "../src/theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChamberEntryHandle {
  /** Plays the descent sequence. `reauthPromise` is a pre-started promise
   *  (the caller kicks off the network call before opening the overlay so it
   *  runs in parallel with the animation). Resolves when the overlay is done. */
  open: (reauthPromise: Promise<boolean>) => Promise<{ ok: boolean }>;
}

interface Props {
  handle: (h: ChamberEntryHandle) => void;
}

// ---------------------------------------------------------------------------
// Message sequence
// ---------------------------------------------------------------------------

interface Msg {
  emoji: string;
  text: string;
  sub?: string;
}

const DESCENT_MSGS: Msg[] = [
  { emoji: "🚀", text: "Heading down to the chamber..." },
  { emoji: "🚀", text: "Knocking the secret knock...", sub: "*knock knock knock*" },
  { emoji: "🚀", text: "Showing the secret hand signal...", sub: "🤙" },
  { emoji: "🚀", text: "Singing the secret passphrase...", sub: "🎵" },
];

const SUCCESS_MSG: Msg = { emoji: "🚀", text: "Welcome to the Chamber of Chaos" };
const FAIL_MSG: Msg = {
  emoji: "🚫",
  text: "Authentication failed. Access Denied.",
  sub: "Returning you to reality...",
};

const MSG_HOLD_MS = 600;
const FADE_IN_MS = 300;
const FADE_OUT_MS = 200;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ChamberEntryOverlayInner = forwardRef<ChamberEntryHandle, Props>(
  ({ handle }, _ref) => {
    const [visible, setVisible] = React.useState(false);
    const [msgIndex, setMsgIndex] = React.useState(0);
    const [phase, setPhase] = React.useState<"descent" | "result">("descent");
    const [result, setResult] = React.useState<"success" | "fail">("success");

    // Animated values
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(20)).current;

    // Sequence state (refs — survive re-renders without triggering them)
    const cancelled = useRef(false);
    const sequenceStarted = useRef(false);
    const pendingPromise = useRef<Promise<boolean> | null>(null);
    const resolverRef = useRef<((v: { ok: boolean }) => void) | null>(null);

    // Play a single message: fade in → hold → fade out
    const playMessage = useCallback(
      (msg: Msg): Promise<void> => {
        return new Promise((resolve) => {
          opacity.setValue(0);
          translateY.setValue(20);

          Animated.parallel([
            Animated.timing(opacity, {
              toValue: 1,
              duration: FADE_IN_MS,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(translateY, {
              toValue: 0,
              duration: FADE_IN_MS,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start(() => {
            if (cancelled.current) { resolve(); return; }
            setTimeout(() => {
              if (cancelled.current) { resolve(); return; }
              Animated.timing(opacity, {
                toValue: 0,
                duration: FADE_OUT_MS,
                easing: Easing.in(Easing.ease),
                useNativeDriver: true,
              }).start(() => {
                if (cancelled.current) { resolve(); return; }
                resolve();
              });
            }, MSG_HOLD_MS - FADE_OUT_MS);
          });
        });
      },
      [opacity, translateY]
    );

    // The message loop — starts in onShow (after Modal native fade completes).
    const startSequence = useCallback(async () => {
      if (sequenceStarted.current) return;
      sequenceStarted.current = true;

      setPhase("descent");

      // Play all 4 descent messages (pure animation)
      for (let i = 0; i < DESCENT_MSGS.length; i++) {
        if (cancelled.current) {
          setVisible(false);
          resolverRef.current?.({ ok: false });
          return;
        }
        setMsgIndex(i);
        await playMessage(DESCENT_MSGS[i]);
      }

      if (cancelled.current) {
        setVisible(false);
        resolverRef.current?.({ ok: false });
        return;
      }

      // Await the pre-started reauth promise.
      // By now (~2.4s of animation), it's likely already resolved.
      let ok = false;
      try {
        ok = await (pendingPromise.current ?? Promise.resolve(false));
      } catch {
        ok = false;
      }

      if (cancelled.current) {
        setVisible(false);
        resolverRef.current?.({ ok: false });
        return;
      }

      // Show result
      setPhase("result");
      setResult(ok ? "success" : "fail");
      await playMessage(ok ? SUCCESS_MSG : FAIL_MSG);

      if (cancelled.current) {
        resolverRef.current?.({ ok: false });
        return;
      }
      setVisible(false);
      resolverRef.current?.({ ok });
      resolverRef.current = null;
      sequenceStarted.current = false;
      pendingPromise.current = null;
    }, [playMessage]);

    // open() — stores the promise, shows the Modal, returns the awaitable.
    // The actual sequence starts in onShow.
    const open = useCallback(
      (reauthPromise: Promise<boolean>): Promise<{ ok: boolean }> => {
        if (cancelled.current) return Promise.resolve({ ok: false });
        cancelled.current = false;
        sequenceStarted.current = false;
        pendingPromise.current = reauthPromise;

        setMsgIndex(0);
        setPhase("descent");
        setResult("success");

        // Reset animation values so the first message starts clean
        opacity.setValue(0);
        translateY.setValue(20);

        setVisible(true);

        // Return a promise that resolves when the sequence finishes.
        // The sequence starts in onShow (after Modal fade-in completes).
        return new Promise<{ ok: boolean }>((resolve) => {
          resolverRef.current = resolve;
        });
      },
      [opacity, translateY]
    );

    useImperativeHandle(_ref, () => ({ open }), [open]);

    // Expose handle via prop (same pattern as FreakConfirm/EggToast).
    // open is stable (useCallback with stable refs), so this effect runs once.
    React.useEffect(() => {
      handle({ open });
      return () => {
        cancelled.current = true;
        handle({ open: async () => ({ ok: false }) });
      };
    }, [handle, open]);

    const currentMsg: Msg =
      phase === "descent"
        ? DESCENT_MSGS[Math.min(msgIndex, DESCENT_MSGS.length - 1)]
        : result === "success"
          ? SUCCESS_MSG
          : FAIL_MSG;

    return (
      <Modal
        visible={visible}
        transparent={false}
        animationType="fade"
        onShow={startSequence}
        onRequestClose={() => {
          cancelled.current = true;
          setVisible(false);
          resolverRef.current?.({ ok: false });
        }}
      >
        <View style={styles.root}>
          <Animated.View
            style={[
              styles.msgWrap,
              { opacity, transform: [{ translateY }] },
            ]}
          >
            <Text style={styles.emoji}>{currentMsg.emoji}</Text>
            <Text style={styles.text}>{currentMsg.text}</Text>
            {currentMsg.sub && <Text style={styles.sub}>{currentMsg.sub}</Text>}
          </Animated.View>
        </View>
      </Modal>
    );
  }
);

// React.memo: parent re-renders (setBusy, commitSignIn) don't cascade here.
const ChamberEntryOverlay = React.memo(ChamberEntryOverlayInner);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  msgWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 48,
    marginBottom: 20,
  },
  text: {
    color: colors.accentSoft,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 32,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "500",
    marginTop: 12,
    textAlign: "center",
    fontStyle: "italic",
  },
});

export default ChamberEntryOverlay;

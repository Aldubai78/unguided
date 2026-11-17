// ChamberChat — the live room (Phase 3, W4).
//
// Renders once the user has picked a persona in the lobby (W3). Connects
// the Socket.IO wrapper (W2), joins the room, and streams:
//   - live messages (own right-aligned in your color, others left in theirs)
//   - system join/leave lines (centered colored pills)
//   - typing indicators (auto-clear on message / 3s timeout)
//   - presence (occupants in the header, live-updated)
//   - composer with throttled typing signals
//
// Leave: back button or explicit leave → chamber_leave + disconnect.
// Reconnect: single "re-enter passphrase" state (no auto-reconnect loop).

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootParamList } from "../App";
import { colors } from "../src/theme";
import { connectChamber, type ChamberSocket } from "../src/chamberSocket";
import { clearGateToken } from "../src/chamberGate";
import type {
  PersonaInfo,
  JoinResult,
  ChamberMessage,
  ChamberSystem,
  PresenceState,
  TypingEvent,
} from "../src/chamberSocket";

type Nav = NativeStackNavigationProp<RootParamList, "Chamber">;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Local message model
// ---------------------------------------------------------------------------

interface ChatMsg {
  id: string;
  kind: "msg" | "system";
  persona: string;
  color: string;
  emoji: string;
  text: string;
  ts: string;
  isOwn: boolean;
  isBot?: boolean;
  isChaos?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Local persona→emoji lookup (mirrors server chamber.py). Used as a fallback
// when the socket message doesn't carry an emoji field, so we never default
// to 🚀 for a known persona. Historical feeds keep their original emoji.
const PERSONA_EMOJI: Record<string, string> = {
  Typhoon: "🌀", Maelstrom: "⚡", Hurricane: "🌊", Cyclone: "⛈️",
  Tornado: "🌪️", Tempest: "🐲", Shamal: "🌬️", Monsoon: "🌧️",
  Firestorm: "🔥", Blizzard: "🌨️", Doug: "🦈",
};
function personaEmoji(name: string | null | undefined): string {
  if (!name) return "🚀";
  return PERSONA_EMOJI[name] ?? "🚀";
}
function personaIsBot(name: string | null | undefined): boolean {
  return name === "Doug";
}

let msgId = 0;
function nextId(): string {
  return `${Date.now()}-${++msgId}`;
}

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

/**
 * WhatsApp-style inline formatter: *bold*, _italic_, ~strikethrough~, `monospace`.
 * Splits text into fragments and returns styled <Text> elements.
 */
function formatInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*[^*]+\*|_[^_]+_|~[^~]+~|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<Text key={key++}>{text.slice(last, match.index)}</Text>);
    }
    const token = match[0];
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      parts.push(
        <Text key={key++} style={{ fontWeight: "700" }}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith("_") && token.endsWith("_") && token.length > 2) {
      parts.push(
        <Text key={key++} style={{ fontStyle: "italic" }}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith("~") && token.endsWith("~") && token.length > 2) {
      parts.push(
        <Text key={key++} style={{ textDecorationLine: "line-through", opacity: 0.7 }}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      parts.push(
        <Text key={key++} style={{ fontFamily: "monospace", backgroundColor: "#ffffff14", borderRadius: 4, paddingHorizontal: 3 }}>
          {token.slice(1, -1)}
        </Text>
      );
    } else {
      parts.push(<Text key={key++}>{token}</Text>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    parts.push(<Text key={key++}>{text.slice(last)}</Text>);
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  persona: string;
  onLeave: () => void;
}

export default function ChamberChat({ persona, onLeave }: Props) {
  const navigation = useNavigation<Nav>();

  // — state —
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [typingWho, setTypingWho] = useState<Map<string, string>>(new Map());
  const [joinError, setJoinError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [reconnectNeeded, setReconnectNeeded] = useState(false);
  const [connectKey, setConnectKey] = useState(0);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [joined, setJoined] = useState(false);
  const [sharkArmed, setSharkArmed] = useState(false);
  const [chaosArmed, setChaosArmed] = useState(false);

  const socketRef = useRef<ChamberSocket | null>(null);
  const listRef = useRef<FlatList<ChatMsg>>(null);
  const nearBottom = useRef(true);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSent = useRef(false);
  const lastTypingSignal = useRef(0);

  // Own persona info (resolved after join result).
  const [me, setMe] = useState<{ persona: string; color: string; emoji: string; is_bot: boolean } | null>(null);

  // — connect + join —
  useEffect(() => {
    let cancelled = false;
    let sock: ChamberSocket | null = null;

    (async () => {
      try {
        sock = await connectChamber((err) => {
          if (cancelled) return;
          setConnecting(false);
          setReconnectNeeded(true);
          setJoinError(err.message || "Connection failed");
        });

        if (cancelled) { sock.destroy(); return; }
        socketRef.current = sock;

        sock.raw.on("connect", () => {
          if (cancelled) return;
          setConnecting(false);
          setConnected(true);
          setReconnectNeeded(false);

          // Join the room.
          sock!.join(persona);
        });

        // Join result
        sock.raw.on("chamber_join_result", (result: JoinResult) => {
          if (cancelled) return;
          if (result.ok) {
            setJoined(true);
            const pName = result.persona ?? persona;
            setMe({
              persona: pName,
              color: result.color ?? colors.accent,
              emoji: personaEmoji(pName),
              is_bot: personaIsBot(pName),
            });
            setJoinError(null);
          } else {
            setJoinError(result.reason || "Join failed");
            // Don't destroy — let the user go back to lobby.
          }
        });

        // Phase 3.1: history — server sends the last N messages on join.
        // Arrives after chamber_join_result, so the UI is ready.
        sock.raw.on("chamber_history", (msgs: ChamberMessage[]) => {
          if (cancelled) return;
          const historyMsgs: ChatMsg[] = msgs.map((m) => ({
            id: nextId(),
            kind: "msg",
            persona: m.persona,
            color: m.color,
            emoji: m.emoji || personaEmoji(m.persona),
            text: m.message,
            ts: m.ts,
            isOwn: m.persona === persona,
            isBot: m.is_bot,
          }));
          setMessages((prev) => [...prev, ...historyMsgs]);
          setTimeout(() => { if (nearBottom.current) listRef.current?.scrollToEnd({ animated: true }); }, 100);
        });

        // Messages
        sock.raw.on("chamber_message", (msg: ChamberMessage) => {
          if (cancelled) return;
          // Skip our own messages — we already rendered them optimistically.
          if (msg.persona === persona) return;
          // Clear typing for this persona.
          setTypingWho((prev) => {
            if (!prev.has(msg.persona)) return prev;
            const next = new Map(prev);
            next.delete(msg.persona);
            return next;
          });

          const occ = presence?.occupants.find((o) => o.persona === msg.persona);
          const chatMsg: ChatMsg = {
            id: nextId(),
            kind: "msg",
            persona: msg.persona,
            color: msg.color,
            emoji: msg.emoji ?? occ?.emoji ?? personaEmoji(msg.persona),
            text: msg.message,
            ts: msg.ts,
            isOwn: false,
            isBot: msg.is_bot,
          };
          setMessages((prev) => [...prev, chatMsg]);
          // Auto-scroll only if user is already at the bottom.
          setTimeout(() => { if (nearBottom.current) listRef.current?.scrollToEnd({ animated: true }); }, 50);
        });

        // System (join/leave)
        sock.raw.on("chamber_system", (sys: ChamberSystem) => {
          if (cancelled) return;
          const chatMsg: ChatMsg = {
            id: nextId(),
            kind: "system",
            persona: sys.persona,
            color: sys.color,
            emoji: sys.emoji,
            text: sys.message,
            ts: sys.ts,
            isOwn: false,
          };
          setMessages((prev) => [...prev, chatMsg]);
          setTimeout(() => { if (nearBottom.current) listRef.current?.scrollToEnd({ animated: true }); }, 50);
        });

        // Presence
        sock.raw.on("chamber_presence", (state: PresenceState) => {
          if (cancelled) return;
          setPresence(state);
          // Update own emoji from presence if we're in it.
          const meOcc = state.occupants.find((o) => o.persona === persona);
          if (meOcc) {
            setMe({ persona: meOcc.persona, color: meOcc.color, emoji: meOcc.emoji, is_bot: meOcc.is_bot });
          }
        });

        // Typing
        sock.raw.on("chamber_typing", (ev: TypingEvent) => {
          if (cancelled) return;
          if (ev.persona === persona) return; // ignore own
          // No timeout — indicator lives until chamber_stopped_typing arrives.
          // Mirrors web client: state is server-authoritative.
          setTypingWho((prev) => {
            const next = new Map(prev);
            next.set(ev.persona, ev.color);
            return next;
          });
        });

        sock.raw.on("chamber_stopped_typing", (ev: TypingEvent) => {
          if (cancelled) return;
          setTypingWho((prev) => {
            if (!prev.has(ev.persona)) return prev;
            const next = new Map(prev);
            next.delete(ev.persona);
            return next;
          });
        });

        // Disconnect
        sock.raw.on("disconnect", () => {
          if (cancelled) return;
          setConnected(false);
          setReconnectNeeded(true);
        });
      } catch (e) {
        if (cancelled) return;
        setConnecting(false);
        setJoinError(e instanceof Error ? e.message : "Failed to connect");
      }
    })();

    return () => {
      cancelled = true;
      if (sock) sock.destroy();
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, connectKey]);

  // — send message —
  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !socketRef.current || !joined) return;

    // 🌋 Easter egg: "something chaotic" arms the gold bubble (no message sent).
    if (text.toLowerCase() === "something chaotic") {
      setChaosArmed(true);
      setInput("");
      setTypingWho(new Map());
      typingSent.current = false;
      return;
    }

    // Fire the armed chaos on the next real message.
    const firedChaos = chaosArmed;
    const chatMsg: ChatMsg = {
      id: nextId(),
      kind: "msg",
      persona: me?.persona ?? persona,
      color: me?.color ?? colors.accent,
      emoji: me?.emoji ?? personaEmoji(me?.persona),
      text,
      ts: new Date().toISOString(),
      isOwn: true,
      isChaos: firedChaos,
    };
    setMessages((prev) => [...prev, chatMsg]);
    setTimeout(() => { if (nearBottom.current) listRef.current?.scrollToEnd({ animated: true }); }, 50);

    socketRef.current.send(text);
    socketRef.current.stopTyping();
    setInput("");
    setTypingWho(new Map());
    typingSent.current = false;

    if (firedChaos) setChaosArmed(false);

    // Clear any armed easter eggs on a normal send.
    setSharkArmed(false);

    // 🦈 Easter egg: sending a lone shark arms the header flash.
    if (text === "🦈") {
      setSharkArmed(true);
    }
  }, [input, joined, me, persona, chaosArmed]);

  // — typing signals (mirrors web client: 2s silence → stopped) —
  const onTextChange = useCallback((text: string) => {
    setInput(text);
    if (!socketRef.current || !joined) return;

    if (text.length > 0) {
      // First keystroke → announce typing.
      if (!typingSent.current) {
        socketRef.current.startTyping();
        typingSent.current = true;
      }
      // Reset the 2s silence timer on every keystroke.
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => {
        if (socketRef.current && typingSent.current) {
          socketRef.current.stopTyping();
          typingSent.current = false;
        }
      }, 20000);
    } else if (typingSent.current) {
      // Input cleared → stop immediately.
      if (typingTimer.current) clearTimeout(typingTimer.current);
      socketRef.current.stopTyping();
      typingSent.current = false;
    }
  }, [joined]);

  // — leave —
  const doLeave = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.leave();
      socketRef.current.destroy();
      socketRef.current = null;
    }
    clearGateToken();
    onLeave();
  }, [onLeave]);

  // — reconnect (in-place, same persona, keep messages) —
  const doReconnect = useCallback(() => {
    setReconnectNeeded(false);
    setJoinError(null);
    setConnecting(true);
    setJoined(false);
    setConnected(false);
    // Destroy the dead socket so the effect cleanup doesn't double-fire.
    if (socketRef.current) {
      socketRef.current.destroy();
      socketRef.current = null;
    }
    // Add a system separator so the user sees where the break was.
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        kind: "system",
        persona: "system",
        color: colors.faint,
        emoji: "🔌",
        text: "reconnected",
        ts: new Date().toISOString(),
        isOwn: false,
      },
    ]);
    // Bump connectKey → connect effect re-runs with same persona.
    setConnectKey((k) => k + 1);
  }, []);

  // — scroll tracking (only auto-scroll when user is at the bottom) —
  const listHeight = useRef(400); // measured once via onLayout
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize } = e.nativeEvent;
      // Within 80px of the bottom = "near bottom" → allow auto-scroll.
      nearBottom.current = contentSize.height - contentOffset.y - listHeight.current < 80;
    },
    [],
  );
  const onListLayout = useCallback((e: LayoutChangeEvent) => {
    listHeight.current = e.nativeEvent.layout.height;
  }, []);

  // — render message —
  const renderMsg = useCallback(
    ({ item }: { item: ChatMsg }) => {
      if (item.kind === "system") {
        return (
          <View style={styles.systemRow}>
            <View style={[styles.systemPill, { borderColor: item.color }]}>
              <Text style={styles.systemEmoji}>{item.emoji}</Text>
              <Text style={[styles.systemText, { color: item.color }]}>{item.text}</Text>
            </View>
          </View>
        );
      }

      const own = item.isOwn;
      return (
        <View style={[styles.msgRow, own ? styles.msgRowRight : styles.msgRowLeft]}>
          <View style={[styles.bubble, own && styles.bubbleOwn, { backgroundColor: item.isChaos ? "#f59e0b" : item.color }]}>
            <Text style={[styles.bubbleTitle, { color: "#fff", textTransform: "uppercase", fontWeight: "700" }, !own && { textAlign: "left" }]}>
              {item.emoji} {item.persona}{item.isChaos ? " 🌈🦄" : ""}
            </Text>
            <Text style={[styles.msgText, item.isChaos && { fontWeight: "700" }]}>{formatInline(item.text)}</Text>
            <Text style={styles.msgTime}>{fmtTime(item.ts)}</Text>
          </View>
        </View>
      );
    },
    [me],
  );

  // — presence header —
  const occupants = presence?.occupants ?? [];

  // — loading —
  if (connecting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentSoft} />
        <Text style={styles.loadingText}>Joining the chamber…</Text>
      </View>
    );
  }

  // — join error / reconnect —
  if (joinError && !joined) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>🚫</Text>
        <Text style={styles.errorText}>{joinError}</Text>
        <TouchableOpacity style={styles.btnBack} onPress={onLeave}>
          <Text style={styles.btnBackText}>← Back to lobby</Text>
        </TouchableOpacity>
        {reconnectNeeded && (
          <TouchableOpacity style={styles.btnReconnect} onPress={doReconnect}>
            <Text style={styles.btnReconnectText}>Reconnect</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* — presence header — */}
      <View style={styles.presenceHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={doLeave}>
          <Text style={styles.backChevron}>←</Text>
        </TouchableOpacity>
        <View style={styles.presenceInfo}>
          <Text style={styles.presenceTitle}>
            {me?.emoji ?? personaEmoji(me?.persona)} {me?.persona ?? persona}
          </Text>
          <Text style={[styles.presenceSub, (sharkArmed || chaosArmed) && { color: "#fbbf24" }]}>
            {chaosArmed
              ? "🌈CHAOS DETECTED🦄"
              : sharkArmed
                ? "🦈 Dug up a shark 🦈"
                : occupants.length > 0
                  ? occupants.map((o) => `${o.emoji} ${o.persona}`).join(" · ")
                  : "you're alone"}
          </Text>
        </View>
      </View>

      {/* — message list — */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderMsg}
        contentContainerStyle={styles.listContent}
        onScroll={onScroll}
        onLayout={onListLayout}
        keyboardShouldPersistTaps="handled"
      />

      {/* — typing indicator (above composer) — */}
      {typingWho.size > 0 && (
        <View style={styles.typingBar}>
          {typingWho.size === 1 ? (
            <Text style={styles.typingText}>
              {Array.from(typingWho.keys())[0]} is typing…
            </Text>
          ) : typingWho.size === 2 ? (
            <Text style={styles.typingText}>
              {(() => { const [a, b] = Array.from(typingWho.keys()); return <>{a} and {b} are typing…</>; })()}
            </Text>
          ) : (
            <Text style={styles.typingText}>Storms are brewing…</Text>
          )}
        </View>
      )}

      {/* — composer — */}
      <View style={styles.composerWrapper}>
        <View style={styles.composer}>
          <TextInput
            style={[styles.input, inputFocused && styles.inputFocused]}
            value={input}
            onChangeText={onTextChange}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Say something chaotic…"
            placeholderTextColor={colors.faint}
            multiline
            autoFocus
            textContentType="none"
            autoCorrect={false}
            spellCheck={false}
            maxLength={5000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnOff]}
            onPress={sendMessage}
            disabled={!input.trim()}
          >
            <Text style={styles.sendBtnEmoji}>{me?.emoji ?? personaEmoji(me?.persona)}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* — disconnected / reconnecting overlay — */}
      {reconnectNeeded && connecting && (
        <View style={styles.reconnectingOverlay}>
          <Text style={styles.reconnectingText}>🔌 Reconnecting…</Text>
        </View>
      )}
      {reconnectNeeded && !connecting && (
        <View style={styles.disconnectOverlay}>
          <Text style={styles.disconnectText}>Disconnected</Text>
          <TouchableOpacity style={styles.btnReconnect} onPress={doReconnect}>
            <Text style={styles.btnReconnectText}>Reconnect</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.card,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 12,
  },
  // Error / reconnect
  errorIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  errorText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 20,
  },
  btnBack: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnBackText: {
    color: colors.text2,
    fontSize: 14,
    fontWeight: "600",
  },
  btnReconnect: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  btnReconnectText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  reconnectingOverlay: {
    position: "absolute",
    bottom: 70,
    left: 16,
    right: 16,
    backgroundColor: colors.cardRaised,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.accentSoft,
  },
  reconnectingText: {
    color: colors.accentSoft,
    fontSize: 13,
    fontWeight: "600",
  },
  // Presence header
  presenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.cardRaised,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  backChevron: {
    color: colors.accentSoft,
    fontSize: 18,
    fontWeight: "700",
  },
  presenceInfo: {
    flex: 1,
  },
  presenceTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  presenceSub: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  // Typing bar
  typingBar: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: colors.card,
  },
  typingText: {
    fontSize: 12,
    fontStyle: "italic",
    color: "#fff",
  },
  // Message list
  listContent: {
    padding: 12,
    gap: 6,
  },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  msgRowLeft: {
    justifyContent: "flex-start",
  },
  msgRowRight: {
    justifyContent: "flex-end",
  },
  msgMeta: {
    marginRight: 6,
    marginBottom: 2,
  },
  msgMetaRight: {
    marginLeft: 6,
    marginBottom: 2,
  },
  msgPersona: {
    fontSize: 11,
    fontWeight: "700",
  },
  bubble: {
    maxWidth: "75%",
    padding: 10,
    paddingTop: 8,
    // Chat-bubble shape (others, left-aligned): flat corner bottom-left.
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
  },
  bubbleOwn: {
    // Own (right-aligned): flat corner bottom-right.
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  bubbleTitle: {
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 4,
    opacity: 0.85,
    textAlign: "right",
  },
  msgText: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 20,
  },
  msgTime: {
    color: "#fff",
    fontSize: 9,
    marginTop: 2,
    textAlign: "right",
    opacity: 0.7,
  },
  // System
  systemRow: {
    alignItems: "center",
    marginVertical: 4,
  },
  systemPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  systemEmoji: {
    fontSize: 12,
    marginRight: 4,
  },
  systemText: {
    fontSize: 11,
    fontWeight: "600",
  },
  // Composer
  composerWrapper: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.cardRaised,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 80,
  },
  inputFocused: {
    borderColor: colors.accentSoft,
    borderWidth: 1,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnOff: {
    backgroundColor: colors.faint,
  },
  sendBtnEmoji: {
    fontSize: 18,
  },
  // Disconnect overlay
  disconnectOverlay: {
    position: "absolute",
    bottom: 70,
    left: 16,
    right: 16,
    backgroundColor: colors.cardRaised,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.accentSoft,
  },
  disconnectText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
});

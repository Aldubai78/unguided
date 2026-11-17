// Chamber socket wrapper (Phase 3, W2).
//
// Thin, typed layer over socket.io-client. The screens (W3/W4) talk to this
// module, NOT to the raw socket — this keeps the Socket.IO API surface
// isolated so a future transport swap (polling → WebSocket, or a different
// event protocol) is a one-file change.
//
// Auth: the gate token is passed in the Socket.IO `auth` payload. The
// server's connect handler (chamber_socket.py) refuses the socket without
// a valid token — this is the real lock, not the UI.
//
// Reconnect: deliberately disabled. A stale gate token (server restart)
// must NOT hammer the server with reconnect attempts. The screen shows a
// single "re-enter passphrase" state; the user taps to re-mint and
// reconnect manually. See brief risk #3.
//
// Transport: polling only (Tailscale-safe, RN-web compatible).
//
// No screen code below this line imports socket.io-client directly.

import { io, Socket } from "socket.io-client";
import { config } from "../config/app-config";
import { getGateToken, clearGateToken } from "./chamberGate";

// ---------------------------------------------------------------------------
// Types — the full event contract (brief §"The protocol").
// ---------------------------------------------------------------------------

/** A persona as seen in presence / available lists. */
export interface PersonaInfo {
  persona: string;
  color: string;
  emoji: string;
  is_bot: boolean;
}

/** The result of a chamber_join attempt. */
export interface JoinResult {
  ok: boolean;
  persona?: string;
  color?: string;
  emoji?: string;
  is_bot?: boolean;
  state?: unknown;
  reason?: string;
  available?: string[];
}

/** A live chat message. */
export interface ChamberMessage {
  persona: string;
  color: string;
  emoji?: string;
  is_bot?: boolean;
  message: string;
  ts: string;
}

/** A system line (join / leave / persona-changed). */
export interface ChamberSystem {
  kind: string;
  persona: string;
  color: string;
  emoji: string;
  message: string;
  ts: string;
}

/** Presence snapshot: who's in the room + who's free. */
export interface PresenceState {
  active: number;
  count: number;
  occupants: PersonaInfo[];
  available: string[];
}

/** Typing indicator (persona → typing / stopped). */
export interface TypingEvent {
  persona: string;
  color: string;
}

/**
 * Incoming events (server → client). socket.io-client v4 uses this as the
 * `ListenEvents` generic: `Socket<ListenEvents, EmitEvents>`.
 */
export interface ChamberListenEvents {
  chamber_join_result: (result: JoinResult) => void;
  chamber_message: (msg: ChamberMessage) => void;
  chamber_system: (sys: ChamberSystem) => void;
  chamber_presence: (state: PresenceState) => void;
  chamber_typing: (ev: TypingEvent) => void;
  chamber_stopped_typing: (ev: TypingEvent) => void;
  chamber_history: (msgs: ChamberMessage[]) => void;
  connect_error: (err: Error) => void;
  connect: (reason?: string) => void;
  disconnect: (reason?: string) => void;
}

/**
 * Outgoing events (client → server). This is the `EmitEvents` generic.
 * Each entry maps the event name to the args it accepts.
 */
export interface ChamberEmitEvents {
  chamber_join: (payload: { persona: string; bot?: boolean }) => void;
  chamber_leave: (payload: Record<string, never>) => void;
  chamber_message: (payload: { message: string }) => void;
  chamber_typing: (payload: Record<string, never>) => void;
  chamber_stopped_typing: (payload: Record<string, never>) => void;
}

/** Convenience alias: the combined event contract (for docs / screens). */
export type ChamberEvents = ChamberListenEvents & ChamberEmitEvents;

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export interface ChamberSocket {
  /** The underlying socket.io Socket (escape hatch; screens should not use). */
  raw: Socket<ChamberListenEvents, ChamberEmitEvents>;
  /** True after the server acknowledged the connection. */
  isConnected(): boolean;
  /** Join the room as a persona. Emits chamber_join. */
  join(persona: string, bot?: boolean): void;
  /** Leave the room. Emits chamber_leave, then disconnects. */
  leave(): void;
  /** Send a chat message. Emits chamber_message_out. */
  send(message: string): void;
  /** Tell the room you're typing. Emits chamber_typing_out. */
  startTyping(): void;
  /** Tell the room you stopped typing. Emits chamber_stopped_typing_out. */
  stopTyping(): void;
  /** Tear down the socket. No reconnect. */
  destroy(): void;
  /**
   * Reconnect after a server restart (stale gate token).
   * Clears the cached gate token, mints a fresh one, and reconnects.
   * Returns the fresh token (the screen can surface errors).
   */
  reconnect(): Promise<void>;
}

/**
 * Connect to the chamber with a gate token.
 *
 * Flow:
 *   1. getGateToken() → mints or returns cached token (POST /api/gate).
 *   2. io(origin, { auth: { token }, transports: ['polling'], reconnection: false }).
 *   3. On connect_error: clear the cached token (server restart), reject.
 *
 * Returns a ChamberSocket handle. The socket is NOT connected until the
 * 'connect' event fires — callers should listen for that.
 */
export async function connectChamber(
  onConnectError?: (err: Error) => void,
): Promise<ChamberSocket> {
  const token = await getGateToken();
  const origin = config.serverUrl.replace(/\/+$/, "");

  const socket = io(origin, {
    auth: { token },
    transports: ["polling"],
    reconnection: false, // NO auto-reconnect — single re-prompt, user-driven.
  }) as unknown as Socket<ChamberListenEvents, ChamberEmitEvents>;

  // On connect_error, clear the cached gate token so the next reconnect
  // mints fresh. (The server rotated it on restart.)
  socket.on("connect_error", (err) => {
    clearGateToken();
    if (onConnectError) onConnectError(err);
  });

  // On plain disconnect (network drop, app backgrounded) do NOT clear the
  // token — it is still valid. Only connect_error (server rejected it) means
  // the token rotated (server restart).
  // Note: we still clear on connect_error below.

  return {
    raw: socket,
    isConnected: () => socket.connected,
    join: (persona: string, bot?: boolean) => {
      socket.emit("chamber_join", { persona, ...(bot ? { bot: true } : {}) });
    },
    leave: () => {
      socket.emit("chamber_leave", {});
      // Give the server a beat to process the leave, then drop.
      setTimeout(() => socket.disconnect(), 250);
    },
    send: (message: string) => {
      socket.emit("chamber_message", { message });
    },
    startTyping: () => {
      socket.emit("chamber_typing", {});
    },
    stopTyping: () => {
      socket.emit("chamber_stopped_typing", {});
    },
    destroy: () => {
      // Emit chamber_leave so the server removes our persona from the room
      // before the socket drops. Without this, a raw disconnect leaves the
      // persona in the occupancy (e.g. navigating away from the chat screen).
      try {
        if (socket.connected) socket.emit("chamber_leave", {});
      } catch { /* socket already gone */ }
      socket.disconnect();
    },
    reconnect: async () => {
      // Clear stale token, mint fresh, reconnect.
      const freshToken = await getGateToken();
      socket.auth = { token: freshToken };
      socket.connect();
    },
  };
}

export const chamberSocket = {
  connectChamber,
};
export default chamberSocket;

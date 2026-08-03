import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/**
 * Optional hardware channel for the outdoor version.
 *
 * An ESP32 on the terrace streams newline-delimited JSON over USB:
 *   {"t":21.4,"wind":3.2,"lux":840,"pir":1,"dist":180}
 *
 * Everything here is written on the assumption that the link is unreliable —
 * outdoor cables get kicked, boards brown-out mid-line, and a half-written line
 * arrives at power-on. A malformed line must never kill the read loop, because
 * the installation runs unattended for weeks and there is nobody to restart it.
 */

/* ------------------------------------------------------------- Web Serial */
/**
 * Web Serial is not in lib.dom, so the surface actually used here is declared
 * rather than reached for through a cast. `serial` is optional: on Firefox and
 * on every iOS browser the property simply does not exist.
 */
interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort {
  /**
   * Chunks are Uint8Array in practice. Declared as the wider `BufferSource`
   * because that is the chunk type TextDecoderStream's writable side accepts,
   * and lib.dom's stream generics are covariant — the narrower declaration
   * cannot be piped into the decoder without a cast.
   */
  readonly readable: ReadableStream<BufferSource> | null;
  readonly writable: WritableStream<BufferSource> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
}

interface Serial {
  requestPort(options?: { filters?: SerialPortFilter[] }): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

declare global {
  interface Navigator {
    readonly serial?: Serial;
  }
}

/* ------------------------------------------------------------------ config */

const BAUD_RATE = 115200;

/** Values are dropped back to null after this long without a valid line. */
const STALE_MS = 15000;
const STALE_POLL_MS = 1000;

/** A device that never sends a newline must not grow the buffer without bound. */
const MAX_LINE_BYTES = 4096;

export interface SerialSensors {
  /** False when the browser has no Web Serial at all; everything else is then inert. */
  supported: boolean;
  connected: boolean;
  /** °C. Null until a valid reading arrives, and again once the link goes stale. */
  temperature: MutableRefObject<number | null>;
  /** m/s. */
  wind: MutableRefObject<number | null>;
  /** Illuminance in lux. */
  lux: MutableRefObject<number | null>;
  /** Passive-infrared occupancy, 0 or 1. */
  pir: MutableRefObject<number | null>;
  /** Ultrasonic range in cm. */
  distance: MutableRefObject<number | null>;
  error: string | null;
  /** Must be called from a user gesture — requestPort shows a browser chooser. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function useSerialSensors(): SerialSensors {
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const temperature = useRef<number | null>(null);
  const wind = useRef<number | null>(null);
  const lux = useRef<number | null>(null);
  const pir = useRef<number | null>(null);
  const distance = useRef<number | null>(null);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  /** Resolves when the port→decoder pipe finishes; awaited so close() cannot race it. */
  const pipeRef = useRef<Promise<void> | null>(null);
  const lastLineAt = useRef(0);
  const mounted = useRef(true);
  /** Set while disconnect() is unwinding, so the read loop knows the end was intentional. */
  const closing = useRef(false);

  const clearValues = useCallback(() => {
    temperature.current = null;
    wind.current = null;
    lux.current = null;
    pir.current = null;
    distance.current = null;
  }, []);

  const disconnect = useCallback(async () => {
    closing.current = true;
    try {
      const reader = readerRef.current;
      readerRef.current = null;
      if (reader) {
        // cancel() unblocks the pending read() and tears the pipe down from the
        // consumer end, which is the only ordering that lets port.close() succeed.
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      await pipeRef.current?.catch(() => undefined);
      pipeRef.current = null;
      const port = portRef.current;
      portRef.current = null;
      if (port) await port.close().catch(() => undefined);
      clearValues();
      if (mounted.current) setConnected(false);
    } finally {
      closing.current = false;
    }
  }, [clearValues]);

  const ingest = useCallback((line: string) => {
    const text = line.trim();
    if (!text || text[0] !== '{') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // Truncated or garbled frame — the next one will be along shortly.
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const record = parsed as Record<string, unknown>;

    const t = finite(record.t);
    const w = finite(record.wind);
    const l = finite(record.lux);
    const p = finite(record.pir);
    const d = finite(record.dist);
    if (t === null && w === null && l === null && p === null && d === null) return;

    // Fields are updated individually so a firmware that only reports some of
    // them, or drops one for a frame, does not blank the others.
    if (t !== null) temperature.current = t;
    if (w !== null) wind.current = w;
    if (l !== null) lux.current = l;
    if (p !== null) pir.current = p > 0 ? 1 : 0;
    if (d !== null) distance.current = d;
    lastLineAt.current = performance.now();
  }, []);

  const readLoop = useCallback(
    async (reader: ReadableStreamDefaultReader<string>) => {
      let buffer = '';
      for (;;) {
        let chunk: ReadableStreamReadResult<string>;
        try {
          chunk = await reader.read();
        } catch {
          break; // Cable pulled or the reader was cancelled by disconnect().
        }
        if (chunk.done) break;
        buffer += chunk.value;
        if (buffer.length > MAX_LINE_BYTES) buffer = buffer.slice(-MAX_LINE_BYTES);
        let cut = buffer.indexOf('\n');
        while (cut !== -1) {
          ingest(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 1);
          cut = buffer.indexOf('\n');
        }
      }
      if (mounted.current && !closing.current && portRef.current) {
        setError('Serial link closed.');
        void disconnect();
      }
    },
    [disconnect, ingest]
  );

  const connect = useCallback(async () => {
    if (!supported || portRef.current) return;
    const serial = navigator.serial;
    if (!serial) return;
    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      if (!mounted.current) {
        await port.close().catch(() => undefined);
        return;
      }
      if (!port.readable) {
        await port.close().catch(() => undefined);
        setError('Serial port opened but is not readable.');
        return;
      }
      portRef.current = port;

      const decoder = new TextDecoderStream();
      pipeRef.current = port.readable.pipeTo(decoder.writable).catch(() => undefined);
      const reader: ReadableStreamDefaultReader<string> = decoder.readable.getReader();
      readerRef.current = reader;

      lastLineAt.current = performance.now();
      setError(null);
      setConnected(true);
      void readLoop(reader);
    } catch (err) {
      // The user dismissing the port chooser throws — that is a decision, not a fault.
      setError(err instanceof Error ? err.message : 'Serial port unavailable.');
      await disconnect();
    }
  }, [disconnect, readLoop, supported]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void disconnect();
    };
  }, [disconnect]);

  useEffect(() => {
    if (!connected) return;
    // Staleness, not disconnection: the port can stay open while the board hangs.
    // Publishing a two-minute-old temperature as if it were live would quietly
    // lie to the scenes, so the values go back to null and the piece falls back.
    const timer = window.setInterval(() => {
      if (performance.now() - lastLineAt.current > STALE_MS) clearValues();
    }, STALE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [clearValues, connected]);

  return {
    supported,
    connected,
    temperature,
    wind,
    lux,
    pir,
    distance,
    error,
    connect,
    disconnect,
  };
}

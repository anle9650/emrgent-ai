"use client";

import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";
import { EcgIcon } from "@/components/ecg-icon";
import type { RecorderStatus } from "@/hooks/use-encounter-recorder";

// ~24ms of audio per 2px column ≈ 83px/s — the sweep speed of an ECG monitor.
const COL_W = 2;
const MS_PER_COL = 24;
// Cap per-frame catch-up so returning from a hidden tab resumes the trace
// instead of replaying the whole gap as a burst scroll.
const MAX_FRAME_MS = 120;
const FFT_SIZE = 1024;
const EDGE_PAD = 2;

type Column = { min: number; max: number };

/** Live amplitude trace for the recording card, drawn in the brand's ECG
 * idiom. Recording sweeps live mic data right-to-left; pausing freezes the
 * last frame; idle shows a dimmed baseline. Doubles as dead-mic detection —
 * a flat trace while "recording" means the room isn't being heard. */
export function RecordingTrace({
  stream,
  status,
}: {
  stream: MediaStream | null;
  status: RecorderStatus;
}) {
  const reducedMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number | null>(null);
  // Oldest-first column history — the source of truth the canvas is repainted
  // from, so resize, DPR, and theme changes never lose the trace.
  const columnsRef = useRef<Column[]>([]);
  const lastTimeRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const capacity = useCallback(
    () => Math.max(1, Math.ceil(sizeRef.current.w / COL_W)),
    []
  );

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const context = canvas?.getContext("2d");
    const { w, h, dpr } = sizeRef.current;
    if (!(canvas && wrap && context) || w === 0 || h === 0) {
      return;
    }
    // Resolved per repaint so a mid-recording theme switch follows along.
    const color = getComputedStyle(wrap).color;
    const midY = h / 2;
    const amp = midY - EDGE_PAD;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    context.strokeStyle = color;
    context.lineCap = "round";

    // Dimmed baseline underneath — the monitor is on even when nothing has
    // been traced yet.
    context.globalAlpha = 0.25;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, midY);
    context.lineTo(w, midY);
    context.stroke();

    const columns = columnsRef.current;
    if (columns.length === 0) {
      return;
    }
    context.globalAlpha = 1;
    context.lineWidth = 1.5;
    context.beginPath();
    for (let i = 0; i < columns.length; i += 1) {
      const x = w - COL_W / 2 - (columns.length - 1 - i) * COL_W;
      // Minimum segment length so silence still draws a visible trace.
      const top = midY - Math.max(columns[i].max * amp, 0.75);
      const bottom = midY - Math.min(columns[i].min * amp, -0.75);
      context.moveTo(x, top);
      context.lineTo(x, bottom);
    }
    context.stroke();
  }, []);

  // Audio graph — analyser tapped off the live stream (never routed to the
  // speakers). Rebuilt whenever the stream changes; recorder rotation reuses
  // the same stream, so the analyser survives it untouched.
  useEffect(() => {
    if (!stream || reducedMotion) {
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return;
    }
    const audioContext = new Ctor();
    if (audioContext.state === "suspended") {
      // The Start click is a user gesture, so this resolves; defensive no-op
      // otherwise.
      audioContext.resume().catch(() => {
        // Leave the static baseline.
      });
    }
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);
    analyserRef.current = analyser;
    dataRef.current = new Uint8Array(analyser.fftSize);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      analyserRef.current = null;
      source.disconnect();
      audioContext.close().catch(() => {
        // Already closed.
      });
    };
  }, [stream, reducedMotion]);

  // Sizing — the canvas bitmap is wiped by resizing, so repaint from the
  // column history immediately after.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (reducedMotion || !(wrap && canvas)) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const overflow = columnsRef.current.length - capacity();
      if (overflow > 0) {
        columnsRef.current.splice(0, overflow);
      }
      drawAll();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [reducedMotion, capacity, drawAll]);

  // State machine: recording runs the sweep; pausing freezes the last frame
  // (MediaRecorder.pause() does NOT silence the stream — the freeze is
  // stopping the loop); idle/requesting clears back to the baseline.
  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const stopLoop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    if (status === "recording" && stream && analyserRef.current) {
      lastTimeRef.current = performance.now();
      accumulatedMsRef.current = 0;
      const tick = (now: number) => {
        const analyser = analyserRef.current;
        const data = dataRef.current;
        if (!(analyser && data)) {
          rafRef.current = null;
          return;
        }
        accumulatedMsRef.current += Math.min(
          now - lastTimeRef.current,
          MAX_FRAME_MS
        );
        lastTimeRef.current = now;
        const pending = Math.floor(accumulatedMsRef.current / MS_PER_COL);
        if (pending > 0) {
          accumulatedMsRef.current -= pending * MS_PER_COL;
          analyser.getByteTimeDomainData(data);
          let min = 0;
          let max = 0;
          for (const value of data) {
            const deviation = (value - 128) / 128;
            if (deviation < min) {
              min = deviation;
            }
            if (deviation > max) {
              max = deviation;
            }
          }
          for (let i = 0; i < pending; i += 1) {
            columnsRef.current.push({ min, max });
          }
          const overflow = columnsRef.current.length - capacity();
          if (overflow > 0) {
            columnsRef.current.splice(0, overflow);
          }
          drawAll();
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return stopLoop;
    }
    if (status === "paused") {
      stopLoop();
      drawAll();
      return;
    }
    stopLoop();
    columnsRef.current = [];
    drawAll();
  }, [status, stream, reducedMotion, capacity, drawAll]);

  if (reducedMotion) {
    return (
      <div className="flex h-12 w-full items-center justify-center text-primary">
        <EcgIcon className="h-[18px] w-11 text-primary/30" flat />
      </div>
    );
  }

  return (
    <div className="relative h-12 w-full text-primary" ref={wrapRef}>
      {/* No fallback content, so screen readers ignore it. */}
      <canvas className="block size-full" ref={canvasRef} />
    </div>
  );
}

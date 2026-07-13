"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type UseSpeechToTextOptions = {
  /** Receives the full composed input text (base + dictated) on every result. */
  onTranscript: (text: string) => void;
  /** BCP-47 language tag; defaults to navigator.language, then "en-US". */
  lang?: string;
};

export function useSpeechToText({
  onTranscript,
  lang,
}: UseSpeechToTextOptions) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseTextRef = useRef("");
  const finalTranscriptRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    setIsSupported(
      Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)
    );
  }, []);

  const start = useCallback(
    (baseText: string) => {
      if (recognitionRef.current) {
        return;
      }
      const SpeechRecognitionCtor =
        window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang ?? navigator.language ?? "en-US";

      baseTextRef.current = baseText.trimEnd();
      finalTranscriptRef.current = "";

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscriptRef.current += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        const spoken = `${finalTranscriptRef.current}${interim}`.trim();
        if (!spoken) {
          return;
        }
        onTranscriptRef.current(
          baseTextRef.current ? `${baseTextRef.current} ${spoken}` : spoken
        );
      };

      recognition.onerror = (event) => {
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          toast.error(
            "Microphone access denied. Enable it in your browser settings."
          );
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          toast.error("Voice input failed. Please try again.");
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        recognitionRef.current = null;
        setIsListening(false);
      }
    },
    [lang]
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const toggle = useCallback(
    (baseText: string) => {
      if (recognitionRef.current) {
        stop();
      } else {
        start(baseText);
      }
    },
    [start, stop]
  );

  useEffect(() => cancel, [cancel]);

  return { isSupported, isListening, start, stop, cancel, toggle };
}

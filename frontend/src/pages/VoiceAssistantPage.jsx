import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { useAccessibility } from "../context/AccessibilityContext";
import API from "../api";
import { matchAppShortcut } from "../lib/voiceCommandRouter";

const VOICE_CONVERSATION_KEY = "visionguide_voice_conversation";

const TYPE_COLOR = {
  greeting: "#22c55e",
  contacts: "#60a5fa",
  locations: "#34d399",
  articles: "#facc15",
  navigation: "#a78bfa",
  sos: "#ef4444",
  stop: "#f87171",
  help: "#fb923c",
  navigate_app: "#f472b6",
  time: "#34d399",
  saved_location_nav: "#38bdf8",
  call: "#34d399",
  unknown: "#6b7280",
};

const QUICK = [
  { icon: "📞", label: "Read Contacts", cmd: "read contacts" },
  { icon: "📲", label: "Call a Contact", cmd: "call" },
  { icon: "📍", label: "Read Locations", cmd: "read saved locations" },
  { icon: "📖", label: "Read Articles", cmd: "read articles" },
  { icon: "🚨", label: "Send SOS", cmd: "send sos" },
  { icon: "🏥", label: "Hospital Near Me", cmd: "hospital near me" },
  { icon: "💊", label: "Pharmacy Near Me", cmd: "pharmacy near me" },
  { icon: "🏧", label: "ATM Near Me", cmd: "atm near me" },
  { icon: "🚔", label: "Police Near Me", cmd: "police station near me" },
  { icon: "🚌", label: "Bus Stop Near Me", cmd: "bus stop near me" },
  { icon: "🏨", label: "Hotel Near Me", cmd: "hotel near me" },
  { icon: "⏰", label: "What Time Is It", cmd: "what time is it" },
  { icon: "❓", label: "Help", cmd: "help" },
];

function normalizeCommand(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    // Strip trailing sentence punctuation ("object detection." / "sos!")
    // once, centrally, so every exact-match branch below (t === "sos",
    // t === "help", STOP_PHRASES, etc.) tolerates it without each needing
    // its own copy of this regex.
    .replace(/[.!?,]+$/, "")
    .trim()
    .replace(/\s+/g, " ");
}

const STOP_PHRASES = new Set([
  "stop",
  "stop reading",
  "stop speaking",
  "stop talking",
  "stop it",
  "quiet",
  "silence",
  "mute",
  "shut up",
  "be quiet",
  "cancel",
]);

function isStopCommand(command) {
  const n = normalizeCommand(command)
    .replace(/[.!?,]+$/, "")
    .trim();

  if (STOP_PHRASES.has(n)) return true;

  const stripped = n
    .replace(/\b(please|can you|could you|now|ok|okay)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return STOP_PHRASES.has(stripped);
}

const READ_CONTACTS_RE =
  /^(please\s+)?(read|show)\s+(my\s+|emergency\s+|saved\s+)?contacts?(\s+aloud)?(\s+please)?$/;

const READ_CONTACTS_SYNONYMS = new Set([
  "contact list",
  "who to call",
  "saved contact",
  "saved contacts",
  "emergency contact",
  "emergency contacts",
  "my contact",
  "my contacts",
]);

function isReadContactsCommand(command) {
  const n = normalizeCommand(command)
    .replace(/[.!?,]+$/, "")
    .trim();

  return READ_CONTACTS_RE.test(n) || READ_CONTACTS_SYNONYMS.has(n);
}

/* window._vgPauseWake() (DashboardLayout) only resolves once the background
   wake-word recognizer's "end" event actually fires after being stopped.
   That event is not always guaranteed to fire (a known Web Speech API
   flakiness), so awaiting it directly can hang forever — leaving the UI
   showing "Listening…" while recognition.start() is never actually reached.
   This races it against a short timeout so the mic can always proceed. */
function pauseWakeWithTimeout(ms = 2000) {
  if (!window._vgPauseWake) return Promise.resolve();
  return Promise.race([
    Promise.resolve(window._vgPauseWake()).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

export default function VoiceAssistantPage() {
  const { settings } = useAccessibility();
  const navigate = useNavigate();

  const isDark = settings.theme === "dark";

  const [phase, setPhase] = useState("idle");
  const [isListening, setIsListening] = useState(false);

  const [msgs, setMsgs] = useState(() => {
    try {
      const saved = sessionStorage.getItem(VOICE_CONVERSATION_KEY);

      if (!saved) {
        return [];
      }

      const parsed = JSON.parse(saved);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.log(
        "[VOICE] Could not restore conversation:",
        error
      );

      return [];
    }
  });

  const [input, setInput] = useState("");

  const [log, setLog] = useState(
    "Ready — click Start Listening to begin"
  );

  const phaseRef = useRef("idle");
  const recRef = useRef(null);
  const recognitionRef = useRef(null);
  const aliveRef = useRef(true);
  const endRef = useRef(null);
  const timeoutRef = useRef(null);

  const genRef = useRef(0);
  const speakTimeoutRef = useRef(null);
  const fbTimeoutRef = useRef(null);

  const [ttsActive, setTtsActive] = useState(false);
  const ttsActiveRef = useRef(false);

  const stopRecRef = useRef(null);
  const stopRecRunningRef = useRef(false);
  const stopRestartTimerRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        VOICE_CONVERSATION_KEY,
        JSON.stringify(msgs)
      );
    } catch (error) {
      console.log(
        "[VOICE] Could not save conversation:",
        error
      );
    }
  }, [msgs]);

  function setSpeakingActive(value) {
    ttsActiveRef.current = value;
    setTtsActive(value);
  }

  function setPhaseSync(value) {
    phaseRef.current = value;
    setPhase(value);
    setIsListening(value === "recording");
  }

  // ============================================================
  // STOP SPEAKING
  // ============================================================

  function stopSpeaking() {
    genRef.current += 1;

    clearTimeout(speakTimeoutRef.current);
    clearTimeout(fbTimeoutRef.current);
    clearTimeout(stopRestartTimerRef.current);

    try {
      window.speechSynthesis.cancel();
    } catch {}

    setSpeakingActive(false);

    stopStopListener();
  }

  // ============================================================
  // TEXT TO SPEECH
  // ============================================================

  function startSpeaking(text, generation) {
    if (!text || generation !== genRef.current) {
      return null;
    }

    clearTimeout(speakTimeoutRef.current);

    try {
      // Chrome fix (same pattern already used in DashboardLayout.jsx):
      // cancel() alone can leave the engine in a state where the very next
      // speak() call has its opening word(s) swallowed. resume() must be
      // called immediately after cancel() here AND again right before the
      // delayed speak() below — doing only one of the two (as a prior fix
      // here did) reproduces the truncation instead of fixing it.
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();
    } catch {}

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = settings.language || "en-US";
    utterance.rate = settings.voiceSpeed ?? 0.9;
    utterance.volume = 1;

    let settled = false;
    let watchdogId = null;

    const clearActive = () => {
      if (settled) return;

      settled = true;
      clearTimeout(watchdogId);

      if (generation === genRef.current) {
        setSpeakingActive(false);
      }
    };

    utterance.addEventListener("end", clearActive);
    utterance.addEventListener("error", clearActive);

    speakTimeoutRef.current = setTimeout(() => {
      if (generation !== genRef.current) return;

      setSpeakingActive(true);

      try {
        // Chrome fix (same pattern already used in DashboardLayout.jsx):
        // resume() right before speak() clears an internal paused/queued
        // state left over from the cancel() above — without it, Chrome can
        // silently swallow the opening word(s) of the new utterance.
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch {
        setSpeakingActive(false);
      }

      // Chrome sometimes plays the utterance fully but never fires "end" or
      // "error" (known Web Speech API flakiness — hits short utterances
      // especially, e.g. "Reading your emergency contacts now."). Without a
      // fallback, whatever the caller chained onto onend (doContacts(),
      // next section of speakSequence, resuming wake) never runs and the
      // assistant goes silent after just the acknowledgment. This fires the
      // same completion path manually if the real event never arrives.
      const estimatedMs = Math.max(1500, text.length * 100) + 4000;

      watchdogId = setTimeout(() => {
        if (settled) return;

        console.log(
          "[VOICE] TTS end/error watchdog fired — utterance never resolved"
        );

        clearActive();

        try {
          window.speechSynthesis.cancel();
        } catch {}

        const handler = utterance.onend;
        utterance.onend = null;
        utterance.onerror = null;

        if (typeof handler === "function") {
          handler();
        }
      }, estimatedMs);
    }, 80);

    return utterance;
  }

  function tts(text) {
    return startSpeaking(text, genRef.current);
  }

  // ============================================================
  // READ SEQUENCE
  // ============================================================

  function speakSequence(sections, generation, index = 0) {
    if (!aliveRef.current) return;
    if (generation !== genRef.current) return;

    if (!sections || index >= sections.length) {
      setSpeakingActive(false);
      setPhaseSync("idle");
      setLog("Ready — click Start Listening to begin");

      if (window._vgResumeWake) {
        try {
          window._vgResumeWake();
        } catch {}
      }

      return;
    }

    setLog("Speaking reply…");

    const next = () => {
      if (!aliveRef.current) return;
      if (generation !== genRef.current) return;

      speakSequence(sections, generation, index + 1);
    };

    const utterance = startSpeaking(
      sections[index],
      generation
    );

    if (!utterance) {
      return;
    }

    utterance.onend = next;
    utterance.onerror = next;
  }

  // ============================================================
  // VOICE STOP LISTENER
  // ============================================================

  async function startStopListener() {
    if (!aliveRef.current) return;
    if (!ttsActiveRef.current) return;

    if (stopRecRunningRef.current) return;

    if (recRef.current) return;
    if (phaseRef.current === "recording") return;

    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log(
        "[STOP] SpeechRecognition is not supported"
      );
      return;
    }

    stopRecRunningRef.current = true;

    await pauseWakeWithTimeout();

    if (
      !aliveRef.current ||
      !ttsActiveRef.current ||
      recRef.current
    ) {
      stopRecRunningRef.current = false;
      return;
    }

    let recognition;

    try {
      recognition = new SpeechRecognition();
    } catch {
      stopRecRunningRef.current = false;
      return;
    }

    recognition.lang = settings.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    stopRecRef.current = recognition;

    console.log("[STOP] Starting stop listener");

    recognition.onstart = () => {
      console.log(
        "[STOP] Microphone listening for STOP"
      );
    };

    recognition.onresult = (event) => {
      if (!aliveRef.current) return;
      if (!ttsActiveRef.current) return;

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const result = event.results[i];

        if (!result || !result[0]) continue;

        const rawText = result[0].transcript;
        const normalized = normalizeCommand(rawText);

        console.log(
          "[STOP] Heard:",
          JSON.stringify(rawText),
          "final:",
          result.isFinal
        );

        if (isStopCommand(normalized)) {
          console.log(
            "[STOP] STOP COMMAND DETECTED:",
            rawText
          );

          addMsg("user", rawText);

          stopSpeaking();

          addMsg(
            "assistant",
            "Stopped.",
            "stop"
          );

          // stopSpeaking() only cancels whatever was playing — it never
          // spoke "Stopped." itself. Speak it now, using the fresh
          // generation stopSpeaking() just created, and only return to
          // idle once that utterance actually finishes.
          const stopGeneration = genRef.current;

          setPhaseSync("speaking");
          setLog("Speaking reply…");

          const stopUtterance = tts("Stopped.");

          const backToReady = () => {
            if (!aliveRef.current) return;
            if (stopGeneration !== genRef.current) return;

            setPhaseSync("idle");
            setLog(
              "Stopped. Click Start Listening to begin"
            );

            if (window._vgResumeWake) {
              try {
                window._vgResumeWake();
              } catch {}
            }
          };

          if (stopUtterance) {
            stopUtterance.onend = backToReady;
            stopUtterance.onerror = backToReady;
          } else {
            backToReady();
          }

          return;
        }
      }
    };

    recognition.onerror = (event) => {
      console.log(
        "[STOP] Recognition error:",
        event.error
      );

      stopRecRunningRef.current = false;

      if (!ttsActiveRef.current) {
        return;
      }

      if (
        event.error === "not-allowed" ||
        event.error === "permission-denied"
      ) {
        console.log(
          "[STOP] Microphone permission denied"
        );
      }

      if (event.error === "aborted") {
        return;
      }
    };

    recognition.onend = () => {
      console.log(
        "[STOP] Recognition ended. TTS active:",
        ttsActiveRef.current
      );

      stopRecRef.current = null;
      stopRecRunningRef.current = false;

      if (
        aliveRef.current &&
        ttsActiveRef.current &&
        !recRef.current &&
        phaseRef.current !== "recording"
      ) {
        clearTimeout(stopRestartTimerRef.current);

        stopRestartTimerRef.current = setTimeout(() => {
          if (
            aliveRef.current &&
            ttsActiveRef.current &&
            !recRef.current
          ) {
            startStopListener();
          }
        }, 150);
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.log(
        "[STOP] Could not start:",
        error.message
      );

      stopRecRunningRef.current = false;
      stopRecRef.current = null;
    }
  }

  function stopStopListener() {
    clearTimeout(stopRestartTimerRef.current);

    if (stopRecRef.current) {
      try {
        stopRecRef.current.abort();
      } catch {}

      stopRecRef.current = null;
    }

    stopRecRunningRef.current = false;
  }

  // ============================================================
  // AUTOMATIC STOP LISTENER CONTROL
  // ============================================================

  useEffect(() => {
    if (ttsActive) {
      const timer = setTimeout(() => {
        if (
          aliveRef.current &&
          ttsActiveRef.current &&
          !recRef.current
        ) {
          startStopListener();
        }
      }, 200);

      return () => clearTimeout(timer);
    }

    // ttsActive briefly flickers false for ~80ms between chained utterances
    // in speakSequence() (contacts/articles read out sentence by sentence).
    // Tearing the STOP recognizer down on every such flicker left real gaps
    // where "stop"/"please stop" couldn't be heard. phase stays "speaking"
    // for the whole sequence, so only actually tear down once we're truly
    // done (or never started), not on that transient gap.
    if (phaseRef.current !== "speaking") {
      stopStopListener();
    }

    return undefined;
  }, [ttsActive]);

  // ============================================================
  // COMPONENT CLEANUP
  // ============================================================

  useEffect(() => {
    aliveRef.current = true;

    // Coordinate exclusive microphone access with the dashboard layout:
    // This page manages its own dedicated speech recognition and text-to-speech lifecycle.
    const realResumeWake = window._vgResumeWake;

    if (window._vgPauseWake) {
      try {
        window._vgPauseWake();
      } catch {}
    }

    window._vgResumeWake = () => {};

    return () => {
      aliveRef.current = false;

      clearTimeout(timeoutRef.current);
      clearTimeout(speakTimeoutRef.current);
      clearTimeout(fbTimeoutRef.current);
      clearTimeout(stopRestartTimerRef.current);

      if (recRef.current) {
        try {
          recRef.current.abort();
        } catch {}

        recRef.current = null;
      }

      stopStopListener();

      try {
        window.speechSynthesis.cancel();
      } catch {}

      window._vgResumeWake = realResumeWake;

      if (realResumeWake) {
        try {
          realResumeWake();
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [msgs]);

  function addMsg(
    role,
    text,
    type = "unknown"
  ) {
    if (!aliveRef.current) return;

    const time = new Date().toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );

    setMsgs((previous) => [
      ...previous.slice(-49),
      {
        role,
        text,
        type,
        time,
      },
    ]);
  }

  // ============================================================
  // NORMAL VOICE LISTENING
  // ============================================================

  async function startListening() {
    console.log("[MAIN VOICE] startListening() called, phase =", phaseRef.current);

    if (phaseRef.current !== "idle") {
      console.log("[MAIN VOICE] startListening() blocked — phase is not idle");
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setLog(
        "❌ Speech Recognition is not supported. Please use Chrome or Edge."
      );
      return;
    }

    stopStopListener();

    // Speak the activation prompt FIRST, and only actually open the
    // microphone once it finishes (via onend/onerror/watchdog below) — the
    // recognizer must never start while this is still audibly playing.
    // Uses the same generation-token guard as every other TTS completion in
    // this file, so a "stop" said during this prompt (which calls
    // stopSpeaking() -> increments genRef -> cancels this utterance) can
    // never still go on to open the mic afterward.
    setPhaseSync("speaking");
    setLog("Listening… Please speak now.");

    const generation = genRef.current;
    const promptUtterance = tts("Listening. Please speak now.");

    const beginRecording = () => {
      if (!aliveRef.current) return;
      if (generation !== genRef.current) return; // stopped/interrupted meanwhile

      phaseRef.current = "recording";
      setPhase("recording");
      setIsListening(true);
      setLog("Listening… Please speak now.");

      (async () => {
        // Bounded — never let a hung wake-word pause prevent
        // recognition.start() from being reached below.
        await pauseWakeWithTimeout();

        if (generation !== genRef.current) return; // re-check after the async gap

        clearTimeout(timeoutRef.current);

        if (recRef.current) {
          try {
            recRef.current.abort();
          } catch {}

          recRef.current = null;
        }

        setTimeout(() => {
          if (generation !== genRef.current) return;
          createMainRecognizer(SpeechRecognition);
        }, 150);
      })();
    };

    if (promptUtterance) {
      promptUtterance.onend = beginRecording;
      promptUtterance.onerror = beginRecording;
    } else {
      beginRecording();
    }
  }

  function createMainRecognizer(
    SpeechRecognition
  ) {
    if (
      !aliveRef.current ||
      phaseRef.current !== "recording"
    ) {
      console.log(
        "[MAIN VOICE] createMainRecognizer() aborted — alive:",
        aliveRef.current,
        "phase:",
        phaseRef.current
      );
      return;
    }

    let recognition;

    try {
      recognition = new SpeechRecognition();
    } catch (error) {
      console.log("[MAIN VOICE] new SpeechRecognition() threw:", error);
      setPhaseSync("idle");
      setLog("Could not start microphone.");
      return;
    }

    recognition.lang =
      settings.language || "en-US";

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recRef.current = recognition;
    recognitionRef.current = recognition;

    let finalText = "";
    let commandFired = false;
    let started = false;
    let retried = false;
    let onstartWatchdog = null;

    timeoutRef.current = setTimeout(() => {
      if (
        phaseRef.current !== "recording" ||
        commandFired
      ) {
        return;
      }

      commandFired = true;
      clearTimeout(onstartWatchdog);

      try {
        recognition.stop();
      } catch {}

      // Keep phase at "speaking" (not "idle") until this message actually
      // finishes — otherwise Start Listening re-enables immediately and a
      // new mic session can start while this utterance is still audibly
      // playing through the speakers.
      setPhaseSync("speaking");
      setLog("Speaking reply…");

      const utterance = tts(
        "I could not hear your voice. Please try again."
      );

      const backToIdle = () => {
        if (!aliveRef.current) return;

        setPhaseSync("idle");
        setLog(
          "Ready — click Start Listening to begin"
        );

        if (window._vgResumeWake) {
          try {
            window._vgResumeWake();
          } catch {}
        }
      };

      if (utterance) {
        utterance.onend = backToIdle;
        utterance.onerror = backToIdle;
      } else {
        backToIdle();
      }
    }, 10000);

    recognition.onstart = () => {
      console.log("[MAIN VOICE] recognition.onstart fired");

      started = true;
      clearTimeout(onstartWatchdog);

      if (!aliveRef.current) return;

      finalText = "";
      commandFired = false;

      setLog(
        "🔴 Listening… Please speak now."
      );
    };

    recognition.onresult = (event) => {
      if (!aliveRef.current || commandFired) {
        return;
      }

      let interim = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const text =
          event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalText += text + " ";
        } else {
          interim = text;
        }
      }

      const display =
        `${finalText} ${interim}`.trim();

      if (display) {
        setLog(`🎙️ "${display}"`);
      }

      if (
        finalText.trim() &&
        !commandFired
      ) {
        commandFired = true;

        clearTimeout(timeoutRef.current);
        clearTimeout(onstartWatchdog);

        const spokenText =
          finalText.trim();

        console.log("[MAIN VOICE] onresult final transcript:", spokenText);

        try {
          recognition.stop();
        } catch {}

        runCommand(spokenText);
      }
    };

    recognition.onerror = (event) => {
      if (!aliveRef.current) return;

      clearTimeout(timeoutRef.current);
      clearTimeout(onstartWatchdog);

      recRef.current = null;
      commandFired = true;

      console.log(
        "[MAIN VOICE] Error:",
        event.error
      );

      if (event.error === "aborted") {
        setPhaseSync("idle");
        setLog(
          "Ready — click Start Listening to begin"
        );
        return;
      }

      if (
        event.error === "not-allowed" ||
        event.error === "permission-denied"
      ) {
        setLog(
          "❌ Microphone permission is blocked. Please allow microphone access in Chrome."
        );
      } else if (
        event.error === "no-speech"
      ) {
        setLog(
          "No speech detected. Please speak clearly and try again."
        );
      } else if (
        event.error === "audio-capture"
      ) {
        setLog(
          "❌ Microphone is not detected. Please check your microphone."
        );
      } else if (
        event.error === "network"
      ) {
        setLog(
          "❌ Chrome speech recognition needs internet. Please check your connection."
        );
      } else {
        setLog(
          "Voice recognition failed. Please try again."
        );
      }

      setPhaseSync("idle");

      if (window._vgResumeWake) {
        try {
          window._vgResumeWake();
        } catch {}
      }
    };

    recognition.onend = () => {
      console.log(
        "[MAIN VOICE] recognition.onend fired — commandFired:",
        commandFired,
        "phase:",
        phaseRef.current
      );

      clearTimeout(timeoutRef.current);
      clearTimeout(onstartWatchdog);

      recRef.current = null;

      if (!aliveRef.current) return;

      if (
        !commandFired &&
        finalText.trim() &&
        phaseRef.current === "recording"
      ) {
        commandFired = true;
        runCommand(finalText.trim());
        return;
      }

      if (
        !commandFired &&
        phaseRef.current === "recording"
      ) {
        setPhaseSync("idle");
        setLog(
          "Ready — click Start Listening to begin"
        );

        if (window._vgResumeWake) {
          try {
            window._vgResumeWake();
          } catch {}
        }
      }
    };

    try {
      recognition.start();
      console.log("[MAIN VOICE] recognition.start() reached and did not throw");

      // Chrome sometimes accepts start() without throwing but then never
      // fires onstart/onresult/onend — the mic silently never actually
      // opens and the UI is left stuck on "Listening" forever. Detect that
      // and recover with a single automatic retry instead of leaving the
      // page dead until reload.
      onstartWatchdog = setTimeout(() => {
        if (
          started ||
          commandFired ||
          retried ||
          !aliveRef.current ||
          phaseRef.current !== "recording" ||
          recRef.current !== recognition
        ) {
          return;
        }

        console.log(
          "[MAIN VOICE] onstart did not fire within 3s — retrying once"
        );

        retried = true;
        commandFired = true;

        try {
          recognition.abort();
        } catch {}

        recRef.current = null;

        setTimeout(() => {
          if (
            aliveRef.current &&
            phaseRef.current === "recording"
          ) {
            createMainRecognizer(SpeechRecognition);
          }
        }, 200);
      }, 3000);
    } catch (error) {
      console.log("[MAIN VOICE] recognition.start() threw:", error);

      clearTimeout(timeoutRef.current);
      clearTimeout(onstartWatchdog);

      recRef.current = null;

      setPhaseSync("idle");

      setLog(
        `❌ Could not start microphone: ${error.message}`
      );
    }
  }

  function stopListening() {
    if (phaseRef.current !== "recording") {
      return;
    }

    clearTimeout(timeoutRef.current);

    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {}

      recRef.current = null;
    }

    // This is the manual "Stop Listening" button (distinct from the voice
    // "stop"/"please stop" command, which already speaks "Stopped."). Give
    // it the same spoken confirmation instead of going silently back to
    // idle, and keep the button disabled until that finishes speaking.
    setPhaseSync("speaking");
    setLog("Speaking reply…");

    const utterance = tts("Stopped listening.");

    const backToReady = () => {
      if (!aliveRef.current) return;

      setPhaseSync("idle");
      setLog("Ready — click Start Listening to begin");

      if (window._vgResumeWake) {
        try {
          window._vgResumeWake();
        } catch {}
      }
    };

    if (utterance) {
      utterance.onend = backToReady;
      utterance.onerror = backToReady;
    } else {
      backToReady();
    }
  }

  // ============================================================
  // COMMAND PROCESSOR
  // ============================================================

  async function runCommand(text) {
    console.log("[MAIN VOICE] runCommand() reached with:", text);

    if (!text?.trim() || !aliveRef.current) {
      return;
    }

    const t = normalizeCommand(text);

    const has = (...words) =>
      words.some((word) =>
        t.includes(word)
      );

    // Resolved once up front (pure lookup, no side effects) so both the
    // dedicated shortcut branch below and nothing else needs to recompute
    // it. See src/lib/voiceCommandRouter.js for the alias list.
    const shortcutHit = matchAppShortcut(t);

    // STOP MUST ALWAYS BE CHECKED FIRST
    if (isStopCommand(t)) {
      stopSpeaking();

      addMsg("user", text);

      addMsg(
        "assistant",
        "Stopped.",
        "stop"
      );

      // stopSpeaking() only cancels whatever was playing — it never spoke
      // "Stopped." itself. Speak it now, using the fresh generation
      // stopSpeaking() just created, and only return to idle once that
      // utterance actually finishes.
      const stopGeneration = genRef.current;

      setPhaseSync("speaking");
      setLog("Speaking reply…");

      const stopUtterance = tts("Stopped.");

      const backToReady = () => {
        if (!aliveRef.current) return;
        if (stopGeneration !== genRef.current) return;

        setPhaseSync("idle");
        setLog(
          "Stopped. Click Start Listening to begin"
        );

        if (window._vgResumeWake) {
          try {
            window._vgResumeWake();
          } catch {}
        }
      };

      if (stopUtterance) {
        stopUtterance.onend = backToReady;
        stopUtterance.onerror = backToReady;
      } else {
        backToReady();
      }

      return;
    }

    setPhaseSync("processing");
    setLog("Processing command…");

    stopSpeaking();

    const generation = genRef.current;

    addMsg("user", text);

    let reply = "";
    let type = "unknown";
    let nav = "";
    let callPerson = "";

    // ============================================================
    // GREETING
    // ============================================================

    if (
      has(
        "hello",
        "hey",
        "good morning",
        "good evening",
        "good afternoon",
        "how are you",
        "who are you",
        "visionguide"
      ) ||
      // Bug fix: "hi" as a plain has()/includes() substring matched inside
      // unrelated words — "history" (has("hi","story"?) no, just "hi" +
      // "story") was being greeted instead of reaching command history
      // handling below. Word-boundary check keeps "hi" as a real word only.
      /\bhi\b/.test(t)
    ) {
      reply =
        "Hello! I am VisionGuide AI, your voice assistant. How can I help you today?";
      type = "greeting";
    }

    // ============================================================
    // THANK YOU
    // ============================================================

    else if (
      has(
        "thank you",
        "thanks",
        "thank u",
        "great",
        "awesome",
        "well done",
        "perfect"
      )
    ) {
      reply =
        "You are welcome! Always here to help.";
      type = "greeting";
    }

    // ============================================================
    // GOODBYE
    // ============================================================

    else if (
      has(
        "bye",
        "goodbye",
        "see you",
        "take care",
        "that's all"
      )
    ) {
      reply =
        "Goodbye! Stay safe.";
      type = "greeting";
    }

    // ============================================================
    // TIME
    // ============================================================

    else if (
      t === "time" ||
      has(
        "what time",
        "current time",
        "what is the time",
        "what's the time",
        "time please"
      )
    ) {
      reply = `The time is ${new Date().toLocaleTimeString(
        [],
        {
          hour: "2-digit",
          minute: "2-digit",
        }
      )}.`;

      type = "time";
    }

    // ============================================================
    // HELP
    // ============================================================

    else if (
      t === "help" ||
      has(
        "what can i say",
        "what can you do",
        "list commands",
        "available commands",
        "how to use"
      )
    ) {
      reply =
        "Here is what you can say. " +
        "For object detection: say object detection, or what is in this image. " +
        "For the camera text reader: say camera text reader, read text, or scan a document. " +
        "For navigation: say navigation, navigate, or hospital near me. " +
        "For emergency help: say SOS, or send help. " +
        "For contacts: say read contacts, or emergency contacts. " +
        "For articles: say read articles. " +
        "For saved locations: say read saved locations. " +
        "You can also say what time is it, go to dashboard, settings, or say stop at any time to stop me talking.";

      type = "help";
    }

    // ============================================================
    // CONTACTS
    // ============================================================

    else if (
      isReadContactsCommand(t)
    ) {
      reply =
        "Reading your emergency contacts now.";

      type = "contacts";
    }

    // ============================================================
    // CALL CONTACT
    // ============================================================

    else if (
      /\b(call|phone|dial|ring)\b/.test(t) &&
      !has(
        "for help",
        "ambulance",
        "sos",
        "emergency help",
        "read contact",
        "contact list",
        "call for",
        // Bug fix: "call emergency" was parsed as "call a contact named
        // emergency" (stripping "call" and treating what's left as a
        // contact name) instead of triggering the SOS flow below. Excluded
        // here so it falls through to the SOS branch instead.
        "call emergency",
        "emergency call"
      )
    ) {
      const name = t
        .replace(
          /\b(please|can you|could you|i want to|i need to|help me)\b/g,
          ""
        )
        .replace(
          /\b(call|phone|dial|ring)\b/g,
          ""
        )
        .replace(
          /\b(my|the|a|an|contact|person|number|mobile|phone number)\b/g,
          ""
        )
        .replace(/\s+/g, " ")
        .trim();

      if (name.length > 0) {
        callPerson = name;

        reply =
          `Calling ${name}. Looking up in your contacts.`;

        type = "call";
      } else {
        reply =
          "Who would you like to call? For example, say call Mom.";

        type = "call_no_name";
      }
    }

    // ============================================================
    // ARTICLES
    // ============================================================

    else if (
      has(
        "read article",
        "show article",
        "saved article",
        "my article",
        "read news",
        "read articles",
        "show articles"
      )
    ) {
      reply =
        "Reading your saved articles now.";

      type = "articles";
    }

    // ============================================================
    // LOCATIONS
    // ============================================================

    else if (
      t === "locations" ||
      t === "saved locations" ||
      has(
        "read location",
        "show location",
        "read saved location",
        "saved place",
        "my location",
        "read saved locations"
      )
    ) {
      reply =
        "Reading your saved locations now.";

      type = "locations";
    }

    // ============================================================
    // SOS
    // ============================================================

    else if (
      t === "sos" ||
      t === "emergency" ||
      has(
        "send sos",
        "sos alert",
        "emergency alert",
        "emergency help",
        "i need help",
        "please help",
        "send help",
        "ambulance",
        "trigger sos",
        // "call emergency" / "emergency call" / "make an emergency call"
        // (the latter contains "emergency call" as a substring) — see the
        // matching exclusion added to the CALL CONTACT branch above.
        "call emergency",
        "emergency call"
      )
    ) {
      reply =
        "Sending SOS alert now. Your emergency contacts will be notified. Stay calm, help is on the way.";

      type = "sos";
    }

    // ============================================================
    // APP FEATURE SHORTCUTS (Object Detection, Camera/Text Reader,
    // Navigation, Dashboard, Settings) — natural phrasing without
    // requiring a "go to" / "open the" prefix. See
    // src/lib/voiceCommandRouter.js for the alias list. Placed after
    // every higher-priority intent (greeting/contacts/articles/
    // locations/sos) so none of those are ever shadowed, and before the
    // generic OTHER COMMANDS fallback below so it takes priority over
    // the older "go to X" app-navigation path for these five pages.
    // ============================================================

    else if (shortcutHit) {
      navigate(shortcutHit.path);

      reply = `Opening ${shortcutHit.label}.`;

      type = "navigate_app";
    }

    // ============================================================
    // OTHER COMMANDS
    // ============================================================

    else {
      const NEARBY = [
        {
          n: [
            "hospital",
            "doctor",
            "clinic",
            "medical",
          ],
          k: "hospital",
        },
        {
          n: [
            "pharmacy",
            "medicine",
            "drug store",
            "chemist",
          ],
          k: "pharmacy",
        },
        {
          n: [
            "atm",
            "cash machine",
            "cash",
            "withdraw",
          ],
          k: "atm",
        },
        {
          n: [
            "police",
            "cop",
            "police station",
          ],
          k: "police station",
        },
        {
          n: [
            "bus stop",
            "bus stand",
            "bus",
            "transit",
          ],
          k: "bus stop",
        },
        {
          n: [
            "hotel",
            "lodge",
            "accommodation",
            "motel",
          ],
          k: "hotel",
        },
        {
          n: [
            "restaurant",
            "food",
            "eat",
            "cafe",
            "coffee",
          ],
          k: "restaurant",
        },
        {
          n: [
            "bank",
            "finance",
          ],
          k: "bank",
        },
        {
          n: [
            "airport",
            "air terminal",
          ],
          k: "airport",
        },
        {
          n: [
            "petrol",
            "fuel",
            "gas station",
          ],
          k: "petrol station",
        },
      ];

      // ========================================================
      // NEAR ME
      // ========================================================

      if (
        has(
          "near me",
          "nearby",
          "nearest",
          "close by",
          "around me"
        )
      ) {
        const hit = NEARBY.find((place) =>
          place.n.some((name) =>
            t.includes(name)
          )
        );

        if (hit) {
          reply =
            `Opening navigation for ${hit.k} near you. Getting distance and directions.`;

          type = "navigation";
          nav = `${hit.k} near me`;
        } else {
          // Bug fix: "near me" alone (no place type — hospital/pharmacy/
          // ATM/etc.) previously fell through everything else in this
          // function to the generic backend-fallback "Sorry, I did not
          // understand" reply, which isn't useful for a blind user who
          // just said the wrong half of a two-part command. Ask what they
          // want instead, same as a real assistant would.
          reply =
            "What would you like to find nearby? For example, hospital, pharmacy, ATM, police station, bus stop, or hotel.";

          type = "clarify";
        }
      }

      // ========================================================
      // APP PAGE NAVIGATION
      // ========================================================

      if (
        !reply &&
        has(
          "go to",
          "open the",
          "take me to",
          "switch to",
          "show me"
        )
      ) {
        const page = getPage(t);

        if (page) {
          reply = `Opening ${page}.`;
          type = "navigate_app";
        }
      }

      // ========================================================
      // MAP NAVIGATION
      // ========================================================

      if (
        !reply &&
        has(
          "navigate to",
          "go to",
          "take me to",
          "directions to",
          "route to",
          "drive to"
        )
      ) {
        const destination = cleanDest(t);

        const pages = [
          "dashboard",
          "voice",
          "camera",
          "object",
          "contact",
          "emergency",
          "article",
          "navigation",
          "safewalk",
          "location",
          "command",
          "history",
          "feedback",
          "setting",
        ];

        if (
          destination &&
          destination.length > 1 &&
          !pages.some((p) =>
            destination.includes(p)
          )
        ) {
          reply =
            `Opening navigation to ${destination}. Getting distance and directions.`;

          type = "navigation";
          nav = destination;
        }
      }

      // ========================================================
      // BACKEND FALLBACK
      // ========================================================

      if (!reply) {
        try {
          const response =
            await API.post(
              "/commands",
              {
                commandText: text,
              }
            );

          reply =
            response.data.responseText ||
            "I processed your command.";

          type =
            response.data.commandType ||
            "unknown";

          if (type === "navigation") {
            nav = cleanDest(text);
          }
        } catch (error) {
          console.log(
            "[VOICE] Backend command error:",
            error
          );

          reply =
            `I heard "${text}". Say help to hear available commands.`;

          type = "unknown";
        }
      }
    }

    if (!aliveRef.current) return;

    addMsg(
      "assistant",
      reply,
      type
    );

    setPhaseSync("speaking");
    setLog("Speaking reply…");

    const utterance = tts(reply);

    clearTimeout(
      fbTimeoutRef.current
    );

    fbTimeoutRef.current =
      setTimeout(() => {
        if (!aliveRef.current) return;

        setPhaseSync("idle");
        setLog(
          "Ready — click Start Listening to begin"
        );

        if (window._vgResumeWake) {
          try {
            window._vgResumeWake();
          } catch {}
        }
      }, 25000);

    const done = () => {
      clearTimeout(
        fbTimeoutRef.current
      );

      if (!aliveRef.current) {
        return;
      }

      if (
        generation !== genRef.current
      ) {
        return;
      }

      // Contacts/locations/articles immediately continue speaking the actual
      // list via speakSequence() below, which already resets phase to idle
      // and resumes the wake listener itself once THAT finishes (see
      // speakSequence). Resetting to idle here too — before that list has
      // even started — falsely tells the UI (and re-enables Start Listening)
      // while the assistant is still mid-response, letting a new recognizer
      // start while speechSynthesis is still talking. So for these three
      // types, skip the reset here and let speakSequence own it exclusively.
      const continuesSpeaking =
        type === "contacts" ||
        type === "locations" ||
        type === "articles" ||
        type === "sos" ||
        (type === "call" && !!callPerson);

      if (!continuesSpeaking) {
        setPhaseSync("idle");

        setLog(
          "Ready — click Start Listening to begin"
        );

        if (window._vgResumeWake) {
          try {
            window._vgResumeWake();
          } catch {}
        }
      }

      if (type === "contacts") {
        doContacts(generation);
      }

      if (type === "locations") {
        doLocations(generation);
      }

      if (type === "articles") {
        doArticles(generation);
      }

      if (type === "sos") {
        doSOS(generation);
      }

      if (
        type === "call" &&
        callPerson
      ) {
        doCall(
          callPerson,
          generation
        );
      }

      if (
        type === "navigation" &&
        nav
      ) {
        openNavPage(nav);
      }

      if (
        type === "saved_location_nav" &&
        nav
      ) {
        findLoc(
          nav,
          generation
        );
      }
    };

    if (utterance) {
      utterance.onend = done;
      utterance.onerror = done;
    } else {
      done();
    }
  }

  // ============================================================
  // NAVIGATION HELPERS
  // ============================================================

  function getPage(t) {
    const map = {
      dashboard: "/dashboard",
      camera: "/dashboard/camera",
      object: "/dashboard/objects",
      objects: "/dashboard/objects",
      contact: "/dashboard/emergency",
      contacts: "/dashboard/emergency",
      emergency: "/dashboard/emergency",
      sos: "/dashboard/sos",
      navigation: "/dashboard/navigation",
      safewalk: "/dashboard/safewalk",
      "safe walk": "/dashboard/safewalk",
      article: "/dashboard/articles",
      articles: "/dashboard/articles",
      "safety tip": "/dashboard/safety",
      safety: "/dashboard/safety",
      location: "/dashboard/locations",
      locations: "/dashboard/locations",
      command: "/dashboard/commands",
      commands: "/dashboard/commands",
      history: "/dashboard/commands",
      feedback: "/dashboard/feedback",
      setting: "/dashboard/settings",
      settings: "/dashboard/settings",
    };

    for (const [
      key,
      path,
    ] of Object.entries(map)) {
      if (t.includes(key)) {
        navigate(path);

        return (
          path.split("/").pop() ||
          "dashboard"
        );
      }
    }

    return null;
  }

  // ============================================================
  // FIXED DESTINATION CLEANER
  // ============================================================
  //
  // IMPORTANT:
  // The previous version had the regular expression split over
  // multiple lines. That caused:
  //
  // "Unterminated regular expression"
  //
  // This version is valid JavaScript.
  // ============================================================

  function cleanDest(text) {
    return String(text || "")
      .replace(
        /\b(navigate to|go to|open map for|directions? to|take me to|find|search for|map to|open|drive to|route to)\b/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  function openMaps(query) {
    if (!query?.trim()) return;

    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        query
      )}`,
      "_blank"
    );
  }

  function openNavPage(query) {
    if (!query?.trim()) return;

    navigate(
      `/dashboard/navigation?dest=${encodeURIComponent(
        query
      )}`
    );
  }

  // ============================================================
  // DATA READERS
  // ============================================================

  // These two commands ("call", "sos") speak a second, follow-up message
  // after their initial reply has already finished (see `continuesSpeaking`
  // above) — so unlike the simple one-shot replies, THEY own resetting the
  // phase back to idle once that follow-up message actually finishes.
  function finishSpeaking(generation) {
    if (!aliveRef.current) return;
    if (generation !== genRef.current) return;

    setPhaseSync("idle");
    setLog("Ready — click Start Listening to begin");

    if (window._vgResumeWake) {
      try {
        window._vgResumeWake();
      } catch {}
    }
  }

  function speakThenFinish(text, generation) {
    const utterance = tts(text);
    const done = () => finishSpeaking(generation);

    if (utterance) {
      utterance.onend = done;
      utterance.onerror = done;
    } else {
      done();
    }
  }

  function spellPhone(phone) {
    if (!phone) return "";

    return String(phone)
      .replace(/\D/g, "")
      .split("")
      .join(" ");
  }

  // ============================================================
  // READ CONTACTS
  // ============================================================

  async function doContacts(generation) {
    try {
      const response =
        await API.get("/emergency");

      if (
        generation !== genRef.current
      ) {
        return;
      }

      if (
        !Array.isArray(response.data) ||
        !response.data.length
      ) {
        speakSequence(
          [
            "No emergency contacts saved.",
          ],
          generation
        );

        return;
      }

      const sections =
        response.data.map(
          (contact, index) => {
            let text =
              `Emergency contact ${index + 1}. Name: ${contact.name || "Unknown"}.`;

            if (contact.phone) {
              text +=
                ` Phone number: ${spellPhone(
                  contact.phone
                )}.`;
            }

            if (contact.relation) {
              text +=
                ` Relation: ${contact.relation}.`;
            }

            return text;
          }
        );

      speakSequence(
        sections,
        generation
      );
    } catch (error) {
      console.log(
        "[VOICE] Contact read error:",
        error
      );

      if (
        generation === genRef.current
      ) {
        speakSequence(
          [
            "Could not read emergency contacts.",
          ],
          generation
        );
      }
    }
  }

  // ============================================================
  // READ LOCATIONS
  // ============================================================

  async function doLocations(generation) {
    try {
      const response =
        await API.get("/locations");

      if (
        generation !== genRef.current
      ) {
        return;
      }

      if (
        !Array.isArray(response.data) ||
        !response.data.length
      ) {
        speakSequence(
          [
            "No saved locations.",
          ],
          generation
        );

        return;
      }

      const sections =
        response.data.map(
          (location, index) => {
            let text =
              `Saved location ${index + 1}. Place name: ${
                location.place_name ||
                location.name ||
                "Unknown"
              }.`;

            if (location.address) {
              text +=
                ` Address: ${location.address}.`;
            }

            return text;
          }
        );

      speakSequence(
        sections,
        generation
      );
    } catch (error) {
      console.log(
        "[VOICE] Location read error:",
        error
      );

      if (
        generation === genRef.current
      ) {
        speakSequence(
          [
            "Could not read saved locations.",
          ],
          generation
        );
      }
    }
  }

  // ============================================================
  // READ ARTICLES
  // ============================================================

  async function doArticles(generation) {
    try {
      const response =
        await API.get("/articles");

      if (
        generation !== genRef.current
      ) {
        return;
      }

      if (
        !Array.isArray(response.data) ||
        !response.data.length
      ) {
        speakSequence(
          [
            "No saved articles.",
          ],
          generation
        );

        return;
      }

      const sections = [];

      response.data.forEach(
        (article, index) => {
          sections.push(
            `Article ${index + 1}. Title: ${
              article.title || "Untitled article"
            }.`
          );

          if (
            article.content &&
            article.content.trim()
          ) {
            sections.push(
              article.content.trim()
            );
          }
        }
      );

      speakSequence(
        sections,
        generation
      );
    } catch (error) {
      console.log(
        "[VOICE] Article read error:",
        error
      );

      if (
        generation === genRef.current
      ) {
        speakSequence(
          [
            "Could not read saved articles.",
          ],
          generation
        );
      }
    }
  }

  // ============================================================
  // SOS
  // ============================================================

  async function doSOS(generation) {
    try {
      await API.post(
        "/sos",
        {
          message:
            "Emergency! I need help.",
          location:
            "Voice command",
        }
      );

      if (
        generation === genRef.current
      ) {
        speakThenFinish(
          "SOS sent. Emergency contacts notified.",
          generation
        );
      }
    } catch (error) {
      console.log(
        "[VOICE] SOS error:",
        error
      );

      if (
        generation === genRef.current
      ) {
        speakThenFinish(
          "Could not send SOS.",
          generation
        );
      }
    }
  }

  // ============================================================
  // CALL CONTACT
  // ============================================================

  async function doCall(
    name,
    generation
  ) {
    if (
      generation !== genRef.current
    ) {
      return;
    }

    try {
      const response =
        await API.get("/emergency");

      if (
        generation !== genRef.current
      ) {
        return;
      }

      const contacts =
        Array.isArray(response.data)
          ? response.data
          : [];

      if (!contacts.length) {
        speakThenFinish(
          "You have no emergency contacts saved.",
          generation
        );

        return;
      }

      const query =
        name.toLowerCase().trim();

      const match =
        contacts.find(
          (contact) => {
            const contactName =
              contact.name
                ?.toLowerCase()
                .trim();

            return (
              contactName &&
              (
                contactName.includes(query) ||
                query.includes(contactName)
              )
            );
          }
        );

      if (match) {
        const phone =
          match.phone?.replace(
            /\s+/g,
            ""
          );

        addMsg(
          "assistant",
          `📞 Calling ${match.name} — ${match.phone}`,
          "call"
        );

        speakThenFinish(
          `Calling ${match.name}. Number: ${spellPhone(
            match.phone
          )}.`,
          generation
        );

        setTimeout(() => {
          if (
            generation !==
            genRef.current
          ) {
            return;
          }

          if (!phone) {
            return;
          }

          window.location.href =
            `tel:${phone}`;
        }, 1800);
      } else {
        const names =
          contacts
            .map(
              (contact) =>
                contact.name
            )
            .filter(Boolean)
            .join(", ");

        speakThenFinish(
          `Contact "${name}" not found. Your saved contacts are: ${names || "none"}.`,
          generation
        );
      }
    } catch (error) {
      console.log(
        "[VOICE] Call contact error:",
        error
      );

      if (
        generation === genRef.current
      ) {
        speakThenFinish(
          "Could not access contacts. Please try again.",
          generation
        );
      }
    }
  }

  // ============================================================
  // FIND SAVED LOCATION
  // ============================================================

  async function findLoc(
    destination,
    generation
  ) {
    try {
      const response =
        await API.get("/locations");

      if (
        generation !== genRef.current
      ) {
        return;
      }

      const locations =
        Array.isArray(response.data)
          ? response.data
          : [];

      const destinationLower =
        destination.toLowerCase();

      const match =
        locations.find(
          (location) => {
            const placeName =
              location.place_name
                ?.toLowerCase();

            return (
              placeName &&
              (
                placeName.includes(
                  destinationLower
                ) ||
                destinationLower.includes(
                  placeName
                )
              )
            );
          }
        );

      if (match) {
        tts(
          `Opening ${match.place_name}.`
        );

        setTimeout(() => {
          if (
            generation !==
            genRef.current
          ) {
            return;
          }

          openMaps(
            match.address ||
              match.place_name
          );
        }, 200);
      } else {
        tts(
          `Opening Maps for ${destination}.`
        );

        setTimeout(() => {
          if (
            generation !==
            genRef.current
          ) {
            return;
          }

          openMaps(destination);
        }, 200);
      }
    } catch (error) {
      console.log(
        "[VOICE] Saved location search error:",
        error
      );

      if (
        generation === genRef.current
      ) {
        tts(
          `Opening Maps for ${destination}.`
        );

        setTimeout(() => {
          if (
            generation !==
            genRef.current
          ) {
            return;
          }

          openMaps(destination);
        }, 200);
      }
    }
  }

  // ============================================================
  // INPUT
  // ============================================================

  function handleSend() {
    const value = input.trim();

    if (!value) return;

    setInput("");

    runCommand(value);
  }

  // ============================================================
  // UI COLORS
  // ============================================================

  const C = {
    card: isDark
      ? "#0d1117"
      : "#ffffff",

    card2: isDark
      ? "#111827"
      : "#f8fafc",

    border: isDark
      ? "#1e2a3a"
      : "rgba(0,0,0,0.09)",

    text: isDark
      ? "#f0f6fc"
      : "#0f172a",

    sub: isDark
      ? "#8b949e"
      : "#64748b",

    inp: isDark
      ? "#0d1117"
      : "#f1f5f9",

    inB: isDark
      ? "#30363d"
      : "rgba(0,0,0,0.15)",

    uBub: isDark
      ? "#1c2d40"
      : "#dbeafe",

    uTxt: isDark
      ? "#79b8ff"
      : "#1d4ed8",

    aBub: isDark
      ? "#111827"
      : "#f0fdf4",
  };

  const isRec =
    phase === "recording";

  const isProc =
    phase === "processing";

  const isSpk =
    phase === "speaking";

  const showSpk =
    isSpk || ttsActive;

  return (
    <DashboardLayout>
      <div
        className="fade-in"
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
        }}
      >
        <div
          style={{
            marginBottom: "24px",
          }}
        >
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 800,
              color: C.text,
              margin: 0,
            }}
          >
            🎤 Voice Assistant
          </h1>

          <p
            style={{
              color: C.sub,
              margin: "4px 0 0",
              fontSize: "13px",
            }}
          >
            Click Start Listening →
            speak your command →
            response is spoken aloud
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(0,1.1fr) minmax(0,1fr)",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* =====================================================
              LEFT SIDE
          ====================================================== */}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* VOICE CONTROL CARD */}

            <div
              style={{
                borderRadius: "20px",
                background: C.card,
                border:
                  `1px solid ${C.border}`,
                padding:
                  "32px 24px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "24px",
                }}
              >
                {isRec && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        inset: -20,
                        borderRadius: "50%",
                        border:
                          "2px solid rgba(239,68,68,.5)",
                        animation:
                          "varing 1.2s ease-out infinite",
                      }}
                    />

                    <div
                      style={{
                        position: "absolute",
                        inset: -40,
                        borderRadius: "50%",
                        border:
                          "2px solid rgba(239,68,68,.25)",
                        animation:
                          "varing 1.2s ease-out infinite 0.4s",
                      }}
                    />
                  </>
                )}

                {showSpk && (
                  <div
                    style={{
                      position: "absolute",
                      inset: -12,
                      borderRadius: "50%",
                      border:
                        "2px solid rgba(96,165,250,.5)",
                      animation:
                        "varing 1.8s ease-out infinite",
                    }}
                  />
                )}

                <div
                  style={{
                    width: "140px",
                    height: "140px",
                    borderRadius: "50%",
                    border:
                      `4px solid ${
                        isRec
                          ? "#ef4444"
                          : isProc
                          ? "#facc15"
                          : showSpk
                          ? "#60a5fa"
                          : "#22c55e"
                      }`,
                    background:
                      isRec
                        ? "rgba(239,68,68,.1)"
                        : isProc
                        ? "rgba(250,204,21,.1)"
                        : showSpk
                        ? "rgba(96,165,250,.1)"
                        : "rgba(34,197,94,.1)",
                    display: "flex",
                    flexDirection:
                      "column",
                    alignItems: "center",
                    justifyContent:
                      "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "52px",
                      lineHeight: 1,
                    }}
                  >
                    {isRec
                      ? "🔴"
                      : isProc
                      ? "⌛"
                      : showSpk
                      ? "🔊"
                      : "🎤"}
                  </span>

                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 800,
                      letterSpacing:
                        "0.08em",
                      color: isRec
                        ? "#ef4444"
                        : isProc
                        ? "#facc15"
                        : showSpk
                        ? "#60a5fa"
                        : "#22c55e",
                    }}
                  >
                    {isRec
                      ? "LISTENING"
                      : isProc
                      ? "PROCESSING"
                      : showSpk
                      ? "SPEAKING"
                      : "READY"}
                  </span>
                </div>
              </div>

              <p
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: isRec
                    ? "#ef4444"
                    : isProc
                    ? "#facc15"
                    : showSpk
                    ? "#60a5fa"
                    : log.startsWith("❌")
                    ? "#f87171"
                    : "#22c55e",
                  margin:
                    "0 0 20px",
                  minHeight: "20px",
                  lineHeight: 1.5,
                }}
              >
                {log}
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent:
                    "center",
                  flexWrap: "wrap",
                }}
              >
                {!isProc && (
                  <button
                    onClick={
                      isListening
                        ? stopListening
                        : startListening
                    }
                    disabled={isSpk}
                    style={{
                      padding:
                        "14px 36px",
                      borderRadius:
                        "14px",
                      fontSize: "16px",
                      fontWeight: 800,
                      background:
                        isListening
                          ? "#ef4444"
                          : "#22c55e",
                      color:
                        isListening
                          ? "#fff"
                          : "#000",
                      border: "none",
                      cursor: isSpk
                        ? "not-allowed"
                        : "pointer",
                      fontFamily:
                        "inherit",
                      opacity: isSpk
                        ? 0.5
                        : 1,
                    }}
                  >
                    {isListening
                      ? "⏹ Stop Listening"
                      : "🎤 Start Listening"}
                  </button>
                )}

                {showSpk && (
                  <button
                    onClick={() => {
                      stopSpeaking();

                      setPhaseSync("idle");

                      setLog(
                        "Stopped. Click Start Listening to begin"
                      );

                      if (
                        window._vgResumeWake
                      ) {
                        try {
                          window._vgResumeWake();
                        } catch {}
                      }
                    }}
                    style={{
                      padding:
                        "10px 24px",
                      borderRadius:
                        "12px",
                      fontSize: "14px",
                      fontWeight: 700,
                      background:
                        "rgba(239,68,68,0.1)",
                      border:
                        "1px solid rgba(239,68,68,0.3)",
                      color: "#f87171",
                      cursor: "pointer",
                      fontFamily:
                        "inherit",
                    }}
                  >
                    ⏹ Stop Speaking
                  </button>
                )}
              </div>
            </div>

            {/* TEXT COMMAND */}

            <div
              style={{
                display: "flex",
                gap: "10px",
              }}
            >
              <input
                type="text"
                placeholder="Or type a command here and press Enter…"
                value={input}
                onChange={(e) =>
                  setInput(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSend();
                  }
                }}
                style={{
                  flex: 1,
                  padding:
                    "13px 16px",
                  borderRadius:
                    "12px",
                  fontSize: "14px",
                  fontFamily:
                    "inherit",
                  background: C.inp,
                  border:
                    `2px solid ${C.inB}`,
                  color: C.text,
                  outline: "none",
                }}
              />

              <button
                onClick={handleSend}
                disabled={!input.trim()}
                style={{
                  padding:
                    "13px 22px",
                  borderRadius:
                    "12px",
                  background:
                    "#22c55e",
                  color: "#000",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor:
                    input.trim()
                      ? "pointer"
                      : "not-allowed",
                  fontFamily:
                    "inherit",
                  opacity:
                    input.trim()
                      ? 1
                      : 0.5,
                }}
              >
                Send Command
              </button>
            </div>

            {/* QUICK COMMANDS */}

            <div
              style={{
                borderRadius: "16px",
                background: C.card,
                border:
                  `1px solid ${C.border}`,
                padding: "18px",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: C.sub,
                  textTransform:
                    "uppercase",
                  letterSpacing:
                    "0.07em",
                  margin:
                    "0 0 12px",
                }}
              >
                ⚡ Quick Commands
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: "8px",
                }}
              >
                {QUICK.map((item) => (
                  <button
                    key={item.cmd}
                    onClick={() =>
                      runCommand(
                        item.cmd
                      )
                    }
                    style={{
                      display: "flex",
                      alignItems:
                        "center",
                      gap: "8px",
                      padding:
                        "11px 12px",
                      borderRadius:
                        "10px",
                      cursor:
                        "pointer",
                      fontSize:
                        "13px",
                      fontWeight: 600,
                      fontFamily:
                        "inherit",
                      background:
                        C.card2,
                      border:
                        `1px solid ${C.border}`,
                      color: C.text,
                      textAlign:
                        "left",
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          "18px",
                      }}
                    >
                      {item.icon}
                    </span>

                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* =====================================================
              RIGHT SIDE
          ====================================================== */}

          <div
            style={{
              display: "flex",
              flexDirection:
                "column",
              gap: "16px",
            }}
          >
            {/* CONVERSATION */}

            <div
              style={{
                borderRadius: "16px",
                background: C.card,
                border:
                  `1px solid ${C.border}`,
                display: "flex",
                flexDirection:
                  "column",
                height: "590px",
              }}
            >
              <div
                style={{
                  padding:
                    "14px 18px",
                  borderBottom:
                    `1px solid ${C.border}`,
                  display: "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "space-between",
                }}
              >
                <span
                  style={{
                    fontSize:
                      "12px",
                    fontWeight: 700,
                    color: C.sub,
                    textTransform:
                      "uppercase",
                    letterSpacing:
                      "0.07em",
                  }}
                >
                  💬 Conversation
                </span>

                {msgs.length > 0 && (
                  <button
                    onClick={() =>
                      setMsgs([])
                    }
                    style={{
                      background:
                        "none",
                      border: "none",
                      color: C.sub,
                      cursor:
                        "pointer",
                      fontSize:
                        "12px",
                      fontFamily:
                        "inherit",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div
                style={{
                  flex: 1,
                  overflowY:
                    "auto",
                  padding: "16px",
                  display: "flex",
                  flexDirection:
                    "column",
                  gap: "12px",
                }}
              >
                {msgs.length === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection:
                        "column",
                      alignItems:
                        "center",
                      justifyContent:
                        "center",
                      gap: "12px",
                      opacity: 0.4,
                      textAlign:
                        "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          "48px",
                      }}
                    >
                      🎤
                    </span>

                    <p
                      style={{
                        fontSize:
                          "13px",
                        color: C.sub,
                        margin: 0,
                        lineHeight:
                          1.7,
                      }}
                    >
                      Click Start Listening
                      and speak a command.
                      <br />
                      Your conversation
                      appears here.
                    </p>
                  </div>
                ) : (
                  msgs.map(
                    (message, index) => (
                      <div
                        key={index}
                        style={{
                          display:
                            "flex",
                          flexDirection:
                            "column",
                          alignItems:
                            message.role ===
                            "user"
                              ? "flex-end"
                              : "flex-start",
                        }}
                      >
                        <span
                          style={{
                            fontSize:
                              "10px",
                            color:
                              C.sub,
                            marginBottom:
                              "3px",
                          }}
                        >
                          {message.role ===
                          "user"
                            ? "You"
                            : "VisionGuide AI"}{" "}
                          ·{" "}
                          {
                            message.time
                          }
                        </span>

                        <div
                          style={{
                            maxWidth:
                              "90%",
                            padding:
                              "10px 14px",
                            borderRadius:
                              message.role ===
                              "user"
                                ? "16px 16px 4px 16px"
                                : "16px 16px 16px 4px",
                            background:
                              message.role ===
                              "user"
                                ? C.uBub
                                : C.aBub,
                            color:
                              message.role ===
                              "user"
                                ? C.uTxt
                                : C.text,
                            border:
                              `1px solid ${
                                message.role ===
                                "user"
                                  ? C.uTxt +
                                    "25"
                                  : (
                                      TYPE_COLOR[
                                        message.type
                                      ] ||
                                      "#6b7280"
                                    ) +
                                    "25"
                              }`,
                            fontSize:
                              "13px",
                            lineHeight:
                              1.7,
                            wordBreak:
                              "break-word",
                          }}
                        >
                          {
                            message.text
                          }
                        </div>

                        {message.role ===
                          "assistant" &&
                          message.type &&
                          message.type !==
                            "unknown" && (
                            <span
                              style={{
                                marginTop:
                                  "3px",
                                padding:
                                  "2px 8px",
                                borderRadius:
                                  "20px",
                                fontSize:
                                  "10px",
                                fontWeight:
                                  700,
                                background:
                                  (
                                    TYPE_COLOR[
                                      message.type
                                    ] ||
                                    "#6b7280"
                                  ) +
                                  "18",
                                color:
                                  TYPE_COLOR[
                                    message.type
                                  ] ||
                                  "#6b7280",
                              }}
                            >
                              {
                                message.type
                              }
                            </span>
                          )}
                      </div>
                    )
                  )
                )}

                {isProc && (
                  <div
                    style={{
                      display:
                        "flex",
                      alignItems:
                        "center",
                      gap: "8px",
                    }}
                  >
                    {[0, 1, 2].map(
                      (i) => (
                        <span
                          key={i}
                          style={{
                            width:
                              "7px",
                            height:
                              "7px",
                            borderRadius:
                              "50%",
                            background:
                              "#facc15",
                            display:
                              "inline-block",
                            animation:
                              "vadot 1.2s ease-in-out infinite",
                            animationDelay:
                              `${i * 0.2}s`,
                          }}
                        />
                      )
                    )}

                    <span
                      style={{
                        fontSize:
                          "11px",
                        color:
                          C.sub,
                      }}
                    >
                      Processing…
                    </span>
                  </div>
                )}

                <div
                  ref={endRef}
                />
              </div>
            </div>

            {/* WHAT TO SAY */}

            <div
              style={{
                borderRadius: "16px",
                background: C.card,
                border:
                  `1px solid ${C.border}`,
                padding: "16px",
              }}
            >
              <p
                style={{
                  fontSize:
                    "11px",
                  fontWeight: 700,
                  color: C.sub,
                  textTransform:
                    "uppercase",
                  letterSpacing:
                    "0.07em",
                  margin:
                    "0 0 10px",
                }}
              >
                💡 What to say
              </p>

              {[
                ["hello", "Greet"],
                [
                  "read contacts",
                  "Hear contacts",
                ],
                [
                  "read saved locations",
                  "Hear places",
                ],
                [
                  "read articles",
                  "Hear articles",
                ],
                [
                  "hospital near me",
                  "Find hospital",
                ],
                [
                  "pharmacy near me",
                  "Find pharmacy",
                ],
                [
                  "ATM near me",
                  "Find ATM",
                ],
                [
                  "police station near me",
                  "Find police",
                ],
                [
                  "send SOS",
                  "Emergency alert",
                ],
                [
                  "what time is it",
                  "Current time",
                ],
                [
                  "go to dashboard",
                  "Switch page",
                ],
                [
                  "stop",
                  "Silence voice",
                ],
                [
                  "help",
                  "All commands",
                ],
              ].map(
                ([command, description]) => (
                  <div
                    key={command}
                    onClick={() =>
                      runCommand(
                        command
                      )
                    }
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "center",
                      padding:
                        "7px 0",
                      borderBottom:
                        `1px solid ${C.border}`,
                      cursor:
                        "pointer",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        color:
                          "#facc15",
                        fontWeight:
                          700,
                        fontSize:
                          "12px",
                        flexShrink: 0,
                      }}
                    >
                      "{command}"
                    </span>

                    <span
                      style={{
                        color:
                          C.sub,
                        fontSize:
                          "11px",
                        textAlign:
                          "right",
                      }}
                    >
                      {description}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes varing {
          0% {
            transform: scale(1);
            opacity: .6;
          }

          100% {
            transform: scale(1.7);
            opacity: 0;
          }
        }

        @keyframes vadot {
          0%, 80%, 100% {
            transform: scale(.7);
            opacity: .3;
          }

          40% {
            transform: scale(1.1);
            opacity: 1;
          }
        }
      `}</style>
    </DashboardLayout>
  );
}
import { useEffect, useRef, useState } from 'react'

interface SpeechResultEvent extends Event {
  results: {
    length: number
    [index: number]: { isFinal: boolean; [alt: number]: { transcript: string } }
  }
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: Event) => void) | null
}

export function VoiceCapture({
  onDone,
  onCancel,
}: {
  onDone: (transcript: string) => void
  onCancel: () => void
}) {
  const [transcript, setTranscript] = useState('')
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(true)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalTranscriptRef = useRef('')
  const manualStopRef = useRef(false)

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Impl = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Impl) {
      setSupported(false)
      return
    }

    // Non-continuous, auto-restarting: some mobile browsers re-deliver "final"
    // results as full cumulative restatements in continuous mode, causing
    // stutter/duplication. One utterance per session, restarted on pause,
    // avoids that entirely.
    const recognition = new Impl()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1]
      const text = last[0].transcript
      if (last.isFinal) {
        finalTranscriptRef.current = (finalTranscriptRef.current + ' ' + text).trim()
        setTranscript(finalTranscriptRef.current)
      } else {
        setTranscript((finalTranscriptRef.current + ' ' + text).trim())
      }
    }
    recognition.onerror = () => {
      manualStopRef.current = true
    }
    recognition.onend = () => {
      if (manualStopRef.current) {
        setListening(false)
      } else {
        try {
          recognition.start()
        } catch {
          setListening(false)
        }
      }
    }

    recognitionRef.current = recognition
    manualStopRef.current = false
    recognition.start()
    setListening(true)
    return () => {
      manualStopRef.current = true
      recognition.stop()
    }
  }, [])

  function stop() {
    manualStopRef.current = true
    recognitionRef.current?.stop()
    setListening(false)
  }

  if (!supported) {
    return (
      <div className="project-form">
        <h2>Voice capture</h2>
        <p className="hint">
          Voice input isn't supported in this browser. Try Chrome, Edge, or Safari on iOS.
        </p>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="project-form">
      <h2>{listening ? '🎤 Listening…' : 'Stopped'}</h2>
      <p className="voice-transcript">{transcript || 'Say what you want to capture…'}</p>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {listening ? (
          <button type="button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => onDone(transcript)} disabled={!transcript}>
            Use this
          </button>
        )}
      </div>
    </div>
  )
}

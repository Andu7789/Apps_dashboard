import { useEffect, useRef, useState } from 'react'

interface SpeechResultEvent extends Event {
  resultIndex: number
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
    const recognition = new Impl()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        if (res.isFinal) finalTranscriptRef.current += res[0].transcript + ' '
        else interimText = res[0].transcript
      }
      setTranscript((finalTranscriptRef.current + interimText).trim())
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    return () => recognition.stop()
  }, [])

  function stop() {
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

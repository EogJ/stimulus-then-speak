import * as ort from "onnxruntime-web"

const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 1280
const MELSPEC_WINDOW = 76

class WakeWordDetector {
  constructor(basePath, wakeModel, confidence, onError) {
    this.basePath = basePath
    this.wakeModel = wakeModel
    this.confidence = confidence
    this.onError = onError
    this.sessions = {}
    this.audioContext = null
    this.worklet = null
    this.stream = null
    this.melFrames = []
    this.embeddingBuffer = []
    this.onDetection = null
    this.running = false
    this.initialized = false

    // Pre-allocated buffers for inference (avoids GC pressure)
    this.melInputBuffer = new Float32Array(MELSPEC_WINDOW * 32)
    this.embInputBuffer = new Float32Array(16 * 96)
  }

  async initialize() {
    const opts = { executionProviders: ["wasm"] }

    // Load all models in parallel for faster initialization
    const [mel, emb, wake] = await Promise.all([
      ort.InferenceSession.create(`${this.basePath}/melspectrogram.onnx`, opts),
      ort.InferenceSession.create(`${this.basePath}/embedding_model.onnx`, opts),
      ort.InferenceSession.create(`${this.basePath}/${this.wakeModel}`, opts)
    ])

    this.sessions = { mel, emb, wake }
  }

  async start(onDetection) {
    if (this.initialized) {
      throw new Error("WakeWordDetector already started. Call stop() first.")
    }

    this.onDetection = onDetection
    this.running = true
    this.melFrames = []
    this.embeddingBuffer = []

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })

    const workletBlob = new Blob([`
      class P extends AudioWorkletProcessor {
        constructor() { super(); this.buf = [] }
        process(inputs) {
          if (inputs[0].length) {
            this.buf.push(...inputs[0][0])
            while (this.buf.length >= ${FRAME_SAMPLES}) {
              this.port.postMessage(this.buf.splice(0, ${FRAME_SAMPLES}))
            }
          }
          return true
        }
      }
      registerProcessor("p", P)
    `], { type: "application/javascript" })
    const workletUrl = URL.createObjectURL(workletBlob)

    try {
      await this.audioContext.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }

    const source = this.audioContext.createMediaStreamSource(this.stream)
    this.worklet = new AudioWorkletNode(this.audioContext, "p")
    this.worklet.port.onmessage = (e) => this.running && this.processFrame(e.data)
    source.connect(this.worklet)

    this.initialized = true
  }

  async processFrame(samples) {
    try {
      const audio = new ort.Tensor("float32", new Float32Array(samples), [1, samples.length])
      const mel = await this.sessions.mel.run({ input: audio })
      const melTensor = mel.output
      const melData = Array.from(melTensor.data ?? Object.values(melTensor.cpuData))

      for (let i = 0; i < melData.length / 32; i++) {
        const frame = melData.slice(i * 32, (i + 1) * 32)
        for (let j = 0; j < frame.length; j++) {
          frame[j] = (frame[j] / 10.0) + 2.0
        }
        this.melFrames.push(frame)
      }

      while (this.melFrames.length >= MELSPEC_WINDOW) {
        // Reuse pre-allocated buffer
        for (let i = 0; i < MELSPEC_WINDOW; i++) {
          this.melInputBuffer.set(this.melFrames[i], i * 32)
        }

        const emb = await this.sessions.emb.run({
          input_1: new ort.Tensor("float32", this.melInputBuffer, [1, MELSPEC_WINDOW, 32, 1])
        })

        const embTensor = emb.conv2d_19
        const embData = embTensor.data ?? Object.values(embTensor.cpuData)
        this.embeddingBuffer.push(Array.from(embData))

        this.melFrames.splice(0, 8)

        if (this.embeddingBuffer.length >= 16) {
          // Reuse pre-allocated buffer
          const startIdx = this.embeddingBuffer.length - 16
          for (let i = 0; i < 16; i++) {
            this.embInputBuffer.set(this.embeddingBuffer[startIdx + i], i * 96)
          }

          const wake = await this.sessions.wake.run({
            "x.1": new ort.Tensor("float32", this.embInputBuffer, [1, 16, 96])
          })

          const outputKey = Object.keys(wake)[0]
          const tensor = wake[outputKey]
          const tensorData = tensor.data ?? Object.values(tensor.cpuData)
          const score = tensorData[0]
          if (score >= this.confidence) this.onDetection?.(score)

          if (this.embeddingBuffer.length > 32) this.embeddingBuffer = this.embeddingBuffer.slice(-16)
        }
      }
    } catch (e) {
      console.error("Wake word error:", e)
      this.onError?.(e)
    }
  }

  stop() {
    this.running = false
    this.initialized = false
    this.worklet?.disconnect()
    this.audioContext?.close()
    this.stream?.getTracks().forEach(t => t.stop())
  }

  pause() { this.running = false }
  resume() {
    // Clear buffers to avoid re-triggering on stale audio data
    this.melFrames = []
    this.embeddingBuffer = []
    this.running = true
  }
}

class CommandRecognizer {
  constructor(lang = "en-US", onError) {
    this.lang = lang
    this.onError = onError
    this.recognition = null
    this.commands = new Map()
    this.running = false
    this.onSpeech = null
  }

  register(phrase, element) {
    const key = phrase.toLowerCase()
    if (!this.commands.has(key)) this.commands.set(key, [])
    this.commands.get(key).push(element)
  }

  start(onSpeech) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      const error = new Error("Speech recognition not supported in this browser")
      console.error(error.message)
      this.onError?.(error)
      return
    }

    this.recognition = new SR()
    this.recognition.continuous = true
    this.recognition.interimResults = false
    this.recognition.lang = this.lang
    this.running = true
    this.onSpeech = onSpeech

    this.recognition.onresult = (e) => {
      const transcript = e.results[e.results.length - 1][0].transcript.trim().toLowerCase()

      for (const [phrase, elements] of this.commands) {
        if (transcript.includes(phrase)) {
          elements.forEach(el => {
            el.dispatchEvent(new CustomEvent(`speak:${phrase}`, {
              bubbles: true,
              detail: { transcript, phrase }
            }))
          })
        }
      }

      this.onSpeech?.(transcript)
    }

    this.recognition.onerror = (e) => {
      if (!["no-speech", "aborted"].includes(e.error)) {
        console.error("Speech error:", e.error)
        this.onError?.(new Error(`Speech recognition error: ${e.error}`))
      }
    }

    this.recognition.onend = () => {
      if (this.running) {
        try {
          this.recognition.start()
        } catch (e) {
          // Recognition may fail to restart if already running or browser restrictions
          this.onError?.(e)
        }
      }
    }

    this.recognition.start()
  }

  stop() {
    this.running = false
    this.recognition?.stop()
  }
}

export default class SpeakThen {
  constructor(element, config = {}) {
    this.element = element
    this.config = {
      basePath: config.basePath || "/models",
      wakeModel: config.wakeModel || "hey_jarvis_v0.1.onnx",
      confidence: config.confidence || 0.5,
      sleepAfter: config.sleepAfter || 5000,
      lang: config.lang || "en-US",
      onWake: config.onWake,
      onSleep: config.onSleep,
      onError: config.onError
    }
    this.state = "sleeping"
    this.sleepTimer = null
    this.started = false
    this.wakeDetector = new WakeWordDetector(
      this.config.basePath,
      this.config.wakeModel,
      this.config.confidence,
      this.config.onError
    )
    this.commandRecognizer = new CommandRecognizer(this.config.lang, this.config.onError)

    this.discoverCommands()
  }

  discoverCommands() {
    const elements = this.element.querySelectorAll("[data-action]")
    
    elements.forEach(el => {
      const actions = el.dataset.action.split(/\s+/)
      actions.forEach(action => {
        const match = action.match(/^speak:([^->]+)/)
        if (match) {
          const phrase = match[1].replace(/_/g, " ")
          this.commandRecognizer.register(phrase, el)
        }
      })
    })
  }

  async start() {
    if (this.started) {
      throw new Error("SpeakThen already started. Call stop() first.")
    }

    await this.wakeDetector.initialize()
    await this.wakeDetector.start(() => {
      this.wake()
    })
    this.started = true
  }

  wake() {
    if (this.state === "awake") return
    this.state = "awake"
    this.wakeDetector.pause()
    this.config.onWake?.()
    this.commandRecognizer.start(() => this.resetSleepTimer())
    this.resetSleepTimer()
  }

  resetSleepTimer() {
    clearTimeout(this.sleepTimer)
    this.sleepTimer = setTimeout(() => this.sleep(), this.config.sleepAfter)
  }

  sleep() {
    if (this.state === "sleeping") return
    this.state = "sleeping"
    this.commandRecognizer.stop()
    this.config.onSleep?.()
    this.wakeDetector.resume()
  }

  stop() {
    clearTimeout(this.sleepTimer)
    this.commandRecognizer.stop()
    this.wakeDetector.stop()
    this.started = false
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import SpeakThen from "./speak_then.js"

vi.mock("onnxruntime-web", () => ({
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({
        output: { data: new Float32Array(32) },
        conv2d_19: { data: new Float32Array(96) },
        dense: { data: new Float32Array([0.3]) }
      })
    })
  },
  Tensor: vi.fn((type, data, shape) => ({ type, data, shape }))
}))

let mockMediaStream
let mockAudioWorkletNode
let mockAudioContext

const mockSpeechRecognition = vi.fn(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  continuous: false,
  interimResults: false,
  lang: "",
  onresult: null,
  onerror: null,
  onend: null
}))

function setupBrowserMocks() {
  mockMediaStream = {
    getTracks: () => [{ stop: vi.fn() }]
  }

  mockAudioWorkletNode = {
    port: { onmessage: null, postMessage: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn()
  }

  mockAudioContext = {
    sampleRate: 16000,
    audioWorklet: {
      addModule: vi.fn().mockResolvedValue(undefined)
    },
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    close: vi.fn()
  }

  global.navigator = {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(mockMediaStream)
    }
  }

  global.AudioContext = vi.fn(() => mockAudioContext)
  global.AudioWorkletNode = vi.fn(() => mockAudioWorkletNode)

  // jsdom doesn't have createObjectURL/revokeObjectURL
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn()
  })

  global.SpeechRecognition = mockSpeechRecognition
  global.webkitSpeechRecognition = undefined
}

beforeEach(() => {
  setupBrowserMocks()
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("SpeakThen", () => {
  let element
  let speakThenInstance

  beforeEach(() => {
    element = document.createElement("div")
    speakThenInstance = null
  })

  afterEach(() => {
    speakThenInstance?.stop()
  })

  describe("configuration", () => {
    it("uses default config values", () => {
      const speakThen = new SpeakThen(element)

      expect(speakThen.config.basePath).toBe("/models")
      expect(speakThen.config.confidence).toBe(0.5)
      expect(speakThen.config.sleepAfter).toBe(5000)
      expect(speakThen.config.lang).toBe("en-US")
    })

    it("accepts custom config values", () => {
      const speakThen = new SpeakThen(element, {
        basePath: "/custom/models",
        confidence: 0.8,
        sleepAfter: 10000,
        lang: "es-ES"
      })

      expect(speakThen.config.basePath).toBe("/custom/models")
      expect(speakThen.config.confidence).toBe(0.8)
      expect(speakThen.config.sleepAfter).toBe(10000)
      expect(speakThen.config.lang).toBe("es-ES")
    })

    it("accepts callback functions", () => {
      const onWake = vi.fn()
      const onSleep = vi.fn()
      const onError = vi.fn()

      const speakThen = new SpeakThen(element, { onWake, onSleep, onError })

      expect(speakThen.config.onWake).toBe(onWake)
      expect(speakThen.config.onSleep).toBe(onSleep)
      expect(speakThen.config.onError).toBe(onError)
    })
  })

  describe("command discovery", () => {
    it("discovers speak: actions from child elements", () => {
      element.innerHTML = `
        <button data-action="speak:next->player#next">Next</button>
        <button data-action="speak:pause->player#pause">Pause</button>
      `

      const speakThen = new SpeakThen(element)

      expect(speakThen.commandRecognizer.commands.has("next")).toBe(true)
      expect(speakThen.commandRecognizer.commands.has("pause")).toBe(true)
    })

    it("converts underscores to spaces in phrases", () => {
      element.innerHTML = `
        <button data-action="speak:play_music->player#play">Play</button>
      `

      const speakThen = new SpeakThen(element)

      expect(speakThen.commandRecognizer.commands.has("play music")).toBe(true)
    })

    it("ignores non-speak actions", () => {
      element.innerHTML = `
        <button data-action="click->player#next">Next</button>
      `

      const speakThen = new SpeakThen(element)

      expect(speakThen.commandRecognizer.commands.size).toBe(0)
    })

    it("handles multiple actions on same element", () => {
      element.innerHTML = `
        <button data-action="click->player#next speak:next->player#next">Next</button>
      `

      const speakThen = new SpeakThen(element)

      expect(speakThen.commandRecognizer.commands.has("next")).toBe(true)
      expect(speakThen.commandRecognizer.commands.size).toBe(1)
    })
  })

  describe("start()", () => {
    it("throws error if already started", async () => {
      speakThenInstance = new SpeakThen(element)
      await speakThenInstance.start()

      await expect(speakThenInstance.start()).rejects.toThrow("already started")
    })

    it("requests microphone access", async () => {
      speakThenInstance = new SpeakThen(element)
      await speakThenInstance.start()

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({
          sampleRate: 16000,
          channelCount: 1
        })
      })
    })
  })

  describe("stop()", () => {
    it("allows restart after stop", async () => {
      speakThenInstance = new SpeakThen(element)
      await speakThenInstance.start()
      speakThenInstance.stop()

      await expect(speakThenInstance.start()).resolves.not.toThrow()
    })
  })

  describe("state transitions", () => {
    it("transitions to awake on wake()", async () => {
      const onWake = vi.fn()
      speakThenInstance = new SpeakThen(element, { onWake })
      await speakThenInstance.start()

      speakThenInstance.wake()

      expect(speakThenInstance.state).toBe("awake")
      expect(onWake).toHaveBeenCalled()
    })

    it("does not re-wake if already awake", async () => {
      const onWake = vi.fn()
      speakThenInstance = new SpeakThen(element, { onWake })
      await speakThenInstance.start()

      speakThenInstance.wake()
      speakThenInstance.wake()

      expect(onWake).toHaveBeenCalledTimes(1)
    })

    it("transitions to sleeping on sleep()", async () => {
      const onSleep = vi.fn()
      speakThenInstance = new SpeakThen(element, { onSleep })
      await speakThenInstance.start()

      speakThenInstance.wake()
      speakThenInstance.sleep()

      expect(speakThenInstance.state).toBe("sleeping")
      expect(onSleep).toHaveBeenCalled()
    })

    it("does not re-sleep if already sleeping", async () => {
      const onSleep = vi.fn()
      speakThenInstance = new SpeakThen(element, { onSleep })
      await speakThenInstance.start()

      speakThenInstance.sleep()

      expect(onSleep).not.toHaveBeenCalled()
    })
  })

  describe("sleep timer", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("auto-sleeps after configured timeout", async () => {
      const onSleep = vi.fn()
      speakThenInstance = new SpeakThen(element, { sleepAfter: 3000, onSleep })
      await speakThenInstance.start()

      speakThenInstance.wake()
      expect(speakThenInstance.state).toBe("awake")

      vi.advanceTimersByTime(3000)

      expect(speakThenInstance.state).toBe("sleeping")
      expect(onSleep).toHaveBeenCalled()
    })

    it("resets timer on resetSleepTimer()", async () => {
      const onSleep = vi.fn()
      speakThenInstance = new SpeakThen(element, { sleepAfter: 3000, onSleep })
      await speakThenInstance.start()

      speakThenInstance.wake()
      vi.advanceTimersByTime(2000)

      speakThenInstance.resetSleepTimer()
      vi.advanceTimersByTime(2000)

      expect(speakThenInstance.state).toBe("awake")

      vi.advanceTimersByTime(1000)

      expect(speakThenInstance.state).toBe("sleeping")
    })
  })
})

describe("CommandRecognizer (via SpeakThen)", () => {
  let element
  let speakThenInstance

  beforeEach(() => {
    element = document.createElement("div")
    speakThenInstance = null
  })

  afterEach(() => {
    speakThenInstance?.stop()
  })

  it("uses configured language", () => {
    speakThenInstance = new SpeakThen(element, { lang: "fr-FR" })

    expect(speakThenInstance.commandRecognizer.lang).toBe("fr-FR")
  })

  it("registers multiple elements for same phrase", () => {
    element.innerHTML = `
      <button data-action="speak:play->player#play">Play 1</button>
      <button data-action="speak:play->player#playAlt">Play 2</button>
    `

    speakThenInstance = new SpeakThen(element)
    const playElements = speakThenInstance.commandRecognizer.commands.get("play")

    expect(playElements).toHaveLength(2)
  })

  it("calls onError when speech recognition not supported", async () => {
    global.SpeechRecognition = undefined
    global.webkitSpeechRecognition = undefined

    const onError = vi.fn()
    speakThenInstance = new SpeakThen(element, { onError })
    await speakThenInstance.start()

    speakThenInstance.wake()

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("not supported")
      })
    )
  })
})

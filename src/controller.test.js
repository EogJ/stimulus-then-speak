import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Application } from "@hotwired/stimulus"
import SpeakThenController from "./controller.js"

vi.mock("./speak_then.js", () => ({
  default: vi.fn().mockImplementation((element, config) => ({
    element,
    config,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn()
  }))
}))

import SpeakThen from "./speak_then.js"

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0))

describe("SpeakThenController", () => {
  let application
  let element

  beforeEach(async () => {
    document.body.innerHTML = ""

    application = Application.start()
    application.register("speak-then", SpeakThenController)

    element = document.createElement("div")
    element.setAttribute("data-controller", "speak-then")
    document.body.appendChild(element)

    await nextTick()
  })

  afterEach(() => {
    application.stop()
    vi.clearAllMocks()
  })

  describe("connect", () => {
    it("creates SpeakThen instance with element", async () => {
      expect(SpeakThen).toHaveBeenCalledWith(
        element,
        expect.objectContaining({})
      )
    })

    it("calls start() on SpeakThen", async () => {
      const instance = SpeakThen.mock.results[0].value
      expect(instance.start).toHaveBeenCalled()
    })

    it("passes default config values", async () => {
      expect(SpeakThen).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          basePath: "/models",
          confidence: 0.5,
          sleepAfter: 5000,
          lang: "en-US"
        })
      )
    })
  })

  describe("custom values", () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      document.body.innerHTML = ""

      element = document.createElement("div")
      element.setAttribute("data-controller", "speak-then")
      element.setAttribute("data-speak-then-confidence-value", "0.8")
      element.setAttribute("data-speak-then-sleep-value", "10000")
      element.setAttribute("data-speak-then-models-path-value", "/custom/models")
      element.setAttribute("data-speak-then-lang-value", "de-DE")
      document.body.appendChild(element)

      await nextTick()
    })

    it("passes custom confidence value", () => {
      expect(SpeakThen).toHaveBeenCalledWith(
        element,
        expect.objectContaining({ confidence: 0.8 })
      )
    })

    it("passes custom sleep value", () => {
      expect(SpeakThen).toHaveBeenCalledWith(
        element,
        expect.objectContaining({ sleepAfter: 10000 })
      )
    })

    it("passes custom models path", () => {
      expect(SpeakThen).toHaveBeenCalledWith(
        element,
        expect.objectContaining({ basePath: "/custom/models" })
      )
    })

    it("passes custom lang value", () => {
      expect(SpeakThen).toHaveBeenCalledWith(
        element,
        expect.objectContaining({ lang: "de-DE" })
      )
    })
  })

  describe("disconnect", () => {
    it("calls stop() on SpeakThen", async () => {
      const instance = SpeakThen.mock.results[0].value

      element.remove()
      await nextTick()

      expect(instance.stop).toHaveBeenCalled()
    })
  })

  describe("onWake", () => {
    it("adds speak-then-awake class to element", async () => {
      const instance = SpeakThen.mock.results[0].value
      instance.config.onWake()

      expect(element.classList.contains("speak-then-awake")).toBe(true)
    })

    it("dispatches wake event", async () => {
      const handler = vi.fn()
      element.addEventListener("speak-then:wake", handler)

      const instance = SpeakThen.mock.results[0].value
      instance.config.onWake()

      expect(handler).toHaveBeenCalled()
    })

    it("updates indicator target text", async () => {
      vi.clearAllMocks()
      document.body.innerHTML = ""

      element = document.createElement("div")
      element.setAttribute("data-controller", "speak-then")
      element.innerHTML = '<span data-speak-then-target="indicator"></span>'
      document.body.appendChild(element)

      await nextTick()

      const instance = SpeakThen.mock.results[0].value
      instance.config.onWake()

      const indicator = element.querySelector('[data-speak-then-target="indicator"]')
      expect(indicator.textContent).toBe("Listening...")
    })
  })

  describe("onSleep", () => {
    it("removes speak-then-awake class from element", async () => {
      const instance = SpeakThen.mock.results[0].value

      instance.config.onWake()
      expect(element.classList.contains("speak-then-awake")).toBe(true)

      instance.config.onSleep()
      expect(element.classList.contains("speak-then-awake")).toBe(false)
    })

    it("dispatches sleep event", async () => {
      const handler = vi.fn()
      element.addEventListener("speak-then:sleep", handler)

      const instance = SpeakThen.mock.results[0].value
      instance.config.onSleep()

      expect(handler).toHaveBeenCalled()
    })

    it("clears indicator target text", async () => {
      vi.clearAllMocks()
      document.body.innerHTML = ""

      element = document.createElement("div")
      element.setAttribute("data-controller", "speak-then")
      element.innerHTML = '<span data-speak-then-target="indicator">Listening...</span>'
      document.body.appendChild(element)

      await nextTick()

      const instance = SpeakThen.mock.results[0].value
      instance.config.onSleep()

      const indicator = element.querySelector('[data-speak-then-target="indicator"]')
      expect(indicator.textContent).toBe("")
    })
  })

  describe("onError", () => {
    it("dispatches error event with error detail", async () => {
      const handler = vi.fn()
      element.addEventListener("speak-then:error", handler)

      const testError = new Error("Test error")
      const instance = SpeakThen.mock.results[0].value
      instance.config.onError(testError)

      expect(handler).toHaveBeenCalled()
      const event = handler.mock.calls[0][0]
      expect(event.detail.error).toBe(testError)
    })
  })
})

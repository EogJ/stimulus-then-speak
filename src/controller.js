import { Controller } from "@hotwired/stimulus"
import SpeakThen from "./speak_then.js"

export default class extends Controller {
  static values = {
    confidence: { type: Number, default: 0.5 },
    sleep: { type: Number, default: 5000 },
    modelsPath: { type: String, default: "/models" },
    wakeModel: { type: String, default: "hey_jarvis_v0.1.onnx" },
    lang: { type: String, default: "en-US" }
  }

  static targets = ["indicator"]

  async connect() {
    this.speakThen = new SpeakThen(this.element, {
      basePath: this.modelsPathValue,
      wakeModel: this.wakeModelValue,
      confidence: this.confidenceValue,
      sleepAfter: this.sleepValue,
      lang: this.langValue,
      onWake: () => this.onWake(),
      onSleep: () => this.onSleep(),
      onError: (error) => this.onError(error)
    })

    await this.speakThen.start()
  }

  disconnect() {
    this.speakThen?.stop()
  }

  onWake() {
    this.element.classList.add("speak-then-awake")
    if (this.hasIndicatorTarget) {
      this.indicatorTarget.textContent = "Listening..."
    }
    this.dispatch("wake")
  }

  onSleep() {
    this.element.classList.remove("speak-then-awake")
    if (this.hasIndicatorTarget) {
      this.indicatorTarget.textContent = ""
    }
    this.dispatch("sleep")
  }

  onError(error) {
    this.dispatch("error", { detail: { error } })
  }
}

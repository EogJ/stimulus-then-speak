# stimulus-speak-then

Voice-controlled Stimulus actions using local wake word detection.

Say "Hey Jarvis" to wake, then speak commands that trigger Stimulus actions.

## Installation

```bash
npm install stimulus-speak-then
# or
yarn add stimulus-speak-then
```

## Setup

### 1. Install the package

```bash
npm install stimulus-speak-then
# or
yarn add stimulus-speak-then
```

Models are automatically copied to `public/models/` on install.

If automatic install fails, manually copy the models:

```bash
cp node_modules/stimulus-speak-then/models/*.onnx public/models/
```

### 2. Configure ONNX Runtime WASM

The package uses ONNX Runtime for wake word detection, which requires WebAssembly files. You must configure where these files are loaded from **before** importing the controller.

**Option A: Use CDN (recommended for most setups)**

```javascript
// app/javascript/controllers/index.js
import { application } from "./application"
import * as ort from "onnxruntime-web"

// Configure WASM paths BEFORE importing the controller
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/"

// Use dynamic import to ensure WASM config is set first
const { SpeakThenController } = await import("stimulus-speak-then")
application.register("speak-then", SpeakThenController)
```

**Option B: Serve WASM files locally**

Copy WASM files to your public directory:

```bash
cp node_modules/onnxruntime-web/dist/ort-wasm*.wasm public/
```

Then configure:

```javascript
import { application } from "./application"
import * as ort from "onnxruntime-web"

ort.env.wasm.wasmPaths = "/"

const { SpeakThenController } = await import("stimulus-speak-then")
application.register("speak-then", SpeakThenController)
```

### 3. Register the controller (alternative if WASM is pre-configured)

If your bundler already handles WASM files or you've configured `ort.env.wasm.wasmPaths` elsewhere:

```javascript
// app/javascript/controllers/index.js
import { application } from "./application"
import { SpeakThenController } from "stimulus-speak-then"

application.register("speak-then", SpeakThenController)
```

## Usage

Add `speak:command` actions to elements. Say "Hey Jarvis" to wake, then speak the command.

```html
<div data-controller="speak-then">
  <span data-speak-then-target="indicator"></span>
  
  <button data-action="speak:next->player#next">Next</button>
  <button data-action="speak:previous->player#previous">Previous</button>
  <button data-action="speak:pause->player#pause">Pause</button>
</div>
```

### Multi-word commands

Use underscores for multi-word phrases:

```html
<button data-action="speak:play_music->player#play">Play Music</button>
<button data-action="speak:turn_off_lights->home#lightsOff">Lights Off</button>
```

### Configuration

```html
<div data-controller="speak-then"
     data-speak-then-confidence-value="0.5"
     data-speak-then-sleep-value="5000"
     data-speak-then-models-path-value="/models"
     data-speak-then-wake-model-value="hey_jarvis_v0.1.onnx"
     data-speak-then-lang-value="en-US"
     data-speak-then-debug-value="true">
</div>
```

| Value | Default | Description |
|-------|---------|-------------|
| `confidence` | `0.5` | Wake word detection threshold (0-1) |
| `sleep` | `5000` | Ms of silence before sleeping |
| `models-path` | `/models` | Path to ONNX model files |
| `wake-model` | `hey_jarvis_v0.1.onnx` | Wake word model filename |
| `lang` | `en-US` | Language for speech recognition (BCP 47 code) |
| `debug` | `false` | Enable debug logging to console |

### Combining with click actions

```html
<button data-action="click->player#next speak:next->player#next">
  Next
</button>
```

### Listening for events

```html
<div data-controller="speak-then my-controller"
     data-action="speak-then:wake->my-controller#onWake speak-then:sleep->my-controller#onSleep speak-then:error->my-controller#onError">
</div>
```

| Event | Description |
|-------|-------------|
| `speak-then:wake` | Fired when wake word is detected |
| `speak-then:sleep` | Fired when returning to sleep after timeout |
| `speak-then:error` | Fired on errors (detail contains `{ error }`) |

### CSS classes

The controller adds `speak-then-awake` class to the element when listening:

```css
.speak-then-awake {
  border-color: green;
}

.speak-then-awake [data-speak-then-target="indicator"] {
  display: block;
}
```

## Using without the controller

```javascript
import { SpeakThen } from "stimulus-speak-then"

const speakThen = new SpeakThen(element, {
  basePath: "/models",
  wakeModel: "hey_jarvis_v0.1.onnx",
  confidence: 0.5,
  sleepAfter: 5000,
  lang: "en-US",
  onWake: () => console.log("Listening..."),
  onSleep: () => console.log("Sleeping..."),
  onError: (error) => console.error("Error:", error)
})

await speakThen.start()
```

## Custom Wake Words

You can train your own wake word using [openWakeWord](https://github.com/dscripka/openWakeWord).

### Training a Custom Model

1. **Install openWakeWord:**
   ```bash
   pip install openwakeword
   ```

2. **Generate synthetic training data:**
   ```bash
   python -m openwakeword.train_custom_model \
     --phrase "hey computer" \
     --output_dir ./my_wake_word \
     --n_samples 5000
   ```

3. **Train the model:**
   ```bash
   python -m openwakeword.train_custom_model \
     --phrase "hey computer" \
     --output_dir ./my_wake_word \
     --train
   ```

4. **Export to ONNX:**
   The training process outputs an ONNX file (e.g., `hey_computer.onnx`).

5. **Copy to your models directory:**
   ```bash
   cp ./my_wake_word/hey_computer.onnx public/models/
   ```

6. **Configure the controller:**
   ```html
   <div data-controller="speak-then"
        data-speak-then-wake-model-value="hey_computer.onnx">
   </div>
   ```

### Using Pre-trained Models

openWakeWord provides several pre-trained models. Download from the [openWakeWord releases](https://github.com/dscripka/openWakeWord/releases) and copy to your models directory:

- `hey_jarvis_v0.1.onnx` (included)
- `alexa_v0.1.onnx`
- `hey_mycroft_v0.1.onnx`
- `ok_google_v0.1.onnx`

**Note:** The `melspectrogram.onnx` and `embedding_model.onnx` files are shared across all wake word models and must remain in your models directory.

## How it works

1. **Wake word detection** runs locally using ONNX models (~3MB) via WebAssembly
2. **Command recognition** uses the Web Speech API after wake (requires Chrome)
3. Commands dispatch custom events (`speak:command`) that Stimulus routes to actions

## Browser support

- Wake word: Any modern browser (runs in WebAssembly)
- Commands: Chrome/Edge (Web Speech API)

## Requirements

- HTTPS (or localhost) for microphone access
- Chrome/Edge for command recognition after wake

## Troubleshooting

### WASM files not found (404 errors)

If you see errors like:
```
Failed to load resource: the server responded with a status of 404 (Not Found)
wasm streaming compile failed
both async and sync fetching of the wasm failed
```

This means ONNX Runtime can't find its WebAssembly files. Make sure you've configured `ort.env.wasm.wasmPaths` **before** importing the controller. See [Configure ONNX Runtime WASM](#2-configure-onnx-runtime-wasm).

### Models not found

If wake word detection fails silently, verify models were copied:

```bash
ls public/models/
# Should show: embedding_model.onnx  hey_jarvis_v0.1.onnx  melspectrogram.onnx
```

If missing, copy manually:
```bash
mkdir -p public/models
cp node_modules/stimulus-speak-then/models/*.onnx public/models/
```

### Vite/Rails specific issues

With Vite, you must use dynamic imports to ensure WASM configuration happens first:

```javascript
// This won't work - static imports are hoisted
import { SpeakThenController } from "stimulus-speak-then"  // Runs first!
ort.env.wasm.wasmPaths = "..."  // Too late

// This works - dynamic import respects execution order
ort.env.wasm.wasmPaths = "..."  // Runs first
const { SpeakThenController } = await import("stimulus-speak-then")  // Runs second
```

## License

MIT

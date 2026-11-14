// Laki Speech: the talk key's on-device engine (Settings › Voice › Talk key › On this Mac). Apple's Speech framework with
// on-device recognition required (nothing leaves the Mac), the microphone through AVAudioEngine. main (src/main/index.ts)
// starts it, so its privacy grants are Laki's. Built by scripts/after-pack.cjs into Contents/MacOS/laki-speech.
//
//   laki-speech --version     {"version":"1"}
//   laki-speech --locales     {"locales":[…]}: the ones this Mac recognizes on device
//   laki-speech <locale>      listens: JSON lines {"level":0…1}, {"partial":"…"}, {"final":"…"}, {"error":"…","code":"…"}
//
// A line on stdin (or its end), or SIGTERM, stops it: the final text, then exit 0. src/shared/speech.ts reads the lines
import AVFoundation
import Foundation
import Speech

let VERSION = "1"
setvbuf(stdout, nil, _IOLBF, 0)

func say(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  print(s)
  fflush(stdout)
}
func fail(_ msg: String, _ code: String, _ status: Int32 = 1) -> Never {
  say(["error": msg, "code": code])
  exit(status)
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "--version" {
  say(["version": VERSION])
  exit(0)
}
if args.first == "--locales" {
  let ids = SFSpeechRecognizer.supportedLocales().map { $0.identifier }.sorted()
  say(["locales": ids.filter { SFSpeechRecognizer(locale: Locale(identifier: $0))?.supportsOnDeviceRecognition == true }])
  exit(0)
}

let id = args.first ?? Locale.current.identifier
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: id)) else { fail("No speech recognition for \(id)", "locale", 2) }
guard recognizer.supportsOnDeviceRecognition else { fail("\(id) isn't recognized on this Mac", "no-on-device", 2) }

// the grants: asked once by macOS, as Laki (the responsible app)
let asked = DispatchSemaphore(value: 0)
var speechOk = false
SFSpeechRecognizer.requestAuthorization { s in
  speechOk = s == .authorized
  asked.signal()
}
asked.wait()
if !speechOk { fail("Speech recognition is off for Laki: System Settings › Privacy & Security › Speech Recognition", "denied", 3) }
var micOk = false
AVCaptureDevice.requestAccess(for: .audio) { ok in
  micOk = ok
  asked.signal()
}
asked.wait()
if !micOk { fail("The microphone is off for Laki: System Settings › Privacy & Security › Microphone", "mic-denied", 3) }

let request = SFSpeechAudioBufferRecognitionRequest()
request.requiresOnDeviceRecognition = true
request.shouldReportPartialResults = true
if #available(macOS 13, *) { request.addsPunctuation = true }

let engine = AVAudioEngine()
let input = engine.inputNode
var heard = "" // the best transcription so far
var stopping = false
var levelAt = Date.distantPast
input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
  request.append(buffer)
  guard Date().timeIntervalSince(levelAt) > 0.08, let ch = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
  levelAt = Date()
  var sum: Float = 0
  for i in 0..<Int(buffer.frameLength) { sum += ch[i] * ch[i] }
  say(["level": min(1, Double(sqrt(sum / Float(buffer.frameLength))) * 5)]) // speech's RMS is small: about the pill's scale
}
engine.prepare()
do { try engine.start() } catch { fail("The microphone: \(error.localizedDescription)", "mic", 4) }

let task = recognizer.recognitionTask(with: request) { result, error in
  if let r = result {
    heard = r.bestTranscription.formattedString
    if r.isFinal {
      say(["final": heard])
      exit(0)
    }
    say(["partial": heard])
  }
  if let e = error {
    if stopping || !heard.isEmpty {
      say(["final": heard]) // stopped, or it ended with words: those
      exit(0)
    }
    fail(e.localizedDescription, "recognition", 5)
  }
}

func stop() {
  if stopping { return }
  stopping = true
  engine.stop()
  input.removeTap(onBus: 0)
  request.endAudio()
  DispatchQueue.main.asyncAfter(deadline: .now() + 3) { // no final in 3 s: what it had
    task.cancel()
    say(["final": heard])
    exit(0)
  }
}
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { stop() }
term.resume()
DispatchQueue.global().async {
  _ = readLine() // a line, or stdin's end (main gone): stop
  DispatchQueue.main.async { stop() }
}
dispatchMain()

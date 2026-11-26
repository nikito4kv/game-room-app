// Речь для фейкового микрофона Chrome (.dev-stack/speech.wav). Без файла Chrome
// вместо голоса пищит: тон ~0,1 с два раза в секунду, а шумодав оставляет от
// него щелчок ~40 мс в начале. Голос «вообще слышно» так проверить можно, а всё,
// что зависит от речи (рация: дослушали ли конец фразы после отпускания), — нет.
//
// .dev-stack не в git, и в свежей рабочей копии файла нет. Тогда на Windows
// синтезируем его системным голосом (System.Speech, 48 кГц, моно) — так он и
// был сделан впервые. На других системах — предупреждение: положите свой wav.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SPEECH_WAV } from "./env.mjs";

// Почти без запятых: на них синтезатор молчит по 0,2–0,3 с, а нужна сплошная речь.
const RU =
  "Привет всем это проверка голоса в комнате и я говорю спокойно и ровно чтобы было что слушать. " +
  "Сейчас мы доиграем эту партию до конца а потом обсудим кто как ходил и почему всё так получилось. " +
  "Если меня плохо слышно или звук пропадает скажите об этом и я сразу поправлю свой микрофон. " +
  "Погода сегодня хорошая и чай ещё горячий так что продолжаем разговор пока все наконец на месте.";
const EN =
  "Hello everyone this is a voice check in the room and I am speaking calmly and steadily so there is something to hear. " +
  "We will finish this round first and then talk about who played what and why it all turned out this way. " +
  "If you cannot hear me well or the sound drops out just tell me and I will fix my microphone right away. " +
  "The weather is nice today and the tea is still hot so let us keep talking while everyone is finally here.";

const psString = (s) => `'${s.replace(/'/g, "''")}'`;

/** Синтез речи в wav системным голосом Windows: русским, если он есть. */
function synthesize(file) {
  const tmp = `${file}.${process.pid}.tmp`;
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$ru = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
if ($ru) { $s.SelectVoice($ru.VoiceInfo.Name); $text = ${psString(RU)} } else { $text = ${psString(EN)} }
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile(${psString(tmp)}, $fmt)
$s.Speak($text)
$s.Dispose()
`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 },
    );
    // Через временный файл: соседний прогон не подхватит недописанный wav.
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

let resolved;

/** Путь к речи для --use-file-for-fake-audio-capture или null (тогда Chrome пищит). */
export function speechWav() {
  if (resolved !== undefined) return resolved;
  if (!fs.existsSync(SPEECH_WAV) && process.platform === "win32") {
    console.log(`  ·    нет ${SPEECH_WAV} — синтезирую речь системным голосом`);
    try {
      synthesize(SPEECH_WAV);
    } catch (e) {
      console.log(`  !    речь не синтезировалась: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  }
  resolved = fs.existsSync(SPEECH_WAV) ? SPEECH_WAV : null;
  if (!resolved) {
    console.log(
      `  !    нет ${SPEECH_WAV}: микрофон будет пищать вместо речи, замеры речи (хвост рации) не получатся. ` +
        "Положите туда любой wav с речью (48 кГц).",
    );
  }
  return resolved;
}

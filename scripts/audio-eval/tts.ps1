# Синтез фраз голосами Windows для офлайн-оценки обработки голоса.
# Вход — JSON-файл со списком заданий [{ "voice": "Pavel", "text": "...", "out": "C:\...\x.wav" }].
# Голоса OneCore (Pavel, Irina — ru-RU) берём через WinRT, остальные (Zira — en-US) —
# через System.Speech. Файлы, которые уже есть, не пересинтезируются.
param([Parameter(Mandatory = $true)][string]$JobsFile)

$ErrorActionPreference = 'Stop'
$jobs = Get-Content -Raw -Encoding UTF8 $JobsFile | ConvertFrom-Json

$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Speech
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$oneCore = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$classic = New-Object System.Speech.Synthesis.SpeechSynthesizer
$done = 0
foreach ($job in $jobs) {
  if (Test-Path $job.out) { continue }
  $winrtVoice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*$($job.voice)*" } | Select-Object -First 1
  if ($winrtVoice) {
    $oneCore.Voice = $winrtVoice
    $stream = Await ($oneCore.SynthesizeTextToStreamAsync($job.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $size = [uint32]$stream.Size
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $null = Await ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    [System.IO.File]::WriteAllBytes($job.out, $bytes)
  } else {
    $classic.SelectVoice("Microsoft $($job.voice) Desktop")
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $classic.SetOutputToWaveFile($job.out, $format)
    $classic.Speak($job.text)
    $classic.SetOutputToNull()
  }
  $done++
}
"synthesized $done"

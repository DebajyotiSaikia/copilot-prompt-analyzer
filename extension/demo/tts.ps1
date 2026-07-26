# Renders the narration to WAV with the local Windows speech engine.
# No network, no API key. Called by voiceover.mjs.
#
#   powershell -NoProfile -File tts.ps1 -Manifest lines.json -OutDir voice
param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$Voice = '',
  [int]$Rate = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

if ($Voice) {
  $synth.SelectVoice($Voice)
}
else {
  # Prefer a female voice; it reads clearer at small speaker sizes.
  $installed = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
  $pick = $installed | Where-Object { $_.VoiceInfo.Gender -eq 'Female' } | Select-Object -First 1
  if (-not $pick) { $pick = $installed | Select-Object -First 1 }
  $synth.SelectVoice($pick.VoiceInfo.Name)
}

$synth.Rate = $Rate
Write-Output "voice: $($synth.Voice.Name)"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$lines = Get-Content -Raw -Path $Manifest | ConvertFrom-Json
foreach ($line in $lines) {
  $path = Join-Path $OutDir "$($line.id).wav"
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($line.text)
  Write-Output "clip: $($line.id)"
}

$synth.SetOutputToNull()
$synth.Dispose()

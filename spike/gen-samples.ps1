Add-Type -AssemblyName System.Speech
$dir = $PSScriptRoot
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = -1

# Sample A - the filler test.
$s.SetOutputToWaveFile((Join-Path $dir 'sampleA.wav'))
$s.Speak('So, um, I basically, like, built this thing, uh, you know, for tracking, I mean, expenses.')

# Sample B - content accuracy, no fillers. This is the one that came back
# badly mangled from a real microphone.
$s.SetOutputToWaveFile((Join-Path $dir 'sampleB.wav'))
$s.Speak('The salt breeze drifted softly through the cracked window, carrying the faint, rhythmic sound of distant waves hitting the shore. An old wooden chair creaked on the porch as the afternoon sun began to dip below the horizon, painting the sky in soft shades of orange and violet. A solitary seagull circled lazily above the empty docks, searching for a late meal before nightfall settled over the quiet harbor.')

$s.SetOutputToNull()
$s.Dispose()
Get-ChildItem $dir -Filter *.wav | Select-Object Name, Length | Format-Table -AutoSize

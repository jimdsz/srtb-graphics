param(
  [Parameter(Mandatory=$true)][string]$MovPath,
  [Parameter(Mandatory=$true)][string]$PngZipPath,
  [double]$OutAtSeconds = 12,
  [string]$FfmpegPath = 'C:\Program Files\PlayoutPilot\Components\casparcg\current\ffmpeg.exe',
  [string]$FfprobePath = 'C:\Program Files\PlayoutPilot\Components\casparcg\current\ffprobe.exe',
  [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-File([string]$Path,[string]$Label) {
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "$Label absent : $Path" }
  return $resolved
}
function Run-Tool([string]$Executable,[string[]]$Arguments) {
  $output = & $Executable @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Échec $Executable ($LASTEXITCODE)`n$($output -join "`n")" }
  return @($output | ForEach-Object { [string]$_ })
}
function Read-Boxes([string]$Executable,[string[]]$InputArgs,[int]$First,[int]$Last) {
  $filter = "select='between(n,$First,$Last)',alphaextract,bbox=min_val=1"
  $arguments=@('-hide_banner','-loglevel','info') + $InputArgs + @('-vf',$filter,'-fps_mode','passthrough','-f','null','NUL')
  $lines = Run-Tool -Executable $Executable -Arguments $arguments
  $result = @{}
  foreach ($line in $lines) {
    if ($line -notmatch 'Parsed_bbox.*pts:(\d+)') { continue }
    $frame = [int]$Matches[1]
    if ($line -match 'x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+) w:(\d+) h:(\d+)') {
      $result[$frame] = [ordered]@{x=[int]$Matches[1];y=[int]$Matches[3];width=[int]$Matches[5];height=[int]$Matches[6]}
    } else { $result[$frame] = $null }
  }
  for ($frame=$First; $frame -le $Last; $frame++) { if (-not $result.ContainsKey($frame)) { throw "Mesure alpha absente à l'image $frame." } }
  return $result
}
function Read-AlphaHashes([string]$Executable,[string[]]$InputArgs,[int]$First,[int]$Last) {
  $filter = "select='between(n,$First,$Last)',alphaextract"
  $arguments=@('-hide_banner','-loglevel','error') + $InputArgs + @('-vf',$filter,'-fps_mode','passthrough','-f','framemd5','-')
  $lines = Run-Tool -Executable $Executable -Arguments $arguments
  $hashes = @{}
  foreach ($line in $lines) {
    if ($line -match '^\s*\d+,\s*(\d+),\s*(\d+),\s*\d+,\s*\d+,\s*([0-9a-f]+)\s*$') { $hashes[[int]$Matches[2]]=$Matches[3] }
  }
  for ($frame=$First; $frame -le $Last; $frame++) { if (-not $hashes.ContainsKey($frame)) { throw "Empreinte alpha absente à l'image $frame." } }
  return $hashes
}
function Assert-Geometry([string]$Kind,[hashtable]$Boxes,[int]$First) {
  $reference = @(
    @(1408,300,392,440),@(1408,300,392,440),@(1408,301,392,438),@(1408,302,392,436),
    @(1408,304,392,432),@(1408,306,392,428),@(1408,310,392,420),@(1408,314,392,412),
    @(1408,319,392,402),@(1408,326,392,388),@(1408,333,392,374),@(1408,343,392,354),
    @(1408,353,392,334),@(1408,367,392,306),@(1408,382,392,276),@(1408,401,392,238),
    @(1408,423,392,194),@(1408,449,392,142),@(1408,478,392,84),@(1408,503,392,34),$null
  )
  for ($index=0; $index -lt 21; $index++) {
    $frame=$First+$index;$actual=$Boxes[$frame];$expected=$reference[$index]
    if ($null -eq $expected) { if ($null -ne $actual) { throw "$Kind : l'état natif 266 reste visible : $($actual | ConvertTo-Json -Compress)" }; continue }
    if ($null -eq $actual -or $actual.x -ne $expected[0] -or $actual.width -ne $expected[2] -or [Math]::Abs($actual.y-$expected[1]) -gt 2 -or [Math]::Abs($actual.height-$expected[3]) -gt 2) {
      throw "$Kind : trajectoire différente à l'état natif $($index+246) : $($actual | ConvertTo-Json -Compress)"
    }
  }
  for ($frame=$First+21; $frame -le $First+25; $frame++) { if ($null -ne $Boxes[$frame]) { throw "$Kind : post-roll $($frame-$First-20)/5 encore visible." } }
}

$mov = Require-File $MovPath 'MOV'
$zip = Require-File $PngZipPath 'ZIP PNG'
$ffmpeg = Require-File $FfmpegPath 'ffmpeg'
$ffprobe = Require-File $FfprobePath 'ffprobe'
$first = [int][Math]::Round($OutAtSeconds*25)
$nativeEnd = $first+20
$last = $first+25
$expectedFrames = $last+1
$expectedDuration = $expectedFrames/25

$probe = (Run-Tool -Executable $ffprobe -Arguments @('-v','error','-count_packets','-show_entries','stream=index,codec_type,codec_name,pix_fmt,width,height,r_frame_rate,time_base,duration,nb_read_packets:format=duration','-of','json',$mov)) -join "`n" | ConvertFrom-Json
$video = @($probe.streams | Where-Object codec_type -eq 'video')[0]
if ([int]$video.nb_read_packets -ne $expectedFrames -or $video.r_frame_rate -ne '25/1' -or $video.time_base -ne '1/25') { throw "MOV : $expectedFrames images à 25 i/s attendues, reçu $($video.nb_read_packets), $($video.r_frame_rate), $($video.time_base)." }
if ([Math]::Abs([double]$video.duration-$expectedDuration) -gt .001 -or [Math]::Abs([double]$probe.format.duration-$expectedDuration) -gt .001) { throw "MOV : durée $expectedDuration attendue." }
$audio = @($probe.streams | Where-Object codec_type -eq 'audio')
if ($audio.Count -and [Math]::Abs([double]$audio[0].duration-$expectedDuration) -gt .001) { throw 'MOV : la piste audio ne finit pas avec la vidéo.' }

$movInput=@('-i',$mov)
$movBoxes=Read-Boxes -Executable $ffmpeg -InputArgs $movInput -First $first -Last $last
$movHashes=Read-AlphaHashes -Executable $ffmpeg -InputArgs $movInput -First $first -Last $last
Assert-Geometry 'MOV' $movBoxes $first
$terminalHash=$movHashes[$nativeEnd]
for($frame=$nativeEnd+1;$frame -le $last;$frame++){if($movHashes[$frame] -ne $terminalHash){throw "MOV : le post-roll ne tient pas l'état natif 266 à l'image $frame."}}

$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp=[IO.Path]::GetFullPath((Join-Path $tempRoot ('srtb-popup-tail-'+[guid]::NewGuid().ToString('N'))))
if(-not $temp.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Répertoire temporaire hors de la racine système.'}
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  Expand-Archive -LiteralPath $zip -DestinationPath $temp
  $manifest=Get-Content -LiteralPath (Join-Path $temp 'SEQUENCE.json') -Raw | ConvertFrom-Json
  if([int]$manifest.frames -ne $expectedFrames -or [Math]::Abs([double]$manifest.duration-$expectedDuration) -gt .001 -or [int]$manifest.fps -ne 25){throw 'PNG : manifeste de durée ou cadence incorrect.'}
  $pngInput=@('-framerate','25','-start_number','1','-i',(Join-Path $temp 'images\image_%06d.png'))
  $pngBoxes=Read-Boxes -Executable $ffmpeg -InputArgs $pngInput -First $first -Last $last
  $pngHashes=Read-AlphaHashes -Executable $ffmpeg -InputArgs $pngInput -First $first -Last $last
  Assert-Geometry 'PNG' $pngBoxes $first
  $terminalHash=$pngHashes[$nativeEnd]
  for($frame=$nativeEnd+1;$frame -le $last;$frame++){if($pngHashes[$frame] -ne $terminalHash){throw "PNG : le post-roll ne tient pas l'état natif 266 à l'image $frame."}}
} finally {
  $resolvedTemp=[IO.Path]::GetFullPath($temp)
  if($resolvedTemp.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemp).StartsWith('srtb-popup-tail-')){Remove-Item -LiteralPath $resolvedTemp -Recurse -Force}
}

function Boxes-ForJson([hashtable]$Boxes,[int]$First,[int]$Last){
  return @($First..$Last | ForEach-Object {[ordered]@{frame=$_;box=$Boxes[$_]}})
}
$report=[ordered]@{
  result='PASS';checkedAt=(Get-Date).ToUniversalTime().ToString('o');mov=$mov;pngZip=$zip
  expected=[ordered]@{frames=$expectedFrames;duration=$expectedDuration;fps=25;outStart=$first;nativeStates='246..266';terminalHold="$($nativeEnd+1)..$last"}
  movProbe=$probe;movBoxes=(Boxes-ForJson $movBoxes $first $last);pngBoxes=(Boxes-ForJson $pngBoxes $first $last)
}
$json=$report | ConvertTo-Json -Depth 20
if($ReportPath){$target=[IO.Path]::GetFullPath($ReportPath);[IO.File]::WriteAllText($target,$json,[Text.UTF8Encoding]::new($false))}
$json

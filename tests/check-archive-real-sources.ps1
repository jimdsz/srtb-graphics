param(
  [Parameter(Mandatory=$true)][string]$ArchivePath,
  [Parameter(Mandatory=$true)][string[]]$SourceFiles
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$expectedFiles=@{}
foreach($sourcePath in $SourceFiles){
  $source=Get-Item -LiteralPath $sourcePath
  if($source.PSIsContainer -or $expectedFiles.ContainsKey($source.Name)){throw 'Les sources explicites doivent etre des fichiers uniques.'}
  $expectedFiles[$source.Name]=@{Bytes=$source.Length;Sha256=(Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$resolvedArchive=(Resolve-Path -LiteralPath $ArchivePath).Path
$archive=[IO.Compression.ZipFile]::OpenRead($resolvedArchive)
try{
  $manifestEntry=$archive.GetEntry('INVENTAIRE.json')
  if(-not $manifestEntry -or $manifestEntry.Length -gt 131072){throw 'Inventaire absent ou excessif.'}
  $reader=[IO.StreamReader]::new($manifestEntry.Open())
  try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  if($manifest.format -ne 'srtb-derivation-files' -or $manifest.version -ne 1 -or -not $manifest.complete -or $manifest.omitted.Count -ne 0){throw 'Ce controle exige une archive complete.'}
  if($manifest.files.Count -ne $expectedFiles.Count -or $manifest.includedCount -ne $expectedFiles.Count -or $manifest.requestedCount -ne $expectedFiles.Count -or $archive.Entries.Count -ne ($expectedFiles.Count+1)){throw 'Nombre de fichiers incoherent.'}
  $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $originals=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $checks=foreach($file in $manifest.files){
    if(-not $names.Add($file.filename) -or $file.filename -match '[\\/]' -or -not $originals.Add($file.originalFilename)){throw 'Nom duplique ou chemin.'}
    $expected=$expectedFiles[$file.originalFilename]
    if(-not $expected){throw 'Source non fournie explicitement.'}
    $entry=$archive.GetEntry($file.filename)
    if(-not $entry -or $entry.Length -ne $expected.Bytes -or $entry.Length -ne $file.bytes){throw 'Taille differente de la source.'}
    $stream=$entry.Open();$digest=[Security.Cryptography.SHA256]::Create()
    try{$actual=[Convert]::ToHexString($digest.ComputeHash($stream)).ToLowerInvariant()}finally{$stream.Dispose();$digest.Dispose()}
    if($actual -ne $expected.Sha256 -or $actual -ne $file.sha256){throw 'Octets differents de la source ou de l inventaire.'}
    [pscustomobject]@{Name=$file.filename;Bytes=$entry.Length;Sha256=$actual;ExactSource=$true}
  }
  [pscustomobject]@{Archive=$resolvedArchive;Complete=$true;Count=$checks.Count;Files=$checks}|ConvertTo-Json -Depth 5
}finally{$archive.Dispose()}

param([Parameter(Mandatory=$true)][string]$ArchivePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$resolvedArchive=(Resolve-Path -LiteralPath $ArchivePath).Path
$archive=[IO.Compression.ZipFile]::OpenRead($resolvedArchive)
try {
  $manifestEntry=$archive.GetEntry('INVENTAIRE.json')
  if(-not $manifestEntry){throw 'Inventaire absent.'}
  $manifestReader=[IO.StreamReader]::new($manifestEntry.Open())
  try{$manifest=$manifestReader.ReadToEnd() | ConvertFrom-Json}finally{$manifestReader.Dispose()}
  if($manifest.format -ne 'srtb-derivation-files' -or $manifest.version -ne 1){throw 'Format inattendu.'}
  if($manifest.includedCount -ne $manifest.files.Count -or $archive.Entries.Count -ne ($manifest.files.Count+1)){throw 'Nombre de fichiers incoherent.'}
  if($manifest.requestedCount -ne ($manifest.files.Count+$manifest.omitted.Count)){throw 'Sorties omises incoherentes.'}
  if($manifest.complete -ne ($manifest.omitted.Count -eq 0)){throw 'Statut complet incorrect.'}
  $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $checks=foreach($file in $manifest.files){
    if(-not $names.Add($file.filename) -or $file.filename -match '[\\/]'){throw 'Nom duplique ou chemin.'}
    $entry=$archive.GetEntry($file.filename)
    if(-not $entry -or $entry.Length -ne $file.bytes){throw 'Taille de fichier incoherente.'}
    $entryStream=$entry.Open();$digest=[Security.Cryptography.SHA256]::Create()
    try{$actual=[Convert]::ToHexString($digest.ComputeHash($entryStream)).ToLowerInvariant()}finally{$entryStream.Dispose();$digest.Dispose()}
    if($actual -ne $file.sha256){throw 'Empreinte differente de l inventaire.'}
    # Independent deterministic source used by the browser fixture, not bytes
    # supplied by the archive writer or its hash implementation.
    if($file.projectId -notmatch '^fixture-project-(\d+)$'){throw 'Ce controle attend les seules donnees synthetiques du banc.'}
    $index=[int]$Matches[1];$expected=[byte[]]::new(512*1024)
    for($offset=0;$offset -lt $expected.Length;$offset++){$expected[$offset]=($offset+$index*29)%256}
    $digest=[Security.Cryptography.SHA256]::Create()
    try{$expectedHash=[Convert]::ToHexString($digest.ComputeHash($expected)).ToLowerInvariant()}finally{$digest.Dispose()}
    if($actual -ne $expectedHash){throw 'Les octets du fichier ne correspondent pas a la source independante.'}
    [pscustomobject]@{Name=$entry.FullName;Bytes=$entry.Length;Sha256=$actual;ExactSource=$true}
  }
  [pscustomobject]@{Archive=$resolvedArchive;Complete=$manifest.complete;Included=$manifest.includedCount;Requested=$manifest.requestedCount;Omitted=$manifest.omitted.Count;Files=$checks} | ConvertTo-Json -Depth 5
}finally{$archive.Dispose()}

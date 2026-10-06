# Builds the RVGD photo galleries. Run after adding photos (or double-click build-gallery.cmd).
# Drop original photos into rvgd-app/gallery/rvgd-<tournament number>/ (jpg or png).
# For each one this writes, next to it:
#   _web/<name>.jpg    full-screen copy, longest side 1800px
#   _thumb/<name>.jpg  grid thumbnail, longest side 480px
# and rvgd-app/gallery/index.json, which the page reads to know which tournaments have photos.
# Photos are turned the right way up (phone EXIF orientation) and shown in file-name order.
# Originals are git-ignored; only _web, _thumb and index.json are published.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'

function Save-Resized($img, $path, $max, $quality) {
  $scale = [Math]::Min(1.0, [double]$max / [Math]::Max($img.Width, $img.Height))
  $w = [int][Math]::Round($img.Width * $scale); $h = [int][Math]::Round($img.Height * $scale)
  $bmp = [Drawing.Bitmap]::new($w, $h)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'HighQuality'
  $g.Clear([Drawing.Color]::Black)
  $g.DrawImage($img, 0, 0, $w, $h)
  $params = New-Object Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]$quality)
  $bmp.Save($path, $jpeg, $params)
  $g.Dispose(); $bmp.Dispose()
}

$index = [ordered]@{}
foreach ($dir in Get-ChildItem $root -Directory | Where-Object Name -match '^rvgd-' | Sort-Object Name) {
  $web = Join-Path $dir.FullName '_web'; $thumb = Join-Path $dir.FullName '_thumb'
  New-Item -ItemType Directory -Force $web, $thumb | Out-Null
  $files = @(Get-ChildItem $dir.FullName -File | Where-Object Extension -match '^\.(jpe?g|png)$' | Sort-Object Name)
  $names = @()
  foreach ($f in $files) {
    $out = $f.BaseName + '.jpg'
    $names += $out
    $w = Join-Path $web $out; $t = Join-Path $thumb $out
    if ((Test-Path $w) -and (Test-Path $t) -and (Get-Item $w).LastWriteTime -ge $f.LastWriteTime) { continue }
    $img = [Drawing.Image]::FromFile($f.FullName)
    try {
      # EXIF orientation (tag 0x0112): phones store photos sideways and rely on this flag.
      if ($img.PropertyIdList -contains 0x0112) {
        $flip = @{ 2 = 'RotateNoneFlipX'; 3 = 'Rotate180FlipNone'; 4 = 'Rotate180FlipX'; 5 = 'Rotate90FlipX'; 6 = 'Rotate90FlipNone'; 7 = 'Rotate270FlipX'; 8 = 'Rotate270FlipNone' }[[int]$img.GetPropertyItem(0x0112).Value[0]]
        if ($flip) { $img.RotateFlip($flip) }
      }
      Save-Resized $img $w 1800 82
      Save-Resized $img $t 480 75
      "  + $($dir.Name)/$out"
    } finally { $img.Dispose() }
  }
  # Drop copies whose original has been removed.
  foreach ($old in @(Get-ChildItem $web, $thumb -File | Where-Object { $names -notcontains $_.Name })) { Remove-Item $old.FullName; "  - $($dir.Name)/$($old.Name)" }
  if ($names.Count) { $index[$dir.Name] = $names }
  '{0,-10} {1} photos' -f $dir.Name, $names.Count
}

$json = ConvertTo-Json -InputObject $index -Depth 3 -Compress
# ConvertTo-Json in PowerShell 5 turns a one-item array into a plain string; keep every list an array.
foreach ($k in @($index.Keys)) { if ($index[$k].Count -eq 1) { $json = $json.Replace("""$k"":""$($index[$k][0])""", """$k"":[""$($index[$k][0])""]") } }
[IO.File]::WriteAllText((Join-Path $root 'index.json'), $json, (New-Object Text.UTF8Encoding $false))
'index.json written.'

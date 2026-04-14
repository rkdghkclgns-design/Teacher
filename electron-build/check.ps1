$distDir = Join-Path $PSScriptRoot "dist"
$files = Get-ChildItem $distDir -Filter "*.exe" -ErrorAction SilentlyContinue
if ($files) {
    foreach ($f in $files) {
        $sizeMB = [math]::Round($f.Length / 1MB, 1)
        Write-Host "$($f.Name)  -  $sizeMB MB"
    }
} else {
    Write-Host "No .exe found in dist/"
}

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$appDir = Join-Path $PSScriptRoot "app"
$jsDir = Join-Path $appDir "js"
$assetsDir = Join-Path $appDir "assets"

# 폴더 생성
New-Item -ItemType Directory -Path $jsDir -Force | Out-Null
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null

# HTML 복사 후 file:// 감지 코드 제거
$htmlContent = Get-Content (Join-Path $root "디벨로켓 교안 도우미.html") -Raw -Encoding UTF8
# file:// 프로토콜 차단 스크립트 제거 (Electron은 file:// 로 로드하므로)
$pattern = "(?s)<script>\s*// file:// 프로토콜 감지.*?</script>"
$htmlContent = [regex]::Replace($htmlContent, $pattern, "<!-- file:// check removed for Electron -->")
[System.IO.File]::WriteAllText((Join-Path $appDir "index.html"), $htmlContent, [System.Text.Encoding]::UTF8)
Write-Host "[OK] HTML copied as index.html (file:// check removed)"

# JS 파일 복사
$jsFiles = Get-ChildItem (Join-Path $root "js") -Filter "*.js"
foreach ($f in $jsFiles) {
    Copy-Item $f.FullName $jsDir -Force
}
Write-Host "[OK] $($jsFiles.Count) JS files copied"

# Assets 복사
$assetFiles = Get-ChildItem (Join-Path $root "assets") -ErrorAction SilentlyContinue
foreach ($f in $assetFiles) {
    Copy-Item $f.FullName $assetsDir -Force
}
Write-Host "[OK] Assets copied"

Write-Host ""
Write-Host "[OK] Setup complete!"

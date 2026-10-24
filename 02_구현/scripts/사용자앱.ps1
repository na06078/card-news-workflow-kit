# 카드뉴스 전용 콘솔. 이 PowerShell 프로세스의 환경만 설정합니다.
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = '카드뉴스 실사용 테스트 - 5173'
$App = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $App
$NodeDir = Join-Path $App '.도구\node-v24.22.1-win-x64'
$Node = Join-Path $NodeDir 'node.exe'
$Data = Join-Path $App '실행데이터\연결준비'
New-Item -ItemType Directory -Force (Join-Path $Data '앱임시') | Out-Null
$env:Path = "$NodeDir;$env:Path"
$env:TEMP = Join-Path $Data '앱임시'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $App '.브라우저'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
@{consolePid=$PID;title=$Host.UI.RawUI.WindowTitle;startedAt=[DateTime]::UtcNow.ToString('o');app=$App;url='http://127.0.0.1:5173'} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Data '사용자콘솔.json')
Write-Host '브라우저: http://127.0.0.1:5173'
Write-Host '기존 로그인 사용 / 실제 검색·이미지는 브라우저에서 직접 시작하세요.'
Write-Host '이 앱을 종료할 때는 이 창에서만 Ctrl+C. Hermes는 종료하지 마세요.'
& $Node 'scripts/개발실행.mjs'
if ($LASTEXITCODE -ne 0) { Write-Host "앱 종료 코드: $LASTEXITCODE"; Read-Host '오류를 확인한 후 Enter' }

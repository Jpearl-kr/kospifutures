<#
Rebuild assets/option-board.json from the newest 옵션전광판 export and push it.

Why this has to run here and not on a server: exports/ is gitignored and
lives only on this PC, and the bid/ask ladder in those files is not in the
KRX Open API (which publishes closing prices only). Vercel therefore has no
way to produce this data on its own — the only thing that can refresh the
Strategy Builder board is this machine, after the day's export is written.

Run it manually, or from Task Scheduler on trading days after the close:

  schtasks /create /tn "kospifutures board" /tr ^
    "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\zube_home\Documents\kospifutures\tools\publish_option_board.ps1" ^
    /sc weekly /d MON,TUE,WED,THU,FRI /st 16:10

It only commits when the rebuilt file actually differs, so a day with no
new export (or a re-run) is a no-op rather than an empty commit.
#>

[CmdletBinding()]
param(
    # Branch to publish to. dev is what Vercel serves as the preview site.
    [string]$Branch = 'dev',
    # Build the JSON but don't commit or push.
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Write-Host "[$stamp] rebuilding option board in $repo"

# py.exe is the launcher installed with Python on Windows; fall back to python.
$python = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { 'python' }

& $python tools/build_option_board.py
if ($LASTEXITCODE -ne 0) {
    throw "build_option_board.py failed with exit code $LASTEXITCODE"
}

if ($NoPush) {
    Write-Host 'NoPush set - built only, nothing committed.'
    exit 0
}

# Nothing to do unless the rebuild actually changed the committed file. A
# trading day whose export never arrived leaves it byte-identical.
$changed = git status --porcelain -- assets/option-board.json
if (-not $changed) {
    Write-Host 'option-board.json unchanged - no new export to publish.'
    exit 0
}

$current = (git rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) {
    throw "on branch '$current', expected '$Branch' — not committing. Switch branches, or pass -Branch $current."
}

# Stage only the derived file: never let a stray local edit ride along.
git add -- assets/option-board.json
if ($LASTEXITCODE -ne 0) { throw 'git add failed' }

$snapshot = (Get-Content assets/option-board.json -Raw | ConvertFrom-Json).snapshot
git commit -m "Update option board snapshot to $snapshot"
if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }

git push origin $Branch
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }

Write-Host "published board snapshot $snapshot to $Branch"

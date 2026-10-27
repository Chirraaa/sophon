$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$cacheDirectory = Join-Path $projectDirectory '.cache'
$sourceDirectory = Join-Path $cacheDirectory 'whisper-source'
$buildDirectory = Join-Path $cacheDirectory 'whisper-build'
$voiceDirectory = Join-Path $projectDirectory 'resources/whisper'
New-Item -ItemType Directory -Force -Path $cacheDirectory, $voiceDirectory | Out-Null


$cmakeCommand = Get-Command cmake -ErrorAction SilentlyContinue
$cmakePath = if ($cmakeCommand) { $cmakeCommand.Source } else { $null }
if (-not $cmakePath) {
  $vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  if (Test-Path -LiteralPath $vswherePath) {
    $installation = & $vswherePath -latest -products '*' -property installationPath
    if ($installation) {
      $candidate = Join-Path $installation 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
      if (Test-Path -LiteralPath $candidate) { $cmakePath = $candidate }
    }
  }
}
if (-not $cmakePath) { throw 'Install Visual Studio Build Tools with Desktop development with C++ (including CMake), then run npm run setup:voice again.' }

if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory 'CMakeLists.txt'))) {
  & git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git $sourceDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Could not download whisper.cpp source.' }
}
$expectedRevision = 'd1be6fde11ac6e0407606b4e42fe72d34add8037'
$sourceRevision = & git -C $sourceDirectory rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $sourceRevision -ne $expectedRevision) { throw 'Whisper source revision does not match the reviewed v1.9.5 commit.' }
$sourceChanges = & git -C $sourceDirectory status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0 -or $sourceChanges) { throw 'Whisper source cache is modified. Review it before building.' }
& $cmakePath -S $sourceDirectory -B $buildDirectory -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF -DGGML_CUDA=OFF -DGGML_NATIVE=OFF
if ($LASTEXITCODE -ne 0) { throw 'Could not configure whisper.cpp. Check that the Visual Studio C++ workload is installed.' }
& $cmakePath --build $buildDirectory --config Release --target whisper-server --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Could not build whisper-server.' }
$program = Get-ChildItem -LiteralPath $buildDirectory -Filter whisper-server.exe -Recurse | Select-Object -First 1
if (-not $program) { throw 'The build did not produce whisper-server.exe.' }
$voiceManifest = Get-Content -LiteralPath (Join-Path $projectDirectory 'src/main/voice/manifest.json') -Raw | ConvertFrom-Json
$candidateFiles = [ordered]@{}
$nativeNames = $voiceManifest.files.PSObject.Properties.Name | Where-Object { [IO.Path]::GetExtension($_) -in '.exe', '.dll' }
$buildMatches = $true
foreach ($nativeName in $nativeNames) {
  $nativePath = Join-Path $program.DirectoryName $nativeName
  $nativeHash = (Get-FileHash -LiteralPath $nativePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $candidateFiles[$nativeName] = $nativeHash
  if ($nativeHash -ne $voiceManifest.files.$nativeName) { $buildMatches = $false }
}
$candidateFiles['ggml-base.bin'] = $voiceManifest.files.'ggml-base.bin'
if (-not $buildMatches) {
  $candidatePath = Join-Path $buildDirectory 'voice-manifest.candidate.json'
  [ordered]@{ schemaVersion = 1; source = $voiceManifest.source; files = $candidateFiles } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $candidatePath -Encoding utf8
  throw "Compiler output differs from the reviewed voice manifest. Existing voice resources were preserved. Review $candidatePath and the build provenance, then deliberately update src/main/voice/manifest.json and rebuild the signed app. Never accept new hashes automatically."
}
foreach ($nativeName in $nativeNames) {
  Copy-Item -LiteralPath (Join-Path $program.DirectoryName $nativeName) -Destination $voiceDirectory -Force
}

$modelPath = Join-Path $voiceDirectory 'ggml-base.bin'

$expectedHash = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host 'Downloading the multilingual Whisper base model (about 148 MB)...'
  $partialPath = "$modelPath.download"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' -OutFile $partialPath
  if ((Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash -ine $expectedHash) { throw 'The downloaded model checksum did not match. Run setup again.' }
  Move-Item -LiteralPath $partialPath -Destination $modelPath -Force
}
if ((Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash -ine $expectedHash) { throw 'The existing base model checksum did not match. Choose a verified model in Settings > Voice.' }
Write-Host "Voice is ready. Files are in $voiceDirectory. Restart npm run dev."
